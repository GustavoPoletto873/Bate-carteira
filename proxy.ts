import { NextResponse, type NextRequest } from "next/server";
import { ipDoPedido, redeLiberada, restricaoAtiva } from "@/lib/servidor/rede";

/**
 * App publicado (Vercel) com LASTRO_IPS_PERMITIDOS: só a rede do escritório entra — página, rotas /api e arquivos.
 * Sem a lista configurada, ou rodando no seu computador, não restringe nada.
 */
export function proxy(req: NextRequest) {
  if (!restricaoAtiva() || redeLiberada(req.headers)) return NextResponse.next();
  const ip = ipDoPedido(req.headers) || "desconhecido";
  const pagina = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acesso restrito</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050505;color:#e1e0cc;font-family:system-ui,sans-serif}
main{max-width:34rem;padding:2rem}h1{font-weight:500;letter-spacing:-.03em}p{color:rgb(225 224 204/.65);line-height:1.5}code{color:#e1e0cc}</style></head>
<body><main><h1>Acesso restrito à rede do escritório</h1><p>Este app só abre a partir da internet da empresa.
Se você está no escritório e mesmo assim caiu aqui, peça para liberar o IP <code>${ip.replace(/[^0-9a-fA-F.:]/g, "")}</code>
em <code>LASTRO_IPS_PERMITIDOS</code>.</p></main></body></html>`;
  return new NextResponse(pagina, { status: 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
