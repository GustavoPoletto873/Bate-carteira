/**
 * Resumo do resultado para a tela: o que precisa de atenção, uma linha curta por campo (carteira × documentos).
 * Função pura (testada); a tabela completa e o Excel continuam com todos os detalhes.
 */
import { camposDe, type ChaveCampo, type LinhaResultado, type Situacao, type TipoCarteira } from "./conciliacao";

/** Um ponto de atenção do título, direto: o campo, o que está na carteira e o que o outro lado traz. */
export interface Ponto {
  campo: string;
  /** o valor da carteira */
  carteira: string;
  /** o que os documentos (ou a WP_Termo) trazem de diferente; "" quando não há outro valor para mostrar */
  outro: string;
  lado: "documentos" | "WP_Termo";
  /** diverge (vermelho), conferir (amarelo) ou aproximado (azul: a comparação deduziu) */
  tipo: "diverge" | "conferir" | "aproximado";
  /** o que mostrar quando não há outro valor: "não achado", "confirmar no documento"… */
  semValor: string;
  /** a explicação completa (arquivo, página, o porquê) — fica no detalhe, fora do resumo */
  nota: string;
}

/** Os valores dos documentos diferentes do da carteira, no máximo dois ("a | b +3"). */
function outrosValores(documentos: string, carteira: string): string {
  const outros = [...new Set(documentos.split(" | ").map((v) => v.trim()).filter((v) => v && v !== carteira))];
  return outros.slice(0, 2).join(" | ") + (outros.length > 2 ? ` +${outros.length - 2}` : "");
}

/** O resumo do título: uma linha curta por campo com problema (carteira × documentos), o mais grave primeiro. */
export function pontosDaLinha(l: LinhaResultado, campos: [ChaveCampo, string][] = camposDe("titulos")): Ponto[] {
  if (l.situacao === "Só no WP") {
    const vl = l.campos.valor.wp;
    return [{
      campo: "Carteira", carteira: "não está na carteira", outro: `linha ${l.wpLinha ?? "?"}${vl ? ` · VL ${vl}` : ""}`,
      lado: "WP_Termo", tipo: "diverge", semValor: "", nota: "",
    }];
  }
  if (l.situacao === "OK" || l.situacao === "Sem documentos") return [];

  const lista: Ponto[] = [];
  for (const [k, campo] of campos) {
    const c = l.campos[k];
    const base = { campo, carteira: c.britech, lado: "documentos" as const, nota: c.nota };
    if (c.status === "Diverge") {
      lista.push({ ...base, outro: outrosValores(c.documentos, c.britech), tipo: "diverge", semValor: "não está nos documentos" });
    } else if (c.status === "Não localizado") {
      lista.push({ ...base, outro: "", tipo: "conferir", semValor: "não achado" });
    } else if (c.status === "Verificar") {
      lista.push({ ...base, outro: outrosValores(c.documentos, c.britech), tipo: "conferir", semValor: c.documentos ? "confirmar no documento" : "não achado" });
    } else if (c.status === "Provável") {
      lista.push({ ...base, outro: outrosValores(c.documentos, c.britech), tipo: "aproximado", semValor: "confere por aproximação" });
    }
    if (l.noWp && (c.wpStatus === "Diverge" || c.wpStatus === "Verificar" || c.wpStatus === "Não localizado")) {
      lista.push({
        campo, carteira: c.britech, outro: c.wp, lado: "WP_Termo", tipo: c.wpStatus === "Diverge" ? "diverge" : "conferir",
        semValor: "em branco", nota: "",
      });
    }
  }
  const ordem = { diverge: 0, conferir: 1, aproximado: 2 };
  return lista.sort((a, b) => ordem[a.tipo] - ordem[b.tipo]);
}

const ATENCAO: Situacao[] = ["Divergente", "Só no WP", "Verificar", "Provável"];
const BATE = new Set(["Confere", "Provável"]);

/**
 * Validado visualmente: o valor e a data de emissão batem com os documentos (os outros campos podem pedir conferência).
 * Fica nos validados, mas precisa da aprovação do analista.
 */
export function aguardaAprovacao(l: LinhaResultado): boolean {
  return !l.aprovado && ATENCAO.includes(l.situacao) && l.situacao !== "Só no WP"
    && BATE.has(l.campos.valor.status) && BATE.has(l.campos.emissao.status);
}

/** O analista aprovou: o título passa a conferir (na tela e no Excel), marcado como aprovado. */
export function aplicarAprovacoes(linhas: LinhaResultado[], aprovados: Set<number>): LinhaResultado[] {
  if (!aprovados.size) return linhas;
  return linhas.map((l) => (aprovados.has(l.id) ? { ...l, situacao: "OK" as Situacao, aprovado: true } : l));
}

/** Os três blocos do resumo: o que precisa de atenção, o que está validado e o que ficou sem documento. */
export interface ResumoTela {
  /** divergem ou faltam confirmar (divergentes primeiro) */
  atencao: LinhaResultado[];
  /** valor e emissão batem: validados visualmente, aguardando a aprovação do analista */
  aprovar: LinhaResultado[];
  /** 100% validados (conferem em tudo, ou aprovados pelo analista) */
  validados: LinhaResultado[];
  /** 100% pendentes: nenhum documento da pasta cita o título */
  pendentes: LinhaResultado[];
  /** frase de abertura, ex.: "3 de 13 títulos precisam de atenção" */
  titulo: string;
}

export function resumirParaTela(linhas: LinhaResultado[], tipo: TipoCarteira = "titulos"): ResumoTela {
  const [um, varios] = tipo === "recebiveis" ? ["recebível precisa", "recebíveis precisam"] : ["título precisa", "títulos precisam"];
  const aprovar = linhas.filter(aguardaAprovacao);
  const atencao = linhas
    .filter((l) => ATENCAO.includes(l.situacao) && !aguardaAprovacao(l))
    .sort((a, b) => ATENCAO.indexOf(a.situacao) - ATENCAO.indexOf(b.situacao));
  const validados = linhas.filter((l) => l.situacao === "OK");
  const pendentes = linhas.filter((l) => l.situacao === "Sem documentos");
  const total = linhas.length;
  const nome = tipo === "recebiveis" ? "recebível" : "título";
  const titulo = !total
    ? "Nenhum título para conferir"
    : atencao.length
      ? `${atencao.length} de ${total} ${total === 1 ? um : varios} de atenção`
      : aprovar.length
        ? `${aprovar.length} ${aprovar.length === 1 ? `${nome} aguarda` : `${tipo === "recebiveis" ? "recebíveis" : "títulos"} aguardam`} sua aprovação`
        : pendentes.length === total
          ? `Nenhum ${nome} foi achado nos documentos da pasta`
          : "Nada diverge";
  return { atencao, aprovar, validados, pendentes, titulo };
}
