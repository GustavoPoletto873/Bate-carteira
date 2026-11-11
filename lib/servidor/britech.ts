/**
 * Cliente da API da Britech (WS/api) de cada administradora, com as credenciais do servidor.
 * - Fundo/BuscaCarteiraClientePorCPFCNPJ: carteiras (IdCliente = IdCarteira) do CNPJ — consultado em todas as
 *   Britech configuradas ao mesmo tempo, o que também descobre a administradora do fundo;
 * - Relatorio/RelatorioComposicaoCarteira (ExcelAlinhado): a carteira na data — o mesmo relatório que o hub usa.
 */
import { britechConfigurada, instanciasBritech, type InstanciaBritech } from "./config";

export class ErroBritech extends Error {}

export interface CarteiraBritech {
  id: string;
  nome: string;
  /** código da administradora (PLANNER, ID, INTRA…) */
  adm: string;
  admNome: string;
}

export function instancia(adm: string | null | undefined): InstanciaBritech {
  const lista = instanciasBritech();
  if (!lista.length) {
    throw new ErroBritech("Credenciais da Britech não configuradas: defina BRITECH_<ADM>_USUARIO e BRITECH_<ADM>_SENHA (.env.local).");
  }
  const alvo = (adm || "PLANNER").toUpperCase();
  const achada = lista.find((i) => i.adm === alvo);
  if (!achada) throw new ErroBritech(`Não há credenciais da Britech para a administradora ${alvo}.`);
  return achada;
}

/**
 * Britech que recusou a senha ou não existe (endereço não resolve) fica em pausa por um tempo: cada busca por CNPJ
 * consulta todas as Britech, e repetir login recusado pode bloquear o usuário — que a equipe usa no site.
 */
const PAUSA_MS = 15 * 60 * 1000;
const pausadas = new Map<string, { ate: number; erro: string }>();

function emPausa(inst: InstanciaBritech): string | null {
  const p = pausadas.get(inst.adm);
  if (!p) return null;
  if (Date.now() < p.ate) return p.erro;
  pausadas.delete(inst.adm);
  return null;
}

const pausar = (inst: InstanciaBritech, erro: string) => {
  pausadas.set(inst.adm, { ate: Date.now() + PAUSA_MS, erro });
  return new ErroBritech(erro);
};

/** Só para os testes. */
export const limparPausas = () => pausadas.clear();

async function chamar(inst: InstanciaBritech, caminho: string, timeoutMs: number): Promise<Response> {
  const pausa = emPausa(inst);
  if (pausa) throw new ErroBritech(`${pausa} (nova tentativa em até 15 min ou ao reiniciar o app)`);
  const auth = "Basic " + Buffer.from(`${inst.usuario}:${inst.senha}`).toString("base64");
  let resposta: Response;
  try {
    resposta = await fetch(`${inst.url}/${caminho}`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch (e) {
    const nome = (e as Error)?.name;
    if (nome === "TimeoutError" || nome === "AbortError") {
      throw new ErroBritech(`A Britech da ${inst.nome} não respondeu em ${Math.round(timeoutMs / 1000)} s.`);
    }
    const causa = (e as { cause?: { code?: string } })?.cause?.code;
    const host = new URL(inst.url).host;
    if (causa === "ENOTFOUND" || causa === "EAI_AGAIN") throw pausar(inst, `O endereço da Britech da ${inst.nome} (${host}) não existe ou não é acessível desta rede`);
    throw new ErroBritech(`Não consegui falar com a Britech da ${inst.nome} (${host}): ${(e as Error)?.message ?? e}`);
  }
  if (resposta.status === 401 || resposta.status === 403) {
    throw pausar(inst, `A Britech da ${inst.nome} recusou o usuário e a senha (HTTP ${resposta.status}). Confira BRITECH_${inst.adm}_USUARIO e _SENHA`);
  }
  if (!resposta.ok) {
    const trecho = (await resposta.text().catch(() => "")).slice(0, 200);
    throw new ErroBritech(`A Britech da ${inst.nome} respondeu HTTP ${resposta.status}${trecho ? `: ${trecho}` : ""}`);
  }
  return resposta;
}

/**
 * Carteiras do CNPJ (classe e subclasses) numa Britech. A Britech às vezes devolve itens nulos no lugar de alguns
 * cadastros; quando isso acontece, a consulta é repetida (até 3 vezes) e os resultados são somados.
 */
async function carteirasNaInstancia(inst: InstanciaBritech, cnpj: string): Promise<CarteiraBritech[]> {
  const caminho = `Fundo/BuscaCarteiraClientePorCPFCNPJ?cpfCnpj=${encodeURIComponent(cnpj)}`;
  const vistos = new Map<string, CarteiraBritech>();
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const dados = await (await chamar(inst, caminho, 30_000)).json().catch(() => null);
    const itens: unknown[] = Array.isArray(dados) ? dados : dados ? [dados] : [];
    let incompleto = false;
    for (const bruto of itens) {
      const item = bruto as { ClientesCarteira?: ({ Cliente?: { IdCliente?: unknown; Nome?: unknown } } | null)[] } | null;
      if (!item) {
        incompleto = true;
        continue;
      }
      for (const cc of item.ClientesCarteira ?? []) {
        const cliente = cc?.Cliente;
        if (cliente?.IdCliente != null && cliente?.Nome) {
          const id = String(cliente.IdCliente);
          vistos.set(id, { id, nome: String(cliente.Nome), adm: inst.adm, admNome: inst.nome });
        } else {
          incompleto = true;
        }
      }
    }
    if (!incompleto) break;
  }
  return [...vistos.values()];
}

/**
 * Carteiras do CNPJ. Com `adm`, só naquela Britech; sem, em todas as configuradas ao mesmo tempo.
 * `falhas` lista as Britech que deram erro (credencial recusada, fora do ar) — para a tela avisar.
 */
export async function carteirasPorCnpj(cnpj: string, adm?: string | null): Promise<{ carteiras: CarteiraBritech[]; falhas: { adm: string; erro: string }[] }> {
  if (!britechConfigurada()) {
    throw new ErroBritech("Credenciais da Britech não configuradas: defina BRITECH_<ADM>_USUARIO e BRITECH_<ADM>_SENHA (.env.local).");
  }
  const alvos = adm ? [instancia(adm)] : instanciasBritech();
  const resultados = await Promise.allSettled(alvos.map((i) => carteirasNaInstancia(i, cnpj)));
  const carteiras: CarteiraBritech[] = [];
  const falhas: { adm: string; erro: string }[] = [];
  resultados.forEach((r, k) => {
    if (r.status === "fulfilled") carteiras.push(...r.value);
    else falhas.push({ adm: alvos[k].adm, erro: (r.reason as Error)?.message ?? String(r.reason) });
  });
  if (!carteiras.length && falhas.length === alvos.length) throw new ErroBritech(falhas.map((f) => f.erro).join(" · "));
  return { carteiras, falhas };
}

const EXCEL_ZIP = [0x50, 0x4b];
const EXCEL_OLE = [0xd0, 0xcf, 0x11, 0xe0];
const comeca = (b: Uint8Array, assinatura: number[]) => assinatura.every((v, i) => b[i] === v);

export async function composicaoCarteira(adm: string | null, id: string, dataBase: string): Promise<Uint8Array> {
  const inst = instancia(adm);
  const params = new URLSearchParams({
    IdCarteira: id, DataReferencia: dataBase, IdMoeda: "1", SeparaCustodia: "N", AgrupaValoresLiquidacao: "N",
    DemonstraGrossUp: "S", AgrupaDireitoCreditorio: "S", IdLingua: "1", TipoRelatorio: "1", DespesasSubclasse: "S",
    TipoArquivo: "ExcelAlinhado",
  });
  const resposta = await chamar(inst, `Relatorio/RelatorioComposicaoCarteira?${params}`, 120_000);
  const bytes = new Uint8Array(await resposta.arrayBuffer());
  // A Britech às vezes devolve 200 com um erro em texto/JSON no lugar do Excel.
  if (!comeca(bytes, EXCEL_ZIP) && !comeca(bytes, EXCEL_OLE)) {
    const trecho = new TextDecoder().decode(bytes.slice(0, 200)).trim();
    throw new ErroBritech(`A Britech da ${inst.nome} não devolveu a carteira ${id} em ${dataBase}${trecho ? `: ${trecho}` : ""}`);
  }
  return bytes;
}
