/**
 * Carteira pelo Sinqia (SQCtrl) da administradora — o mesmo serviço que o boleta_sinqia usa para a Azumi:
 * token no Keycloak (grant "password", client "sqfaas") e
 * GET /api/v1/carteiras/{carteira}/relatorios/posicao/carteirac?data=aaaa-mm-dd.
 * A posição traz os títulos de renda fixa (nome, emissor, valor bruto/líquido, quantidade, vencimento) e os direitos
 * creditórios só em totais — por recebível, continue usando a amostra/estoque.
 *
 * Cada administradora: SINQIA_<ADM>_URL (API), SINQIA_<ADM>_TOKEN_URL (…/realms/sinqia/protocol/openid-connect/token),
 * SINQIA_<ADM>_USUARIO e SINQIA_<ADM>_SENHA; opcional SINQIA_<ADM>_CLIENT_ID (padrão "sqfaas").
 */
export class ErroSinqia extends Error {}

export interface InstanciaSinqia { adm: string; nome: string; url: string; tokenUrl: string; clientId: string; usuario: string; senha: string }

const NOMES: Record<string, string> = { AZUMI: "Azumi", FINVEST: "Finvest", LIMINE: "Limine" };

export function instanciasSinqia(): InstanciaSinqia[] {
  const lista: InstanciaSinqia[] = [];
  for (const chave of Object.keys(process.env).sort()) {
    const adm = chave.match(/^SINQIA_([A-Z0-9]+)_USUARIO$/)?.[1];
    if (!adm) continue;
    const env = (s: string) => (process.env[`SINQIA_${adm}_${s}`] ?? "").trim();
    const [url, tokenUrl, usuario, senha] = [env("URL").replace(/\/+$/, ""), env("TOKEN_URL"), env("USUARIO"), env("SENHA")];
    if (url && tokenUrl && usuario && senha) lista.push({ adm, nome: NOMES[adm] ?? adm, url, tokenUrl, clientId: env("CLIENT_ID") || "sqfaas", usuario, senha });
  }
  return lista;
}

function instancia(adm: string): InstanciaSinqia {
  const alvo = adm.toUpperCase();
  const i = instanciasSinqia().find((x) => x.adm === alvo);
  if (!i) throw new ErroSinqia(`Não há acesso ao Sinqia da administradora ${alvo}: defina SINQIA_${alvo}_URL, _TOKEN_URL, _USUARIO e _SENHA (.env.local).`);
  return i;
}

const tokens = new Map<string, { token: string; ate: number }>();
const pausadas = new Map<string, { ate: number; erro: string }>();
const PAUSA_MS = 15 * 60 * 1000;
export const limparSinqia = () => {
  tokens.clear();
  pausadas.clear();
};

async function token(inst: InstanciaSinqia): Promise<string> {
  const guardado = tokens.get(inst.adm);
  if (guardado && Date.now() < guardado.ate) return guardado.token;
  const pausa = pausadas.get(inst.adm);
  if (pausa && Date.now() < pausa.ate) throw new ErroSinqia(`${pausa.erro} (nova tentativa em até 15 min ou ao reiniciar o app)`);
  let r: Response;
  try {
    r = await fetch(inst.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "password", client_id: inst.clientId, username: inst.usuario, password: inst.senha }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (e) {
    throw new ErroSinqia(`Não consegui falar com o login do Sinqia da ${inst.nome}: ${(e as Error)?.message ?? e}`);
  }
  if (r.status === 400 || r.status === 401) {
    const erro = `O Sinqia da ${inst.nome} recusou o usuário e a senha (HTTP ${r.status}). Confira SINQIA_${inst.adm}_USUARIO e _SENHA`;
    pausadas.set(inst.adm, { ate: Date.now() + PAUSA_MS, erro });
    throw new ErroSinqia(erro);
  }
  if (!r.ok) throw new ErroSinqia(`O login do Sinqia da ${inst.nome} respondeu HTTP ${r.status}.`);
  const corpo = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!corpo.access_token) throw new ErroSinqia(`O login do Sinqia da ${inst.nome} não devolveu o token.`);
  tokens.set(inst.adm, { token: corpo.access_token, ate: Date.now() + Math.max(30, (corpo.expires_in ?? 300) - 30) * 1000 });
  return corpo.access_token;
}

interface Papel { nome?: string; descricao?: string; emissor?: string; valorBruto?: unknown; valorLiquido?: unknown; valor?: unknown; quantidade?: unknown; vencimento?: string; dataVencimento?: string; tipo?: string }

/** Títulos de renda fixa da posição (data[0].rendaFixa.mercados[].papeis[]). */
export function papeisDaPosicao(dados: unknown): (Papel & { mercado: string })[] {
  const d = dados as { data?: unknown[] } & Record<string, unknown>;
  const item = (Array.isArray(d?.data) ? d.data[0] : d) as { rendaFixa?: { mercados?: { nome?: string; papeis?: Papel[] }[] } } | undefined;
  return (item?.rendaFixa?.mercados ?? []).flatMap((m) => (m.papeis ?? []).map((p) => ({ ...p, mercado: m.nome ?? "" })));
}

const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** Posição → CSV no layout que o app já lê (ATIVO; EMISSOR; VALOR APLICAÇÃO; VALOR MERCADO; DATA VENCIMENTO…). */
export function csvDaPosicao(dados: unknown): string {
  const papeis = papeisDaPosicao(dados);
  const linhas = papeis.map((p) => [
    p.nome || p.descricao, p.emissor || p.nome || p.descricao, p.valorBruto ?? p.valor, p.valorLiquido ?? p.valor,
    p.vencimento || p.dataVencimento, p.quantidade, p.tipo || p.mercado,
  ].map(csv).join(";"));
  return ["ATIVO;EMISSOR;VALOR APLICACAO;VALOR MERCADO;DATA VENCIMENTO;QUANTIDADE;TIPO", ...linhas].join("\n");
}

/** Posição da carteira na data (aaaa-mm-dd), como CSV para a conferência. */
export async function carteiraSinqia(adm: string, carteira: string, data: string): Promise<{ nome: string; bytes: Uint8Array; titulos: number }> {
  const codigo = carteira.replace(/\D/g, "");
  if (!codigo) throw new ErroSinqia("Informe o código da carteira no Sinqia (coluna Carteira do Monday).");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new ErroSinqia("Informe a data-base no formato aaaa-mm-dd.");
  const inst = instancia(adm);
  const buscar = async () => fetch(`${inst.url}/api/v1/carteiras/${codigo}/relatorios/posicao/carteirac?data=${data}`, {
    headers: { Authorization: `Bearer ${await token(inst)}`, Accept: "application/json" }, signal: AbortSignal.timeout(60_000), cache: "no-store",
  });
  let r: Response;
  try {
    r = await buscar();
    if (r.status === 401) {
      tokens.delete(inst.adm); // token vencido: um novo login
      r = await buscar();
    }
  } catch (e) {
    if (e instanceof ErroSinqia) throw e;
    throw new ErroSinqia(`Não consegui falar com o Sinqia da ${inst.nome}: ${(e as Error)?.message ?? e}`);
  }
  if (r.status === 404) throw new ErroSinqia(`O Sinqia da ${inst.nome} não tem a carteira ${codigo} em ${data}.`);
  if (!r.ok) throw new ErroSinqia(`O Sinqia da ${inst.nome} respondeu HTTP ${r.status} para a carteira ${codigo}.`);
  const dados = await r.json().catch(() => null);
  if (!dados) throw new ErroSinqia(`O Sinqia da ${inst.nome} não devolveu a posição em JSON.`);
  const titulos = papeisDaPosicao(dados).length;
  return { nome: `sinqia_${codigo}_${data}.csv`, bytes: new TextEncoder().encode(csvDaPosicao(dados)), titulos };
}
