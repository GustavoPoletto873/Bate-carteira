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

const ATENCAO: Situacao[] = ["Divergente", "Só no WP", "Verificar"];

export interface ResumoTela {
  atencao: LinhaResultado[];
  /** conferem por aproximação (outro campo, sem rótulo, diferença pequena ou cálculo da taxa) */
  provaveis: LinhaResultado[];
  ok: LinhaResultado[];
  semDocumentos: LinhaResultado[];
  /** frase de abertura, ex.: "3 de 13 títulos precisam de atenção" */
  titulo: string;
  /** contagens que entram na frase, na ordem de gravidade */
  partes: { situacao: Situacao; n: number }[];
}

export function resumirParaTela(linhas: LinhaResultado[], tipo: TipoCarteira = "titulos"): ResumoTela {
  const [um, varios] = tipo === "recebiveis" ? ["recebível precisa", "recebíveis precisam"] : ["título precisa", "títulos precisam"];
  const atencao = linhas
    .filter((l) => ATENCAO.includes(l.situacao))
    .sort((a, b) => ATENCAO.indexOf(a.situacao) - ATENCAO.indexOf(b.situacao));
  const ok = linhas.filter((l) => l.situacao === "OK");
  const provaveis = linhas.filter((l) => l.situacao === "Provável");
  const semDocumentos = linhas.filter((l) => l.situacao === "Sem documentos");
  const total = linhas.length;
  const titulo = !total
    ? "Nenhum título para conferir"
    : atencao.length
      ? `${atencao.length} de ${total} ${total === 1 ? um : varios} de atenção`
      : semDocumentos.length === total
        ? `Nenhum ${tipo === "recebiveis" ? "recebível" : "título"} foi achado nos documentos da pasta`
        : "Nada diverge";
  const partes = (["Divergente", "Só no WP", "Verificar", "Provável", "Sem documentos", "OK"] as Situacao[])
    .map((situacao) => ({ situacao, n: linhas.filter((l) => l.situacao === situacao).length }))
    .filter((p) => p.n > 0);
  return { atencao, provaveis, ok, semDocumentos, titulo, partes };
}
