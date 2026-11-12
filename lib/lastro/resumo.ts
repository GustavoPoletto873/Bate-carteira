/**
 * Resumo do resultado para a tela: o que precisa de atenção, explicado em uma linha por problema.
 * Função pura (testada); a tabela completa e o Excel continuam com todos os detalhes.
 */
import { camposDe, type ChaveCampo, type LinhaResultado, type Situacao, type TipoCarteira } from "./conciliacao";

export interface Pendencia {
  campo: string;
  texto: string;
  /** diverge (vermelho) ou só pede conferência (amarelo) */
  grave: boolean;
}

export function pendenciasDaLinha(l: LinhaResultado, campos: [ChaveCampo, string][] = camposDe("titulos")): Pendencia[] {
  if (l.situacao === "Só no WP") {
    const vl = l.campos.valor.wp;
    return [{
      campo: "Carteira",
      texto: `está na WP_Termo (linha ${l.wpLinha ?? "?"}${vl ? `, VL ${vl}` : ""}) mas não na ${campos[3][1] === "Sacado" ? "carteira" : "carteira Britech"}`,
      grave: true,
    }];
  }
  if (l.situacao === "OK" || l.situacao === "Sem documentos") return [];

  const lista: Pendencia[] = [];
  for (const [k, rotulo] of campos) {
    const c = l.campos[k];
    if (c.status === "Diverge") {
      const docs = c.documentos ? ` × documentos ${c.documentos}` : "";
      lista.push({ campo: rotulo, texto: `Britech ${c.britech || "—"}${docs}${c.nota ? ` (${c.nota})` : ""}`, grave: true });
    } else if (c.status === "Verificar" || c.status === "Não localizado") {
      lista.push({ campo: rotulo, texto: c.nota || "não encontrado nos documentos", grave: false });
    } else if (c.status === "Provável") {
      lista.push({ campo: rotulo, texto: c.nota || "deduzido pela comparação com o documento", grave: false });
    }
    if (l.noWp && c.wpStatus === "Diverge") {
      lista.push({ campo: rotulo, texto: `Britech ${c.britech || "—"} × WP_Termo ${c.wp || "em branco"}`, grave: true });
    } else if (l.noWp && (c.wpStatus === "Verificar" || c.wpStatus === "Não localizado")) {
      lista.push({ campo: rotulo, texto: `WP_Termo ${c.wp || "em branco"}; confira com a Britech (${c.britech || "—"})`, grave: false });
    }
  }
  // o mais grave primeiro, mantendo a ordem dos campos
  return lista.sort((a, b) => Number(b.grave) - Number(a.grave));
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
