/**
 * Restrição por rede: só os IPs públicos listados em LASTRO_IPS_PERMITIDOS (ex.: o do escritório) acessam o app
 * publicado. Aceita IPs e faixas IPv4 (CIDR), separados por vírgula: "203.0.113.10, 198.51.100.0/24".
 * Na Vercel o IP de quem acessa vem do cabeçalho x-real-ip / x-forwarded-for, que a própria Vercel preenche
 * (não dá para o visitante falsificar).
 */

export function listaDeIps(texto = process.env.LASTRO_IPS_PERMITIDOS ?? ""): string[] {
  return texto.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}

function ipv4ParaNumero(ip: string): number | null {
  const partes = ip.split(".");
  if (partes.length !== 4) return null;
  let n = 0;
  for (const p of partes) {
    if (!/^\d{1,3}$/.test(p) || +p > 255) return null;
    n = n * 256 + +p;
  }
  return n;
}

function normalizarIp(ip: string): string {
  let s = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (s.startsWith("::ffff:") && s.includes(".")) s = s.slice(7); // IPv4 escrito como IPv6
  return s;
}

/** O IP está na lista (IP exato ou faixa IPv4 em CIDR)? */
export function ipNaLista(ip: string, lista: string[]): boolean {
  const alvo = normalizarIp(ip);
  if (!alvo) return false;
  const numero = ipv4ParaNumero(alvo);
  return lista.some((item) => {
    const [base, bits] = item.split("/");
    if (bits === undefined) return normalizarIp(base) === alvo;
    const b = ipv4ParaNumero(base.trim());
    const tamanho = Number(bits);
    if (b === null || numero === null || !Number.isInteger(tamanho) || tamanho < 0 || tamanho > 32) return false;
    const mascara = tamanho === 0 ? 0 : (0xffffffff << (32 - tamanho)) >>> 0;
    return ((b & mascara) >>> 0) === ((numero & mascara) >>> 0);
  });
}

/** IP de quem fez o pedido, como a Vercel informa. */
export function ipDoPedido(cabecalhos: Headers): string {
  return (cabecalhos.get("x-real-ip") ?? cabecalhos.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
}

/**
 * A restrição por rede vale para este pedido? Só na Vercel e com a lista configurada.
 * (No seu computador o servidor já só aceita conexões da própria máquina.)
 */
export function restricaoAtiva(): boolean {
  return !!process.env.VERCEL && listaDeIps().length > 0;
}

export function redeLiberada(cabecalhos: Headers): boolean {
  return restricaoAtiva() && ipNaLista(ipDoPedido(cabecalhos), listaDeIps());
}
