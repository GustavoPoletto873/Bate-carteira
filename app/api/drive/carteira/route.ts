import { basePara, carteiraFormatada } from "@/lib/servidor/drive-local";
import { obrigatorio, tratar } from "@/lib/servidor/rota";

/** Carteira Britech já baixada (_Carteiras\FORMATADA\<data>\<id>_<cnpj>_<data>_BRITECH.xlsx), se existir. */
export async function GET(req: Request) {
  return tratar(req, async (q) => {
    const base = await basePara(q.get("base"));
    const cnpj = obrigatorio(q, "cnpj", "o CNPJ").replace(/\D/g, "");
    return { carteira: await carteiraFormatada(base, cnpj, q.get("data") || null) };
  });
}
