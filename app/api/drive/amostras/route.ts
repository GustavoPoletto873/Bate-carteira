import { amostrasEstoques, basePara } from "@/lib/servidor/drive-local";
import { tratar } from "@/lib/servidor/rota";

/** Amostra e estoque do fundo nas pastas da administradora (_Amostra, _Insumos, Estoques…), achados pelo CNPJ ou nome. */
export async function GET(req: Request) {
  return tratar(req, async (q) => {
    const base = await basePara(q.get("base"));
    const cnpj = (q.get("cnpj") ?? "").replace(/\D/g, "");
    return { arquivos: await amostrasEstoques(base, q.get("fundo") ?? "", cnpj) };
  });
}
