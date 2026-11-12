/** Junta as etapas: documentos da pasta → análise → conferência → resultado para a tela e o Excel. */
import { camposDe, conferir, recortarPelaWp, TOLERANCIA_CENTAVOS, unicos, type ResultadoConferencia, type Situacao } from "./conciliacao";
import type { PontoCdi } from "./indexadores";
import { ehEstoque, validarCarteira, type ValidacaoCarteira } from "./validacao-carteira";
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

/** Documentos lidos ao mesmo tempo. */
const LEITURAS_SIMULTANEAS = 4;

export async function lerDocumentos(
  arquivos: ArquivoEntrada[], pdfjs: PdfJs, opcoesPdf: Record<string, unknown> = {}, progresso?: Progresso,
): Promise<{ docs: Documento[]; ignorados: { nome: string; motivo: string }[] }> {
  const ler = arquivos.filter((a) => classificar(a.nome) === "ler");
  const ignorados = arquivos
    .map((a) => ({ nome: a.caminho, motivo: classificar(a.nome) }))
    .filter((a) => a.motivo !== "ler" && a.motivo !== "silencio");
  // vários de uma vez: boa parte do tempo é esperar o arquivo chegar do Drive
  const docs: Documento[] = new Array(ler.length);
  let proximo = 0;
  let prontos = 0;
  const trabalhar = async () => {
    while (proximo < ler.length) {
      const i = proximo++;
      const arq = ler[i];
      progresso?.(prontos, ler.length, `Lendo ${arq.nome}`);
      try {
        const t = await extrairTexto(arq.nome, await arq.ler(), pdfjs, opcoesPdf);
        docs[i] = analisar(arq.nome, t.texto, {
          caminho: arq.caminho, tipo: t.tipo, paginasLidas: t.paginasLidas, paginasTotal: t.paginasTotal, aviso: t.aviso,
          paginas: t.paginas,
        });
      } catch (e) {
        docs[i] = documentoComErro(arq.nome, arq.caminho, `não foi possível ler: ${String((e as Error)?.message ?? e).slice(0, 150)}`);
      }
      prontos++;
      await new Promise((r) => setTimeout(r, 0)); // deixa a tela respirar entre um documento e outro
    }
  };
  await Promise.all(Array.from({ length: Math.min(LEITURAS_SIMULTANEAS, ler.length) }, trabalhar));
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
  /** documentos lidos (texto, valores e datas com rótulo e página) — para a busca nos PDFs */
  docs: Documento[];
  /** abre de novo um arquivo da pasta de lastro (para o visualizador); ausente nos testes */
  abrir?: (caminho: string) => Promise<Uint8Array>;
  ignorados: { nome: string; motivo: string }[];
  avisos: string[];
  /** validação da carteira como a aba CVM do workpaper (null se o WP não tem a aba carteiraInforme) */
  validacao: ValidacaoCarteira | null;
}

export function montarResultado(args: {
  workpaper: Workpaper; posicoes: Posicao[]; docs: Documento[]; ignorados: { nome: string; motivo: string }[];
  dataBase: string | null; fonteBritech: string; pastaLastro: string; avisos?: string[];
  /** série do CDI para os títulos com taxa (Nota Comercial, CCB, CRI…) */
  cdi?: PontoCdi[];
  /** arquivos da pasta de lastro, para o visualizador abrir o documento */
  arquivos?: ArquivoEntrada[];
  /** estoque completo, só para validar a carteira quando a carteira conferida é a amostra */
  estoque?: { posicoes: Posicao[]; origem: string };
}): ResultadoCompleto {
  const { workpaper, docs, ignorados } = args;
  // a carteira conferida já é o estoque inteiro? senão, o estoque extra (se houver)
  const estoqueValidacao = ehEstoque(args.posicoes)
    ? { posicoes: args.posicoes, origem: `a própria carteira conferida (${args.fonteBritech})` }
    : args.estoque;
  const validacao = validarCarteira(workpaper, estoqueValidacao?.posicoes ?? null, estoqueValidacao?.origem ?? "");
  const { posicoes, aviso } = recortarPelaWp(args.posicoes, workpaper.linhas);
  const conferencia = conferir(posicoes, workpaper.linhas, docs, workpaper.cnpj, TOLERANCIA_CENTAVOS, {
    dataBase: args.dataBase, cdi: args.cdi,
  });
  const porCaminho = new Map((args.arquivos ?? []).map((a) => [a.caminho, a.ler]));
  const semTexto = docs.filter((d) => d.erro).length;
  const avisos = [...(args.avisos ?? []), ...(aviso ? [aviso] : [])];
  if (!docs.length) avisos.push("A pasta de lastro e termo não tem documentos legíveis (PDF, HTML, DOCX ou TXT).");
  return {
    ...conferencia, ignorados, avisos, docs, validacao,
    abrir: porCaminho.size ? async (caminho) => {
      const ler = porCaminho.get(caminho);
      if (!ler) throw new Error(`Arquivo não encontrado na pasta: ${caminho}`);
      return ler();
    } : undefined,
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
  Provável: "FFDDEBF7", igual: "FFC6EFCE", "campo diferente": "FFDDEBF7", "sem rótulo": "FFDDEBF7", aproximado: "FFFFEB9C",
  calculado: "FFDDEBF7",
  Verificar: "FFFFEB9C", "Não localizado": "FFEDEDED", "Sem documentos": "FFEDEDED",
  VERIFICAR: "FFFFC7CE", "SEM DADOS": "FFEDEDED",
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

  // recebíveis (amostra/estoque): "Valor" e "Sacado" no lugar de "VL Aplic." e "Emissor"; a fonte é a carteira, não a Britech
  const rec = r.tipo === "recebiveis";
  const F = rec ? "Carteira" : "Britech";
  const V = rec ? "Valor" : "VL Aplic.";
  const E = rec ? "Sacado" : "Emissor";
  const campos = camposDe(r.tipo);
  const cab = ["Situação", rec ? "Recebível" : "Ativo", `${E} (${F})`, ...(rec ? ["Cedente"] : []), rec ? "Nº documento" : "Cód. Britech", "Dt. Aquisição",
    `${V} ${F}`, `${V} WP`, `${V} WP x ${F}`, `${V} documentos`, `${V} docs`,
    `Dt. Emissão ${F}`, "Dt. Emissão WP", `Dt. Emissão WP x ${F}`, "Dt. Emissão documentos", "Dt. Emissão docs",
    `Dt. Vencimento ${F}`, "Dt. Vencimento WP", `Dt. Vencimento WP x ${F}`, "Dt. Vencimento documentos",
    "Dt. Vencimento docs", `${E} nos documentos`, `${E} docs`, "No WP_Termo", "Linha WP", "Documentos usados",
    "Observações"];
  const linhas = r.linhas.map((ln) => {
    const c = ln.campos;
    const fontes = unicos(Object.values(c).flatMap((x) => x.fontes));
    const notas = campos.filter(([k]) => c[k].nota).map(([k, rot]) => `${rot}: ${c[k].nota}`);
    return [ln.situacao, ln.ativo, ln.emissor, ...(rec ? [ln.cedente] : []), ln.codigo, ln.dataAquisicao,
      c.valor.britech, c.valor.wp, c.valor.wpStatus, c.valor.documentos, c.valor.status,
      c.emissao.britech, c.emissao.wp, c.emissao.wpStatus, c.emissao.documentos, c.emissao.status,
      c.vencimento.britech, c.vencimento.wp, c.vencimento.wpStatus, c.vencimento.documentos, c.vencimento.status,
      c.emissor.documentos, c.emissor.status, ln.noWp ? "Sim" : "Não", ln.wpLinha ?? "", fontes.join(" | "), notas.join("\n")];
  });
  aba("Conciliação", cab, linhas, {
    Ativo: 45, Recebível: 30, [`${E} (${F})`]: 36, Cedente: 36, "Documentos usados": 60, Observações: 70, [`${E} nos documentos`]: 36,
  }, ["Situação", `${V} WP x ${F}`, `${V} docs`, `Dt. Emissão WP x ${F}`, "Dt. Emissão docs",
    `Dt. Vencimento WP x ${F}`, "Dt. Vencimento docs", `${E} docs`]);

  const rotulos = Object.fromEntries(campos);
  aba("Evidências", [rec ? "Recebível" : "Ativo", `${V} ${F}`, "Campo", "Encontrado no documento", `x ${F}`, "Ligação com a posição", "Documento", "Trecho do documento"],
    r.linhas.flatMap((ln) => ln.evidencias.map((e) => [ln.ativo, ln.valorAplicado, rotulos[e.campo], e.valor,
      e.confere ? "Confere" : "Diverge", e.nivel, e.documento, e.trecho])),
    { Ativo: 45, Recebível: 30, Documento: 55, "Trecho do documento": 110 }, [`x ${F}`]);

  aba("Comparações", ["Situação", rec ? "Recebível" : "Ativo", "Campo", "Origem", "Coluna da carteira", "Valor na carteira",
    "Relação", "Documento", "Página", "Rótulo no documento", "Valor no documento", "Detalhe", "Trecho do documento"],
  r.linhas.flatMap((ln) => ln.comparacoes.map((c) => [ln.situacao, ln.ativo, c.tipo === "valor" ? V : c.campo === "aquisicao" ? "Dt. Aquisição" : rotulos[c.campo],
    c.carteira.origem, c.carteira.coluna, c.carteira.valor, c.relacao, c.documento.arquivo, c.documento.pagina || "",
    c.documento.rotulo || "(sem rótulo)", c.documento.valor, c.detalhe, c.documento.trecho])),
  { Ativo: 45, Recebível: 30, "Coluna da carteira": 24, Documento: 50, "Rótulo no documento": 30, Detalhe: 80, "Trecho do documento": 100 },
  ["Situação", "Relação"]);

  const v = r.validacao;
  if (v) {
    const reais = (c: number | null) => (c === null ? "" : c / 100);
    const pct = (x: number | null) => (x === null ? "" : Math.round(x * 10000) / 100);
    aba("Validação da carteira", ["Bloco", "Item", "Carteira (R$)", "Estoque / Amostra (R$)", "Diferença (R$)", "Quantidade", "% do PL", "Status"], [
      ...v.composicao.map((c) => ["Composição da carteira", c.categoria, reais(c.valor), "", "", "", pct(c.pctPl), ""]),
      ...v.foraDasCategorias.map((c) => ["Composição da carteira", `(fora das categorias) ${c.mapeamento}`, reais(c.valor), "", "", "", "", "VERIFICAR"]),
      ["Composição da carteira", "Patrimônio líquido × soma das categorias", reais(v.pl), reais(v.somaCategorias), v.pl === null ? "" : reais(v.pl - v.somaCategorias), "", "", v.statusPl],
      ...v.estoque.map((e) => ["Carteira × estoque", e.item, reais(e.carteira), reais(e.estoque), reais(e.diferenca), e.quantidade, "", e.status]),
      ...(v.estoque.length ? [] : [["Carteira × estoque", v.origemEstoque, "", "", "", "", "", "SEM DADOS"]]),
      ...(v.avisoEstoque ? [["Carteira × estoque", v.avisoEstoque, "", "", "", "", "", "VERIFICAR"]] : []),
      ...v.amostra.map((a) => ["Amostra (WP_Termo)", a.categoria, "", reais(a.valor), "", a.quantidade, pct(a.pctPl), ""]),
      ...v.verificacao.map((x) => ["Verificação de lastro", x.item, "", "", "", x.total, x.total ? pct(x.verificados / x.total) : "", `${x.verificados} V · ${x.pendentes} P`]),
    ], { Bloco: 24, Item: 52 }, ["Status"]);
  }

  aba("Documentos", ["Arquivo", "Tipo", "Páginas lidas", "Cita o CNPJ do fundo", "Ligado a", "Observação"], [
    ...r.documentos.map((d) => [d.caminho, d.tipo, d.paginas, d.citaCnpjFundo ? "Sim" : "Não", d.vinculos.join("\n"), d.observacao]),
    ...r.ignorados.map((i) => [i.nome, "", "", "", "", i.motivo]),
  ], { Arquivo: 60, "Ligado a": 70, Observação: 50 });

  const s = r.resumo;
  aba("Parâmetros", ["Item", "Valor"], [
    ["Fundo", s.fundo], ["CNPJ", s.cnpj], ["Data-base", s.dataBase], [rec ? "Carteira (amostra/estoque)" : "Carteira Britech", s.fonteBritech],
    ["Workpaper", s.workpaper], ["Pasta de lastro e termo", s.pastaLastro], [rec ? "Recebíveis conferidos" : "Títulos da Britech conferidos", s.posicoesBritech],
    ["Linhas na WP_Termo", s.linhasWpTermo], ["Documentos lidos", s.documentosLidos], ["Documentos sem texto", s.documentosSemTexto],
    ["Arquivos não lidos", s.arquivosIgnorados], ["Tolerância de valor (R$)", s.tolerancia], ["Gerado em", s.geradoEm],
    ...r.avisos.map((a) => ["Aviso", a]),
  ], { Item: 32, Valor: 110 });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
