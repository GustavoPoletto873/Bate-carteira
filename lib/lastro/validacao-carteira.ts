/**
 * Validação da carteira enviada pela administradora, como a aba "CVM" do workpaper faz:
 * 1. composição da carteira (aba carteiraInforme do fundo, somada por categoria do informe) e a soma das categorias
 *    contra o patrimônio líquido;
 * 2. carteira × estoque: DC vincendos e vencidos contra a soma do valor presente do estoque por situação, e a PDD
 *    contra a soma do VALOR_PDD;
 * 3. amostra (WP_Termo): quantidade, valor e representatividade no PL por categoria;
 * 4. resultado da verificação de lastro: V/P na WP_Termo e na WP_Lastro.
 * Funções puras.
 */
import type { Posicao, Workpaper } from "./planilhas";
import { normalizar } from "./textos";

export const PL = "Patrimônio líquido";
export const CATEGORIAS = [
  "Direitos creditórios vincendos", "Direitos creditórios vencidos", "Cotas de fundos de renda fixa",
  "Cotas de fundos de direito creditório", "Disponibilidades", "Títulos públicos", "Títulos privados",
  "Provisão para perdas com direitos creditórios", "Valores a pagar / a receber",
] as const;

export type StatusValidacao = "OK" | "VERIFICAR" | "SEM DADOS";

export interface ValidacaoCarteira {
  dataBase: string | null;
  composicao: { categoria: string; valor: number; pctPl: number | null }[];
  /** linhas com categoria fora das da CVM (não entram na soma) */
  foraDasCategorias: { mapeamento: string; valor: number }[];
  pl: number | null;
  somaCategorias: number;
  statusPl: StatusValidacao;
  estoque: { item: string; carteira: number | null; estoque: number | null; quantidade: number; diferenca: number | null; status: StatusValidacao }[];
  /** de onde veio o estoque (ou por que não houve conferência) */
  origemEstoque: string;
  /** data de referência do estoque (DATA_REFERENCIA), para comparar com a data da carteira */
  dataEstoque: string | null;
  /** estoque e carteira em datas diferentes: a diferença pode ser só da data */
  avisoEstoque: string;
  amostra: { categoria: string; quantidade: number; valor: number; pctPl: number | null }[];
  verificacao: { item: string; total: number; verificados: number; pendentes: number }[];
  status: StatusValidacao;
}

/** Diferença aceita entre carteira e estoque: R$ 1,00 (arredondamento de muitos recebíveis). */
export const TOLERANCIA_ESTOQUE = 100;

const igual = (a: string, b: string) => normalizar(a) === normalizar(b);

/** Recebível vencido: pela situação do estoque ou, sem ela, pelo vencimento antes da data-base. */
export function ehVencido(p: Posicao, dataBase: string | null): boolean {
  const s = normalizar(p.situacao ?? "");
  if (s) return /vencid/.test(s) && !/a vencer|vincend/.test(s);
  return !!(p.dataVencimento && dataBase && p.dataVencimento < dataBase);
}

/** O arquivo é um estoque completo (tem situação/PDD ou vencimentos), não só a amostra. */
export function ehEstoque(posicoes: Posicao[]): boolean {
  return posicoes.length > 0 && posicoes.every((p) => p.tipo === "recebivel")
    && posicoes.some((p) => !!p.situacao || p.valorPdd != null);
}

export function validarCarteira(wp: Workpaper, estoque: Posicao[] | null, origemEstoque = ""): ValidacaoCarteira | null {
  const linhas = wp.carteiraInforme;
  if (!linhas.length) return null;
  const dataBase = linhas.find((l) => l.dataBase)?.dataBase ?? wp.dataBase;
  const soma = (categoria: string) => linhas.filter((l) => igual(l.mapeamento, categoria)).reduce((s, l) => s + l.valor, 0);
  const temCategoria = (categoria: string) => linhas.some((l) => igual(l.mapeamento, categoria));

  const pl = temCategoria(PL) ? soma(PL) : null;
  const pct = (v: number) => (pl ? v / pl : null);
  const composicao = CATEGORIAS.map((categoria) => ({ categoria, valor: soma(categoria), pctPl: pct(soma(categoria)) }));
  const somaCategorias = composicao.reduce((s, c) => s + c.valor, 0);
  const conhecidas = [...CATEGORIAS, PL].map(normalizar);
  const fora = new Map<string, number>();
  for (const l of linhas) if (!conhecidas.includes(normalizar(l.mapeamento))) fora.set(l.mapeamento, (fora.get(l.mapeamento) ?? 0) + l.valor);
  // como a aba CVM: ROUND(PL − soma, 0) ≠ 0 → VERIFICAR
  const statusPl: StatusValidacao = pl === null ? "SEM DADOS" : Math.abs(pl - somaCategorias) < 50 ? "OK" : "VERIFICAR";

  // carteira × estoque
  const linhaEstoque = (item: string, carteira: number | null, valorEstoque: number | null, quantidade: number) => {
    const diferenca = carteira !== null && valorEstoque !== null ? carteira - valorEstoque : null;
    const status: StatusValidacao = diferenca === null ? "SEM DADOS" : Math.abs(diferenca) <= TOLERANCIA_ESTOQUE ? "OK" : "VERIFICAR";
    return { item, carteira, estoque: valorEstoque, quantidade, diferenca, status };
  };
  let estoqueLinhas: ValidacaoCarteira["estoque"] = [];
  let origem = origemEstoque;
  let dataEstoque: string | null = null;
  let avisoEstoque = "";
  if (estoque && ehEstoque(estoque)) {
    // a data mais comum do estoque (DATA_REFERENCIA)
    const contagem = new Map<string, number>();
    for (const p of estoque) if (p.dataReferencia) contagem.set(p.dataReferencia, (contagem.get(p.dataReferencia) ?? 0) + 1);
    dataEstoque = [...contagem].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (dataEstoque && dataBase && dataEstoque !== dataBase) {
      avisoEstoque = `O estoque é de ${dataEstoque.split("-").reverse().join("/")} e a carteira de ${dataBase.split("-").reverse().join("/")}: a diferença pode ser só da data. Use o estoque da data-base (ex.: pelo Fromtis).`;
    }
    const vencidos = estoque.filter((p) => ehVencido(p, dataBase));
    const vincendos = estoque.filter((p) => !ehVencido(p, dataBase));
    const presente = (ps: Posicao[]) => (ps.some((p) => p.valorPresente !== null) ? ps.reduce((s, p) => s + (p.valorPresente ?? 0), 0) : null);
    const pdd = estoque.some((p) => p.valorPdd != null) ? estoque.reduce((s, p) => s + Math.abs(p.valorPdd ?? 0), 0) : null;
    const pddCarteira = temCategoria(CATEGORIAS[7]) ? Math.abs(soma(CATEGORIAS[7])) : null;
    estoqueLinhas = [
      linhaEstoque("Direitos creditórios vincendos × valor presente a vencer", temCategoria(CATEGORIAS[0]) ? soma(CATEGORIAS[0]) : null, presente(vincendos), vincendos.length),
      linhaEstoque("Direitos creditórios vencidos × valor presente vencido", temCategoria(CATEGORIAS[1]) ? soma(CATEGORIAS[1]) : null, presente(vencidos), vencidos.length),
      linhaEstoque("Provisão para perdas × VALOR_PDD do estoque", pddCarteira, pdd, estoque.filter((p) => (p.valorPdd ?? 0) !== 0).length),
    ];
  } else {
    origem = origem || "sem o estoque completo (use o estoque como carteira ou deixe o arquivo de estoque no Drive)";
  }

  // amostra (coluna "Amostra" da WP_Termo) e resultado da verificação
  const categoriasAmostra = ["Recompra", CATEGORIAS[0], CATEGORIAS[1]];
  const amostra = categoriasAmostra.map((categoria) => {
    const ls = wp.linhas.filter((l) => igual(l.amostra, categoria));
    const valor = ls.reduce((s, l) => s + (l.valorNominal ?? l.valorAquisicao ?? 0), 0);
    return { categoria, quantidade: ls.length, valor, pctPl: pct(valor) };
  });
  const semCategoria = wp.linhas.filter((l) => !categoriasAmostra.some((c) => igual(l.amostra, c)));
  if (semCategoria.length) {
    const valor = semCategoria.reduce((s, l) => s + (l.valorNominal ?? l.valorAquisicao ?? 0), 0);
    amostra.push({ categoria: "Sem categoria na coluna Amostra", quantidade: semCategoria.length, valor, pctPl: pct(valor) });
  }
  const status = (st: string[]) => ({ verificados: st.filter((s) => s === "V").length, pendentes: st.filter((s) => s === "P").length });
  const termo = status(wp.linhas.map((l) => l.status.toUpperCase()));
  const verificacao = [
    { item: "Termos de cessão (WP_Termo)", total: wp.linhas.length, ...termo },
    ...(wp.lastro ? [{ item: "Lastros (WP_Lastro)", total: wp.linhas.length, ...wp.lastro }] : []),
  ];

  const statusGeral: StatusValidacao = statusPl === "VERIFICAR" || estoqueLinhas.some((e) => e.status === "VERIFICAR") ? "VERIFICAR"
    : statusPl === "SEM DADOS" ? "SEM DADOS" : "OK";
  return {
    dataBase, composicao, foraDasCategorias: [...fora].map(([mapeamento, valor]) => ({ mapeamento, valor })), pl, somaCategorias, statusPl,
    estoque: estoqueLinhas, origemEstoque: origem, dataEstoque, avisoEstoque, amostra, verificacao, status: statusGeral,
  };
}
