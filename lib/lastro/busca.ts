/**
 * Busca "tipo grep" nos documentos já lidos (como o Bater PDF do bate-lastro): sem acento e sem maiúsculas, um
 * resultado por documento com as páginas e os trechos. Valor (1.234,56) e data (10/03/2026) são comparados pelo
 * valor, então "1234,56" acha "1.234,56". Funções puras.
 */
import { paginaDe, trecho, type Documento } from "./documentos";
import { fmtData, fmtValor, normalizar, paraCentavos, paraData } from "./textos";

export const MIN_CARACTERES_BUSCA = 3;
const MAX_OCORRENCIAS = 30;

export interface OcorrenciaBusca {
  ini: number;
  fim: number;
  pagina: number;
  /** trecho do texto original em volta da ocorrência */
  trecho: string;
  /** o texto encontrado, como está no documento (para destacar no trecho) */
  alvo: string;
}

export interface ResultadoBusca {
  doc: Documento;
  total: number;
  paginas: number[];
  ocorrencias: OcorrenciaBusca[];
}

export interface Busca {
  /** termo normalizado que o visualizador destaca na página */
  destacar: string;
  tipo: "texto" | "valor" | "data";
  resultados: ResultadoBusca[];
  motivo?: "termo_curto";
}

export function buscarNosDocumentos(docs: Documento[], termo: string): Busca {
  const t = normalizar(termo);
  if (t.length < MIN_CARACTERES_BUSCA) return { destacar: t, tipo: "texto", resultados: [], motivo: "termo_curto" };
  const ehValor = /^r?\$?\s*(\d{1,3}(\.\d{3})+|\d+)(,\d{2})$/.test(t) || /^\d+\.\d{2}$/.test(t);
  const centavos = ehValor ? paraCentavos(t.replace(/^r?\$?\s*/, "")) : null;
  const data = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(t) ? paraData(t) : null;
  const tipo = centavos !== null ? "valor" : data ? "data" : "texto";
  const destacar = centavos !== null ? fmtValor(centavos) : data ? fmtData(data) : t;

  const resultados: ResultadoBusca[] = [];
  for (const doc of docs) {
    if (!doc.norm) continue;
    let achados: { ini: number; fim: number }[];
    if (centavos !== null) achados = doc.valores.filter((v) => v.valor === centavos);
    else if (data) achados = doc.datas.filter((d) => d.valor === data);
    else {
      achados = [];
      for (let i = doc.norm.indexOf(t); i >= 0 && achados.length < 500; i = doc.norm.indexOf(t, i + t.length)) {
        achados.push({ ini: i, fim: i + t.length });
      }
    }
    if (!achados.length) continue;
    const ocorrencias = achados.slice(0, MAX_OCORRENCIAS).map((a) => ({
      ini: a.ini, fim: a.fim, pagina: paginaDe(doc, a.ini), trecho: trecho(doc, a.ini, a.fim),
      alvo: doc.texto.slice(doc.mapa[a.ini], doc.mapa[Math.min(a.fim, doc.mapa.length - 1)]),
    }));
    resultados.push({ doc, total: achados.length, paginas: [...new Set(ocorrencias.map((o) => o.pagina))], ocorrencias });
  }
  resultados.sort((a, b) => b.total - a.total || a.doc.nome.localeCompare(b.doc.nome, "pt-BR"));
  return { destacar, tipo, resultados };
}
