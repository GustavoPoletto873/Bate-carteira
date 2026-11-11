/** Normalização de texto, datas e valores em formato brasileiro. Valores sempre em centavos (inteiros). */

export const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7,
  agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};
const MESES_ABREV: Record<string, number> = {
  jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8,
  set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12,
};
export const ORDINAIS: Record<string, number> = {
  primeira: 1, segunda: 2, terceira: 3, quarta: 4, quinta: 5, sexta: 6,
  setima: 7, oitava: 8, nona: 9, decima: 10,
};
const SUFIXOS_EMPRESA = new Set(["ltda", "sa", "s", "a", "eireli", "me", "epp", "de", "da", "do", "das", "dos", "e", "em"]);

const RE_DATA_NUM = /(?<!\d)(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?!\d)/g;
const RE_DATA_EXT = new RegExp(
  `(?<!\\d)(\\d{1,2})o?\\s+de\\s+(${Object.keys(MESES).join("|")})\\s+de\\s+(\\d{4})(?!\\d)`, "g");
const RE_DATA_ABREV = new RegExp(
  `(?<!\\d)(\\d{1,2})[-/ ](${Object.keys(MESES_ABREV).join("|")})[-/ ](\\d{4})(?!\\d)`, "g");
const RE_VALOR = /(?<![\d.,])(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})(?![\d,])/g;

export function semAcento(texto: string): string {
  return texto.normalize("NFKD").replace(/\p{M}/gu, "");
}

/** minúsculas, sem acento e com espaços simples */
export function normalizar(texto: unknown): string {
  return semAcento(String(texto ?? "").toLowerCase()).replace(/\s+/g, " ").trim();
}

/** Como normalizar(), mas devolve o texto original (espaços simples) e o mapa posição normalizada → original. */
export function normalizarComMapa(texto: string): { norm: string; original: string; mapa: Int32Array } {
  const original = (texto ?? "").replace(/\s+/g, " ").trim();
  const partes: string[] = [];
  const posicoes: number[] = [];
  let i = 0;
  for (const ch of original) {
    const n = semAcento(ch.toLowerCase());
    for (let k = 0; k < n.length; k++) {
      partes.push(n[k]);
      posicoes.push(i);
    }
    i += ch.length;
  }
  posicoes.push(original.length);
  return { norm: partes.join(""), original, mapa: Int32Array.from(posicoes) };
}

/** Só letras e números separados por um espaço, com espaço nas pontas (para buscar nomes inteiros). */
export function palavras(texto: string): string {
  return " " + normalizar(texto).replace(/[^a-z0-9]+/g, " ").trim() + " ";
}

/** Nome da empresa sem LTDA, S.A., EIRELI e preposições: "credito estrategico assessoria". */
export function nomeEssencial(nome: string): string {
  return palavras(nome).split(" ").filter((t) => t && !SUFIXOS_EMPRESA.has(t)).join(" ");
}

export function soDigitos(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

// ------------------------------------------------------------------ datas (ISO aaaa-mm-dd)

function montar(d: number, m: number, a: number): string | null {
  if (!(a > 1900 && a < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const data = new Date(Date.UTC(a, m - 1, d));
  if (data.getUTCMonth() !== m - 1 || data.getUTCDate() !== d) return null;
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface Ocorrencia<T> { ini: number; fim: number; valor: T }

/** Todas as datas do texto já normalizado, em ordem. Aceita 10/06/2026, '10 de junho de 2026' e '10-jun-2026'. */
export function acharDatas(norm: string): Ocorrencia<string>[] {
  const achadas: Ocorrencia<string>[] = [];
  for (const m of norm.matchAll(RE_DATA_NUM)) {
    const d = montar(+m[1], +m[2], +m[3]);
    if (d) achadas.push({ ini: m.index!, fim: m.index! + m[0].length, valor: d });
  }
  for (const m of norm.matchAll(RE_DATA_EXT)) {
    const d = montar(+m[1], MESES[m[2]], +m[3]);
    if (d) achadas.push({ ini: m.index!, fim: m.index! + m[0].length, valor: d });
  }
  for (const m of norm.matchAll(RE_DATA_ABREV)) {
    const d = montar(+m[1], MESES_ABREV[m[2]], +m[3]);
    if (d) achadas.push({ ini: m.index!, fim: m.index! + m[0].length, valor: d });
  }
  return achadas.sort((a, b) => a.ini - b.ini);
}

/** Célula/texto → data ISO. Número = data serial do Excel. null se vazio ou inválido. */
export function paraData(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? null : montar(v.getDate(), v.getMonth() + 1, v.getFullYear());
  }
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null; // fora de 1954–2119: não é data
    const data = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return montar(data.getUTCDate(), data.getUTCMonth() + 1, data.getUTCFullYear());
  }
  const texto = String(v).trim();
  if (!texto || ["-", "nan", "NaT", "None"].includes(texto)) return null;
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
  if (iso) return montar(+iso[3], +iso[2], +iso[1]);
  const achadas = acharDatas(normalizar(texto));
  return achadas.length ? achadas[0].valor : null;
}

export function fmtData(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

// ------------------------------------------------------------------ valores (centavos)

export function acharValores(norm: string): Ocorrencia<number>[] {
  const achados: Ocorrencia<number>[] = [];
  for (const m of norm.matchAll(RE_VALOR)) {
    const centavos = parseInt(m[1].replace(/\./g, ""), 10) * 100 + parseInt(m[2], 10);
    if (Number.isFinite(centavos)) achados.push({ ini: m.index!, fim: m.index! + m[0].length, valor: centavos });
  }
  return achados;
}

/** Célula → centavos. Aceita número ou texto '1.234,56'. null se vazio. */
export function paraCentavos(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  let texto = String(v).replace("R$", "").trim();
  if (!texto || texto === "-" || texto === "nan") return null;
  if (texto.includes(",")) texto = texto.replace(/\./g, "").replace(",", ".");
  const n = Number(texto);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function fmtValor(centavos: number | null | undefined): string {
  if (centavos === null || centavos === undefined) return "";
  const negativo = centavos < 0;
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}${inteiro},${String(abs % 100).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ emissão e códigos

/** Números de emissão citados: '2a (segunda) emissao', '70a emissao', 'emissao segunda'. */
export function numerosDeEmissao(norm: string): Set<number> {
  const numeros = new Set<number>();
  for (const m of norm.matchAll(/(?<!\d)(\d{1,3})\s*[ao]\s*(?:\(\s*[a-z]+\s*\)\s*)?emissao/g)) numeros.add(+m[1]);
  const ordinais = new RegExp(`emissao:?\\s+(${Object.keys(ORDINAIS).join("|")})\\b`, "g");
  for (const m of norm.matchAll(ordinais)) numeros.add(ORDINAIS[m[1]]);
  return numeros;
}

/** 'NC_CREDITO ESTRATEGICO 2E   Vcto: ...' → 2 */
export function numeroEmissaoBritech(descricao: string): number | null {
  const m = String(descricao ?? "").match(/[_\s](\d{1,3})\s*E\b/);
  return m ? +m[1] : null;
}

/** Primeiro "código" da descrição (ex.: '26C4044095' de um CRI), em minúsculas. */
export function codigoBritech(descricao: string): string {
  const primeiro = String(descricao ?? "").trim().split(" ")[0] ?? "";
  if (primeiro.length >= 8 && /\d/.test(primeiro) && /[A-Za-z]/.test(primeiro) && !primeiro.includes("_")) {
    return primeiro.toLowerCase();
  }
  return "";
}

export function texto(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isInteger(v)) return String(v);
  const t = String(v).trim();
  return ["-", "nan", "NaT", "None"].includes(t) ? "" : t;
}
