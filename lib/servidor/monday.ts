/**
 * Fundo no board de lastro do Monday, pelo CNPJ: administradora (ADM), sistema (BRITECH, SINQIA, MAPS, AMPLIS…) e o
 * código da carteira nesse sistema. É o mapa que diz ao app de onde buscar a carteira de cada fundo.
 *
 * MONDAY_API_TOKEN (segredo) e, se o board mudar, LASTRO_MONDAY_BOARD. As colunas são as do board "Lastro"
 * (CNPJ, ADM, Sistema, Carteira); dá para trocar por LASTRO_MONDAY_COLUNAS="cnpj,adm,sistema,carteira".
 */
export class ErroMonday extends Error {}

export interface FundoMonday {
  nome: string;
  adm: string;
  sistema: string;
  carteira: string;
  grupo: string;
}

const BOARD_PADRAO = "18400837320";
const COLUNAS_PADRAO = ["text_mkxtans5", "color_mky2r9sq", "text_mky23n4a", "text_mkxt6exv"];

export const mondayConfigurado = () => !!process.env.MONDAY_API_TOKEN;

function colunas(): { cnpj: string; adm: string; sistema: string; carteira: string } {
  const lista = (process.env.LASTRO_MONDAY_COLUNAS ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  const [cnpj, adm, sistema, carteira] = lista.length === 4 ? lista : COLUNAS_PADRAO;
  return { cnpj, adm, sistema, carteira };
}

const fmtCnpj = (c: string) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;

interface ItemMonday {
  name: string;
  updated_at: string;
  group: { title: string } | null;
  column_values: { id: string; text: string | null }[];
}

/** O item mais recente do fundo no board (o CNPJ aparece em vários trimestres). null se não estiver no board. */
export async function fundoNoMonday(cnpj: string): Promise<FundoMonday | null> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new ErroMonday("Defina MONDAY_API_TOKEN (.env.local) para o app ler o board do Monday.");
  const digitos = cnpj.replace(/\D/g, "");
  if (digitos.length !== 14) throw new ErroMonday("Informe o CNPJ do fundo com 14 dígitos.");
  const c = colunas();
  const query = `query ($board: ID!, $valores: [String]!) {
    items_page_by_column_values(board_id: $board, limit: 50, columns: [{ column_id: "${c.cnpj}", column_values: $valores }]) {
      items { name updated_at group { title } column_values(ids: ["${c.adm}", "${c.sistema}", "${c.carteira}"]) { id text } }
    }
  }`;
  let r: Response;
  try {
    r = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
      body: JSON.stringify({ query, variables: { board: process.env.LASTRO_MONDAY_BOARD || BOARD_PADRAO, valores: [fmtCnpj(digitos), digitos] } }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (e) {
    throw new ErroMonday(`Não consegui falar com o Monday: ${(e as Error)?.message ?? e}`);
  }
  if (r.status === 401 || r.status === 403) throw new ErroMonday("O Monday recusou o token (MONDAY_API_TOKEN).");
  const corpo = (await r.json().catch(() => null)) as { data?: { items_page_by_column_values?: { items: ItemMonday[] } }; errors?: { message: string }[] } | null;
  if (!r.ok || corpo?.errors?.length) {
    throw new ErroMonday(`O Monday respondeu com erro: ${corpo?.errors?.map((e) => e.message).join("; ") || `HTTP ${r.status}`}`);
  }
  const itens = corpo?.data?.items_page_by_column_values?.items ?? [];
  if (!itens.length) return null;
  // o item com ADM e sistema preenchidos (há cópias "(copy)" vazias no board); depois, o mais recente
  const texto = (item: ItemMonday, id: string) => item.column_values.find((v) => v.id === id)?.text?.trim() ?? "";
  const pontos = (item: ItemMonday) => (texto(item, c.adm) ? 2 : 0) + (texto(item, c.sistema) ? 1 : 0) - (/\(copy\)/i.test(item.name) ? 4 : 0);
  const maisRecente = [...itens].sort((a, b) => pontos(b) - pontos(a) || b.updated_at.localeCompare(a.updated_at))[0];
  const valor = (id: string) => texto(maisRecente, id);
  return {
    nome: maisRecente.name, adm: valor(c.adm), sistema: valor(c.sistema).toUpperCase(),
    carteira: valor(c.carteira).replace(/\D/g, ""), grupo: maisRecente.group?.title ?? "",
  };
}

/** O que o app faz com cada administradora/sistema do Monday. */
export function papelDoFundo(f: FundoMonday): { fonte: "britech" | "sinqia" | "arquivo" | "fora"; aviso: string } {
  const adm = f.adm.toUpperCase();
  const sistema = f.sistema;
  if (["QI TECH", "BLUEWAVE", "BLUE WAVE"].includes(adm)) return { fonte: "fora", aviso: `${f.adm}: só validação de estoque — fora do escopo deste app.` };
  if (["INTRA", "LIMINE", "FINVEST"].includes(adm)) {
    return { fonte: "arquivo", aviso: `A ${f.adm} envia a carteira: a validação usa a aba carteiraInforme do workpaper e o estoque do Drive.` };
  }
  if (/MAPS/.test(sistema)) return { fonte: "arquivo", aviso: "Fundo no MAPS: a API só responde pela VPN (máquina do Lucas). Use o arquivo da carteira." };
  if (/AMPLIS/.test(sistema)) return { fonte: "arquivo", aviso: "Fundo no AMPLIS: sem integração. Use o arquivo da carteira." };
  if (/SINQIA/.test(sistema)) return { fonte: "sinqia", aviso: "" };
  return { fonte: "britech", aviso: "" };
}
