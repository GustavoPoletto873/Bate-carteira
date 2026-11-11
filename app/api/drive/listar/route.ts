import { listarRecursivo } from "@/lib/servidor/drive-local";
import { obrigatorio, tratar } from "@/lib/servidor/rota";

/** Todos os arquivos de uma pasta do Drive (inclusive subpastas). */
export async function GET(req: Request) {
  return tratar(req, async (q) => ({ arquivos: await listarRecursivo(obrigatorio(q, "pasta", "a pasta")) }));
}
