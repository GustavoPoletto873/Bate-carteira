/**
 * Série diária do CDI no Banco Central (SGS 12, % ao dia, só dias úteis), buscada ano a ano e guardada em memória:
 * os anos fechados não mudam; o ano corrente é buscado de novo a cada 6 horas. Só datas vão para o Banco Central.
 */
import type { PontoCdi } from "../lastro/indexadores";

export class ErroIndice extends Error {}

const URL_SGS = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados";
const SEIS_HORAS = 6 * 3600_000;
const cache = new Map<number, { quando: number; pontos: PontoCdi[] }>();

async function doAno(ano: number): Promise<PontoCdi[]> {
  const corrente = ano >= new Date().getUTCFullYear();
  const guardado = cache.get(ano);
  if (guardado && (!corrente || Date.now() - guardado.quando < SEIS_HORAS)) return guardado.pontos;
  const url = `${URL_SGS}?formato=json&dataInicial=01/01/${ano}&dataFinal=31/12/${ano}`;
  let r: Response;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store", headers: { accept: "application/json" } });
  } catch (e) {
    throw new ErroIndice(`Não consegui falar com o Banco Central para buscar o CDI de ${ano}: ${(e as Error)?.message ?? e}`);
  }
  if (r.status === 404) return []; // ano ainda sem dados
  if (!r.ok) throw new ErroIndice(`O Banco Central respondeu HTTP ${r.status} ao buscar o CDI de ${ano}.`);
  const dados = (await r.json().catch(() => [])) as { data: string; valor: string }[];
  const pontos = (Array.isArray(dados) ? dados : [])
    .map((d) => ({ data: `${d.data.slice(6, 10)}-${d.data.slice(3, 5)}-${d.data.slice(0, 2)}`, taxa: Number(d.valor) }))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.data) && Number.isFinite(p.taxa));
  cache.set(ano, { quando: Date.now(), pontos });
  return pontos;
}

/** Pontos do CDI de [de, ate] (datas ISO), no máximo 15 anos. */
export async function serieCdi(de: string, ate: string): Promise<PontoCdi[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate) || de > ate) {
    throw new ErroIndice("Período inválido para o CDI: use datas aaaa-mm-dd, com o início antes do fim.");
  }
  const a0 = +de.slice(0, 4);
  const a1 = +ate.slice(0, 4);
  if (a1 - a0 > 15) throw new ErroIndice("Período do CDI longo demais (máximo 15 anos).");
  const anos = Array.from({ length: a1 - a0 + 1 }, (_, i) => a0 + i);
  const partes = await Promise.all(anos.map(doAno));
  return partes.flat().filter((p) => p.data >= de && p.data <= ate);
}
