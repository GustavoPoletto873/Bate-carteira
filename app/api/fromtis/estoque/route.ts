import { erroJson } from "@/lib/servidor/acesso";
import { ErroFromtis, estoqueFromtis } from "@/lib/servidor/fromtis";
import { obrigatorio, tratar } from "@/lib/servidor/rota";

export const maxDuration = 120;

/** Estoque de direitos creditórios do fundo na data-base, pela API SOAP do Fromtis da administradora (CSV). */
export async function GET(req: Request) {
  return tratar(req, async (q) => {
    try {
      const { nome, bytes } = await estoqueFromtis(
        obrigatorio(q, "adm", "a administradora"),
        obrigatorio(q, "cnpj", "o CNPJ").replace(/\D/g, ""),
        obrigatorio(q, "data", "a data-base"),
      );
      return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
        headers: {
          "content-type": "application/octet-stream",
          "x-arquivo": encodeURIComponent(nome),
          "cache-control": "no-store",
        },
      });
    } catch (e) {
      if (e instanceof ErroFromtis) return erroJson(e.message, 502);
      throw e;
    }
  });
}
