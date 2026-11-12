/**
 * Vínculo manual pendência ↔ documento, campo a campo, com as marcas do Bater PDF do bate-lastro:
 * V = confere, D = divergente, P = sem valor no documento. A marca automática é só a sugestão; a decisão de quem
 * confere sempre vence a comparação automática. Funções puras.
 */
import { conceitoDaData } from "./comparacao";
import { situacaoDe, type Campo, type ChaveCampo, type LinhaResultado } from "./conciliacao";
import { achar, type Documento } from "./documentos";
import { acharValores, fmtData, nomeEssencial, normalizar, paraData } from "./textos";

export type Marca = "V" | "D" | "P";

export interface CampoVinculado {
  /** o que está no documento (digitado ou sugerido) */
  documento: string;
  marca: Marca;
}

export interface Vinculo {
  arquivo: string;
  pagina?: number;
  campos: Partial<Record<ChaveCampo, CampoVinculado>>;
}

const CHAVES: ChaveCampo[] = ["valor", "emissao", "vencimento", "emissor"];

/** Valor da carteira mostrado na grade: no emissor, o nome; nos outros, o que a conferência usou. */
export function valorDaCarteira(l: LinhaResultado, k: ChaveCampo): string {
  return k === "emissor" ? l.emissor : l.campos[k].britech;
}

const centavosEm = (t: string) => acharValores(normalizar(t)).map((v) => v.valor);

/** Marca automática: sem valor no documento → P; iguais (valor, data ou nome) → V; senão D. */
export function marcaAutomatica(k: ChaveCampo, carteira: string, documento: string): Marca {
  if (!documento.trim()) return "P";
  if (k === "valor") {
    const doc = centavosEm(documento);
    return doc.length && centavosEm(carteira).some((v) => doc.includes(v)) ? "V" : "D";
  }
  if (k === "emissao" || k === "vencimento") {
    const a = paraData(carteira);
    return a && a === paraData(documento) ? "V" : "D";
  }
  const a = nomeEssencial(carteira);
  const b = nomeEssencial(documento);
  return a && b && (a.includes(b) || b.includes(a)) ? "V" : "D";
}

/** O que o documento traz para cada campo da pendência (a partir das comparações e dos valores/datas rotulados). */
export function sugestaoDoDocumento(l: LinhaResultado, doc: Documento): Record<ChaveCampo, string> {
  const daComparacao = (k: ChaveCampo) =>
    l.comparacoes.find((c) => c.documento.arquivo === doc.nome && (k === "valor" ? c.tipo === "valor" : c.campo === k))?.documento.valor ?? "";
  const dataRotulada = (k: "emissao" | "vencimento") => {
    const a = doc.datasComRotulo.find((d) => conceitoDaData(d.rotulo) === k);
    return a ? fmtData(a.valor) : "";
  };
  const nome = l.emissor && achar(doc, nomeEssencial(l.emissor).split(" ").slice(0, 2).join(" ")) ? l.emissor : doc.emissoresCitados[0]?.valor ?? "";
  return {
    valor: daComparacao("valor"),
    emissao: daComparacao("emissao") || dataRotulada("emissao"),
    vencimento: daComparacao("vencimento") || dataRotulada("vencimento"),
    emissor: nome,
  };
}

/** Aplica os vínculos manuais às linhas: a marca vira o status do campo e a situação é recalculada. */
export function aplicarVinculos(linhas: LinhaResultado[], vinculos: Map<number, Vinculo>): LinhaResultado[] {
  if (!vinculos.size) return linhas;
  return linhas.map((l) => {
    const v = vinculos.get(l.id);
    if (!v) return l;
    const campos = { ...l.campos };
    for (const k of CHAVES) {
      const cv = v.campos[k];
      if (!cv) continue;
      const onde = `${v.arquivo}${v.pagina ? ` p. ${v.pagina}` : ""}`;
      const base: Campo = { ...campos[k], fontes: [v.arquivo] };
      campos[k] = cv.marca === "V"
        ? { ...base, status: "Confere", documentos: cv.documento || base.documentos, nota: `conferido à mão em ${onde}` }
        : cv.marca === "D"
          ? { ...base, status: "Diverge", documentos: cv.documento, nota: `divergência marcada à mão em ${onde}` }
          : { ...base, status: "Não localizado", documentos: "", nota: `sem valor no documento ${onde} (marcado à mão)` };
    }
    return { ...l, campos, situacao: situacaoDe(campos, l.noWp), manual: v.arquivo };
  });
}
