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
}

export interface Workpaper {
  arquivo: string;
  fundo: string;
  cnpj: string;
  dataBase: string | null;
  linhas: LinhaWP[];
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
  const outras = nomes.filter((n) => n.toLowerCase().startsWith("resumo") || n.toLowerCase() === "carteirainforme");
  const wb = XLSX.read(bytes, { type: "array", sheets: [abaTermo, ...outras], dense: true });
  const { linhas, primeira } = linhasDaAba(wb.Sheets[abaTermo]);

  const iCab = linhas.slice(0, 40).findIndex((l) => l.some((v) => {
    const t = String(v ?? "").trim().toUpperCase();
    return t === "BASE_VALOR_AQUISICAO" || t === "BASE_NUMERO_DOC";
  }));
  if (iCab < 0) throw new ErroDeEntrada("Não achei o cabeçalho da aba WP_Termo (linha com BASE_VALOR_AQUISICAO).");
  const colunas = new Map<string, number>();
  linhas[iCab].forEach((v, i) => {
    const t = String(v ?? "").trim().toUpperCase();
    if (t && !colunas.has(t)) colunas.set(t, i);
  });
  const faltando = OBRIGATORIAS_WP.filter((c) => !colunas.has(c));
  if (faltando.length) {
    throw new ErroDeEntrada(`A aba WP_Termo não tem as colunas ${faltando.join(", ")}. Confira se o workpaper está no modelo atual.`);
  }

  const wp: Workpaper = { arquivo, fundo: "", cnpj: "", dataBase: dataBaseDoWorkpaper(wb), linhas: [] };
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
    });
    if (!wp.fundo) wp.fundo = texto(col("BASE_NOME_FUNDO"));
    if (!wp.cnpj) wp.cnpj = soDigitos(col("BASE_CNPJ_FUNDO"));
  });

  if (wp.cnpj.length !== 14) {
    const m = arquivo.match(/(?<!\d)(\d{14})(?!\d)/);
    if (m) wp.cnpj = m[1];
  }
  if (!wp.fundo) wp.fundo = arquivo.replace(/\.[^.]+$/, "").replace(/^WP_|_\d{14}$/g, "");
  return wp;
}

export function resumoWorkpaper(wp: Workpaper) {
  return { fundo: wp.fundo, cnpj: wp.cnpj, dataBase: wp.dataBase, dataBaseFmt: fmtData(wp.dataBase), linhasWpTermo: wp.linhas.length };
}

// ------------------------------------------------------------------ carteira Britech

export interface Posicao {
  linha: number;
  codigo: string;
  ativo: string;
  emissor: string;
  valorAplicado: number;
  valorPresente: number | null;
  dataAquisicao: string | null;
  dataEmissao: string | null;
  dataVencimento: string | null;
  grupo: string;
}

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
  const posicoes: Posicao[] = [];
  linhas.slice(iCab + 1).forEach((linha, k) => {
    /** primeiro valor preenchido entre as colunas do campo */
    const col = (campo: string) => {
      for (const i of mapa.get(campo) ?? []) if (!vazio(linha?.[i])) return linha[i];
      return null;
    };
    /** VL Aplic.: o menor valor preenchido entre VALOR CUSTO / APLICAÇÃO / VALOR APLICAÇÃO (como o hub faz) */
    const valores = (mapa.get("valorAplicado") ?? []).map((i) => paraCentavos(linha?.[i])).filter((v): v is number => v !== null);
    const valor = valores.length ? Math.min(...valores) : null;
    const emissor = texto(col("emissor"));
    const emissao = paraData(col("dataEmissao"));
    const vencimento = paraData(col("dataVencimento"));
    if (!emissor || valor === null || !(emissao || vencimento)) return; // cotas, caixa, valores a liquidar
    posicoes.push({
      linha: primeira + iCab + 1 + k, codigo: texto(col("codigo")), ativo: texto(col("ativo")), emissor,
      valorAplicado: valor, valorPresente: paraCentavos(col("valorPresente")),
      dataAquisicao: paraData(col("dataAquisicao")), dataEmissao: emissao, dataVencimento: vencimento,
      grupo: texto(col("grupo")),
    });
  });
  return posicoes;
}

export function lerCarteira(bytes: Uint8Array, arquivo: string): Posicao[] {
  let wb: XLSX.WorkBook;
  try {
    if (arquivo.toLowerCase().endsWith(".csv")) {
      const t = new TextDecoder("utf-8").decode(bytes);
      const separador = (t.match(/;/g)?.length ?? 0) > (t.match(/,/g)?.length ?? 0) ? ";" : ",";
      wb = XLSX.read(t, { type: "string", FS: separador, raw: true });
    } else {
      wb = XLSX.read(bytes, { type: "array", dense: true });
    }
  } catch (e) {
    throw new ErroDeEntrada(`Não consegui ler a carteira Britech "${arquivo}". Envie o Excel exportado do PAS ou o _BRITECH.xlsx. (${String(e).slice(0, 120)})`);
  }
  for (const nome of wb.SheetNames) {
    const { linhas, primeira } = linhasDaAba(wb.Sheets[nome]);
    const posicoes = posicoesDaTabela(linhas, primeira);
    if (posicoes.length) return posicoes;
  }
  throw new ErroDeEntrada(`A carteira "${arquivo}" não tem as colunas esperadas (Emissor, VL Aplic./Vlr. Aquisição, Dt. Emissão, Dt. Vencimento) ou não tem nenhum título com emissor e datas.`);
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
