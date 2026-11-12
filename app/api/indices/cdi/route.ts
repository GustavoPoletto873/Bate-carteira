import { ErroIndice, serieCdi } from "@/lib/servidor/indices";
import { erroJson } from "@/lib/servidor/acesso";
import { obrigatorio, tratar } from "@/lib/servidor/rota";

export const maxDuration = 60;

/** CDI diário do Banco Central entre duas datas — para calcular o valor de títulos "% do CDI + spread". */
export async function GET(req: Request) {
  return tratar(req, async (q) => {
    try {
      return { pontos: await serieCdi(obrigatorio(q, "de", "a data inicial"), obrigatorio(q, "ate", "a data final")) };
    } catch (e) {
      if (e instanceof ErroIndice) return erroJson(e.message, 502);
      throw e;
    }
  });
}
