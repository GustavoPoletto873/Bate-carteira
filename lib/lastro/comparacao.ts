/**
 * Comparação de valores e datas: carteira (e WP_Termo) × documentos, mostrando de onde veio cada lado.
 * Os dados nem sempre vêm no campo certo ("o valor nominal da amostra é o valor de aplicação do documento"), então o
 * app aproxima em vez de só validar: cruza todo valor/data da carteira com todo valor/data dos documentos ligados ao
 * título e diz se é igual no mesmo campo, igual em outro campo, igual sem rótulo, aproximado ou calculado.
 * Funções puras.
 */
import type { Documento, Rotulado } from "./documentos";
import type { LinhaWP, Posicao } from "./planilhas";
import { fmtData, fmtValor, normalizar } from "./textos";

export type Relacao = "igual" | "campo diferente" | "sem rótulo" | "calculado" | "aproximado";
/** Campo da conferência que a comparação ajuda a decidir. */
export type CampoComparado = "valor" | "emissao" | "vencimento" | "aquisicao";

export interface Comparacao {
  tipo: "valor" | "data";
  campo: CampoComparado;
  carteira: { origem: "carteira" | "WP_Termo"; coluna: string; valor: string };
  documento: { arquivo: string; pagina: number; rotulo: string; valor: string; trecho: string };
  relacao: Relacao;
  /** ex.: "dif R$ 0,02 (0,01%)", "2 dias", ou a conta do cálculo */
  detalhe: string;
  /** para ordenar: diferença relativa (valor) ou em dias (data); 0 quando igual */
  distancia: number;
}

/** Famílias de valor: nominal (face/principal/emissão), custo (aquisição/aplicação/integralização), presente, parcela. */
export type Familia = "nominal" | "custo" | "presente" | "parcela" | "outro" | "";

export function familiaDoRotulo(rotulo: string): Familia {
  const r = normalizar(rotulo);
  if (!r) return "";
  if (/parcela|prestacao/.test(r)) return "parcela";
  if (/presente|atualizado|\batual\b|saldo|mercado/.test(r)) return "presente";
  if (/aquisicao|cessao|preco|aplicac|aplicado|integraliza|subscricao|desembolso|liquido|\bpu\b|custo/.test(r)) return "custo";
  if (/nominal|face|principal|emissao|credito|financiado|emprestimo|bruto/.test(r)) return "nominal";
  return "outro";
}

export type ConceitoData = "emissao" | "vencimento" | "aquisicao" | "desembolso" | "assinatura" | "pagamento" | "referencia" | "outro" | "";

export function conceitoDaData(rotulo: string): ConceitoData {
  const r = normalizar(rotulo);
  if (!r) return "";
  if (/vencimento|vencto|vencendo/.test(r)) return "vencimento";
  if (/emissao|emitid/.test(r)) return "emissao";
  if (/aquisicao|cessao/.test(r)) return "aquisicao";
  if (/desembolso|integraliza|liberacao|credito/.test(r)) return "desembolso";
  if (/assinatura/.test(r)) return "assinatura";
  if (/pagamento/.test(r)) return "pagamento";
  if (/referencia|posicao/.test(r)) return "referencia";
  return "outro";
}

const ORDEM: Record<Relacao, number> = { igual: 0, "campo diferente": 1, "sem rótulo": 2, calculado: 3, aproximado: 4 };
const TOLERANCIA_APROXIMADO = 0.005; // 0,5%
const DIAS_APROXIMADO = 31;
const MAX_POR_CAMPO = 5;
const MAX_DOCS = 12;

interface ValorDaCarteira { campo: CampoComparado; origem: "carteira" | "WP_Termo"; coluna: string; valor: number; familia: Familia }
interface DataDaCarteira { campo: CampoComparado; origem: "carteira" | "WP_Termo"; coluna: string; valor: string; conceito: ConceitoData }

/** Valores da posição (e da linha da WP_Termo) com o nome da coluna de onde vieram. */
export function valoresDaCarteira(pos: Posicao, w?: LinhaWP): ValorDaCarteira[] {
  const rec = pos.tipo === "recebivel";
  const col = pos.colunas ?? {};
  const lista: ValorDaCarteira[] = [];
  const nomeAplicado = col.valorAplicado || (rec ? "VALOR_AQUISICAO" : "VL Aplic.");
  lista.push({
    campo: "valor", origem: "carteira", coluna: nomeAplicado, valor: pos.valorAplicado,
    familia: rec && /nominal/i.test(nomeAplicado) ? "nominal" : "custo",
  });
  if (pos.valorNominal !== null && pos.valorNominal !== pos.valorAplicado) {
    lista.push({ campo: "valor", origem: "carteira", coluna: col.valorNominal || "VALOR_NOMINAL", valor: pos.valorNominal, familia: "nominal" });
  }
  if (pos.valorPresente !== null && !lista.some((v) => v.valor === pos.valorPresente)) {
    lista.push({ campo: "valor", origem: "carteira", coluna: col.valorPresente || "Valor presente", valor: pos.valorPresente, familia: "presente" });
  }
  if (w?.valorAquisicao != null && !lista.some((v) => v.valor === w.valorAquisicao)) {
    lista.push({ campo: "valor", origem: "WP_Termo", coluna: "BASE_VALOR_AQUISICAO", valor: w.valorAquisicao, familia: "custo" });
  }
  if (w?.valorNominal != null && !lista.some((v) => v.valor === w.valorNominal)) {
    lista.push({ campo: "valor", origem: "WP_Termo", coluna: "BASE_VALOR_NOMINAL", valor: w.valorNominal, familia: "nominal" });
  }
  return lista.filter((v) => v.valor > 0);
}

export function datasDaCarteira(pos: Posicao, w?: LinhaWP): DataDaCarteira[] {
  const col = pos.colunas ?? {};
  const lista: DataDaCarteira[] = [];
  const add = (campo: CampoComparado, origem: "carteira" | "WP_Termo", coluna: string, valor: string | null, conceito: ConceitoData) => {
    if (valor && !lista.some((d) => d.campo === campo && d.valor === valor)) lista.push({ campo, origem, coluna, valor, conceito });
  };
  add("emissao", "carteira", col.dataEmissao || "Dt. Emissão", pos.dataEmissao, "emissao");
  add("vencimento", "carteira", col.dataVencimento || "Dt. Vencimento", pos.dataVencimento, "vencimento");
  add("aquisicao", "carteira", col.dataAquisicao || "Dt. Aquisição", pos.dataAquisicao, "aquisicao");
  add("emissao", "WP_Termo", "BASE_DATA_EMISSAO", w?.dataEmissao ?? null, "emissao");
  add("vencimento", "WP_Termo", "BASE_DATA_VENCIMENTO", w?.dataVencimento ?? null, "vencimento");
  add("aquisicao", "WP_Termo", "BASE_DATA_AQUISICAO", w?.dataAquisicao ?? null, "aquisicao");
  return lista;
}

const dias = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

function doDocumento(doc: Documento, a: Rotulado<number> | Rotulado<string>, valor: string) {
  return { arquivo: doc.nome, pagina: a.pagina, rotulo: a.rotulo, valor, trecho: a.trecho };
}

/** Todas as comparações de uma posição com os documentos ligados a ela (direto / mesma operação). */
export function compararPosicao(pos: Posicao, docs: Documento[], w?: LinhaWP): Comparacao[] {
  const saida: Comparacao[] = [];
  const valores = valoresDaCarteira(pos, w);
  const datas = datasDaCarteira(pos, w);
  for (const doc of docs.slice(0, MAX_DOCS)) {
    for (const a of doc.valoresComRotulo) {
      const familia = familiaDoRotulo(a.rotulo);
      for (const cv of valores) {
        const dif = Math.abs(a.valor - cv.valor);
        const carteira = { origem: cv.origem, coluna: cv.coluna, valor: fmtValor(cv.valor) };
        if (dif <= 1) {
          const relacao: Relacao = !familia ? "sem rótulo"
            : familia === cv.familia || familia === "outro" ? "igual" : "campo diferente";
          saida.push({ tipo: "valor", campo: "valor", carteira, documento: doDocumento(doc, a, fmtValor(a.valor)), relacao, detalhe: "", distancia: 0 });
        } else if (familia === cv.familia && dif / cv.valor <= TOLERANCIA_APROXIMADO) {
          const pct = (dif / cv.valor) * 100;
          saida.push({
            tipo: "valor", campo: "valor", carteira, documento: doDocumento(doc, a, fmtValor(a.valor)), relacao: "aproximado",
            detalhe: `dif R$ ${fmtValor(dif)} (${pct.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%)`, distancia: dif / cv.valor,
          });
        }
      }
    }
    for (const a of doc.datasComRotulo) {
      const conceito = conceitoDaData(a.rotulo);
      for (const cd of datas) {
        const carteira = { origem: cd.origem, coluna: cd.coluna, valor: fmtData(cd.valor) };
        const dif = Math.abs(dias(a.valor) - dias(cd.valor));
        if (dif === 0) {
          const relacao: Relacao = !conceito ? "sem rótulo"
            : conceito === cd.conceito || conceito === "outro" ? "igual" : "campo diferente";
          saida.push({ tipo: "data", campo: cd.campo, carteira, documento: doDocumento(doc, a, fmtData(a.valor)), relacao, detalhe: "", distancia: 0 });
        } else if (conceito === cd.conceito && dif <= DIAS_APROXIMADO) {
          saida.push({
            tipo: "data", campo: cd.campo, carteira, documento: doDocumento(doc, a, fmtData(a.valor)), relacao: "aproximado",
            detalhe: `${dif} dia${dif > 1 ? "s" : ""} de diferença`, distancia: dif,
          });
        }
      }
    }
  }
  return podar(saida);
}

/** Ordena (igual primeiro, depois a menor diferença), tira repetidos e limita por campo da carteira. */
export function podar(lista: Comparacao[]): Comparacao[] {
  const vistos = new Set<string>();
  const porCampo = new Map<string, number>();
  return [...lista]
    .sort((a, b) => ORDEM[a.relacao] - ORDEM[b.relacao] || a.distancia - b.distancia)
    .filter((c) => {
      const chave = `${c.carteira.coluna}|${c.carteira.origem}|${c.documento.arquivo}|${c.documento.valor}|${c.relacao}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      const k = `${c.carteira.origem}|${c.carteira.coluna}`;
      const n = porCampo.get(k) ?? 0;
      if (n >= MAX_POR_CAMPO) return false;
      porCampo.set(k, n + 1);
      return true;
    });
}

/** Frase curta para a tela e o Excel: "VALOR_NOMINAL (carteira) 40.372,54 = 'valor de aplicação' em dup.pdf p. 1". */
export function descrever(c: Comparacao): string {
  const doc = `${c.documento.rotulo ? `"${c.documento.rotulo}"` : "sem rótulo"} ${c.documento.valor} em ${c.documento.arquivo} p. ${c.documento.pagina}`;
  const lado = `${c.carteira.coluna} (${c.carteira.origem}) ${c.carteira.valor}`;
  const sinal = c.relacao === "aproximado" ? "≈" : c.relacao === "calculado" ? "≈ calculado de" : "=";
  return `${lado} ${sinal} ${doc}${c.detalhe ? ` — ${c.detalhe}` : ""}`;
}
