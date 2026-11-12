/** pdf.js no navegador: worker, fontes e mapas de caracteres copiados para /public/pdfjs pelo postinstall. */
import type { PdfJs } from "./extratores";

export const OPCOES_PDF = {
  cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/",
  verbosity: 0,
};

let carregado: Promise<PdfJs> | null = null;

export function carregarPdfjs(): Promise<PdfJs> {
  carregado ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    return pdfjs as unknown as PdfJs;
  });
  return carregado;
}

// ------------------------------------------------------------------ visualizador (tipos mínimos do pdf.js)

export interface ItemDeTexto { str: string; transform: number[]; width: number; height: number }
export interface Viewport {
  width: number;
  height: number;
  /** matriz [a, b, c, d, e, f] que leva coordenadas do PDF para a tela */
  transform: number[];
}

/** Ponto do PDF (x, y) na tela, pela matriz do viewport (o pdf.js 6 não tem mais convertToViewportRectangle). */
function naTela(v: Viewport, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = v.transform;
  return [a * x + c * y + e, b * x + d * y + f];
}
export interface PaginaPdf {
  getViewport(o: { scale: number }): Viewport;
  render(o: { canvasContext: CanvasRenderingContext2D; canvas: HTMLCanvasElement; viewport: Viewport }): { promise: Promise<void>; cancel(): void };
  getTextContent(): Promise<{ items: unknown[] }>;
  cleanup(): void;
}
export interface DocumentoPdf { numPages: number; getPage(n: number): Promise<PaginaPdf> }

/** Abre um PDF para o visualizador; chame `fechar()` ao trocar de documento. */
export async function abrirPdf(bytes: Uint8Array): Promise<{ pdf: DocumentoPdf; fechar: () => Promise<void> }> {
  const pdfjs = await carregarPdfjs();
  const tarefa = pdfjs.getDocument({ data: bytes, isEvalSupported: false, ...OPCOES_PDF });
  const pdf = (await tarefa.promise) as unknown as DocumentoPdf;
  return { pdf, fechar: () => tarefa.destroy() };
}

const semAcento = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Onde o termo aparece na página, em fração da página (0 a 1) — como no bate-lastro, o destaque é posicionado em
 * porcentagem e continua alinhado em qualquer zoom. Marca os itens de texto que formam cada ocorrência.
 */
export function destaquesNaPagina(itens: ItemDeTexto[], termo: string, viewport: Viewport): { x: number; y: number; w: number; h: number }[] {
  // compara sem espaços: o pdf.js quebra o texto em pedaços ("1.453.004," + "29") com espaçamento variável
  const alvo = semAcento(termo).replace(/\s+/g, "");
  if (!alvo) return [];
  let texto = "";
  const dono: number[] = [];
  itens.forEach((it, i) => {
    for (const ch of semAcento(it.str ?? "")) {
      if (/\s/.test(ch)) continue;
      texto += ch;
      dono.push(i);
    }
  });
  const marcados = new Set<number>();
  for (let p = texto.indexOf(alvo); p >= 0; p = texto.indexOf(alvo, p + alvo.length)) {
    for (let k = p; k < p + alvo.length; k++) marcados.add(dono[k]);
  }
  return [...marcados].map((i) => {
    const it = itens[i];
    const [, , c, d, e, f] = it.transform;
    const altura = it.height || Math.hypot(c, d);
    const [x1, y1] = naTela(viewport, e, f);
    const [x2, y2] = naTela(viewport, e + it.width, f + altura);
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    return { x: x / viewport.width, y: y / viewport.height, w: Math.abs(x2 - x1) / viewport.width, h: Math.abs(y2 - y1) / viewport.height };
  });
}
