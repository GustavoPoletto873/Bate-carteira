import { erroJson } from "@/lib/servidor/acesso";
import { carteiraSinqia, ErroSinqia, sinqiaAtivo } from "@/lib/servidor/sinqia";
import { obrigatorio, tratar } from "@/lib/servidor/rota";

export const maxDuration = 90;

/** Posição da carteira no Sinqia da administradora (títulos de renda fixa), como CSV para a conferência. */
export async function GET(req: Request) {
  return tratar(req, async (q) => {
    if (!sinqiaAtivo()) return erroJson("A integração com o Sinqia está em stand-by (LASTRO_SINQIA_ATIVO=1 para usar no escritório).", 503);
    try {
      const { nome, bytes, titulos } = await carteiraSinqia(obrigatorio(q, "adm", "a administradora"), obrigatorio(q, "carteira", "a carteira"), obrigatorio(q, "data", "a data-base"));
      return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
        headers: { "content-type": "text/csv; charset=utf-8", "x-arquivo": encodeURIComponent(nome), "x-titulos": String(titulos), "cache-control": "no-store" },
      });
    } catch (e) {
      if (e instanceof ErroSinqia) return erroJson(e.message, 502);
      throw e;
    }
  });
}
