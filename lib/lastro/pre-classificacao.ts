/**
 * Pré-classificação das pendências — o núcleo do motor do bate-lastro (branch pre-classificacao-bater-pdf), adaptado:
 * para cada título que não conferiu, sugere o documento (e a página ou a linha da tabela) mais provável, a confiança
 * (alta, média, baixa, ambígua, sem candidato) e a marca de cada campo — V (confere), D (o documento traz outro valor)
 * ou P (não achado) —, com a evidência (arquivo, página, trecho e a regra). Nada é gravado: quem confere aplica.
 *
 * Fica de fora o que no bate-lastro depende do banco: leituras de IA, outras bases do fundo, o aprendizado com o que o
 * time já conferiu e as regras por administradora.
 */
import type { ChaveCampo, DadosDoTitulo, LinhaResultado } from "./conciliacao";
import type { Documento } from "./documentos";
import {
  chavesDocumento, diasAntes, extrairCodigos, extrairDatas, extrairMoedas, extrairNumeros, extrairPessoas, nomeCortado, nomeNoTexto,
  normalizarMesmoTamanho, normalizarPessoa, numeroConfere, somarMeses, tokensNome,
  type Achado, type ChavesDocumento, type NumeroImpresso,
} from "./formas";
import type { Marca, Vinculo } from "./marcacoes";
import { fmtData, fmtValor } from "./textos";

export type Confianca = "alta" | "media" | "baixa" | "ambigua" | "sem_candidato";
export type CampoPre = "numero" | "valor" | "vencimento" | "emissao" | "sacadoDoc" | "sacadoNome" | "cedenteDoc" | "cedenteNome";

const PESOS: Record<CampoPre, number> = { numero: 4, valor: 3, vencimento: 2, sacadoDoc: 2, cedenteDoc: 1, emissao: 1, sacadoNome: 1, cedenteNome: 0.5 };
const FORTES: CampoPre[] = ["numero", "valor", "vencimento", "sacadoDoc"];
const CAMPOS_PRE: CampoPre[] = ["numero", "sacadoNome", "sacadoDoc", "cedenteNome", "cedenteDoc", "valor", "emissao", "vencimento"];
export const ORDEM_CONFIANCA: Confianca[] = ["alta", "media", "baixa", "ambigua", "sem_candidato"];

export interface Veredito {
  /** V confere, D o documento traz outro valor, P não achado */
  marca: Marca;
  /** como está impresso no documento (o que confirmou, no V; o outro valor, no D) */
  documento: string;
  /** regra que decidiu (ex.: cnpj_mesma_raiz, vencimento_um_dia_antes); "" quando é a leitura direta */
  regra: string;
  /** página da evidência (0 = sem evidência) e posição no texto da página */
  pagina: number;
  pos: number;
  fim: number;
  /** peso diferente do padrão (regra de um dia, número só pelo grupo principal) */
  peso?: number;
  /** o documento traz outra data, mas a regra mantém a da carteira (informativo) */
  alerta?: string;
}

export interface Destaque { pagina: number; termo: string; marca: Marca }

export interface Candidato {
  docId: number;
  arquivo: string;
  caminho: string;
  /** "termo" quando o documento é de cessão/endosso; senão o documento do título */
  tipo: "termo" | "documento";
  pagina: number;
  /** a linha da tabela (termo, borderô, anexo) ou a página inteira */
  modo: "linha" | "pagina";
  score: number;
  detalhes: Record<CampoPre, Veredito>;
  /** trechos para destacar no recorte do PDF */
  destaques: Destaque[];
}

export interface Sugestao {
  linhaId: number;
  confianca: Confianca;
  candidato: Candidato | null;
  alternativas: Candidato[];
  /** a marca sugerida para os campos que o Bater PDF grava */
  campos: Record<ChaveCampo, Veredito>;
  avisos: string[];
}

// ------------------------------------------------------------------ páginas

interface Pagina {
  doc: DocIndexado;
  numero: number;
  original: string;
  texto: string;
  inicios: number[];
  datas: Achado<string>[];
  moedas: Achado<number>[];
  pessoas: Achado<string>[];
  numeros: NumeroImpresso[];
  codigos: Achado<string>[];
  linhasTitulo: number[];
  ehTabela: boolean;
  ehListagem: boolean;
  hash: string;
}

interface DocIndexado {
  doc: Documento;
  paginas: Pagina[];
  termo: boolean;
  acessorio: boolean;
  assinatura: Set<string>;
}

interface Ref { pag: Pagina; pos: number }

export interface Indice {
  docs: DocIndexado[];
  porCorrido: Map<string, Ref[]>;
  porGrupos: Map<string, Ref[]>;
  porPrincipal: Map<string, Ref[]>;
  porCodigo: Map<string, Ref[]>;
  porPessoa: Map<string, Ref[]>;
  porMoeda: Map<number, Ref[]>;
}

const MIN_IDENTIFICADORES_LISTAGEM = 5;
const LINHA_CURTA = 40;
const RE_TERMO = /termo de cessao|instrumento particular de cessao|cessionari|termo de endosso/;
const RE_ACESSORIO = /dados\s+do\s+segurado|bilhete\s+(?:de\s+seguro|numero)/;

function hashTexto(t: string): string {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return `${t.length}:${h >>> 0}`;
}

const linhaDe = (p: Pagina, pos: number) => {
  let lo = 0;
  let hi = p.inicios.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (p.inicios[m] <= pos) lo = m;
    else hi = m - 1;
  }
  return lo;
};
const fimDaLinha = (p: Pagina, l: number) => (l + 1 < p.inicios.length ? p.inicios[l + 1] - 1 : p.texto.length);

function montarPagina(doc: DocIndexado, numero: number, original: string): Pagina {
  const texto = normalizarMesmoTamanho(original);
  const inicios = [0];
  for (let i = 0; i < texto.length; i++) if (texto[i] === "\n") inicios.push(i + 1);
  const p: Pagina = {
    doc, numero, original, texto, inicios,
    datas: extrairDatas(texto), moedas: extrairMoedas(texto), pessoas: extrairPessoas(texto),
    numeros: extrairNumeros(texto), codigos: extrairCodigos(texto),
    linhasTitulo: [], ehTabela: false, ehListagem: false, hash: hashTexto(texto),
  };
  const comValor = new Set(p.moedas.filter((m) => m.valor > 0).map((m) => linhaDe(p, m.pos)));
  p.linhasTitulo = [...new Set(p.datas.map((d) => linhaDe(p, d.pos)))].filter((l) => comValor.has(l)).sort((a, b) => a - b);
  p.ehTabela = p.linhasTitulo.length >= 2;
  if (p.ehTabela) {
    const titulo = new Set(p.linhasTitulo);
    const pessoas = new Set(p.pessoas.filter((x) => titulo.has(linhaDe(p, x.pos))).map((x) => x.valor));
    p.ehListagem = pessoas.size >= MIN_IDENTIFICADORES_LISTAGEM;
  }
  return p;
}

/** Páginas de todos os documentos com texto, com os valores e o índice para achar as âncoras. */
export function indexar(docs: Documento[]): Indice {
  const indice: Indice = {
    docs: [], porCorrido: new Map(), porGrupos: new Map(), porPrincipal: new Map(), porCodigo: new Map(), porPessoa: new Map(), porMoeda: new Map(),
  };
  const pus = <K>(m: Map<K, Ref[]>, k: K, r: Ref) => {
    const l = m.get(k);
    if (l) l.push(r);
    else m.set(k, [r]);
  };
  for (const doc of docs) {
    if (doc.erro || doc.norm.length < 40) continue;
    const di: DocIndexado = { doc, paginas: [], termo: false, acessorio: false, assinatura: new Set() };
    // o texto bruto, com as quebras de linha: a linha do título num termo/borderô e a listagem dependem delas
    const texto = doc.bruto || doc.texto;
    const inicios = doc.bruto ? doc.paginasBrutas : doc.paginas.length ? doc.paginas : [0];
    inicios.forEach((ini, i) => di.paginas.push(montarPagina(di, i + 1, texto.slice(ini, inicios[i + 1] ?? texto.length))));
    di.termo = RE_TERMO.test(di.paginas.slice(0, 3).map((p) => p.texto).join("\n"));
    di.acessorio = RE_ACESSORIO.test(di.paginas[0]?.texto.slice(0, 400) ?? "");
    for (const p of di.paginas) {
      for (const x of p.pessoas) di.assinatura.add(`p${x.valor}`);
      for (const x of p.moedas) di.assinatura.add(`m${x.valor}`);
      for (const x of p.datas) di.assinatura.add(`d${x.valor}`);
      for (const n of p.numeros) {
        pus(indice.porCorrido, n.corrido, { pag: p, pos: n.pos });
        pus(indice.porGrupos, n.grupos.join("."), { pag: p, pos: n.pos });
        if (n.grupos[0]?.length >= 4) pus(indice.porPrincipal, n.grupos[0], { pag: p, pos: n.pos });
      }
      for (const c of p.codigos) pus(indice.porCodigo, c.valor, { pag: p, pos: c.pos });
      for (const x of p.pessoas) pus(indice.porPessoa, x.valor, { pag: p, pos: x.pos });
      for (const x of p.moedas) pus(indice.porMoeda, x.valor, { pag: p, pos: x.pos });
    }
    indice.docs.push(di);
  }
  return indice;
}

// ------------------------------------------------------------------ o título (pendência) e o perfil do tipo

interface Perfil { comParcela: boolean; ancoraPorNome: boolean; corrigeNumeroDaLinha: boolean; paginasDocInteiro: number; ccb: boolean; duplicata: boolean }

function perfilDo(tipo: string): Perfil {
  const f = normalizarMesmoTamanho(tipo).replace(/[^a-z0-9]+/g, " ").trim();
  const nc = f === "nc" || f.startsWith("nc ") || f.includes("nota comercial");
  const duplicata = f.includes("duplicata") || f.startsWith("dm ");
  const ccb = f.startsWith("ccb");
  const cpr = f.startsWith("cpr") || f.includes("produto rural") || f.includes("produtor rural");
  return {
    comParcela: ccb || cpr, ancoraPorNome: !ccb && f.includes("contrato"), corrigeNumeroDaLinha: !duplicata,
    paginasDocInteiro: nc ? Number.POSITIVE_INFINITY : 15, ccb, duplicata,
  };
}

interface Pend {
  linha: LinhaResultado;
  d: DadosDoTitulo;
  chaves: ChavesDocumento;
  pessoaSacado: string | null;
  pessoaCedente: string | null;
  tokSacado: string[];
  tokCedente: string[];
  /** o nome veio cortado na carteira: a última palavra vale pelo começo */
  sacadoCortado: boolean;
  cedenteCortado: boolean;
  valores: number[];
  perfil: Perfil;
}

function pendencia(l: LinhaResultado): Pend | null {
  const d = l.dados;
  if (!d) return null;
  return {
    linha: l, d, chaves: chavesDocumento(d.numero), pessoaSacado: normalizarPessoa(d.docSacado), pessoaCedente: normalizarPessoa(d.docCedente),
    tokSacado: tokensNome(d.sacado), tokCedente: tokensNome(d.cedente), sacadoCortado: nomeCortado(d.sacado), cedenteCortado: nomeCortado(d.cedente),
    valores: [...new Set([d.nominal, d.aquisicao].filter((v): v is number => v !== null && v > 0))], perfil: perfilDo(d.tipo),
  };
}

// ------------------------------------------------------------------ campos numa região

type Modo = "linha" | "pagina";
type Avaliacao = Record<CampoPre, Veredito>;

const nada = (): Veredito => ({ marca: "P", documento: "", regra: "", pagina: 0, pos: -1, fim: -1 });
const dentro = <T extends { pos: number }>(lista: T[], ini: number, fim: number) => lista.filter((x) => x.pos >= ini && x.pos < fim);
const veredito = (p: Pagina, marca: Marca, x: { pos: number; fim: number }, regra = "", extra: Partial<Veredito> = {}): Veredito =>
  ({ marca, documento: p.original.slice(x.pos, x.fim).replace(/\s+/g, " ").trim(), regra, pagina: p.numero, pos: x.pos, fim: x.fim, ...extra });

const ROTULOS: Record<"vencimento" | "emissao" | "valor" | "sacadoDoc" | "cedenteDoc" | "cedenteCcb", RegExp> = {
  vencimento: /venc(?:imento|to|\.)?/g,
  emissao: /emiss(?:ao|[^\sa-z0-9]o|\.)|emitid[oa]s? em|data d[oa] (?:contrato|operacao)/g,
  valor: /valor/g,
  sacadoDoc: /sacado|devedor|pagador(?!a)|destinatario|comprador/g,
  cedenteDoc: /cedente|emitente|sacador|beneficiario|vendedor/g,
  cedenteCcb: /cedente|credor/g,
};
const RE_COLADO = /^[\s:.\-–|]*(?:n[º°o.]?\s*:?\s*)?$/;
const RE_ENCARGO = /(?:iof|seguro|tarifa|juros|multa|mora|cet|custo\s+efetivo|taxa|desconto|abatimento)[^\d\n]{0,25}$/;
const RE_VALOR_PARCELA = /valor\s+d[ao]s?\s+parcelas?/;

function rotulos(p: Pagina, re: RegExp, ini: number, fim: number): { pos: number; fim: number }[] {
  return [...p.texto.slice(ini, fim).matchAll(new RegExp(re.source, "g"))].map((m) => ({ pos: ini + m.index!, fim: ini + m.index! + m[0].length }));
}

/** O primeiro valor logo depois do rótulo ("Vencimento: 05/09/2026"): só separadores entre eles, na mesma linha. */
function colado<T extends { pos: number }>(p: Pagina, rot: { fim: number }, lista: T[]): T | null {
  const x = lista.find((v) => v.pos >= rot.fim);
  if (!x || x.pos - rot.fim > 30 || linhaDe(p, x.pos) !== linhaDe(p, rot.fim)) return null;
  return RE_COLADO.test(p.texto.slice(rot.fim, x.pos)) ? x : null;
}
const depoisDoRotulo = <T extends { pos: number }>(rots: { fim: number }[], lista: T[], janela: number): T | null => {
  for (const r of rots) {
    const x = lista.find((v) => v.pos >= r.fim && v.pos - r.fim <= janela);
    if (x) return x;
  }
  return null;
};
const deEncargo = (p: Pagina, pos: number) => {
  const antes = p.texto.slice(Math.max(0, pos - 40), pos);
  return RE_ENCARGO.test(antes) && !RE_VALOR_PARCELA.test(antes);
};

/** Parcelas mensais do cronograma impresso (1º vencimento … último), como no motor do bate-lastro. */
function cronograma(p: Pagina): Set<string> {
  const t = p.texto;
  const depois = (re: RegExp) => {
    const m = re.exec(t);
    return m ? p.datas.find((d) => d.pos >= m.index + m[0].length && d.pos - (m.index + m[0].length) <= 40)?.valor ?? null : null;
  };
  const primeira = depois(/vencimento\s+da\s+1\S{0,2}\s+parcela|primeiro\s+vencimento|vencimento\s+das\s+parcelas/);
  if (!primeira) return new Set();
  let ultima = depois(/vencimento\s+final|ultimo\s+vencimento|vencimento\s+da\s+ultima\s+parcela/);
  const qtd = /(?:quantidade|qtde?\.?|numero)\s+de\s+parcelas\s*:?\s*(\d{1,3})/.exec(t);
  if (!ultima && qtd) ultima = somarMeses(primeira, Number(qtd[1]) - 1);
  if (!ultima || ultima < primeira) return new Set();
  const datas = new Set<string>();
  for (let n = 0, d = primeira; d <= ultima && n < 480; n++, d = somarMeses(primeira, n)) datas.add(d);
  return datas;
}
function tabelaDeParcelas(p: Pagina): Set<string> {
  const m = [...p.texto.matchAll(/(?<![\d/.,])\d{1,3}\s+(\d{2}\/\d{2}\/\d{4})\s*r\$\s?\d/g)];
  if (m.length < 3) return new Set();
  return new Set(m.map((x) => extrairDatas(x[1])[0]?.valor).filter((v): v is string => !!v));
}

function avaliarNumero(e: Pend, p: Pagina, ini: number, fim: number, modo: Modo): Veredito {
  const a = e.chaves;
  if (a.trivial) return e.perfil.ccb && a.corrido === "0" ? { ...nada(), marca: "V", regra: "ccb_sem_numero", peso: 0 } : nada();
  if (a.codigo) {
    const c = dentro(p.codigos, ini, fim).find((x) => x.valor === a.codigo);
    if (c) return veredito(p, "V", c);
  }
  let principal = false;
  for (const n of dentro(p.numeros, ini, fim)) {
    const r = numeroConfere(a, n, e.perfil.comParcela);
    if (r) return veredito(p, "V", n, r === "parcela" ? "numero_com_parcela" : "");
    if (a.principal.length >= 4 && n.grupos[0] === a.principal) principal = true;
  }
  if (modo === "linha" && !principal && e.perfil.corrigeNumeroDaLinha) {
    const ocupado = (n: NumeroImpresso) => [...p.pessoas, ...p.datas, ...p.moedas].some((x) => x.pos <= n.pos && n.pos < x.fim);
    const soltos = dentro(p.numeros, ini, fim).filter((n) => n.digitos.length >= 6 && !ocupado(n));
    if (soltos.length === 1) return veredito(p, "D", soltos[0], "", { peso: 0 });
  }
  return principal ? { ...nada(), peso: 1.5 } : nada();
}

function avaliarValor(e: Pend, p: Pagina, ini: number, fim: number, modo: Modo): Veredito {
  if (!e.valores.length) return nada();
  const moedas = dentro(p.moedas, ini, fim);
  const igual = moedas.find((m) => e.valores.includes(m.valor) && !deEncargo(p, m.pos));
  if (igual) return veredito(p, "V", igual);
  if (modo === "linha") {
    const distintos = [...new Set(moedas.filter((m) => m.valor > 0).map((m) => m.valor))];
    if (distintos.length === 1) return veredito(p, "D", moedas.find((m) => m.valor === distintos[0])!);
    return nada();
  }
  const outro = depoisDoRotulo(rotulos(p, ROTULOS.valor, ini, fim), moedas.filter((m) => !deEncargo(p, m.pos)), 80);
  return outro ? veredito(p, "D", outro) : nada();
}

function avaliarData(e: Pend, campo: "vencimento" | "emissao", p: Pagina, ini: number, fim: number, modo: Modo): Veredito {
  const alvo = e.d[campo];
  const datas = dentro(p.datas, ini, fim);
  const rots = rotulos(p, ROTULOS[campo], ini, fim);
  if (!alvo) {
    if (campo !== "vencimento") return nada();
    const doc = modo === "linha" ? datas[datas.length - 1] : depoisDoRotulo(rots, datas, 80);
    return doc ? veredito(p, "D", doc, "planilha_sem_vencimento") : nada();
  }
  if (modo === "pagina" && campo === "vencimento") {
    if (cronograma(p).has(alvo)) return { ...nada(), marca: "V", documento: fmtData(alvo), regra: "cronograma_parcelas", pagina: p.numero };
    if (tabelaDeParcelas(p).has(alvo)) return { ...nada(), marca: "V", documento: fmtData(alvo), regra: "parcela_na_tabela", pagina: p.numero };
  }
  const antes = diasAntes(alvo);
  if (modo === "pagina") {
    for (const r of rots) {
      const x = colado(p, r, p.datas);
      if (!x) continue;
      if (x.valor === alvo) return veredito(p, "V", x);
      if (antes.includes(x.valor)) {
        return campo === "emissao" ? veredito(p, "D", x, "planilha_um_dia_depois") : veredito(p, "D", x, "vencimento_um_dia_antes", { peso: 1.5 });
      }
      return veredito(p, "D", x);
    }
  }
  const igual = datas.find((x) => x.valor === alvo);
  if (igual) return veredito(p, "V", igual);
  if (campo === "vencimento") {
    const umDia = datas.find((x) => antes.includes(x.valor));
    if (umDia) return veredito(p, "D", umDia, "vencimento_um_dia_antes", { peso: 1.5 });
  }
  if (modo === "pagina") {
    const outro = depoisDoRotulo(rots, datas, 80);
    if (outro) return veredito(p, "D", outro);
  }
  return nada();
}

function avaliarPessoa(alvo: string | null, rotulo: RegExp, p: Pagina, ini: number, fim: number, modo: Modo): Veredito {
  if (!alvo) return nada();
  const pessoas = dentro(p.pessoas, ini, fim);
  const igual = pessoas.find((x) => x.valor === alvo);
  if (igual) return veredito(p, "V", igual);
  const raiz = alvo.length === 14 ? pessoas.find((x) => x.valor.length === 14 && x.valor.slice(0, 8) === alvo.slice(0, 8)) : undefined;
  if (raiz) return veredito(p, "V", raiz, "cnpj_mesma_raiz");
  if (modo === "pagina") {
    const outro = depoisDoRotulo(rotulos(p, rotulo, ini, fim), pessoas, 200);
    if (outro) return veredito(p, "D", outro);
  }
  return nada();
}

function avaliarNome(tokens: string[], cortado: boolean, p: Pagina, ini: number, fim: number): Veredito {
  if (!tokens.length) return nada();
  const r = nomeNoTexto(tokens, p.texto, ini, fim, cortado);
  return r.ok ? veredito(p, "V", r) : nada();
}

function avaliar(e: Pend, p: Pagina, ini: number, fim: number, modo: Modo): Avaliacao {
  return {
    numero: avaliarNumero(e, p, ini, fim, modo),
    valor: avaliarValor(e, p, ini, fim, modo),
    vencimento: avaliarData(e, "vencimento", p, ini, fim, modo),
    emissao: avaliarData(e, "emissao", p, ini, fim, modo),
    sacadoDoc: avaliarPessoa(e.pessoaSacado, ROTULOS.sacadoDoc, p, ini, fim, modo),
    cedenteDoc: avaliarPessoa(e.pessoaCedente, e.perfil.ccb ? ROTULOS.cedenteCcb : ROTULOS.cedenteDoc, p, ini, fim, modo),
    sacadoNome: avaliarNome(e.tokSacado, e.sacadoCortado, p, ini, fim),
    cedenteNome: avaliarNome(e.tokCedente, e.cedenteCortado, p, ini, fim),
  };
}

function pontuar(e: Pend, a: Avaliacao): number {
  let s = 0;
  for (const k of CAMPOS_PRE) {
    const v = a[k];
    s += v.peso ?? (v.marca === "V" ? PESOS[k] : 0);
  }
  if (e.perfil.ancoraPorNome && a.sacadoNome.marca === "V") s += 1;
  return s;
}
const fortesV = (a: Avaliacao) => FORTES.filter((k) => a[k].marca === "V").length;

// ------------------------------------------------------------------ regiões e candidatos

/** A linha do título numa tabela (termo, borderô): da linha seguinte à do título anterior até a linha com valor e data. */
function regiaoRegistro(p: Pagina, pos: number): [number, number] {
  const l = linhaDe(p, pos);
  const i = p.linhasTitulo.findIndex((k) => k >= l);
  if (i < 0) return regiaoLinha(p, pos);
  const k = p.linhasTitulo[i];
  let ini = i > 0 ? p.linhasTitulo[i - 1] + 1 : Math.max(0, k - 3);
  if (k - ini + 1 > 8) ini = k - 3;
  return [p.inicios[Math.max(0, ini)], fimDaLinha(p, k)];
}
function regiaoLinha(p: Pagina, pos: number): [number, number] {
  const l = linhaDe(p, pos);
  if (fimDaLinha(p, l) - p.inicios[l] >= LINHA_CURTA) return [p.inicios[l], fimDaLinha(p, l)];
  return [p.inicios[Math.max(0, l - 1)], fimDaLinha(p, Math.min(p.inicios.length - 1, l + 1))];
}

interface Regiao { pag: Pagina; modo: Modo; ini: number; fim: number; aval: Avaliacao; score: number }
interface CandidatoInterno { di: DocIndexado; melhor: Regiao; segundoNoPdf: number; score: number }

function ancoras(e: Pend, ind: Indice): Ref[] {
  const lista: Ref[] = [];
  const a = e.chaves;
  const add = (refs?: Ref[]) => refs && lista.push(...refs);
  if (a.codigo) add(ind.porCodigo.get(a.codigo));
  if (a.corrido.length >= 3 && !a.trivial) {
    add(ind.porCorrido.get(a.corrido));
    add(ind.porGrupos.get(a.grupos.join(".")));
  }
  if (a.principal.length >= 4) add(ind.porPrincipal.get(a.principal));
  if (e.perfil.comParcela && a.corrido.length >= 7) {
    for (const corte of [2, 3]) if (a.corrido.length - corte >= 5) add(ind.porCorrido.get(a.corrido.slice(0, -corte)));
    for (let n = 8; n <= a.corrido.length - 2; n++) {
      for (let i = 0; i + n <= a.corrido.length; i++) {
        const s = a.corrido.slice(i, i + n);
        if (s[0] !== "0") add(ind.porCorrido.get(s));
      }
    }
  }
  if (e.pessoaSacado) add(ind.porPessoa.get(e.pessoaSacado));
  const datas = [e.d.vencimento, e.d.emissao].filter(Boolean);
  for (const v of e.valores) add(ind.porMoeda.get(v)?.filter((r) => r.pag.datas.some((d) => datas.includes(d.valor))));
  if (!lista.length && e.perfil.ancoraPorNome && e.tokSacado.length >= 2) {
    const minimo = Math.max(2, Math.ceil(0.75 * e.tokSacado.length));
    for (const di of ind.docs) {
      for (const p of di.paginas) {
        const achados = e.tokSacado.map((t) => p.texto.search(new RegExp(`(?<![a-z0-9])${t}(?![a-z0-9])`))).filter((i) => i >= 0);
        if (achados.length >= minimo) lista.push({ pag: p, pos: Math.min(...achados) });
      }
    }
  }
  return lista.filter((r) => !r.pag.doc.acessorio);
}

/** O documento traz alguma coisa do título (número, CPF/CNPJ ou metade do nome)? Sem isso não é dele. */
function documentoDoTitulo(e: Pend, di: DocIndexado): boolean {
  const a = e.chaves;
  const temChave = !a.trivial || !!e.pessoaSacado || e.tokSacado.length > 0;
  if (!temChave) return true;
  const paginas = di.paginas;
  if (a.codigo && paginas.some((p) => p.codigos.some((c) => c.valor === a.codigo))) return true;
  if (!a.trivial && paginas.some((p) => p.numeros.some((n) => numeroConfere(a, n, e.perfil.comParcela) || (a.principal.length >= 4 && n.grupos[0] === a.principal)))) return true;
  if (e.pessoaSacado) {
    const s = e.pessoaSacado;
    if (paginas.some((p) => p.pessoas.some((x) => x.valor === s || (s.length === 14 && x.valor.length === 14 && x.valor.slice(0, 8) === s.slice(0, 8))))) return true;
  }
  if (e.tokSacado.length) {
    const todo = paginas.map((p) => p.texto).join("\n");
    const achados = e.tokSacado.filter((t) => new RegExp(`(?<![a-z0-9])${t}(?![a-z0-9])`).test(todo)).length;
    if (achados / e.tokSacado.length >= 0.5) return true;
  }
  return false;
}

function candidatosDoDoc(e: Pend, di: DocIndexado, refs: Ref[]): CandidatoInterno | null {
  const porPagina = new Map<Pagina, number[]>();
  for (const r of refs) porPagina.set(r.pag, [...(porPagina.get(r.pag) ?? []), r.pos]);
  const regioes: Regiao[] = [];
  for (const [pag, posicoes] of porPagina) {
    if (pag.ehTabela) {
      const linhas = new Map<string, Regiao>();
      for (const pos of posicoes.sort((a, b) => a - b)) {
        const [ini, fim] = regiaoRegistro(pag, pos);
        const k = `${ini}-${fim}`;
        if (linhas.has(k)) continue;
        const aval = avaliar(e, pag, ini, fim, "linha");
        if (fortesV(aval) >= 2) linhas.set(k, { pag, modo: "linha", ini, fim, aval, score: pontuar(e, aval) });
      }
      if (linhas.size) {
        regioes.push(...linhas.values());
        continue;
      }
      if (pag.ehListagem) continue; // listagem (relatório, borderô de muitos devedores) não é o documento do título
    }
    const aval = avaliar(e, pag, 0, pag.texto.length, "pagina");
    regioes.push({ pag, modo: "pagina", ini: 0, fim: pag.texto.length, aval, score: pontuar(e, aval) });
  }
  if (!regioes.length) return null;
  regioes.sort((a, b) => b.score - a.score || a.pag.numero - b.pag.numero || a.ini - b.ini);
  const melhor = regioes[0];
  const rival = regioes.slice(1).find((r) => r.modo === "linha" || melhor.modo === "linha");
  let score = melhor.score;
  if (melhor.modo === "pagina") {
    if (!documentoDoTitulo(e, di)) return null;
    score += completarNoDocumento(e, di, melhor, true);
  } else {
    completarNoDocumento(e, di, melhor, false);
  }
  return { di, melhor, segundoNoPdf: rival?.score ?? 0, score };
}

/** Campos que a página não trouxe, procurados nas outras páginas do documento (número, CPF/CNPJ, valor, nomes). */
function completarNoDocumento(e: Pend, di: DocIndexado, r: Regiao, soma: boolean): number {
  let extra = 0;
  const paginas = di.paginas.slice(0, Number.isFinite(e.perfil.paginasDocInteiro) ? e.perfil.paginasDocInteiro : undefined);
  const faltam = new Set((["numero", "sacadoDoc", "cedenteDoc", "valor", "sacadoNome", "cedenteNome"] as CampoPre[]).filter((k) => r.aval[k].marca === "P"));
  for (const p of paginas) {
    if (!faltam.size) break;
    if (p === r.pag) continue;
    const av = avaliar(e, p, 0, p.texto.length, "pagina");
    for (const k of [...faltam]) {
      if (av[k].marca !== "V") continue;
      r.aval[k] = av[k];
      faltam.delete(k);
      if (soma) extra += av[k].peso ?? PESOS[k];
    }
  }
  return extra;
}

/** Mesmo documento (cópias): a mesma página, ou ≥ 90% dos mesmos CPFs, valores e datas. */
function mesmoDocumento(a: CandidatoInterno, b: CandidatoInterno): boolean {
  if (a.melhor.pag.hash === b.melhor.pag.hash) return true;
  const x = a.di.assinatura;
  const y = b.di.assinatura;
  if (x.size < 8 || y.size < 8 || Math.min(x.size, y.size) / Math.max(x.size, y.size) < 0.9) return false;
  let comum = 0;
  for (const v of x) if (y.has(v)) comum++;
  return comum / (x.size + y.size - comum) >= 0.9;
}

function confianca(c: CandidatoInterno, segundo: CandidatoInterno | undefined): Confianca {
  const a = c.melhor.aval;
  let fortes = fortesV(a);
  if (a.numero.marca === "V" && a.sacadoNome.marca === "V" && a.sacadoDoc.marca !== "V") fortes++;
  const margem = c.score - Math.max(segundo?.score ?? 0, c.segundoNoPdf);
  if (c.score < 3) return "sem_candidato";
  if (margem < 1) return "ambigua";
  if (fortes >= 2 && margem >= 2 && (a.numero.marca === "V" || c.score >= 7)) return "alta";
  if (fortes >= 2 && c.score >= 5) return "media";
  return "baixa";
}

function destaquesDe(c: CandidatoInterno): Destaque[] {
  const vistos = new Set<string>();
  const lista: Destaque[] = [];
  for (const k of CAMPOS_PRE) {
    const v = c.melhor.aval[k];
    if (v.marca === "P" || v.pos < 0 || !v.documento) continue;
    const chave = `${v.pagina}:${v.documento}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    lista.push({ pagina: v.pagina, termo: v.documento, marca: v.marca });
  }
  const daPagina = c.melhor.pag.numero;
  return lista.sort((a, b) => Number(b.pagina === daPagina) - Number(a.pagina === daPagina) || a.pagina - b.pagina);
}

function publico(c: CandidatoInterno): Candidato {
  return {
    docId: c.di.doc.id, arquivo: c.di.doc.nome, caminho: c.di.doc.caminho, tipo: c.di.termo ? "termo" : "documento",
    pagina: c.melhor.pag.numero, modo: c.melhor.modo, score: Math.round(c.score * 10) / 10, detalhes: c.melhor.aval, destaques: destaquesDe(c),
  };
}

const RE_CPF_ROTULADO = /\bcpf\b[^0-9]{0,15}(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/g;

/** Pré-classifica um título: o documento sugerido, a confiança e a marca de cada campo. */
export function preClassificarTitulo(l: LinhaResultado, ind: Indice): Sugestao {
  const vazio: Sugestao = {
    linhaId: l.id, confianca: "sem_candidato", candidato: null, alternativas: [], avisos: [],
    campos: { valor: nada(), emissao: nada(), vencimento: nada(), emissor: nada() },
  };
  const e = pendencia(l);
  if (!e) return vazio;
  const porDoc = new Map<DocIndexado, Ref[]>();
  for (const r of ancoras(e, ind)) porDoc.set(r.pag.doc, [...(porDoc.get(r.pag.doc) ?? []), r]);
  const todos: CandidatoInterno[] = [];
  for (const [di, refs] of porDoc) {
    const c = candidatosDoDoc(e, di, refs);
    if (c) todos.push(c);
  }
  todos.sort((a, b) => b.score - a.score || a.di.doc.nome.localeCompare(b.di.doc.nome));
  const usados: CandidatoInterno[] = [];
  for (const c of todos) {
    if (usados.length >= 3) break;
    if (!usados.some((u) => mesmoDocumento(u, c))) usados.push(c);
  }
  if (!usados.length) return vazio;
  const [melhor, segundo] = usados;
  let conf = confianca(melhor, segundo);
  const a = melhor.melhor.aval;
  const avisos: string[] = [];

  // nome parcial ao lado do CPF confirmado
  if (a.sacadoDoc.marca === "V" && a.sacadoNome.marca !== "V" && a.sacadoDoc.pos >= 0 && e.tokSacado.length) {
    const pag = melhor.di.paginas[a.sacadoDoc.pagina - 1];
    const ini = Math.max(0, a.sacadoDoc.pos - 250);
    const fim = Math.min(pag.texto.length, a.sacadoDoc.fim + 250);
    const perto = e.tokSacado.filter((t) => new RegExp(`(?<![a-z0-9])${t}(?![a-z0-9])`).test(pag.texto.slice(ini, fim))).length;
    if (perto / e.tokSacado.length >= 0.5) a.sacadoNome = { ...a.sacadoDoc, documento: e.d.sacado, regra: "nome_parcial_com_cpf" };
  }
  // convenção do time (bate-lastro): o termo de cessão de duplicata traz o cedente, não o sacado — vale a carteira
  if (e.perfil.duplicata && melhor.di.termo && a.sacadoNome.marca !== "V" && a.sacadoDoc.marca !== "V" && e.tokSacado.length) {
    a.sacadoNome = { ...nada(), marca: "V", documento: e.d.sacado, regra: "termo_sem_sacado" };
  }
  // CPF de outra pessoa
  if ((conf === "alta" || conf === "media") && e.pessoaSacado?.length === 11 && e.tokSacado.length
    && a.sacadoDoc.marca !== "V" && a.sacadoNome.marca !== "V") {
    const cpfs = melhor.di.paginas.flatMap((p) => [...p.texto.matchAll(RE_CPF_ROTULADO)].map((m) => m[1].replace(/\D/g, "")));
    if (cpfs.length && !cpfs.includes(e.pessoaSacado)) {
      conf = "baixa";
      avisos.push("cpf_de_outra_pessoa");
    }
  }
  // só a pessoa: o documento não traz número, valor nem vencimento do título
  if (melhor.melhor.modo === "pagina") {
    const exigidos = [!e.chaves.trivial && "numero", e.valores.length && "valor", e.d.vencimento && "vencimento"].filter(Boolean) as CampoPre[];
    if (exigidos.length && exigidos.every((k) => a[k].marca !== "V")) avisos.push("so_a_pessoa");
  }
  // datas: a regra de um dia mantém a data da carteira (V com o alerta); data não achada na página → no documento todo
  for (const k of ["vencimento", "emissao"] as const) {
    const v = a[k];
    const alvo = e.d[k];
    if (!alvo) continue;
    if (v.marca === "D" && (v.regra === "vencimento_um_dia_antes" || (k === "emissao" && v.regra === "planilha_um_dia_depois"))) {
      a[k] = { ...v, marca: "V", alerta: v.documento };
    } else if (v.marca === "P") {
      for (const p of melhor.di.paginas) {
        const x = p.datas.find((d) => d.valor === alvo);
        if (x) {
          a[k] = veredito(p, "V", x, "no_documento");
          break;
        }
      }
    }
  }

  const emissor = a.sacadoNome.marca === "V" ? a.sacadoNome
    : a.sacadoDoc.marca === "V" ? { ...a.sacadoDoc, documento: e.d.sacado, regra: "pelo_cpf_cnpj" } : a.sacadoNome;
  const campos: Record<ChaveCampo, Veredito> = { valor: a.valor, emissao: a.emissao, vencimento: a.vencimento, emissor };
  // campo que a própria carteira não tem: não é "não achado" (não há o que procurar)
  const semValor: Record<ChaveCampo, boolean> = { valor: !e.valores.length, emissao: !e.d.emissao, vencimento: !e.d.vencimento, emissor: !e.tokSacado.length };
  for (const k of ORDEM_CAMPOS) if (semValor[k] && campos[k].marca === "P") campos[k] = { ...campos[k], regra: "sem_valor_na_carteira" };
  return { linhaId: l.id, confianca: conf, candidato: publico(melhor), alternativas: usados.slice(1).map(publico), avisos, campos };
}

/** Linhas que entram na pré-classificação: as que não conferiram e ainda não têm vínculo feito à mão. */
export function pendentes(linhas: LinhaResultado[]): LinhaResultado[] {
  return linhas.filter((l) => l.situacao !== "OK" && l.situacao !== "Só no WP" && !l.manual && l.dados);
}

/** Pré-classifica as pendências sem travar a tela (cede a vez a cada lote). */
export async function preClassificar(
  linhas: LinhaResultado[], docs: Documento[], onProgresso?: (feitos: number, total: number) => void,
): Promise<Sugestao[]> {
  const ceder = () => new Promise((r) => setTimeout(r, 0));
  await ceder();
  const ind = indexar(docs);
  const lista = pendentes(linhas);
  const saida: Sugestao[] = [];
  for (let i = 0; i < lista.length; i++) {
    saida.push(preClassificarTitulo(lista[i], ind));
    if (i % 15 === 14) {
      onProgresso?.(i + 1, lista.length);
      await ceder();
    }
  }
  onProgresso?.(lista.length, lista.length);
  return saida;
}

// ------------------------------------------------------------------ conferência em lote (motivos, grupos, aplicar)

export type Decisao = "confirmar" | "revisar" | "pendente";
export interface Motivo { chave: string; decisao: Decisao; titulo: string }

export const ROTULO_CONFIANCA: Record<Confianca, string> = {
  alta: "alta", media: "média", baixa: "baixa", ambigua: "ambígua", sem_candidato: "sem candidato",
};
const ORDEM_CAMPOS: ChaveCampo[] = ["emissor", "valor", "emissao", "vencimento"];

/** Por que o título precisa (ou não) de olho: o mesmo motivo leva à mesma decisão, e vira o grupo da conferência. */
export function motivoDe(s: Sugestao, rotulos: Record<ChaveCampo, string>): Motivo {
  if (!s.candidato) return { chave: "sem_pdf", decisao: "revisar", titulo: "Nenhum documento encontrado" };
  if (s.avisos.includes("so_a_pessoa")) return { chave: "aviso:so_a_pessoa", decisao: "pendente", titulo: "O documento sugerido só traz a pessoa (CPF/nome), não o título" };
  if (s.avisos.includes("cpf_de_outra_pessoa")) return { chave: "aviso:cpf_de_outra_pessoa", decisao: "pendente", titulo: "O documento sugerido traz o CPF de outra pessoa" };
  if (s.confianca !== "alta") return { chave: `confianca:${s.confianca}`, decisao: "revisar", titulo: `Confiança ${ROTULO_CONFIANCA[s.confianca]} no documento sugerido` };
  const partes: Motivo[] = [];
  const com = (f: (v: Veredito) => boolean) => ORDEM_CAMPOS.filter((k) => f(s.campos[k]));
  const nomes = (ks: ChaveCampo[]) => ks.map((k) => rotulos[k]).join(", ");
  const naoAchados = com((v) => v.marca === "P" && v.regra !== "sem_valor_na_carteira");
  if (naoAchados.length) partes.push({ chave: `nao_encontrado:${naoAchados.join(",")}`, decisao: "confirmar", titulo: `${nomes(naoAchados)} não achado` });
  const divergentes = com((v) => v.marca === "D" && !!v.documento && !v.regra);
  if (divergentes.length) partes.push({ chave: `divergente:${divergentes.join(",")}`, decisao: "revisar", titulo: `o documento traz outro ${nomes(divergentes)}` });
  const correcoes = com((v) => v.marca === "D" && !!v.documento && !!v.regra);
  if (correcoes.length) partes.push({ chave: `correcao:${correcoes.join(",")}`, decisao: "confirmar", titulo: `correção sugerida em ${nomes(correcoes)}` });
  const pelaCarteira = com((v) => v.marca === "V" && v.regra === "termo_sem_sacado");
  if (pelaCarteira.length) partes.push({ chave: `pela_carteira:${pelaCarteira.join(",")}`, decisao: "confirmar", titulo: `${nomes(pelaCarteira)}: o termo da duplicata não traz — vale a carteira` });
  if (!partes.length) return { chave: "confere", decisao: "confirmar", titulo: "Tudo confere com o documento" };
  const titulo = partes.map((p) => p.titulo).join(" + ");
  return {
    chave: partes.map((p) => p.chave).join("|"),
    decisao: partes.some((p) => p.decisao === "revisar") ? "revisar" : "confirmar",
    titulo: titulo[0].toUpperCase() + titulo.slice(1),
  };
}

export interface Grupo { motivo: Motivo; itens: Sugestao[] }

/** Grupos por motivo (o maior primeiro); dentro do grupo, os títulos do mesmo documento ficam juntos. */
export function agruparPorMotivo(lista: Sugestao[], rotulos: Record<ChaveCampo, string>): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const s of lista) {
    const m = motivoDe(s, rotulos);
    const g = grupos.get(m.chave) ?? { motivo: m, itens: [] };
    g.itens.push(s);
    grupos.set(m.chave, g);
  }
  for (const g of grupos.values()) g.itens.sort((a, b) => (a.candidato?.arquivo ?? "").localeCompare(b.candidato?.arquivo ?? "") || a.linhaId - b.linhaId);
  return [...grupos.values()].sort((a, b) => b.itens.length - a.itens.length);
}

/** Seções da conferência: para decidir, prontos para aplicar e sem documento. */
export function secoes(lista: Sugestao[], rotulos: Record<ChaveCampo, string>) {
  const comPdf = lista.filter((s) => s.candidato);
  const grupos = agruparPorMotivo(comPdf, rotulos);
  const ordem: Record<Decisao, number> = { revisar: 0, pendente: 1, confirmar: 2 };
  return {
    paraDecidir: grupos.filter((g) => g.motivo.decisao !== "confirmar")
      .sort((a, b) => ordem[a.motivo.decisao] - ordem[b.motivo.decisao] || b.itens.length - a.itens.length),
    prontos: grupos.filter((g) => g.motivo.decisao === "confirmar"),
    semPdf: lista.filter((s) => !s.candidato),
  };
}

/** O vínculo (marcas do Bater PDF) que a sugestão grava quando quem confere aplica. */
export function vinculoDaSugestao(s: Sugestao): Vinculo | null {
  if (!s.candidato) return null;
  const campos: Vinculo["campos"] = {};
  for (const k of ORDEM_CAMPOS) {
    const v = s.campos[k];
    campos[k] = { marca: v.marca, documento: v.marca === "P" ? "" : v.documento };
  }
  return { arquivo: s.candidato.arquivo, pagina: s.candidato.pagina, campos };
}

/** Texto curto do valor da carteira em cada campo (para o cartão da conferência). */
export function valorDaCarteiraPre(d: DadosDoTitulo, k: ChaveCampo): string {
  if (k === "valor") return fmtValor(d.nominal ?? d.aquisicao);
  if (k === "emissao") return fmtData(d.emissao);
  if (k === "vencimento") return fmtData(d.vencimento);
  return d.sacado;
}
