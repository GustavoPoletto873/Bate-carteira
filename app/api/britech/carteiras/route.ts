import { carteirasPorCnpj } from "@/lib/servidor/britech";
import { obrigatorio, tratar } from "@/lib/servidor/rota";

export const maxDuration = 60;

/** Carteiras da Britech (IdCarteira, nome e administradora) do CNPJ — em todas as Britech configuradas, ou só em `adm`. */
export async function GET(req: Request) {
  return tratar(req, async (q) => {
    const cnpj = obrigatorio(q, "cnpj", "o CNPJ").replace(/\D/g, "");
    return carteirasPorCnpj(cnpj, q.get("adm"));
  });
}
