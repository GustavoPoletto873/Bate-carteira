import { responderArquivo } from "@/lib/servidor/drive-local";
import { obrigatorio, tratar } from "@/lib/servidor/rota";

/** Bytes de um arquivo do Drive (o navegador lê e confere; nada é guardado no servidor). */
export async function GET(req: Request) {
  return tratar(req, async (q) => responderArquivo(obrigatorio(q, "caminho", "o caminho do arquivo")));
}
