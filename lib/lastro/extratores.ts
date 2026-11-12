/**
 * Bytes de um arquivo → texto. Não depende do DOM: roda no navegador e no Node (testes).
 * O pdf.js é injetado (navegador: 'pdfjs-dist'; Node: 'pdfjs-dist/legacy/build/pdf.mjs').
 */
import JSZip from "jszip";

export const MAX_PAGINAS_PDF = 40;
export const TEMPO_MAX_PDF_MS = 8000;

export const EXTENSOES_TEXTO = [".pdf", ".htm", ".html", ".docx", ".txt", ".xml"];
const COMPACTADOS = [".zip", ".7z", ".rar", ".tgz", ".gz", ".tar"];
const IMAGENS = [".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif"];
const SILENCIOSOS = [".jsonl", ".ini", ".db", ".tmp", ".lnk"];

export interface TextoExtraido {
  texto: string;
  paginasLidas: number;
  paginasTotal: number;
  tipo: string;
  aviso: string;
  /** onde começa cada página no texto (PDF); ausente nos outros formatos (uma página só) */
  paginas?: number[];
}

/** Tipo mínimo do pdf.js que usamos (evita acoplar aos tipos internos da biblioteca). */
export interface PdfJs {
  getDocument(src: Record<string, unknown>): { promise: Promise<PdfDoc>; destroy(): Promise<void> };
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup(): void }>;
}

export function extensao(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i >= 0 ? nome.slice(i).toLowerCase() : "";
}

/** O que fazer com o arquivo: 'ler', 'silencio' (log, temporário) ou o motivo de não ler. */
export function classificar(nome: string): "ler" | "silencio" | string {
  const ext = extensao(nome);
  if (nome.startsWith("_") || nome.startsWith("~$") || nome.startsWith(".") || SILENCIOSOS.includes(ext)) return "silencio";
  if (EXTENSOES_TEXTO.includes(ext)) return "ler";
  if (COMPACTADOS.includes(ext)) return "arquivo compactado: descompacte para que os documentos sejam lidos";
  if (IMAGENS.includes(ext)) return "imagem: não há OCR";
  return `formato ${ext || "sem extensão"} não é lido`;
}

export function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const ENTIDADES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ordf: "ª", ordm: "º", ccedil: "ç", Ccedil: "Ç",
  atilde: "ã", otilde: "õ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", acirc: "â",
  ecirc: "ê", ocirc: "ô", agrave: "à", Atilde: "Ã", Otilde: "Õ", Aacute: "Á", Eacute: "É", Iacute: "Í",
  Oacute: "Ó", Uacute: "Ú", Acirc: "Â", Ecirc: "Ê", Ocirc: "Ô", Agrave: "À", ndash: "–", mdash: "—",
};

function decodificarEntidades(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (inteiro, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : inteiro;
    }
    return ENTIDADES[e] ?? inteiro;
  });
}

/** HTML → texto com quebra de linha entre os elementos (como o get_text('\n') do BeautifulSoup). */
export function textoHtml(bytes: Uint8Array): string {
  let html = decodificar(bytes);
  const charset = html.slice(0, 3000).match(/charset=["']?([\w-]+)/i)?.[1]?.toLowerCase();
  if (charset && !["utf-8", "utf8"].includes(charset)) {
    try {
      html = new TextDecoder(charset).decode(bytes);
    } catch {
      /* charset desconhecido: fica com a primeira decodificação */
    }
  }
  html = html.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  return decodificarEntidades(html.replace(/<[^>]+>/g, "\n"));
}

export async function textoDocx(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const arquivo = zip.file("word/document.xml");
  if (!arquivo) throw new Error("DOCX sem word/document.xml");
  const xml = await arquivo.async("string");
  return decodificarEntidades(xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, " ").replace(/<[^>]+>/g, ""));
}

export async function textoPdf(bytes: Uint8Array, pdfjs: PdfJs, opcoes: Record<string, unknown> = {}) {
  const tarefa = pdfjs.getDocument({ data: bytes, isEvalSupported: false, ...opcoes });
  const pdf = await tarefa.promise;
  const partes: string[] = [];
  let lidas = 0;
  let aviso = "";
  const inicio = Date.now();
  try {
    const total = pdf.numPages;
    const limite = Math.min(total, MAX_PAGINAS_PDF);
    for (let n = 1; n <= limite; n++) {
      const pagina = await pdf.getPage(n);
      try {
        const conteudo = await pagina.getTextContent();
        partes.push(conteudo.items.map((it) => {
          const item = it as { str?: string; hasEOL?: boolean };
          return (item.str ?? "") + (item.hasEOL ? "\n" : " ");
        }).join(""));
      } catch {
        partes.push(""); // página corrompida não derruba o documento
      }
      pagina.cleanup();
      lidas = n;
      if (n === 3 && n < total && partes.join("").trim().length < 40) break; // escaneado
      if (Date.now() - inicio > TEMPO_MAX_PDF_MS && n < limite) {
        aviso = `leitura parou na página ${n} de ${total} (PDF lento)`;
        break;
      }
    }
    if (!aviso && total > lidas && lidas === MAX_PAGINAS_PDF) aviso = `lidas as ${lidas} primeiras páginas de ${total}`;
    const paginas: number[] = [];
    let pos = 0;
    for (const p of partes) {
      paginas.push(pos);
      pos += p.length + 1;
    }
    return { texto: partes.join("\n"), paginasLidas: lidas, paginasTotal: total, aviso, paginas };
  } finally {
    await tarefa.destroy(); // no pdf.js 6 quem libera o documento é a tarefa de carregamento
  }
}

export async function extrairTexto(
  nome: string, bytes: Uint8Array, pdfjs: PdfJs, opcoesPdf: Record<string, unknown> = {},
): Promise<TextoExtraido> {
  const ext = extensao(nome);
  if (ext === ".pdf") {
    const r = await textoPdf(bytes, pdfjs, opcoesPdf);
    return { ...r, tipo: "PDF" };
  }
  if (ext === ".htm" || ext === ".html" || ext === ".xml") {
    return { texto: textoHtml(bytes), paginasLidas: 1, paginasTotal: 1, tipo: "HTML", aviso: "" };
  }
  if (ext === ".docx") {
    return { texto: await textoDocx(bytes), paginasLidas: 1, paginasTotal: 1, tipo: "DOCX", aviso: "" };
  }
  if (ext === ".txt") {
    return { texto: decodificar(bytes), paginasLidas: 1, paginasTotal: 1, tipo: "TXT", aviso: "" };
  }
  throw new Error(`formato ${ext || "sem extensão"} não é lido`);
}
