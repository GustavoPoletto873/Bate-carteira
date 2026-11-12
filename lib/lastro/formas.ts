/**
 * Formas de impressão dos valores nos documentos — datas, moedas, CPF/CNPJ, números e códigos —, como no
 * formas_impressao.py da pré-classificação do bate-lastro. É o dicionário único: o que reconhece um valor no texto
 * (motor da pré-classificação) e o que gera as formas em que um valor conhecido costuma estar impresso (busca).
 *
 * O texto vem de `normalizarMesmoTamanho` (minúsculo, sem acento e com o MESMO tamanho do original), para as posições
 * valerem também no texto original (trecho e destaque).
 */

/** Minúsculo e sem acento, caractere a caractere, sem mudar o tamanho (as posições continuam valendo no original). */
export function normalizarMesmoTamanho(texto: string): string {
  let s = "";
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    const base = c.normalize("NFD")[0] ?? c;
    const min = base.toLowerCase();
    s += min.length === 1 ? min : base.length === 1 ? base : c;
  }
  return s;
}

export interface Achado<T> { pos: number; fim: number; valor: T }

// ------------------------------------------------------------------ datas

const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MES_POR_NOME = new Map<string, number>([...MESES.map((m, i) => [m, i + 1] as const), ...MESES.map((m, i) => [m.slice(0, 3), i + 1] as const)]);
const MESES_ALT = [...MES_POR_NOME.keys()].sort((a, b) => b.length - a.length).join("|");

const RE_DATA = /(?<!\d)(\d{1,2})\s?[/.\-]\s?(\d{1,2})\s?[/.\-]\s?(\d{4}|\d{2})(?!\d)/g;
const RE_DATA_ISO = /(?<![\d/.\-])(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
const RE_DATA_EXTENSO = new RegExp(
  `(?<!\\d)(\\d{1,2})(?:º|°|o)?\\s+(?:\\([a-z ]{2,30}\\)\\s+)?de\\s+(${MESES.join("|")})\\s+de\\s+(\\d{4})(?!\\d)`, "g",
);
const RE_DATA_MES_ESCRITO = new RegExp(
  `(?<![\\d.])(\\d{1,2})\\s?([/\\-. ])\\s?(${MESES_ALT})\\.?\\s?[/\\-. ]\\s?(\\d{4}|\\d{2})(?!\\d)(?![\\s,]*(?:as\\s+|\\()?\\d{1,2}:\\d{2})`, "g",
);

/** Data de calendário válida (ano de 2 dígitos vira 20xx; 1900–2100) em aaaa-mm-dd. */
export function dataValida(d: number, m: number, a: number): string | null {
  const ano = a < 100 ? a + 2000 : a;
  if (ano < 1900 || ano > 2100 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(ano, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function extrairDatas(t: string): Achado<string>[] {
  const achados = new Map<number, Achado<string>>();
  const pus = (pos: number, fim: number, valor: string | null) => {
    if (valor && !achados.has(pos)) achados.set(pos, { pos, fim, valor });
  };
  for (const m of t.matchAll(RE_DATA)) pus(m.index!, m.index! + m[0].length, dataValida(+m[1], +m[2], +m[3]));
  for (const m of t.matchAll(RE_DATA_ISO)) pus(m.index!, m.index! + m[0].length, dataValida(+m[3], +m[2], +m[1]));
  for (const m of t.matchAll(RE_DATA_EXTENSO)) pus(m.index!, m.index! + m[0].length, dataValida(+m[1], MESES.indexOf(m[2]) + 1, +m[3]));
  for (const m of t.matchAll(RE_DATA_MES_ESCRITO)) {
    if (m[4].length === 2 && !["/", "-"].includes(m[2])) continue; // "15 mar 26" não
    pus(m.index!, m.index! + m[0].length, dataValida(+m[1], MES_POR_NOME.get(m[3]) ?? 0, +m[4]));
  }
  return [...achados.values()].sort((a, b) => a.pos - b.pos);
}

/** Dia anterior, e o sábado (dois dias antes) quando a data é uma segunda-feira. */
export function diasAntes(iso: string): string[] {
  const d = new Date(`${iso}T00:00:00Z`);
  const menos = (n: number) => new Date(d.getTime() - n * 86_400_000).toISOString().slice(0, 10);
  return d.getUTCDay() === 1 ? [menos(1), menos(2)] : [menos(1)];
}

export function somarMeses(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth(), Math.min(d, ultimo))).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ moedas (centavos)

const RE_MOEDA = /(?<![\d.,])(\d{1,3}(?:\.\d{3})+|\d+)(?:\r?\n)?,(\d{2})(?![\d,])/g;
const RE_MOEDA_PONTO = /r\$\s*(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/g;
const RE_MOEDA_AMERICANA = /(?<![\d.,])(\d{1,3}(?:,\d{3})+)\.(\d{2})(?![\d.,])/g;

export function extrairMoedas(t: string): Achado<number>[] {
  const achados = new Map<number, Achado<number>>();
  const centavos = (inteiro: string, dec: string) => Number(inteiro.replace(/\D/g, "")) * 100 + Number(dec);
  for (const m of t.matchAll(RE_MOEDA)) achados.set(m.index!, { pos: m.index!, fim: m.index! + m[0].length, valor: centavos(m[1], m[2]) });
  for (const re of [RE_MOEDA_PONTO, RE_MOEDA_AMERICANA]) {
    for (const m of t.matchAll(re)) {
      const pos = m.index! + m[0].indexOf(m[1]);
      if (!achados.has(pos)) achados.set(pos, { pos, fim: m.index! + m[0].length, valor: centavos(m[1], m[2]) });
    }
  }
  return [...achados.values()].sort((a, b) => a.pos - b.pos);
}

// ------------------------------------------------------------------ CPF/CNPJ

const RE_PESSOA = /(?<!\d)(?:\d{2}\.?\d{3}\.?\d{3}\s{0,2}\/?\s{0,2}\d{4}\s{0,2}-?\s{0,2}\d{2}|\d{3}\.?\d{3}\.?\d{3}\s{0,2}-?\s{0,2}\d{2})(?!\d)/g;
const RE_DIGITOS_CORRIDOS = /(?<![\d.,/\-])(\d{9,10}|\d{12,13})(?![\d.,/\-])/g;

/** CPF/CNPJ do texto, só dígitos (corridos de 9–10 ou 12–13 dígitos ganham o zero à esquerda perdido). */
export function extrairPessoas(t: string): Achado<string>[] {
  const achados = new Map<number, Achado<string>>();
  for (const m of t.matchAll(RE_PESSOA)) achados.set(m.index!, { pos: m.index!, fim: m.index! + m[0].length, valor: m[0].replace(/\D/g, "") });
  for (const m of t.matchAll(RE_DIGITOS_CORRIDOS)) {
    if (achados.has(m.index!)) continue;
    const d = m[1];
    achados.set(m.index!, { pos: m.index!, fim: m.index! + d.length, valor: d.padStart(d.length <= 10 ? 11 : 14, "0") });
  }
  return [...achados.values()].sort((a, b) => a.pos - b.pos);
}

function dvOk(digitos: string, pesos: number[][]): boolean {
  if (/^(\d)\1+$/.test(digitos)) return false;
  return pesos.every((p) => {
    const n = p.length;
    const soma = p.reduce((s, peso, i) => s + peso * Number(digitos[i]), 0);
    const r = soma % 11;
    return (r < 2 ? 0 : 11 - r) === Number(digitos[n]);
  });
}
const PESOS_CPF = [[10, 9, 8, 7, 6, 5, 4, 3, 2], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]];
const PESOS_CNPJ = [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]];

/** CPF/CNPJ da carteira em 11/14 dígitos; o zero à esquerda perdido volta só se o dígito verificador conferir. */
export function normalizarPessoa(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 11 || d.length === 14) return d;
  if (d.length >= 6 && d.length <= 10) {
    const p = d.padStart(11, "0");
    return dvOk(p, PESOS_CPF) ? p : null;
  }
  if (d.length === 12 || d.length === 13) {
    const p = d.padStart(14, "0");
    return dvOk(p, PESOS_CNPJ) ? p : null;
  }
  return null;
}

// ------------------------------------------------------------------ números e códigos

export interface NumeroImpresso { pos: number; fim: number; grupos: string[]; corrido: string; digitos: string }

const RE_NUMERO = /(?<!\d)\d(?:[\d./\-]*\d)?(?!\d)/g;
const semZeros = (s: string) => s.replace(/^0+/, "") || "0";

function gruposDe(texto: string): string[] {
  return texto.split(/\D+/).filter(Boolean).map(semZeros);
}

export function extrairNumeros(t: string): NumeroImpresso[] {
  return [...t.matchAll(RE_NUMERO)].map((m) => {
    const digitos = m[0].replace(/\D/g, "");
    return { pos: m.index!, fim: m.index! + m[0].length, grupos: gruposDe(m[0]), corrido: semZeros(digitos), digitos };
  });
}

const RE_CODIGO = /(?<![a-z0-9])(?=[a-z0-9\-./]*[a-z])[a-z0-9]*\d[a-z0-9]*(?:[\-./][a-z0-9]+)*(?![a-z0-9])/g;
export const MIN_CARACTERES_CODIGO = 6;

/** "12C3-45678" → "12c345678"; null se não tiver letra e dígito ou tiver menos de 6 caracteres. */
export function compactarCodigo(texto: string): string | null {
  const c = normalizarMesmoTamanho(texto).replace(/[^a-z0-9]/g, "");
  return c.length >= MIN_CARACTERES_CODIGO && /[a-z]/.test(c) && /\d/.test(c) ? c : null;
}

export function extrairCodigos(t: string): Achado<string>[] {
  const lista: Achado<string>[] = [];
  for (const m of t.matchAll(RE_CODIGO)) {
    const c = compactarCodigo(m[0]);
    if (c) lista.push({ pos: m.index!, fim: m.index! + m[0].length, valor: c });
  }
  return lista;
}

/** O número do documento da carteira, em todas as formas que a comparação usa. */
export interface ChavesDocumento {
  grupos: string[];
  corrido: string;
  principal: string;
  digitos: string;
  codigo: string | null;
  trivial: boolean;
}

export function chavesDocumento(v: unknown): ChavesDocumento {
  const bruto = String(v ?? "").trim().replace(/^'/, "");
  const grupos = gruposDe(bruto);
  const digitos = bruto.replace(/\D/g, "");
  const corrido = digitos ? semZeros(digitos) : "";
  const codigo = compactarCodigo(bruto);
  return { grupos, corrido, principal: grupos[0] ?? "", digitos, codigo, trivial: (corrido === "0" || !corrido) && !codigo };
}

/** O número impresso confere com o da carteira? 'exato', 'parcela' (a carteira tem o sufixo da parcela) ou null. */
export function numeroConfere(a: ChavesDocumento, n: Pick<NumeroImpresso, "grupos" | "corrido" | "digitos">, comParcela: boolean): "exato" | "parcela" | null {
  if (!a.corrido || a.trivial) return null;
  const curto = !!a.codigo && n.corrido.length < 6;
  if (!curto && (n.corrido === a.corrido || (n.grupos.length === a.grupos.length && n.grupos.every((g, i) => g === a.grupos[i])))) return "exato";
  if (!comParcela || curto) return null;
  const ultimo = a.grupos[a.grupos.length - 1] ?? "";
  if (a.grupos.length >= 2 && ultimo.length <= 3 && a.principal.length >= 4
    && n.grupos.length === a.grupos.length - 1 && n.grupos.every((g, i) => g === a.grupos[i])) return "parcela";
  if (a.codigo || n.corrido.length < 5) return null;
  const sobra = a.corrido.length - n.corrido.length;
  if (sobra >= 2 && sobra <= 3 && a.corrido.startsWith(n.corrido)) return "parcela";
  if (n.corrido.length >= 8 && sobra >= 2 && (a.corrido.includes(n.corrido) || (n.digitos.length >= 8 && a.digitos.includes(n.digitos)))) return "parcela";
  if (a.corrido.length >= 6 && n.corrido.length > a.corrido.length && n.corrido.endsWith(a.corrido)) return "parcela";
  return null;
}

// ------------------------------------------------------------------ nomes

const STOPWORDS = new Set("ltda me epp eireli sa s a de da do das dos e cia em recuperacao judicial fidc fic rl responsabilidade limitada".split(" "));

export function tokensNome(nome: string): string[] {
  return [...new Set(normalizarMesmoTamanho(nome).replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t)))];
}

/** Nome com cara de cortado pelo sistema da administradora (25+ caracteres terminando no meio de uma palavra). */
export const nomeCortado = (nome: string) => nome.trim().length >= 25 && /[a-z]$/i.test(nome.trim());

/**
 * O nome está no texto? Para cada ocorrência de cada palavra, conta as palavras distintas do nome nos 80 caracteres
 * seguintes; vale se todas aparecem, ou pelo menos 2 e 75% delas.
 */
export function nomeNoTexto(
  tokens: string[], t: string, ini = 0, fim = t.length, ultimoCortado = false,
): { ok: boolean; pos: number; fim: number; achados: number } {
  if (!tokens.length) return { ok: false, pos: -1, fim: -1, achados: 0 };
  const ocorrencias: { pos: number; fim: number; token: string }[] = [];
  const trecho = t.slice(ini, fim);
  for (const [i, token] of tokens.entries()) {
    // nome cortado na carteira (ex.: 30 caracteres): a última palavra pode estar pela metade
    const fimDaPalavra = ultimoCortado && i === tokens.length - 1 ? "" : "(?![a-z0-9])";
    const re = new RegExp(`(?<![a-z0-9])${token}${fimDaPalavra}`, "g");
    for (const m of trecho.matchAll(re)) ocorrencias.push({ pos: ini + m.index!, fim: ini + m.index! + token.length, token });
  }
  ocorrencias.sort((a, b) => a.pos - b.pos);
  let melhor = { ok: false, pos: -1, fim: -1, achados: 0 };
  for (let i = 0; i < ocorrencias.length; i++) {
    const vistos = new Set<string>();
    let ultimo = ocorrencias[i].fim;
    for (let j = i; j < ocorrencias.length && ocorrencias[j].pos <= ocorrencias[i].pos + 80; j++) {
      if (vistos.has(ocorrencias[j].token)) continue;
      vistos.add(ocorrencias[j].token);
      ultimo = Math.max(ultimo, ocorrencias[j].fim);
    }
    const n = vistos.size;
    if (n > melhor.achados || (n === melhor.achados && ultimo - ocorrencias[i].pos < melhor.fim - melhor.pos)) {
      melhor = { ok: false, pos: ocorrencias[i].pos, fim: ultimo, achados: n };
    }
  }
  melhor.ok = melhor.achados === tokens.length || (melhor.achados >= 2 && melhor.achados / tokens.length >= 0.75);
  return melhor;
}

// ------------------------------------------------------------------ formas de um valor conhecido (busca)

export type FormaValor = "pessoa" | "moeda" | "data" | "numero" | "nome";

const NOMES_DIA = ["", "um", "dois", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze",
  "quinze", "dezesseis", "dezessete", "dezoito", "dezenove", "vinte", "vinte e um", "vinte e dois", "vinte e tres", "vinte e quatro",
  "vinte e cinco", "vinte e seis", "vinte e sete", "vinte e oito", "vinte e nove", "trinta", "trinta e um"];

/** As formas em que o valor costuma estar impresso (para procurar nos documentos). */
export function termosDeBusca(valor: string, forma: FormaValor): string[] {
  const v = valor.replace(/\s+/g, " ").trim().replace(/^'/, "");
  if (!v || v === "-") return [];
  const termos: string[] = [];
  if (forma === "pessoa") {
    let d = v.replace(/\D/g, "");
    if (d.length === 10) d = d.padStart(11, "0");
    if (d.length === 13) d = d.padStart(14, "0");
    if (d.length === 11) termos.push(`${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`, d, `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}`);
    else if (d.length === 14) termos.push(`${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`, d, `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}`);
    else termos.push(d);
    termos.push(semZeros(d));
  } else if (forma === "moeda") {
    const c = v.includes(",") ? Math.round(Number(v.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "")) * 100) : Math.round(Number(v.replace(/[^\d.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "")) * 100);
    if (Number.isFinite(c)) {
      const inteiro = Math.floor(c / 100);
      const dec = String(c % 100).padStart(2, "0");
      const milhar = inteiro.toLocaleString("pt-BR");
      termos.push(`${milhar},${dec}`, `${inteiro},${dec}`, `${inteiro.toLocaleString("en-US")}.${dec}`, `${inteiro}.${dec}`);
    }
  } else if (forma === "data") {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : extrairDatas(normalizarMesmoTamanho(v))[0]?.valor;
    if (iso) {
      const [a, m, d] = iso.split("-");
      const mes = MESES[Number(m) - 1];
      const dia = Number(d);
      termos.push(`${d}/${m}/${a}`, `${d}.${m}.${a}`, `${d}-${m}-${a}`, `${d}/${m}/${a.slice(2)}`, iso, `${dia} de ${mes} de ${a}`);
      if (dia === 1) termos.push(`1º de ${mes} de ${a}`);
      termos.push(`(${NOMES_DIA[dia]}) de ${mes} de ${a}`, `${dia} de ${mes}, de ${a}`, `${dia} ${mes.slice(0, 3)} ${a}`, `${dia}/${mes.slice(0, 3)}/${a}`);
    }
  } else if (forma === "numero") {
    termos.push(v, v.replace(/^0+/, ""));
    const d = v.replace(/\D/g, "").replace(/^0+/, "");
    if (d.length >= 6) termos.push(d);
  } else {
    termos.push(v);
    const p = v.split(" ");
    if (p.length > 2) termos.push(p.slice(0, 2).join(" "));
  }
  const vistos = new Set<string>();
  return termos.filter((t) => {
    const k = normalizarMesmoTamanho(t);
    if (t.length < 3 || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}
