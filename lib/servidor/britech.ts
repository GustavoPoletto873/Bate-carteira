/**
 * Cliente da API da Britech (WS/api), com as credenciais do servidor.
 * - Fundo/BuscaCarteiraClientePorCPFCNPJ: carteiras (IdCliente = IdCarteira) do CNPJ;
 * - Relatorio/RelatorioComposicaoCarteira (ExcelAlinhado): a carteira na data — o mesmo relatório que o hub usa.
 */
import { BRITECH_SENHA, BRITECH_URL, BRITECH_USUARIO, britechConfigurada } from "./config";

export class ErroBritech extends Error {}

export interface CarteiraBritech {
  id: string;
  nome: string;
}

async function chamar(url: string, timeoutMs: number): Promise<Response> {
  if (!britechConfigurada()) {
    throw new ErroBritech("Credenciais da Britech não configuradas: defina BRITECH_USUARIO e BRITECH_SENHA (.env.local).");
  }
  const auth = "Basic " + Buffer.from(`${BRITECH_USUARIO}:${BRITECH_SENHA}`).toString("base64");
  let resposta: Response;
  try {
    resposta = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch (e) {
    const nome = (e as Error)?.name;
    throw new ErroBritech(nome === "TimeoutError" || nome === "AbortError"
      ? `A Britech não respondeu em ${Math.round(timeoutMs / 1000)} s.`
      : `Não consegui falar com a Britech: ${(e as Error)?.message ?? e}`);
  }
  if (resposta.status === 401 || resposta.status === 403) {
    throw new ErroBritech(`A Britech recusou as credenciais (HTTP ${resposta.status}). Confira BRITECH_USUARIO e BRITECH_SENHA.`);
  }
  if (!resposta.ok) {
    const trecho = (await resposta.text().catch(() => "")).slice(0, 200);
    throw new ErroBritech(`A Britech respondeu HTTP ${resposta.status}${trecho ? `: ${trecho}` : ""}`);
  }
  return resposta;
}

/**
 * Carteiras do CNPJ (classe e subclasses). A Britech às vezes devolve itens nulos no lugar de alguns cadastros;
 * quando isso acontece, a consulta é repetida (até 3 vezes) e os resultados são somados.
 */
export async function carteirasPorCnpj(cnpj: string): Promise<CarteiraBritech[]> {
  const url = `${BRITECH_URL}/Fundo/BuscaCarteiraClientePorCPFCNPJ?cpfCnpj=${encodeURIComponent(cnpj)}`;
  const vistos = new Map<string, CarteiraBritech>();
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const dados = await (await chamar(url, 30_000)).json().catch(() => null);
    const itens: unknown[] = Array.isArray(dados) ? dados : dados ? [dados] : [];
    let incompleto = itens.length === 0;
    for (const bruto of itens) {
      const item = bruto as { ClientesCarteira?: ({ Cliente?: { IdCliente?: unknown; Nome?: unknown } } | null)[] } | null;
      if (!item) {
        incompleto = true;
        continue;
      }
      for (const cc of item.ClientesCarteira ?? []) {
        const cliente = cc?.Cliente;
        if (cliente?.IdCliente != null && cliente?.Nome) {
          vistos.set(String(cliente.IdCliente), { id: String(cliente.IdCliente), nome: String(cliente.Nome) });
        } else {
          incompleto = true;
        }
      }
    }
    if (!incompleto) break;
  }
  return [...vistos.values()];
}

const EXCEL_ZIP = [0x50, 0x4b];
const EXCEL_OLE = [0xd0, 0xcf, 0x11, 0xe0];
const comeca = (b: Uint8Array, assinatura: number[]) => assinatura.every((v, i) => b[i] === v);

export async function composicaoCarteira(id: string, dataBase: string): Promise<Uint8Array> {
  const params = new URLSearchParams({
    IdCarteira: id, DataReferencia: dataBase, IdMoeda: "1", SeparaCustodia: "N", AgrupaValoresLiquidacao: "N",
    DemonstraGrossUp: "S", AgrupaDireitoCreditorio: "S", IdLingua: "1", TipoRelatorio: "1", DespesasSubclasse: "S",
    TipoArquivo: "ExcelAlinhado",
  });
  const resposta = await chamar(`${BRITECH_URL}/Relatorio/RelatorioComposicaoCarteira?${params}`, 120_000);
  const bytes = new Uint8Array(await resposta.arrayBuffer());
  // A Britech às vezes devolve 200 com um erro em texto/JSON no lugar do Excel.
  if (!comeca(bytes, EXCEL_ZIP) && !comeca(bytes, EXCEL_OLE)) {
    const trecho = new TextDecoder().decode(bytes.slice(0, 200)).trim();
    throw new ErroBritech(`A Britech não devolveu a carteira ${id} em ${dataBase}${trecho ? `: ${trecho}` : ""}`);
  }
  return bytes;
}
