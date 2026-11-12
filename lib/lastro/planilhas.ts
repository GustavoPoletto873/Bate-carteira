/** Leitura do workpaper (aba WP_Termo) e da carteira Britech com o SheetJS. */
import * as XLSX from "xlsx";
import { fmtData, normalizar, paraCentavos, paraData, soDigitos, texto } from "./textos";

export class ErroDeEntrada extends Error {}

type Linha = unknown[];

function linhasDaAba(ws: XLSX.WorkSheet): { linhas: Linha[]; primeira: number } {
  const ref = ws["!ref"];
  if (!ref) return { linhas: [], primeira: 1 };
  const primeira = XLSX.utils.decode_range(ref).s.r + 1;
  const linhas = XLSX.utils.sheet_to_json<Linha>(ws, { header: 1, raw: true, defval: null, blankrows: true });
  return { linhas, primeira };
}

// ------------------------------------------------------------------ workpaper

export interface LinhaWP {
  linhaExcel: number;
  idBase: string;
  numeroDoc: string;
  valorAquisicao: number | null;
  valorNominal: number | null;
  dataEmissao: string | null;
  dataVencimento: string | null;
  dataAquisicao: string | null;
  tipoRecebivel: string;
  nomeSacado: string;
  nomeCedente: string;
  status: string;
  /** coluna "Amostra" da WP_Termo: Direitos creditórios vincendos / vencidos / Recompra */
  amostra: string;
}

/** Linha da aba carteiraInforme: a carteira enviada pela administradora, já classificada nas categorias da CVM. */
export interface LinhaInforme {
  dataBase: string | null;
  descricao: string;
  /** centavos */
  valor: number;
  /** categoria do informe da CVM (coluna "Mapeamento") */
  mapeamento: string;
}

export interface Workpaper {
  arquivo: string;
  fundo: string;
  cnpj: string;
  dataBase: string | null;
  linhas: LinhaWP[];
  /** carteira do fundo na aba carteiraInforme (só as linhas do CNPJ do fundo) */
  carteiraInforme: LinhaInforme[];
  /** status (V/P) da aba WP_Lastro */
  lastro: { verificados: number; pendentes: number } | null;
}

const OBRIGATORIAS_WP = ["BASE_VALOR_AQUISICAO", "BASE_DATA_EMISSAO", "BASE_DATA_VENCIMENTO"];

function dataBaseDoWorkpaper(wb: XLSX.WorkBook): string | null {
  for (const nome of wb.SheetNames) {
    const ws = wb.Sheets[nome];
    if (!ws) continue;
    if (nome.toLowerCase().startsWith("resumo")) {
      for (const linha of linhasDaAba(ws).linhas.slice(0, 3)) {
        for (const v of linha) {
          const m = typeof v === "string" ? v.match(/\d{2}\/\d{2}\/\d{4}/) : null;
          const d = m ? paraData(m[0]) : null;
          if (d) return d;
        }
      }
    }
  }
  const informe = wb.SheetNames.find((n) => n.toLowerCase() === "carteirainforme");
  if (informe && wb.Sheets[informe]) {
    const segunda = linhasDaAba(wb.Sheets[informe]).linhas[1];
    const d = segunda ? paraData(segunda[0]) : null;
    if (d) return d;
  }
  return null;
}

export function lerWorkpaper(bytes: Uint8Array, arquivo: string): Workpaper {
  let nomes: string[];
  try {
    nomes = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames;
  } catch (e) {
    throw new ErroDeEntrada(`Não consegui abrir o workpaper "${arquivo}". Confira se é o .xlsm do fundo. (${String(e).slice(0, 120)})`);
  }
  const abaTermo = nomes.find((n) => n.trim().toLowerCase() === "wp_termo");
  if (!abaTermo) {
    throw new ErroDeEntrada(`O workpaper "${arquivo}" não tem a aba WP_Termo. Abas encontradas: ${nomes.join(", ")}.`);
  }
  const outras = nomes.filter((n) => ["carteirainforme", "wp_lastro"].includes(n.trim().toLowerCase()) || n.toLowerCase().startsWith("resumo"));
  const wb = XLSX.read(bytes, { type: "array", sheets: [abaTermo, ...outras], dense: true });
  const { linhas, primeira } = linhasDaAba(wb.Sheets[abaTermo]);

  const iCab = linhas.slice(0, 40).findIndex((l) => l.some((v) => {
    const t = String(v ?? "").trim().toUpperCase();
    return t === "BASE_VALOR_AQUISICAO" || t === "BASE_NUMERO_DOC";
  }));
  if (iCab < 0) {
    // FIC (investe em cotas) e fundos sem cessão trazem a WP_Termo sem a tabela BASE_… (no máximo colunas auxiliares)
    const semTabela = !linhas.some((l) => l.some((v) => /^BASE_/i.test(String(v ?? "").trim())));
    throw new ErroDeEntrada(semTabela
      ? "A aba WP_Termo deste workpaper está vazia (sem a tabela BASE_…): o fundo não tem termos de cessão para conferir (comum em FIC)."
      : "Não achei o cabeçalho da aba WP_Termo (linha com BASE_VALOR_AQUISICAO).");
  }
  const colunas = new Map<string, number>();
  linhas[iCab].forEach((v, i) => {
    const t = String(v ?? "").trim().toUpperCase();
    if (t && !colunas.has(t)) colunas.set(t, i);
  });
  const faltando = OBRIGATORIAS_WP.filter((c) => !colunas.has(c));
  if (faltando.length) {
    throw new ErroDeEntrada(`A aba WP_Termo não tem as colunas ${faltando.join(", ")}. Confira se o workpaper está no modelo atual.`);
  }

  const wp: Workpaper = { arquivo, fundo: "", cnpj: "", dataBase: dataBaseDoWorkpaper(wb), linhas: [], carteiraInforme: [], lastro: null };
  linhas.slice(iCab + 1).forEach((linha, k) => {
    const col = (nome: string) => {
      const i = colunas.get(nome);
      return i === undefined ? null : linha[i] ?? null;
    };
    const valor = paraCentavos(col("BASE_VALOR_AQUISICAO"));
    if (valor === null && !texto(col("BASE_NUMERO_DOC"))) return;
    wp.linhas.push({
      linhaExcel: primeira + iCab + 1 + k,
      idBase: texto(col("ID_BASE")),
      numeroDoc: texto(col("BASE_NUMERO_DOC")),
      valorAquisicao: valor,
      valorNominal: paraCentavos(col("BASE_VALOR_NOMINAL")),
      dataEmissao: paraData(col("BASE_DATA_EMISSAO")),
      dataVencimento: paraData(col("BASE_DATA_VENCIMENTO")),
      dataAquisicao: paraData(col("BASE_DATA_AQUISICAO")),
      tipoRecebivel: texto(col("BASE_TIPO_RECEBIVEL")),
      nomeSacado: texto(col("BASE_NOME_SACADO")),
      nomeCedente: texto(col("BASE_NOME_CEDENTE")),
      status: texto(col("STATUS")),
      amostra: texto(col("AMOSTRA")),
    });
    if (!wp.fundo) wp.fundo = texto(col("BASE_NOME_FUNDO"));
    if (!wp.cnpj) wp.cnpj = soDigitos(col("BASE_CNPJ_FUNDO"));
  });

  if (wp.cnpj.length !== 14) {
    const m = arquivo.match(/(?<!\d)(\d{14})(?!\d)/);
    if (m) wp.cnpj = m[1];
  }
  if (!wp.fundo) wp.fundo = arquivo.replace(/\.[^.]+$/, "").replace(/^WP_|_\d{14}$/g, "");
  wp.carteiraInforme = lerCarteiraInforme(wb, wp.cnpj);
  wp.lastro = statusDoLastro(wb);
  return wp;
}

/** Aba carteiraInforme (Data Base | CNPJ Fundo | Descricao | Valor | … | Mapeamento): só as linhas do fundo. */
function lerCarteiraInforme(wb: XLSX.WorkBook, cnpj: string): LinhaInforme[] {
  const nome = wb.SheetNames.find((n) => n.trim().toLowerCase() === "carteirainforme");
  if (!nome || !cnpj) return [];
  const { linhas } = linhasDaAba(wb.Sheets[nome]);
  const iCab = linhas.slice(0, 10).findIndex((l) => l.some((v) => chave(v) === "mapeamento"));
  if (iCab < 0) return [];
  const chaves = linhas[iCab].map(chave);
  const indice = (...nomes: string[]) => chaves.findIndex((k) => nomes.includes(k));
  const [iData, iCnpj, iDesc, iValor, iMap] = [indice("data base"), indice("cnpj fundo", "cnpj"), indice("descricao"), indice("valor"), indice("mapeamento")];
  if (iCnpj < 0 || iValor < 0 || iMap < 0) return [];
  return linhas.slice(iCab + 1)
    .filter((l) => soDigitos(l[iCnpj]) === cnpj && texto(l[iMap]))
    .map((l) => ({
      dataBase: iData >= 0 ? paraData(l[iData]) : null, descricao: iDesc >= 0 ? texto(l[iDesc]) : "",
      valor: paraCentavos(l[iValor]) ?? 0, mapeamento: texto(l[iMap]),
    }));
}

/** Contagem de V (verificado) e P (pendente) na coluna STATUS da aba WP_Lastro. */
function statusDoLastro(wb: XLSX.WorkBook): { verificados: number; pendentes: number } | null {
  const nome = wb.SheetNames.find((n) => n.trim().toLowerCase() === "wp_lastro");
  if (!nome) return null;
  const { linhas } = linhasDaAba(wb.Sheets[nome]);
  const iCab = linhas.slice(0, 40).findIndex((l) => l.some((v) => String(v ?? "").trim().toUpperCase() === "ID_BASE"));
  if (iCab < 0) return null;
  const iStatus = linhas[iCab].findIndex((v) => String(v ?? "").trim().toUpperCase() === "STATUS");
  if (iStatus < 0) return null;
  const status = linhas.slice(iCab + 1).map((l) => texto(l[iStatus]).toUpperCase());
  return { verificados: status.filter((s) => s === "V").length, pendentes: status.filter((s) => s === "P").length };
}

export function resumoWorkpaper(wp: Workpaper) {
  return { fundo: wp.fundo, cnpj: wp.cnpj, dataBase: wp.dataBase, dataBaseFmt: fmtData(wp.dataBase), linhasWpTermo: wp.linhas.length };
}

// ------------------------------------------------------------------ carteira Britech

export interface Posicao {
  linha: number;
  /** título da carteira Britech, ou recebível de um estoque/amostra (duplicata, CCB…) */
  tipo: "titulo" | "recebivel";
  /** código do título; no recebível, o número do documento (NU_DOCUMENTO) */
  codigo: string;
  ativo: string;
  /** emissor do título; no recebível, o sacado (devedor) */
  emissor: string;
  /** cedente do recebível ("" no título) */
  cedente: string;
  /** VL Aplic.; no recebível, o valor de aquisição (ou o nominal, se o arquivo não tiver aquisição) */
  valorAplicado: number;
  /** valor de face do recebível — é o que aparece na duplicata/CCB (null no título) */
  valorNominal: number | null;
  valorPresente: number | null;
  dataAquisicao: string | null;
  dataEmissao: string | null;
  dataVencimento: string | null;
  grupo: string;
  /** nome da coluna de onde veio cada valor/data no arquivo da carteira (para mostrar a origem na comparação) */
  colunas?: Partial<Record<CampoDaCarteira, string>>;
  /** recebível: situação no estoque ("A vencer", "Vencido"…) e provisão para perda (centavos) */
  situacao?: string;
  valorPdd?: number | null;
  /** data de referência do estoque (DATA_REFERENCIA) */
  dataReferencia?: string | null;
}

export type CampoDaCarteira = "valorAplicado" | "valorNominal" | "valorPresente" | "dataEmissao" | "dataVencimento" | "dataAquisicao";

/**
 * Nomes de coluna aceitos para cada campo, em ordem de preferência. Cobre o _BRITECH.xlsx formatado pelo hub,
 * a exportação do PAS e o relatório bruto da API (ExcelAlinhado: MERCADO, GRUPO, ID TÍTULO, CÓDIGO, DESCRIÇÃO,
 * EMISSOR/INSTITUIÇÃO, VALOR CUSTO/APLICAÇÃO/VALOR APLICAÇÃO, DATA EMISSÃO, DATA VENCIMENTO...).
 */
const SINONIMOS: Record<string, string[]> = {
  codigo: ["id titulo", "cod", "codigo", "cod ativo", "cod titulo"],
  ativo: ["ativo", "descricao", "titulo", "papel", "nome do ativo"],
  emissor: ["emissor", "instituicaoemissor", "instituicao emissor", "nome emissor", "nome do emissor", "instituicao"],
  valorAplicado: ["vl aplic", "vlr aplic", "valor aplicado", "vl aplicado", "vlr aquisicao", "valor aquisicao",
    "vl aquisicao", "valorcusto", "valor custo", "valor aplicacao", "aplicacao"],
  valorPresente: ["vlr presente", "valor presente", "valormercado", "valor mercado", "vl mercado", "vl atual",
    "valor atual", "vl bruto", "valor bruto", "valor liquido", "saldo mtm"],
  dataAquisicao: ["dt aquisicao", "data aquisicao", "dataaquisicao", "dt aplic", "dt aplicacao", "data aplicacao",
    "dt operacao", "data operacao", "data lancamento", "data registro"],
  dataEmissao: ["dt emissao", "data emissao", "emissao", "dt de emissao", "data de emissao"],
  dataVencimento: ["dt vencimento", "data vencimento", "vencimento", "dt vencto", "vencto", "data de vencimento",
    "dt de vencimento"],
  grupo: ["e financeira", "grupo", "tipo", "mercado", "tipo ativo"],
};

function chave(v: unknown): string {
  return normalizar(v).replace(/[^a-z0-9]+/g, " ").trim();
}

/** {campo: colunas candidatas, na ordem de preferência}. Uma coluna serve a um campo só. */
function mapearColunas(cabecalho: Linha): Map<string, number[]> {
  const chaves = cabecalho.map(chave);
  const usadas = new Set<number>();
  const mapa = new Map<string, number[]>();
  for (const [campo, nomes] of Object.entries(SINONIMOS)) {
    const colunas: number[] = [];
    for (const nome of nomes) {
      chaves.forEach((k, j) => {
        if (k === nome && !usadas.has(j)) {
          colunas.push(j);
          usadas.add(j);
        }
      });
    }
    if (colunas.length) mapa.set(campo, colunas);
  }
  for (const [campo, nomes] of Object.entries(SINONIMOS)) {
    if (mapa.has(campo)) continue;
    const j = chaves.findIndex((k, i) => k && !usadas.has(i) && nomes.some((n) => n.length > 4 && k.startsWith(n)));
    if (j >= 0) {
      mapa.set(campo, [j]);
      usadas.add(j);
    }
  }
  return mapa;
}

const vazio = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

export function posicoesDaTabela(linhas: Linha[], primeira = 1): Posicao[] {
  let iCab = -1;
  let mapa = new Map<string, number[]>();
  for (let n = 0; n < Math.min(linhas.length, 41); n++) {
    const m = mapearColunas(linhas[n] ?? []);
    if (m.has("valorAplicado") && m.has("emissor") && (m.has("dataEmissao") || m.has("dataVencimento"))) {
      iCab = n;
      mapa = m;
      break;
    }
  }
  if (iCab < 0) return [];
  const cabecalho = linhas[iCab] ?? [];
  const posicoes: Posicao[] = [];
  linhas.slice(iCab + 1).forEach((linha, k) => {
    /** coluna do primeiro valor preenchido entre as colunas do campo (-1 se nenhuma) */
    const indice = (campo: string) => (mapa.get(campo) ?? []).find((i) => !vazio(linha?.[i])) ?? -1;
    const col = (campo: string) => {
      const i = indice(campo);
      return i >= 0 ? linha[i] : null;
    };
    const nomeColuna = (i: number) => (i >= 0 ? texto(cabecalho[i]) : "");
    /** VL Aplic.: o menor valor preenchido entre VALOR CUSTO / APLICAÇÃO / VALOR APLICAÇÃO (como o hub faz) */
    const candidatos = (mapa.get("valorAplicado") ?? [])
      .map((i) => [i, paraCentavos(linha?.[i])] as const)
      .filter((v): v is readonly [number, number] => v[1] !== null);
    const menor = candidatos.reduce<readonly [number, number] | null>((m, v) => (!m || v[1] < m[1] ? v : m), null);
    const valor = menor ? menor[1] : null;
    const emissor = texto(col("emissor"));
    const emissao = paraData(col("dataEmissao"));
    const vencimento = paraData(col("dataVencimento"));
    if (!emissor || valor === null || !(emissao || vencimento)) return; // cotas, caixa, valores a liquidar
    posicoes.push({
      linha: primeira + iCab + 1 + k, tipo: "titulo", codigo: texto(col("codigo")), ativo: texto(col("ativo")), emissor,
      cedente: "", valorAplicado: valor, valorNominal: null, valorPresente: paraCentavos(col("valorPresente")),
      dataAquisicao: paraData(col("dataAquisicao")), dataEmissao: emissao, dataVencimento: vencimento,
      grupo: texto(col("grupo")),
      colunas: {
        valorAplicado: nomeColuna(menor ? menor[0] : -1), valorPresente: nomeColuna(indice("valorPresente")),
        dataEmissao: nomeColuna(indice("dataEmissao")), dataVencimento: nomeColuna(indice("dataVencimento")),
        dataAquisicao: nomeColuna(indice("dataAquisicao")),
      },
    });
  });
  return posicoes;
}

// ------------------------------------------------------------------ estoque / amostra de recebíveis

/**
 * Colunas do estoque e da amostra exportados pelos sistemas das administradoras sem Britech (Fromtis, Sinqia,
 * MAPS…): NU_DOCUMENTO, NOME_SACADO, NOME_CEDENTE, VALOR_AQUISICAO, VALOR_NOMINAL, DATA_EMISSAO,
 * DATA_VENCIMENTO_ORIGINAL… (com "_" ou espaço). Para cada campo, o primeiro nome achado vale.
 */
const COLUNAS_RECEBIVEIS: Record<string, string[]> = {
  numero: ["nu documento", "numero documento", "num documento", "numero do documento", "n documento"],
  seuNumero: ["seu numero"],
  tipo: ["tipo recebivel", "tipo de recebivel"],
  sacado: ["nome sacado", "nome do sacado", "sacado"],
  cedente: ["nome cedente", "nome do cedente", "cedente"],
  valorAquisicao: ["valor aquisicao", "valor de aquisicao", "vl aquisicao"],
  valorNominal: ["valor nominal", "valor de face", "vl nominal"],
  valorPresente: ["valor presente", "vl presente"],
  dataEmissao: ["data emissao", "data de emissao", "dt emissao"],
  dataVencimento: ["data vencimento original", "data vencimento", "data de vencimento", "dt vencimento", "data vencimento ajustada"],
  dataAquisicao: ["data aquisicao", "data de aquisicao", "dt aquisicao"],
  situacao: ["situacao recebivel", "situacao do recebivel", "situacao"],
  pdd: ["valor pdd", "vl pdd", "pdd"],
  dataReferencia: ["data referencia", "data de referencia", "dt referencia"],
};

function colunasDeRecebiveis(cabecalho: Linha): Map<string, number> | null {
  const chaves = cabecalho.map(chave);
  const mapa = new Map<string, number>();
  for (const [campo, nomes] of Object.entries(COLUNAS_RECEBIVEIS)) {
    const j = nomes.map((n) => chaves.indexOf(n)).find((i) => i >= 0);
    if (j !== undefined) mapa.set(campo, j);
  }
  const ok = mapa.has("sacado") && (mapa.has("numero") || mapa.has("seuNumero"))
    && (mapa.has("valorAquisicao") || mapa.has("valorNominal")) && mapa.has("dataVencimento");
  return ok ? mapa : null;
}

export function recebiveisDaTabela(linhas: Linha[], primeira = 1): Posicao[] {
  let iCab = -1;
  let mapa: Map<string, number> | null = null;
  for (let n = 0; n < Math.min(linhas.length, 41) && !mapa; n++) {
    mapa = colunasDeRecebiveis(linhas[n] ?? []);
    if (mapa) iCab = n;
  }
  if (!mapa) return [];
  const m = mapa;
  const cabecalho = linhas[iCab] ?? [];
  const nomeColuna = (campo: string) => {
    const i = m.get(campo);
    return i === undefined ? "" : texto(cabecalho[i]);
  };
  const posicoes: Posicao[] = [];
  linhas.slice(iCab + 1).forEach((linha, k) => {
    const col = (campo: string) => {
      const i = m.get(campo);
      return i === undefined ? null : linha?.[i] ?? null;
    };
    const aquisicao = paraCentavos(col("valorAquisicao"));
    const nominal = paraCentavos(col("valorNominal"));
    const valor = aquisicao ?? nominal;
    const numero = texto(col("numero")) || texto(col("seuNumero"));
    const sacado = texto(col("sacado"));
    if (valor === null || (!numero && !sacado)) return; // linha de total ou em branco
    const tipo = texto(col("tipo"));
    posicoes.push({
      linha: primeira + iCab + 1 + k, tipo: "recebivel", codigo: numero,
      ativo: [tipo || "Recebível", numero].filter(Boolean).join(" "), emissor: sacado, cedente: texto(col("cedente")),
      valorAplicado: valor, valorNominal: nominal, valorPresente: paraCentavos(col("valorPresente")),
      dataAquisicao: paraData(col("dataAquisicao")), dataEmissao: paraData(col("dataEmissao")),
      dataVencimento: paraData(col("dataVencimento")), grupo: tipo,
      situacao: texto(col("situacao")), valorPdd: paraCentavos(col("pdd")), dataReferencia: paraData(col("dataReferencia")),
      colunas: {
        valorAplicado: nomeColuna(aquisicao !== null ? "valorAquisicao" : "valorNominal"), valorNominal: nomeColuna("valorNominal"),
        valorPresente: nomeColuna("valorPresente"), dataEmissao: nomeColuna("dataEmissao"),
        dataVencimento: nomeColuna("dataVencimento"), dataAquisicao: nomeColuna("dataAquisicao"),
      },
    });
  });
  return posicoes;
}

/** Carteira Britech (títulos) ou estoque/amostra de recebíveis — o formato é reconhecido pelas colunas. */
export function lerCarteira(bytes: Uint8Array, arquivo: string): Posicao[] {
  let wb: XLSX.WorkBook;
  try {
    if (arquivo.toLowerCase().endsWith(".csv")) {
      // os sistemas das administradoras costumam exportar em Windows-1252 (Latin-1): sem isso os acentos dos nomes quebram
      let t = new TextDecoder("utf-8").decode(bytes);
      if (t.includes("�")) t = new TextDecoder("windows-1252").decode(bytes);
      const separador = (t.match(/;/g)?.length ?? 0) > (t.match(/,/g)?.length ?? 0) ? ";" : ",";
      wb = XLSX.read(t, { type: "string", FS: separador, raw: true });
    } else {
      wb = XLSX.read(bytes, { type: "array", dense: true });
    }
  } catch (e) {
    throw new ErroDeEntrada(`Não consegui ler a carteira "${arquivo}". Envie o Excel da Britech, a amostra ou o estoque do fundo. (${String(e).slice(0, 120)})`);
  }
  for (const nome of wb.SheetNames) {
    const { linhas, primeira } = linhasDaAba(wb.Sheets[nome]);
    const posicoes = recebiveisDaTabela(linhas, primeira);
    if (posicoes.length) return posicoes;
    const titulos = posicoesDaTabela(linhas, primeira);
    if (titulos.length) return titulos;
  }
  throw new ErroDeEntrada(
    `A carteira "${arquivo}" não tem as colunas esperadas: na Britech, Emissor, VL Aplic./Vlr. Aquisição, Dt. Emissão e Dt. Vencimento; `
    + "no estoque/amostra, NU_DOCUMENTO, NOME_SACADO, VALOR_AQUISICAO (ou VALOR_NOMINAL) e DATA_VENCIMENTO.",
  );
}

/** '<id>_<cnpj>_<dd.mm.aaaa>_BRITECH.xlsx' é a carteira deste fundo nesta data? */
export function ehCarteiraDoFundo(nomeArquivo: string, cnpj: string, dataBase: string | null): boolean {
  if (!cnpj || !/britech/i.test(nomeArquivo) || !/\.(xlsx|xls|xlsm)$/i.test(nomeArquivo)) return false;
  if (!nomeArquivo.includes(cnpj)) return false;
  if (!dataBase) return true;
  const [a, m, d] = dataBase.split("-");
  return nomeArquivo.includes(`${d}.${m}.${a}`) || !/\d{2}\.\d{2}\.\d{4}/.test(nomeArquivo);
}

export function pastaDaData(dataBase: string | null): string {
  if (!dataBase) return "";
  const [a, m, d] = dataBase.split("-");
  return `${d}.${m}.${a}`;
}
