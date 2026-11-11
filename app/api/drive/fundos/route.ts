import { basePara, listarFundos } from "@/lib/servidor/drive-local";
import { tratar } from "@/lib/servidor/rota";

/** Workpapers (WP_<fundo>_<cnpj>.xlsm) da pasta do trimestre. */
export async function GET(req: Request) {
  return tratar(req, async (q) => {
    const base = await basePara(q.get("base"));
    return { base, fundos: await listarFundos(base) };
  });
}
