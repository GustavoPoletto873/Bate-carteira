import { carteirasPorCnpj } from "@/lib/servidor/britech";
import { obrigatorio, tratar } from "@/lib/servidor/rota";

export const maxDuration = 60;

/** Carteiras da Britech (IdCarteira e nome) cadastradas para o CNPJ. */
export async function GET(req: Request) {
  return tratar(req, async (q) => {
    const cnpj = obrigatorio(q, "cnpj", "o CNPJ").replace(/\D/g, "");
    return { carteiras: await carteirasPorCnpj(cnpj) };
  });
}
