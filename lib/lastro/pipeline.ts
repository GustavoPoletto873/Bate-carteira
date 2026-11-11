/** Junta as etapas: documentos da pasta → análise → conferência → resultado para a tela e o Excel. */
import { CAMPOS, conferir, TOLERANCIA_CENTAVOS, unicos, type ResultadoConferencia, type Situacao } from "./conciliacao";
import { analisar, documentoComErro, type Documento } from "./documentos";
import { classificar, extrairTexto, type PdfJs } from "./extratores";
import type { Posicao, Workpaper } from "./planilhas";
import { fmtData, fmtValor } from "./textos";

export interface ArquivoEntrada {
  nome: string;
  caminho: string;
  ler: () => Promise<Uint8Array>;
}

export type Progresso = (atual: number, total: number, texto: string) => void;

export async function lerDocumentos(
  arquivos: ArquivoEntrada[], pdfjs: PdfJs, opcoesPdf: Record<string, unknown> = {}, progresso?: Progresso,
): Promise<{ docs: Documento[]; ignorados: { nome: string; motivo: string }[] }> {
  const ler = arquivos.filter((a) => classificar(a.nome) === "ler");
  const ignorados = arquivos
    .map((a) => ({ nome: a.caminho, motivo: classificar(a.nome) }))
    .filter((a) => a.motivo !== "ler" && a.motivo !== "silencio");
  const docs: Documento[] = [];
  for (let i = 0; i < ler.length; i++) {
    const arq = ler[i];
    progresso?.(i, ler.length, `Lendo ${arq.nome}`);
    try {
      const t = await extrairTexto(arq.nome, await arq.ler(), pdfjs, opcoesPdf);
      docs.push(analisar(arq.nome, t.texto, {
        caminho: arq.caminho, tipo: t.tipo, paginasLidas: t.paginasLidas, paginasTotal: t.paginasTotal, aviso: t.aviso,
      }));
    } catch (e) {
      docs.push(documentoComErro(arq.nome, arq.caminho, `não foi possível ler: ${String((e as Error)?.message ?? e).slice(0, 150)}`));
    }
    await new Promise((r) => setTimeout(r, 0)); // deixa a tela respirar entre um documento e outro
  }
  progresso?.(ler.length, ler.length, "Documentos lidos");
  return { docs, ignorados };
}

export interface Resumo {
  fundo: string;
  cnpj: string;
  dataBase: string;
  fonteBritech: string;
  workpaper: string;
  pastaLastro: string;
  posicoesBritech: number;
  linhasWpTermo: number;
  documentosLidos: number;
  documentosSemTexto: number;
  arquivosIgnorados: number;
  contagem: Partial<Record<Situacao, number>>;
  geradoEm: string;
  tolerancia: string;
}

export interface ResultadoCompleto extends ResultadoConferencia {
  resumo: Resumo;
  ignorados: { nome: string; motivo: string }[];
  avisos: string[];
}

export function montarResultado(args: {
  workpaper: Workpaper; posicoes: Posicao[]; docs: Documento[]; ignorados: { nome: string; motivo: string }[];
  dataBase: string | null; fonteBritech: string; pastaLastro: string; avisos?: string[];
}): ResultadoCompleto {
  const { workpaper, posicoes, docs, ignorados } = args;
  const conferencia = conferir(posicoes, workpaper.linhas, docs, workpaper.cnpj);
  const semTexto = docs.filter((d) => d.erro).length;
  const avisos = [...(args.avisos ?? [])];
  if (!docs.length) avisos.push("A pasta de lastro e termo não tem documentos legíveis (PDF, HTML, DOCX ou TXT).");
  return {
    ...conferencia, ignorados, avisos,
    resumo: {
      fundo: workpaper.fundo, cnpj: workpaper.cnpj, dataBase: fmtData(args.dataBase), fonteBritech: args.fonteBritech,
      workpaper: workpaper.arquivo, pastaLastro: args.pastaLastro, posicoesBritech: posicoes.length,
      linhasWpTermo: workpaper.linhas.length, documentosLidos: docs.length - semTexto, documentosSemTexto: semTexto,
      arquivosIgnorados: ignorados.length, contagem: conferencia.contagem,
      geradoEm: new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }),
      tolerancia: fmtValor(TOLERANCIA_CENTAVOS),
    },
  };
}

// ------------------------------------------------------------------ Excel

const CORES: Record<string, string> = {
  Confere: "FFC6EFCE", OK: "FFC6EFCE", Diverge: "FFFFC7CE", Divergente: "FFFFC7CE", "Só no WP": "FFFFC7CE",
  Verificar: "FFFFEB9C", "Não localizado": "FFEDEDED", "Sem documentos": "FFEDEDED",
};

export async function gerarExcel(r: ResultadoCompleto): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Bate Carteira x Lastro";

  const aba = (titulo: string, cabecalho: string[], linhas: (string | number)[][], larguras: Record<string, number> = {}, status: string[] = []) => {
    const ws = wb.addWorksheet(titulo, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(cabecalho);
    ws.getRow(1).eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
      c.alignment = { wrapText: true, vertical: "middle" };
    });
    linhas.forEach((l) => ws.addRow(l));
    const indices = status.map((s) => cabecalho.indexOf(s) + 1).filter((i) => i > 0);
    ws.eachRow((row, n) => {
      if (n === 1) return;
      for (const i of indices) {
        const cor = CORES[String(row.getCell(i).value ?? "")];
        if (cor) row.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: cor } };
      }
    });
    cabecalho.forEach((nome, i) => {
      ws.getColumn(i + 1).width = larguras[nome] ?? Math.min(Math.max(nome.length + 2, 12), 40);
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cabecalho.length } };
  };

  const cab = ["Situação", "Ativo", "Emissor (Britech)", "Cód. Britech", "Dt. Aquisição",
    "VL Aplic. Britech", "VL Aplic. WP", "VL Aplic. WP x Britech", "VL Aplic. documentos", "VL Aplic. docs",
    "Dt. Emissão Britech", "Dt. Emissão WP", "Dt. Emissão WP x Britech", "Dt. Emissão documentos", "Dt. Emissão docs",
    "Dt. Vencimento Britech", "Dt. Vencimento WP", "Dt. Vencimento WP x Britech", "Dt. Vencimento documentos",
    "Dt. Vencimento docs", "Emissor nos documentos", "Emissor docs", "No WP_Termo", "Linha WP", "Documentos usados",
    "Observações"];
  const linhas = r.linhas.map((ln) => {
    const c = ln.campos;
    const fontes = unicos(Object.values(c).flatMap((x) => x.fontes));
    const notas = CAMPOS.filter(([k]) => c[k].nota).map(([k, rot]) => `${rot}: ${c[k].nota}`);
    return [ln.situacao, ln.ativo, ln.emissor, ln.codigo, ln.dataAquisicao,
      c.valor.britech, c.valor.wp, c.valor.wpStatus, c.valor.documentos, c.valor.status,
      c.emissao.britech, c.emissao.wp, c.emissao.wpStatus, c.emissao.documentos, c.emissao.status,
      c.vencimento.britech, c.vencimento.wp, c.vencimento.wpStatus, c.vencimento.documentos, c.vencimento.status,
      c.emissor.documentos, c.emissor.status, ln.noWp ? "Sim" : "Não", ln.wpLinha ?? "", fontes.join(" | "), notas.join("\n")];
  });
  aba("Conciliação", cab, linhas, { Ativo: 45, "Emissor (Britech)": 36, "Documentos usados": 60, Observações: 70, "Emissor nos documentos": 36 },
    ["Situação", "VL Aplic. WP x Britech", "VL Aplic. docs", "Dt. Emissão WP x Britech", "Dt. Emissão docs",
      "Dt. Vencimento WP x Britech", "Dt. Vencimento docs", "Emissor docs"]);

  const rotulos = Object.fromEntries(CAMPOS);
  aba("Evidências", ["Ativo", "VL Aplic. Britech", "Campo", "Encontrado no documento", "x Britech", "Ligação com a posição", "Documento", "Trecho do documento"],
    r.linhas.flatMap((ln) => ln.evidencias.map((e) => [ln.ativo, ln.valorAplicado, rotulos[e.campo], e.valor,
      e.confere ? "Confere" : "Diverge", e.nivel, e.documento, e.trecho])),
    { Ativo: 45, Documento: 55, "Trecho do documento": 110 }, ["x Britech"]);

  aba("Documentos", ["Arquivo", "Tipo", "Páginas lidas", "Cita o CNPJ do fundo", "Ligado a", "Observação"], [
    ...r.documentos.map((d) => [d.caminho, d.tipo, d.paginas, d.citaCnpjFundo ? "Sim" : "Não", d.vinculos.join("\n"), d.observacao]),
    ...r.ignorados.map((i) => [i.nome, "", "", "", "", i.motivo]),
  ], { Arquivo: 60, "Ligado a": 70, Observação: 50 });

  const s = r.resumo;
  aba("Parâmetros", ["Item", "Valor"], [
    ["Fundo", s.fundo], ["CNPJ", s.cnpj], ["Data-base", s.dataBase], ["Carteira Britech", s.fonteBritech],
    ["Workpaper", s.workpaper], ["Pasta de lastro e termo", s.pastaLastro], ["Títulos da Britech conferidos", s.posicoesBritech],
    ["Linhas na WP_Termo", s.linhasWpTermo], ["Documentos lidos", s.documentosLidos], ["Documentos sem texto", s.documentosSemTexto],
    ["Arquivos não lidos", s.arquivosIgnorados], ["Tolerância de valor (R$)", s.tolerancia], ["Gerado em", s.geradoEm],
    ...r.avisos.map((a) => ["Aviso", a]),
  ], { Item: 32, Valor: 110 });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
