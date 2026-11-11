/** Envelope comum das rotas /api: trava de acesso + erros em JSON com mensagem para a tela. */
import { ErroDeEntrada } from "../lastro/planilhas";
import { erroJson, verificarAcesso } from "./acesso";
import { ErroBritech } from "./britech";
import { ErroDrive } from "./drive-local";

export async function tratar(req: Request, fn: (q: URLSearchParams) => Promise<unknown>): Promise<Response> {
  const recusa = verificarAcesso(req);
  if (recusa) return recusa;
  try {
    const r = await fn(new URL(req.url).searchParams);
    return r instanceof Response ? r : Response.json(r);
  } catch (e) {
    if (e instanceof ErroDrive || e instanceof ErroDeEntrada) return erroJson(e.message, 400);
    if (e instanceof ErroBritech) return erroJson(e.message, 502);
    console.error("[api]", e);
    return erroJson(`Erro inesperado: ${(e as Error)?.message ?? e}`, 500);
  }
}

export function obrigatorio(q: URLSearchParams, nome: string, rotulo = nome): string {
  const v = (q.get(nome) ?? "").trim();
  if (!v) throw new ErroDrive(`Informe ${rotulo}.`);
  return v;
}
