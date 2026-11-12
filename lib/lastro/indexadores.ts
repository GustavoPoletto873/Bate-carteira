/**
 * Valor calculado pela taxa do título: principal × fator (CDI ou prefixado) entre duas datas.
 * Ex.: Nota Comercial a "100% do CDI + 3,00% a.a." — o VL Aplic. da carteira costuma ser o principal do documento
 * corrigido da emissão até a aquisição, e o valor presente, até a data-base. O CDI vem da série diária do Banco
 * Central (SGS 12, % ao dia, só dias úteis). IPCA não é calculado (precisa do VNA mensal). Funções puras.
 */
import type { Comparacao } from "./comparacao";
import { conceitoDaData, familiaDoRotulo } from "./comparacao";
import type { Documento } from "./documentos";
import type { LinhaWP, Posicao } from "./planilhas";
import { fmtData, fmtValor, normalizar } from "./textos";

/** Taxa do CDI de um dia útil, em % ao dia (ex.: 0,055131). */
export interface PontoCdi { data: string; taxa: number }

export interface Taxa {
  indexador: "CDI" | "PRE";
  /** % do CDI (100 = 100% do CDI); no prefixado, 0 */
  percentual: number;
  /** juros ao ano (CDI + spread ou prefixado a.a.) ou ao mês (prefixado a.m.), em % */
  juros: number;
  periodo: "ano" | "mes";
  /** de onde a taxa foi lida (descrição do ativo ou documento/página) */
  origem: string;
  texto: string;
}

const NUM = String.raw`(\d{1,3}(?:[.,]\d{1,8})?)`;
const PCT_CDI = new RegExp(String.raw`${NUM}\s*%\s*(?:\([^)]{0,60}\)\s*)?(?:d[aoe]s?\s+)?(?:variacao\s+(?:acumulada\s+)?(?:d[aoe]s?\s+)?)?(?:taxas?\s+)?(?:medias?\s+)?(?:diarias?\s+)?(?:d[aoe]s?\s+)?(?:cdi|di\b|depositos interfinanceiros)`, "g");
const SPREAD_DEPOIS_DI = new RegExp(String.raw`(?:cdi|\bdi\b)[^;]{0,300}?(?:\+|acrescid[ao]s?\s+(?:de\s+)?|adicionad[ao]s?\s+(?:de\s+)?|mais\s+)\s*(?:(?:uma\s+)?(?:sobretaxa|spread|taxa)\s+(?:de\s+)?)?${NUM}\s*%`, "g");
const SPREAD = new RegExp(String.raw`(?:sobretaxa|spread)\s+(?:de\s+|equivalente\s+a\s+)?${NUM}\s*%`, "g");
const PRE_AA = new RegExp(String.raw`(?:juros|taxa|remuneracao)[^;]{0,60}?${NUM}\s*%\s*(?:\([^)]{0,60}\)\s*)?(?:a\.?\s?a\.?|ao\s+ano)`, "g");
const PRE_AM = new RegExp(String.raw`(?:juros|taxa|remuneracao)[^;]{0,60}?${NUM}\s*%\s*(?:\([^)]{0,60}\)\s*)?(?:a\.?\s?m\.?|ao\s+mes)`, "g");
const num = (s: string) => Number(s.replace(",", "."));
/** O texto fala do CDI/DI ("100% do CDI", "taxas médias diárias dos DI", "DI over", "CDI + 2%")? */
const CITA_CDI = /\bcdi\b|\b(?:taxas?|d[aoe]s?)\s+(?:medias?\s+)?(?:diarias?\s+)?di\b|\bdi\s+over\b|depositos interfinanceiros|\bdi\b\s*\+/;

/** Taxas citadas num texto já normalizado (minúsculas, sem acento). */
export function taxasNoTexto(norm: string, origem: string): Taxa[] {
  const taxas: Taxa[] = [];
  const temCdi = CITA_CDI.test(norm);
  if (temCdi) {
    const pcts = [...norm.matchAll(PCT_CDI)].map((m) => num(m[1])).filter((v) => v > 0 && v <= 300);
    const spreads = [...norm.matchAll(SPREAD_DEPOIS_DI), ...norm.matchAll(SPREAD)].map((m) => num(m[1])).filter((v) => v >= 0 && v < 50);
    const pct = pcts[0] ?? 100;
    const spread = spreads[0] ?? 0;
    taxas.push({ indexador: "CDI", percentual: pct, juros: spread, periodo: "ano", origem, texto: `${fmtPct(pct)}% CDI${spread ? ` + ${fmtPct(spread)}% a.a.` : ""}` });
    return taxas;
  }
  if (/ipca|igp-?m|\binpc\b/.test(norm)) return taxas; // índice de preços: não calculado
  const aa = [...norm.matchAll(PRE_AA)].map((m) => num(m[1])).filter((v) => v > 0 && v < 100);
  const am = [...norm.matchAll(PRE_AM)].map((m) => num(m[1])).filter((v) => v > 0 && v < 20);
  if (aa[0]) taxas.push({ indexador: "PRE", percentual: 0, juros: aa[0], periodo: "ano", origem, texto: `${fmtPct(aa[0])}% a.a.` });
  if (am[0]) taxas.push({ indexador: "PRE", percentual: 0, juros: am[0], periodo: "mes", origem, texto: `${fmtPct(am[0])}% a.m.` });
  return taxas;
}

const fmtPct = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
const diasCorridos = (de: string, ate: string) =>
  (Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10)) - Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10))) / 86_400_000;

/** Série do CDI pronta para fator entre duas datas: produto acumulado por % do CDI (O(log n) por consulta). */
export class CurvaCdi {
  private readonly datas: string[];
  private readonly produtos = new Map<number, Float64Array>();

  constructor(private readonly serie: PontoCdi[]) {
    this.datas = serie.map((p) => p.data);
  }

  get vazia() {
    return this.serie.length === 0;
  }

  /** índice do primeiro dia útil >= data */
  private indice(data: string): number {
    let lo = 0;
    let hi = this.datas.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.datas[m] < data) lo = m + 1;
      else hi = m;
    }
    return lo;
  }

  private acumulado(percentual: number): Float64Array {
    let p = this.produtos.get(percentual);
    if (!p) {
      p = new Float64Array(this.serie.length + 1);
      p[0] = 1;
      this.serie.forEach((d, i) => (p![i + 1] = p![i] * (1 + (percentual / 100) * (d.taxa / 100))));
      this.produtos.set(percentual, p);
    }
    return p;
  }

  /** Dias úteis de [de, ate) — a série só tem dias úteis. null se a série não cobre o período. */
  diasUteis(de: string, ate: string): number | null {
    if (this.vazia || de >= ate || de < this.datas[0] || ate > proximoDia(this.datas[this.datas.length - 1])) return null;
    return this.indice(ate) - this.indice(de);
  }

  /** Fator de [de, ate): Π(1 + %CDI × taxa do dia) × (1 + spread)^(dias úteis/252). */
  fator(taxa: Taxa, de: string, ate: string): { fator: number; dias: number } | null {
    const du = this.diasUteis(de, ate);
    if (!du) return null;
    if (taxa.indexador === "PRE") {
      const fator = taxa.periodo === "ano" ? Math.pow(1 + taxa.juros / 100, du / 252) : Math.pow(1 + taxa.juros / 100, diasCorridos(de, ate) / 30);
      return { fator, dias: du };
    }
    const p = this.acumulado(taxa.percentual);
    const fatorDi = p[this.indice(ate)] / p[this.indice(de)];
    return { fator: fatorDi * Math.pow(1 + taxa.juros / 100, du / 252), dias: du };
  }
}

function proximoDia(iso: string): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + 5));
  return d.toISOString().slice(0, 10);
}

const TOLERANCIA_CALCULO = 0.002; // 0,2%
const MAX_PRINCIPAIS = 15;
const MAX_INICIOS = 6;

/** A taxa aparece na descrição do ativo ou nos documentos ligados ao título? */
export function taxasDaPosicao(pos: Posicao, docs: Documento[]): Taxa[] {
  // a taxa da descrição do ativo na carteira manda: se for índice de preços (IPCA…), não calcula com a taxa de outra
  // cláusula do documento (ex.: CDI citado só como taxa de mora)
  const descricao = normalizar(pos.ativo);
  if (/ipca|igp-?m|\binpc\b/.test(descricao)) return [];
  const taxas = taxasNoTexto(descricao, "descrição do ativo na carteira");
  if (taxas.length) return taxas;
  for (const d of docs.slice(0, 6)) {
    for (const t of taxasNoTexto(d.norm, d.nome)) {
      if (!taxas.some((x) => x.indexador === t.indexador && x.percentual === t.percentual && x.juros === t.juros && x.periodo === t.periodo)) taxas.push(t);
    }
  }
  return taxas.slice(0, 4);
}

/**
 * Tenta chegar a um valor da carteira pela conta: principal (do documento ou da carteira) × fator da taxa, da emissão
 * (ou desembolso) até a aquisição (→ VL Aplic.) ou até a data-base (→ valor presente). Devolve o melhor resultado
 * dentro de 0,2%, com a conta explicada.
 */
export function deducoesPorTaxa(
  pos: Posicao, docs: Documento[], w: LinhaWP | undefined, curva: CurvaCdi | null, dataBase: string | null,
): Comparacao[] {
  const taxas = taxasDaPosicao(pos, docs);
  if (!taxas.length) return [];
  if (!curva || curva.vazia) return [];

  // principais: valores do documento rotulados como nominal/custo e o nominal da carteira
  const principais: { valor: number; arquivo: string; pagina: number; rotulo: string; trecho: string }[] = [];
  const addPrincipal = (p: (typeof principais)[number]) => {
    if (p.valor > 0 && principais.length < MAX_PRINCIPAIS && !principais.some((x) => x.valor === p.valor)) principais.push(p);
  };
  for (const d of docs.slice(0, 6)) {
    for (const a of d.valoresComRotulo) {
      const f = familiaDoRotulo(a.rotulo);
      if (f === "nominal" || f === "custo") addPrincipal({ valor: a.valor, arquivo: d.nome, pagina: a.pagina, rotulo: a.rotulo, trecho: a.trecho });
    }
  }
  if (pos.valorNominal !== null) addPrincipal({ valor: pos.valorNominal, arquivo: "carteira", pagina: 0, rotulo: pos.colunas?.valorNominal || "VALOR_NOMINAL", trecho: "" });
  if (w?.valorNominal != null) addPrincipal({ valor: w.valorNominal, arquivo: "WP_Termo", pagina: 0, rotulo: "BASE_VALOR_NOMINAL", trecho: "" });

  // início: emissão da carteira e datas de emissão/desembolso dos documentos
  const inicios: { data: string; origem: string }[] = [];
  const addInicio = (data: string | null | undefined, origem: string) => {
    if (data && inicios.length < MAX_INICIOS && !inicios.some((x) => x.data === data)) inicios.push({ data, origem });
  };
  addInicio(pos.dataEmissao, `${pos.colunas?.dataEmissao || "Dt. Emissão"} da carteira`);
  for (const d of docs.slice(0, 6)) {
    for (const a of d.datasComRotulo) {
      const c = conceitoDaData(a.rotulo);
      if (c === "emissao" || c === "desembolso") addInicio(a.valor, `"${a.rotulo}" em ${d.nome} p. ${a.pagina}`);
    }
  }

  // alvos: VL Aplic. na aquisição e valor presente na data-base
  const alvos: { valor: number; ate: string; coluna: string }[] = [];
  if (pos.dataAquisicao) alvos.push({ valor: pos.valorAplicado, ate: pos.dataAquisicao, coluna: pos.colunas?.valorAplicado || "VL Aplic." });
  if (pos.valorPresente !== null && dataBase) alvos.push({ valor: pos.valorPresente, ate: dataBase, coluna: pos.colunas?.valorPresente || "Valor presente" });
  if (dataBase && !pos.dataAquisicao) alvos.push({ valor: pos.valorAplicado, ate: dataBase, coluna: pos.colunas?.valorAplicado || "VL Aplic." });

  let melhor: Comparacao | null = null;
  for (const taxa of taxas) {
    for (const ini of inicios) {
      for (const alvo of alvos) {
        const f = curva.fator(taxa, ini.data, alvo.ate);
        if (!f) continue;
        for (const p of principais) {
          if (p.valor === alvo.valor) continue;
          const calculado = Math.round(p.valor * f.fator);
          const dif = Math.abs(calculado - alvo.valor) / alvo.valor;
          // a conta precisa explicar o valor bem melhor que o principal sozinho (senão é coincidência de período curto)
          const semConta = Math.abs(p.valor - alvo.valor) / alvo.valor;
          if (dif > TOLERANCIA_CALCULO || dif * 5 > semConta || (melhor && dif >= melhor.distancia)) continue;
          melhor = {
            tipo: "valor", campo: "valor",
            carteira: { origem: "carteira", coluna: alvo.coluna, valor: fmtValor(alvo.valor) },
            documento: { arquivo: p.arquivo, pagina: p.pagina, rotulo: p.rotulo, valor: fmtValor(p.valor), trecho: p.trecho },
            relacao: "calculado",
            detalhe: `R$ ${fmtValor(p.valor)} × ${f.fator.toLocaleString("pt-BR", { maximumFractionDigits: 8 })} `
              + `(${taxa.texto}, taxa da ${taxa.origem}; ${fmtData(ini.data)} → ${fmtData(alvo.ate)}, ${f.dias} dias úteis; início: ${ini.origem}) `
              + `= R$ ${fmtValor(calculado)}; dif ${(dif * 100).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%`,
            distancia: dif,
          };
        }
      }
    }
  }
  return melhor ? [melhor] : [];
}

/** Período do CDI que a conferência vai precisar (da emissão mais antiga até a data-base), ou null se nada cita CDI. */
export function periodoDoCdi(posicoes: Posicao[], docs: Documento[], dataBase: string | null): { de: string; ate: string } | null {
  const citaCdi = posicoes.some((p) => /\bcdi\b|\bdi\b/i.test(p.ativo)) || docs.some((d) => CITA_CDI.test(d.norm));
  const citaPre = docs.some((d) => /juros|remuneracao/.test(d.norm) && /(a\.?\s?a\.?|ao ano|a\.?\s?m\.?|ao mes)/.test(d.norm));
  if (!citaCdi && !citaPre) return null;
  const ate = dataBase ?? new Date().toISOString().slice(0, 10);
  const datas = posicoes.flatMap((p) => [p.dataEmissao, p.dataAquisicao]).filter((d): d is string => !!d && d < ate).sort();
  const minimo = new Date(Date.UTC(+ate.slice(0, 4) - 10, +ate.slice(5, 7) - 1, 1)).toISOString().slice(0, 10);
  const de = datas[0] && datas[0] > minimo ? datas[0] : minimo;
  // folga para emissões dos documentos um pouco anteriores à da carteira
  const comFolga = new Date(Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1 - 6, 1)).toISOString().slice(0, 10);
  return { de: comFolga < minimo ? minimo : comFolga, ate };
}
