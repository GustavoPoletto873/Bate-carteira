import { erroJson } from "@/lib/servidor/acesso";
import { ErroMonday, fundoNoMonday, mondayConfigurado, papelDoFundo } from "@/lib/servidor/monday";
import { obrigatorio, tratar } from "@/lib/servidor/rota";

/** O fundo no board de lastro do Monday (ADM, sistema, carteira) e o que o app faz com ele. */
export async function GET(req: Request) {
  return tratar(req, async (q) => {
    if (!mondayConfigurado()) return { configurado: false, fundo: null, papel: null };
    try {
      const fundo = await fundoNoMonday(obrigatorio(q, "cnpj", "o CNPJ"));
      return { configurado: true, fundo, papel: fundo ? papelDoFundo(fundo) : null };
    } catch (e) {
      if (e instanceof ErroMonday) return erroJson(e.message, 502);
      throw e;
    }
  });
}
