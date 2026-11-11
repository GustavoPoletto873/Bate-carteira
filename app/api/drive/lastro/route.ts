import { basePara, pastasDeLastro } from "@/lib/servidor/drive-local";
import { tratar } from "@/lib/servidor/rota";

/** Pastas de "Lastro e Termo", da mais parecida com o fundo para a menos parecida. */
export async function GET(req: Request) {
  return tratar(req, async (q) => {
    const base = await basePara(q.get("base"));
    return pastasDeLastro(base, q.get("fundo") ?? "", (q.get("cnpj") ?? "").replace(/\D/g, ""));
  });
}
