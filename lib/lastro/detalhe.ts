/**
 * O detalhe de um título, campo a campo e direto ao ponto: o valor da carteira, onde ele aparece nos documentos
 * (arquivo, página e rótulo), os outros valores que os documentos trazem e o porquê numa frase curta.
 * As comparações completas ficam guardadas para quem quiser abrir. Função pura (testada).
 */
import type { Comparacao, Relacao } from "./comparacao";
import type { Campo, ChaveCampo, LinhaResultado, StatusCampo } from "./conciliacao";

export interface Achado {
  valor: string;
  arquivo: string;
  pagina: number;
  rotulo: string;
  relacao: Relacao | "citado";
  trecho: string;
}

export interface DetalheCampo {
  chave: ChaveCampo | "aquisicao";
  rotulo: string;
  /** null em Dt. Aquisição (só aparece pela comparação) */
  status: StatusCampo | null;
  carteira: string;
  coluna: string;
  wp: { valor: string; status: StatusCampo } | null;
  /** a melhor evidência do valor da carteira nos documentos */
  achado: Achado | null;
  /** os outros valores que os documentos trazem, com quantos documentos */
  outros: { valor: string; docs: number }[];
  /** o porquê em uma frase */
  porque: string;
  /** a nota completa da conferência (para quem quiser o texto inteiro) */
  nota: string;
  comparacoes: Comparacao[];
}

const ORDEM: Record<Relacao, number> = { igual: 0, "campo diferente": 1, "sem rótulo": 2, calculado: 3, aproximado: 4 };

/** "a | b | c" → valores únicos, sem o da carteira. */
const valoresDe = (documentos: string, carteira: string) =>
  [...new Set(documentos.split(" | ").map((v) => v.trim()).filter((v) => v && v !== carteira))];

function porqueDo(c: Campo, achado: Achado | null, outros: { valor: string }[]): string {
  switch (c.status) {
    case "Confere":
      return "confere com o documento";
    case "Provável":
      if (!achado) return "confere por aproximação";
      if (achado.relacao === "campo diferente") return `aparece no documento como "${achado.rotulo}"`;
      if (achado.relacao === "sem rótulo") return "aparece no documento, sem rótulo";
      if (achado.relacao === "calculado") return "bate pela conta da taxa";
      if (achado.relacao === "aproximado") return "valor próximo no documento";
      return "confere por aproximação";
    case "Diverge":
      return outros.length ? "o documento traz outro valor" : "não está nos documentos do título";
    case "Verificar":
      if (/n[aã]o concordam/.test(c.nota)) return "os documentos não concordam entre si";
      if (/rotulam/.test(c.nota)) return "o documento rotula outra data; a da carteira aparece sem rótulo";
      if (/mesmo emissor/.test(c.nota)) return "só há documentos do mesmo emissor";
      return achado ? "aparece no documento, mas falta confirmar" : "falta confirmar no documento";
    case "Não localizado":
      return "não achado nos documentos";
    default:
      return "";
  }
}

/** O detalhe de cada campo do título (mais a Dt. Aquisição, quando a comparação a encontrou). */
export function detalhesPorCampo(l: LinhaResultado, campos: [ChaveCampo, string][]): DetalheCampo[] {
  const lista: DetalheCampo[] = [];
  const doCampo = (k: ChaveCampo | "aquisicao") => l.comparacoes.filter((c) => (k === "valor" ? c.tipo === "valor" : c.campo === k && c.tipo === "data"));
  const melhor = (comps: Comparacao[]): Achado | null => {
    const c = [...comps].filter((x) => x.carteira.origem === "carteira").sort((a, b) => ORDEM[a.relacao] - ORDEM[b.relacao] || a.distancia - b.distancia)[0];
    return c ? { valor: c.documento.valor, arquivo: c.documento.arquivo, pagina: c.documento.pagina, rotulo: c.documento.rotulo, relacao: c.relacao, trecho: c.documento.trecho } : null;
  };
  for (const [k, rotulo] of campos) {
    const c = l.campos[k];
    const comps = doCampo(k);
    let achado = c.status === "Diverge" || c.status === "Não localizado" ? null : melhor(comps);
    if (!achado && k === "emissor") {
      const e = l.evidencias.find((x) => x.campo === "emissor" && x.confere);
      if (e && c.status !== "Diverge") achado = { valor: e.valor, arquivo: e.documento, pagina: 0, rotulo: "", relacao: "citado", trecho: e.trecho };
    }
    const outros = valoresDe(c.documentos, c.britech).map((valor) => ({
      valor, docs: new Set(l.evidencias.filter((e) => e.campo === k && e.valor === valor).map((e) => e.documento)).size || 1,
    }));
    lista.push({
      chave: k, rotulo, status: c.status, carteira: c.britech, coluna: comps.find((x) => x.carteira.origem === "carteira")?.carteira.coluna ?? "",
      wp: l.noWp && c.wpStatus !== "—" && c.wpStatus !== "Confere" ? { valor: c.wp, status: c.wpStatus } : null,
      achado, outros, porque: porqueDo(c, achado, outros), nota: c.nota, comparacoes: comps,
    });
  }
  const aquisicao = doCampo("aquisicao");
  if (aquisicao.length) {
    const achado = melhor(aquisicao);
    lista.push({
      chave: "aquisicao", rotulo: "Dt. Aquisição", status: null, carteira: aquisicao[0].carteira.valor, coluna: aquisicao[0].carteira.coluna,
      wp: null, achado, outros: [], porque: achado?.relacao === "igual" ? "confere com o documento" : achado ? "aparece no documento" : "", nota: "", comparacoes: aquisicao,
    });
  }
  return lista;
}

/** Os documentos ligados ao título, sem repetir, com o nível de ligação mais forte. */
export function documentosDoTitulo(l: LinhaResultado): { arquivo: string; nivel: string }[] {
  const ordem = ["direto", "mesma operação", "mesmo emissor"];
  const porDoc = new Map<string, string>();
  for (const e of l.evidencias) {
    const atual = porDoc.get(e.documento);
    if (!atual || ordem.indexOf(e.nivel) < ordem.indexOf(atual)) porDoc.set(e.documento, e.nivel);
  }
  return [...porDoc].map(([arquivo, nivel]) => ({ arquivo, nivel })).sort((a, b) => ordem.indexOf(a.nivel) - ordem.indexOf(b.nivel));
}
