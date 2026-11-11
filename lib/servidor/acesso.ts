/**
 * Trava das rotas /api: elas leem o Drive e usam as credenciais da Britech, então não podem ficar abertas.
 * - Na Vercel, quem vem da rede liberada (LASTRO_IPS_PERMITIDOS, ver rede.ts) passa sem chave.
 * - Com LASTRO_CHAVE_ACESSO configurada: a chave é exigida (cabeçalho x-lastro-chave) de quem não está na rede liberada.
 * - Sem a chave: só funciona no próprio computador (fora da Vercel e com Host localhost). Os scripts
 *   `npm run dev`/`npm start` sobem o servidor só em 127.0.0.1, então ninguém da rede chega nele.
 * - Na Vercel sem a chave: rotas fechadas.
 */
import { timingSafeEqual } from "node:crypto";
import { CHAVE_ACESSO } from "./config";
import { redeLiberada } from "./rede";

const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function hostDoPedido(req: Request): string {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  return host.replace(/:\d+$/, "").toLowerCase();
}

/** Uso local sem chave: fora da Vercel, sem chave configurada e chamado por localhost. */
export function ehLocal(req: Request): boolean {
  return !process.env.VERCEL && !CHAVE_ACESSO && HOSTS_LOCAIS.has(hostDoPedido(req));
}

/** null = pode seguir; Response = recusa pronta para devolver. */
export function verificarAcesso(req: Request): Response | null {
  if (ehLocal(req)) return null;
  if (redeLiberada(req.headers)) return null; // rede do escritório (LASTRO_IPS_PERMITIDOS): sem chave
  if (!CHAVE_ACESSO) {
    return Response.json(
      { erro: "Acesso fechado: configure LASTRO_CHAVE_ACESSO no servidor para usar o Drive e a Britech fora do seu computador." },
      { status: 403 },
    );
  }
  const enviada = req.headers.get("x-lastro-chave") ?? "";
  if (!iguais(enviada, CHAVE_ACESSO)) {
    return Response.json({ erro: "Chave de acesso inválida. Informe a chave do app em “Pasta do trimestre no Drive e chave de acesso”." }, { status: 401 });
  }
  return null;
}

export function erroJson(mensagem: string, status = 400): Response {
  return Response.json({ erro: mensagem }, { status });
}
