// Copia o worker, os CMaps e as fontes padrão do pdf.js para public/pdfjs (roda no postinstall).
// Assim a versão dos arquivos servidos é sempre a mesma do pacote instalado, aqui e na Vercel.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const origem = join(raiz, "node_modules", "pdfjs-dist");
const destino = join(raiz, "public", "pdfjs");

if (!existsSync(origem)) {
  console.warn("pdfjs-dist não instalado; nada a copiar.");
  process.exit(0);
}
mkdirSync(destino, { recursive: true });
cpSync(join(origem, "build", "pdf.worker.min.mjs"), join(destino, "pdf.worker.min.mjs"));
for (const pasta of ["cmaps", "standard_fonts", "wasm"]) {
  if (existsSync(join(origem, pasta))) cpSync(join(origem, pasta), join(destino, pasta), { recursive: true });
}
console.log("pdf.js copiado para public/pdfjs");
