/**
 * Análise do texto de um documento de lastro/termo: valores em R$, datas de emissão e vencimento
 * rotuladas, emissores citados, números de emissão e CNPJs. Funções puras (rodam no navegador e nos testes).
 */
import {
  acharDatas, acharValores, normalizarComMapa, numerosDeEmissao, palavras, soDigitos, type Ocorrencia,
} from "./textos";

const ROTULOS_EMISSAO = [/data\s+(?:de\s+|da\s+)?emissao/g, /emitid[ao]s?\s+em/g];
const ROTULOS_VENCIMENTO = [
  /data\s+(?:de\s+|do\s+|final\s+de\s+)?vencimento/g, /vencimento\s+em/g,
  /vencendo-se,?(?:\s+portanto)?,?\s+em/g, /vencimento\s*:/g, /data\s+vencto/g,
];
// Palavra de outro rótulo entre o rótulo e a data = a data é desse outro rótulo
// (ex.: "contados da Data de Emissão, vencendo-se, portanto, em 26/03/2031" não é emissão).
const CONFLITOS_EMISSAO = ["vencimento", "vencendo", "vencto", "integraliza", "aquisicao", "assinatura", "pagamento"];
const CONFLITOS_VENCIMENTO = ["emissao", "integraliza", "aquisicao", "assinatura", "carencia"];
const ROTULOS_VALOR = [
  /valor\s+da\s+aquisicao/g, /valor\s+atual\s+do\s+ativo/g, /valor\s+a\s+pagar/g, /valor\s+em\s+r\$/g,
  /valor\s+total\s+da\s+emissao/g, /valor\s+de\s+aquisicao/g, /valor\s+aplicado/g, /valor\s+da\s+cessao/g,
  /preco\s+de\s+aquisicao/g,
];
const ROTULOS_EMISSOR = [
  /emissao,?\s+pela\s+(.{4,90}?),?\s+(?:inscrita|com\s+sede|sociedade)/g,
  /emissor\s+\(nome\s+do\s+emissor\)\s+(.{3,90}?)\s+codigo/g,
  /contratante\/emissora\s+nome\s+(.{3,90}?)\s+cnpj/g,
  /nome\s+simplificado\s+do\s+emissor:?\s+(\S{3,30})/g,
  /emitente:\s+(.{4,90}?),?\s+(?:inscrita|cnpj|com\s+sede|pessoa)/g,
  /(?:securitizadora|emissora)\s*:\s+(.{4,90}?),?\s+(?:inscrita|cnpj|com\s+sede|sociedade)/g,
];
const JANELA_DATA = 70;
const JANELA_VALOR = 60;
const TRECHO = 90;
const RE_CNPJ = /(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g;

export interface Achado<T> { valor: T; ini: number; fim: number; trecho: string }

export interface Documento {
  id: number;
  nome: string;
  caminho: string;
  tipo: string;
  paginasLidas: number;
  paginasTotal: number;
  erro: string;
  aviso: string;
  texto: string;
  norm: string;
  mapa: Int32Array;
  palavras: string;
  valores: Achado<number>[];
  valoresRotulados: Achado<number>[];
  datas: Achado<string>[];
  datasEmissao: Achado<string>[];
  datasVencimento: Achado<string>[];
  emissoresCitados: Achado<string>[];
  numerosEmissao: Set<number>;
  cnpjs: Set<string>;
  grupo: string;
}

let proximoId = 1;

export function temTexto(doc: Documento): boolean {
  return doc.norm.length > 40;
}

/** Trecho do texto original em volta de uma posição do texto normalizado. */
export function trecho(doc: Documento, ini: number, fim: number): string {
  if (!doc.mapa.length) return "";
  const limite = doc.mapa.length - 1;
  const a = doc.mapa[Math.max(0, Math.min(ini, limite))];
  const b = doc.mapa[Math.max(0, Math.min(fim, limite))];
  const i = Math.max(0, a - TRECHO / 2);
  const f = Math.min(doc.texto.length, b + TRECHO / 2);
  return (i > 0 ? "…" : "") + doc.texto.slice(i, f).trim() + (f < doc.texto.length ? "…" : "");
}

export function contem(doc: Documento, termoPalavras: string): boolean {
  const termo = " " + termoPalavras.trim() + " ";
  return termo.trim().length > 2 && doc.palavras.includes(termo);
}

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Onde o termo (palavras normalizadas) aparece, com o trecho; null se não aparece. */
export function achar(doc: Documento, termoPalavras: string): Achado<string> | null {
  const tokens = termoPalavras.split(" ").filter(Boolean);
  if (!tokens.length || !contem(doc, termoPalavras)) return null;
  const re = new RegExp(`(?<![a-z0-9])${tokens.map(escapar).join("[^a-z0-9]+")}(?![a-z0-9])`);
  const m = doc.norm.match(re);
  if (!m || m.index === undefined) return { valor: termoPalavras, ini: 0, fim: 0, trecho: "" };
  return { valor: termoPalavras, ini: m.index, fim: m.index + m[0].length, trecho: trecho(doc, m.index, m.index + m[0].length) };
}

function datasRotuladas(doc: Documento, rotulos: RegExp[], datas: Ocorrencia<string>[], conflitos: string[]) {
  const achados: Achado<string>[] = [];
  const vistos = new Set<string>();
  for (const rotulo of rotulos) {
    for (const m of doc.norm.matchAll(rotulo)) {
      const fimRotulo = m.index! + m[0].length;
      for (const d of datas) {
        if (d.ini < fimRotulo) continue;
        if (d.ini - fimRotulo > JANELA_DATA) break;
        const entre = doc.norm.slice(fimRotulo, d.ini);
        if (conflitos.some((p) => entre.includes(p))) break;
        const chave = `${d.ini}|${d.valor}`;
        if (!vistos.has(chave)) {
          vistos.add(chave);
          achados.push({ valor: d.valor, ini: m.index!, fim: d.fim, trecho: trecho(doc, m.index!, d.fim) });
        }
        break;
      }
    }
  }
  return achados;
}

function valoresRotulados(doc: Documento, valores: Ocorrencia<number>[]) {
  const achados: Achado<number>[] = [];
  const vistos = new Set<number>();
  for (const rotulo of ROTULOS_VALOR) {
    for (const m of doc.norm.matchAll(rotulo)) {
      const fimRotulo = m.index! + m[0].length;
      for (const v of valores) {
        if (v.ini < fimRotulo) continue;
        if (v.ini - fimRotulo > JANELA_VALOR) break;
        if (!vistos.has(v.ini) && v.valor > 0) {
          vistos.add(v.ini);
          achados.push({ valor: v.valor, ini: m.index!, fim: v.fim, trecho: trecho(doc, m.index!, v.fim) });
        }
        break;
      }
    }
  }
  return achados;
}

function emissoresCitados(doc: Documento) {
  const achados: Achado<string>[] = [];
  const vistos = new Set<string>();
  for (const rotulo of ROTULOS_EMISSOR) {
    for (const m of doc.norm.matchAll(rotulo)) {
      const ini = m.index! + m[0].indexOf(m[1]);
      const fim = ini + m[1].length;
      const nome = doc.texto.slice(doc.mapa[ini], doc.mapa[fim]).trim().replace(/^[\s,.;:*()"“”]+|[\s,.;:*()"“”]+$/g, "");
      const chave = palavras(nome);
      if (nome && !vistos.has(chave)) {
        vistos.add(chave);
        achados.push({ valor: nome, ini, fim, trecho: trecho(doc, m.index!, fim) });
      }
    }
  }
  return achados;
}

/** Número da operação no nome do arquivo ('789770_12692_TCNC_...' → '12692'). */
export function grupoDoNome(nome: string): string {
  return nome.split(/[_\-. ]+/).find((parte) => /^\d{5}$/.test(parte)) ?? "";
}

export function analisar(
  nome: string, textoBruto: string,
  opcoes: { caminho?: string; tipo?: string; paginasLidas?: number; paginasTotal?: number; aviso?: string } = {},
): Documento {
  const { norm, original, mapa } = normalizarComMapa(textoBruto);
  const tipo = opcoes.tipo ?? (nome.split(".").pop() ?? "").toUpperCase();
  const doc: Documento = {
    id: proximoId++, nome, caminho: opcoes.caminho ?? nome, tipo,
    paginasLidas: opcoes.paginasLidas ?? 1, paginasTotal: opcoes.paginasTotal ?? 1,
    erro: "", aviso: opcoes.aviso ?? "", texto: original, norm, mapa, palavras: palavras(norm),
    valores: [], valoresRotulados: [], datas: [], datasEmissao: [], datasVencimento: [],
    emissoresCitados: [], numerosEmissao: new Set(), cnpjs: new Set(), grupo: grupoDoNome(nome),
  };
  if (!temTexto(doc)) {
    doc.erro = tipo === "PDF" ? "sem texto (documento escaneado/imagem: não há OCR)" : "sem texto";
    return doc;
  }
  const valores = acharValores(norm);
  const datas = acharDatas(norm);
  doc.valores = valores.map((v) => ({ valor: v.valor, ini: v.ini, fim: v.fim, trecho: "" }));
  doc.valoresRotulados = valoresRotulados(doc, valores);
  doc.datas = datas.map((d) => ({ valor: d.valor, ini: d.ini, fim: d.fim, trecho: "" }));
  doc.datasEmissao = datasRotuladas(doc, ROTULOS_EMISSAO, datas, CONFLITOS_EMISSAO);
  doc.datasVencimento = datasRotuladas(doc, ROTULOS_VENCIMENTO, datas, CONFLITOS_VENCIMENTO);
  doc.emissoresCitados = emissoresCitados(doc);
  doc.numerosEmissao = numerosDeEmissao(norm);
  doc.cnpjs = new Set([...norm.matchAll(RE_CNPJ)].map((m) => soDigitos(m[0])));
  return doc;
}

export function documentoComErro(nome: string, caminho: string, erro: string): Documento {
  const doc = analisar(nome, "", { caminho });
  doc.erro = erro;
  return doc;
}
