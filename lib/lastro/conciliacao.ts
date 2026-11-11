/**
 * Conferência campo a campo: carteira Britech × WP_Termo × documentos de lastro e termo.
 *
 * Para cada título, os documentos são ligados à posição em três níveis:
 * - direto: o documento traz o VL Aplic. da posição (até a tolerância);
 * - mesma operação: mesmo número de operação no nome do arquivo de um documento direto, o código do ativo
 *   (ex.: código CETIP) ou o nome do emissor + o mesmo número de emissão;
 * - mesmo emissor: só o nome do emissor (usado quando os níveis acima não trazem a informação).
 */
import { achar, contem, temTexto, trecho, type Achado, type Documento } from "./documentos";
import type { LinhaWP, Posicao } from "./planilhas";
import { codigoBritech, fmtData, fmtValor, nomeEssencial, numeroEmissaoBritech, palavras, soDigitos } from "./textos";

export const TOLERANCIA_CENTAVOS = 1;

export type StatusCampo = "Confere" | "Diverge" | "Verificar" | "Não localizado" | "—";
export type Situacao = "OK" | "Divergente" | "Verificar" | "Sem documentos" | "Só no WP";
export type Nivel = "direto" | "mesma operação" | "mesmo emissor";
export type ChaveCampo = "valor" | "emissao" | "vencimento" | "emissor";

export const CAMPOS: [ChaveCampo, string][] = [
  ["valor", "VL Aplic."], ["emissao", "Dt. Emissão"], ["vencimento", "Dt. Vencimento"], ["emissor", "Emissor"],
];

/** Carteira Britech (títulos) ou estoque/amostra de direitos creditórios (recebíveis). */
export type TipoCarteira = "titulos" | "recebiveis";

/** Rótulos dos campos conforme o tipo de carteira (no recebível, o "emissor" conferido é o sacado). */
export function camposDe(tipo: TipoCarteira): [ChaveCampo, string][] {
  if (tipo === "titulos") return CAMPOS;
  return [["valor", "Valor"], ["emissao", "Dt. Emissão"], ["vencimento", "Dt. Vencimento"], ["emissor", "Sacado"]];
}

export interface Campo {
  status: StatusCampo;
  britech: string;
  documentos: string;
  fontes: string[];
  nota: string;
  wp: string;
  wpStatus: StatusCampo;
}

export interface Evidencia {
  campo: ChaveCampo;
  valor: string;
  confere: boolean;
  documento: string;
  trecho: string;
  nivel: Nivel;
}

export interface LinhaResultado {
  id: number;
  ativo: string;
  emissor: string;
  /** cedente do recebível ("" no título) */
  cedente: string;
  codigo: string;
  valorAplicado: string;
  dataAquisicao: string;
  noWp: boolean;
  wpLinha: number | null;
  situacao: Situacao;
  campos: Record<ChaveCampo, Campo>;
  docsDiretos: number;
  docsMesmaOperacao: number;
  evidencias: Evidencia[];
}

export interface ItemInventario {
  nome: string;
  caminho: string;
  tipo: string;
  paginas: string;
  vinculos: string[];
  citaCnpjFundo: boolean;
  observacao: string;
}

export interface ResultadoConferencia {
  tipo: TipoCarteira;
  linhas: LinhaResultado[];
  documentos: ItemInventario[];
  contagem: Partial<Record<Situacao, number>>;
}

function campo(parcial: Partial<Campo> = {}): Campo {
  return { status: "Não localizado", britech: "", documentos: "", fontes: [], nota: "", wp: "", wpStatus: "—", ...parcial };
}

export function unicos<T>(itens: T[]): T[] {
  return [...new Set(itens.filter((i) => i !== "" && i !== null && i !== undefined))];
}

// ------------------------------------------------------------------ vínculos documento × posição

interface Vinculos {
  direto: Documento[];
  "mesma operação": Documento[];
  "mesmo emissor": Documento[];
  chaveEmissor: string;
}

function emissorNoDoc(doc: Documento, chave: string): Achado<string> | null {
  if (!chave) return null;
  let achado = achar(doc, chave);
  const tokens = chave.split(" ");
  if (!achado && tokens.length >= 3) achado = achar(doc, tokens.slice(0, 2).join(" "));
  return achado;
}

/** Valores procurados nos documentos: o VL Aplic. e, no recebível, também o valor de face (o que a duplicata/CCB traz). */
function valoresAlvo(pos: Posicao): number[] {
  return pos.valorNominal !== null && pos.valorNominal !== pos.valorAplicado ? [pos.valorAplicado, pos.valorNominal] : [pos.valorAplicado];
}

/**
 * Nome do emissor/sacado para procurar no texto. Os estoques cortam o nome em 25 caracteres
 * ("CONSTRUTORA EXEMPLO E ACA"): a última palavra, provavelmente cortada, sai da busca.
 */
function chaveDoNome(pos: Posicao): string {
  const chave = nomeEssencial(pos.emissor);
  const tokens = chave.split(" ");
  return pos.tipo === "recebivel" && pos.emissor.trim().length >= 25 && tokens.length > 1 ? tokens.slice(0, -1).join(" ") : chave;
}

/** Número do documento do recebível em palavras ("50001-001" → "50001 001"); vazio se for curto demais para ser único. */
function numeroDoRecebivel(pos: Posicao): string {
  if (pos.tipo !== "recebivel") return "";
  const p = palavras(pos.codigo).trim();
  return soDigitos(p).length >= 4 ? p : "";
}

export function vincular(pos: Posicao, docs: Documento[], tolerancia = TOLERANCIA_CENTAVOS): Vinculos {
  const chaveEmissor = chaveDoNome(pos);
  const titulo = pos.tipo !== "recebivel";
  const codigo = titulo ? codigoBritech(pos.ativo) : "";
  const numEmissao = titulo ? numeroEmissaoBritech(pos.ativo) : null;
  const numeroDoc = numeroDoRecebivel(pos);
  const alvos = valoresAlvo(pos);
  const direto = docs.filter((d) => d.valores.some((a) => alvos.some((v) => Math.abs(a.valor - v) <= tolerancia)));
  const grupos = new Set(direto.map((d) => d.grupo).filter(Boolean));
  const mesmaOp: Documento[] = [];
  const mesmoEmissor: Documento[] = [];
  for (const d of docs) {
    if (direto.includes(d) || !temTexto(d)) continue;
    const citaEmissor = emissorNoDoc(d, chaveEmissor) !== null;
    if ((d.grupo && grupos.has(d.grupo)) || (codigo && contem(d, codigo)) || (numeroDoc && contem(d, numeroDoc))
      || (citaEmissor && numEmissao !== null && d.numerosEmissao.has(numEmissao))) {
      mesmaOp.push(d);
    } else if (citaEmissor) {
      mesmoEmissor.push(d);
    }
  }
  return { direto, "mesma operação": mesmaOp, "mesmo emissor": mesmoEmissor, chaveEmissor };
}

function nivelDe(doc: Documento, v: Vinculos): Nivel {
  if (v.direto.includes(doc)) return "direto";
  if (v["mesma operação"].includes(doc)) return "mesma operação";
  return "mesmo emissor";
}

// ------------------------------------------------------------------ avaliação de cada campo

function avaliarValor(pos: Posicao, v: Vinculos, evid: Evidencia[], tolerancia: number): Campo {
  const alvos = valoresAlvo(pos);
  const face = alvos.length > 1 ? pos.valorNominal : null;
  // no recebível o documento traz o valor de face: é ele a referência para "valor parecido"
  const alvo = face ?? pos.valorAplicado;
  const c = campo({ britech: face !== null ? `${fmtValor(pos.valorAplicado)} (face ${fmtValor(face)})` : fmtValor(pos.valorAplicado) });
  if (v.direto.length) {
    const achados: string[] = [];
    let maior = 0;
    let soFace = true;
    for (const d of v.direto) {
      let a: Achado<number> | undefined;
      let ref = 0;
      for (const x of d.valores) {
        ref = alvos.find((t) => Math.abs(x.valor - t) <= tolerancia) ?? -1;
        if (ref >= 0) {
          a = x;
          break;
        }
      }
      if (!a) continue;
      if (ref === pos.valorAplicado) soFace = false;
      achados.push(fmtValor(a.valor));
      maior = Math.max(maior, Math.abs(a.valor - ref));
      evid.push({ campo: "valor", valor: fmtValor(a.valor), confere: true, documento: d.nome, trecho: trecho(d, a.ini, a.fim), nivel: "direto" });
    }
    c.status = "Confere";
    c.documentos = unicos(achados).join(" | ");
    c.fontes = v.direto.map((d) => d.nome);
    const notas = [
      face !== null && soFace ? "o documento traz o valor de face (nominal); o de aquisição não aparece nele" : "",
      maior > 0 ? `diferença de R$ ${fmtValor(maior)} (dentro da tolerância de R$ ${fmtValor(tolerancia)})` : "",
    ];
    c.nota = notas.filter(Boolean).join("; ");
    return c;
  }
  // nenhum documento com o valor: algum da mesma operação traz um valor parecido (erro de digitação)?
  const parecidos: [Documento, Achado<number>][] = [];
  for (const d of v["mesma operação"]) {
    for (const a of d.valoresRotulados) {
      if (alvo > 0 && a.valor / alvo >= 0.5 && a.valor / alvo <= 2) parecidos.push([d, a]);
    }
  }
  if (parecidos.length) {
    for (const [d, a] of parecidos) {
      evid.push({ campo: "valor", valor: fmtValor(a.valor), confere: false, documento: d.nome, trecho: a.trecho, nivel: "mesma operação" });
    }
    c.status = "Diverge";
    c.documentos = unicos(parecidos.map(([, a]) => fmtValor(a.valor))).join(" | ");
    c.fontes = unicos(parecidos.map(([d]) => d.nome));
    c.nota = pos.tipo === "recebivel"
      ? "nenhum documento traz o valor do recebível; documentos do mesmo número trazem outro valor"
      : "nenhum documento traz o VL Aplic. da Britech; documentos da mesma operação trazem outro valor";
    return c;
  }
  const quem = pos.tipo === "recebivel" ? "o número nem o sacado" : "o emissor";
  c.nota = v["mesma operação"].length || v["mesmo emissor"].length
    ? "há documentos ligados a este item, mas nenhum traz este valor"
    : `nenhum documento da pasta traz este valor, ${quem}`;
  return c;
}

/** Dias desde 1970 de uma data ISO. */
const dias = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

/** A data dos documentos mais perto da esperada (até 31 dias), para mostrar a diferença em vez de "não localizado". */
function dataMaisProxima(docs: Documento[], alvo: string): [Documento, Achado<string>, number] | null {
  let melhor: [Documento, Achado<string>, number] | null = null;
  for (const d of docs) {
    for (const a of d.datas) {
      const dif = Math.abs(dias(a.valor) - dias(alvo));
      if (dif <= 31 && (!melhor || dif < melhor[2])) melhor = [d, a, dif];
    }
  }
  return melhor;
}

function avaliarData(
  chaveCampo: "emissao" | "vencimento", alvo: string | null, v: Vinculos, evid: Evidencia[], fonte = "a Britech", recebivel = false,
): Campo {
  const atributo = chaveCampo === "emissao" ? "datasEmissao" : "datasVencimento";
  const rotulo = chaveCampo === "emissao" ? "emissão" : "vencimento";
  const c = campo({ britech: fmtData(alvo) });
  const principais = [...v.direto, ...v["mesma operação"]];
  let achados: [Documento, Achado<string>, Nivel][] = principais.flatMap((d) => d[atributo].map((a) => [d, a, nivelDe(d, v)] as [Documento, Achado<string>, Nivel]));
  let soEmissor = false;
  if (!achados.length) {
    achados = v["mesmo emissor"].flatMap((d) => d[atributo].map((a) => [d, a, "mesmo emissor"] as [Documento, Achado<string>, Nivel]));
    soEmissor = achados.length > 0;
  }
  if (!achados.length) {
    const semRotulo = principais.flatMap((d) => d.datas.filter((a) => alvo && a.valor === alvo).map((a) => [d, a] as const));
    if (semRotulo.length) {
      const [d, a] = semRotulo[0];
      evid.push({ campo: chaveCampo, valor: fmtData(a.valor), confere: true, documento: d.nome, trecho: trecho(d, a.ini, a.fim), nivel: nivelDe(d, v) });
      // duplicatas e termos de cessão trazem as datas em tabela, longe do rótulo: num documento ligado ao recebível
      // pelo valor ou pelo número, a data exata basta
      c.status = recebivel ? "Confere" : "Verificar";
      c.documentos = fmtData(alvo);
      c.fontes = unicos(semRotulo.map(([doc]) => doc.nome));
      c.nota = recebivel
        ? `a data aparece no documento do recebível (sem o rótulo de ${rotulo} ao lado)`
        : `a data aparece no documento, mas sem o rótulo de data de ${rotulo}`;
      return c;
    }
    const proxima = recebivel && alvo ? dataMaisProxima(principais, alvo) : null;
    if (proxima) {
      const [d, a, dif] = proxima;
      evid.push({ campo: chaveCampo, valor: fmtData(a.valor), confere: false, documento: d.nome, trecho: trecho(d, a.ini, a.fim), nivel: nivelDe(d, v) });
      c.status = "Verificar";
      c.documentos = fmtData(a.valor);
      c.fontes = [d.nome];
      c.nota = `a data de ${rotulo} d${fonte} (${fmtData(alvo)}) não aparece no documento; a mais próxima é ${fmtData(a.valor)} (${dif} dia${dif > 1 ? "s" : ""} de diferença)`;
      return c;
    }
    c.nota = `nenhum documento ligado à posição traz a data de ${rotulo}`;
    return c;
  }
  for (const [d, a, nivel] of achados) {
    evid.push({ campo: chaveCampo, valor: fmtData(a.valor), confere: a.valor === alvo, documento: d.nome, trecho: a.trecho, nivel });
  }
  const iguais = achados.filter(([, a]) => a.valor === alvo);
  const diferentes = achados.filter(([, a]) => a.valor !== alvo);
  c.documentos = unicos(achados.map(([, a]) => fmtData(a.valor))).join(" | ");
  c.fontes = unicos(achados.map(([d]) => d.nome));
  if (!alvo) {
    c.status = "Verificar";
    c.nota = `${fonte} não tem data de ${rotulo}; veja a data dos documentos`;
  } else if (iguais.length && !diferentes.length) {
    c.status = "Confere";
    if (soEmissor) c.nota = "confirmado só por documento do mesmo emissor (sem o valor da posição)";
  } else if (iguais.length) {
    c.status = "Verificar";
    c.nota = `documentos não concordam entre si; também aparece: ${unicos(diferentes.map(([d, a]) => `${fmtData(a.valor)} (${d.nome})`)).join(", ")}`;
  } else {
    c.status = soEmissor ? "Verificar" : "Diverge";
    c.nota = soEmissor
      ? `documentos do mesmo emissor trazem outra data de ${rotulo}`
      : `a data de ${rotulo} d${fonte} não aparece nos documentos da posição`;
  }
  return c;
}

function avaliarEmissor(pos: Posicao, v: Vinculos, evid: Evidencia[]): Campo {
  const c = campo({ britech: pos.emissor });
  const principais = [...v.direto, ...v["mesma operação"]];
  if (principais.length) {
    const comNome: Documento[] = [];
    for (const d of principais) {
      const a = emissorNoDoc(d, v.chaveEmissor);
      if (a) {
        comNome.push(d);
        evid.push({ campo: "emissor", valor: pos.emissor, confere: true, documento: d.nome, trecho: a.trecho, nivel: nivelDe(d, v) });
      }
    }
    if (comNome.length) {
      return { ...c, status: "Confere", documentos: pos.emissor, fontes: comNome.map((d) => d.nome) };
    }
    // recebível: o documento pode citar só o cedente (ex.: termo de cessão sem a lista de sacados)
    const chaveCedente = pos.cedente ? chaveDoNome({ ...pos, emissor: pos.cedente }) : "";
    const comCedente = chaveCedente ? principais.filter((d) => emissorNoDoc(d, chaveCedente)) : [];
    if (comCedente.length) {
      return {
        ...c, status: "Verificar", documentos: `cedente ${pos.cedente}`, fontes: comCedente.map((d) => d.nome),
        nota: "os documentos citam o cedente, mas não o sacado",
      };
    }
    const citados = principais.flatMap((d) => d.emissoresCitados.map((a) => [d, a] as const));
    for (const [d, a] of citados) {
      evid.push({ campo: "emissor", valor: a.valor, confere: false, documento: d.nome, trecho: a.trecho, nivel: nivelDe(d, v) });
    }
    c.documentos = unicos(citados.map(([, a]) => a.valor)).join(" | ");
    c.fontes = citados.length ? unicos(citados.map(([d]) => d.nome)) : principais.map((d) => d.nome);
    c.status = citados.length ? "Diverge" : "Verificar";
    c.nota = citados.length ? "os documentos da posição citam outro emissor" : "os documentos da posição não citam o nome do emissor";
    return c;
  }
  if (v["mesmo emissor"].length) {
    for (const d of v["mesmo emissor"].slice(0, 5)) {
      const a = emissorNoDoc(d, v.chaveEmissor);
      evid.push({ campo: "emissor", valor: pos.emissor, confere: true, documento: d.nome, trecho: a?.trecho ?? "", nivel: "mesmo emissor" });
    }
    return {
      ...c, status: "Verificar", documentos: pos.emissor, fontes: v["mesmo emissor"].map((d) => d.nome),
      nota: "o nome aparece nos documentos, mas nenhum deles traz o valor ou o código desta posição",
    };
  }
  c.nota = pos.tipo === "recebivel" ? "o sacado não aparece em nenhum documento da pasta" : "o emissor não aparece em nenhum documento da pasta";
  return c;
}

// ------------------------------------------------------------------ workpaper

export function casarWp(posicoes: Posicao[], linhasWp: LinhaWP[], tolerancia = TOLERANCIA_CENTAVOS) {
  const usados = new Set<number>();
  const casados = new Map<number, LinhaWP>();
  const mesmoValor = (p: Posicao, w: LinhaWP) => w.valorAquisicao !== null && Math.abs(w.valorAquisicao - p.valorAplicado) <= tolerancia;
  const mesmoCodigo = (p: Posicao, w: LinhaWP) => !!soDigitos(p.codigo) && soDigitos(p.codigo) === soDigitos(w.numeroDoc);
  const tentar = (regra: (p: Posicao, w: LinhaWP) => boolean) => {
    posicoes.forEach((p, i) => {
      if (casados.has(i)) return;
      const j = linhasWp.findIndex((w, k) => !usados.has(k) && regra(p, w));
      if (j >= 0) {
        casados.set(i, linhasWp[j]);
        usados.add(j);
      }
    });
  };
  tentar((p, w) => mesmoValor(p, w) && mesmoCodigo(p, w));
  tentar(mesmoValor);
  tentar((p, w) => mesmoCodigo(p, w) && w.dataEmissao === p.dataEmissao && w.dataVencimento === p.dataVencimento);
  // recebível: mesmo número de documento e mesmo vencimento (alguns estoques não trazem a data de emissão)
  tentar((p, w) => p.tipo === "recebivel" && mesmoCodigo(p, w) && w.dataVencimento === p.dataVencimento);
  return { casados, sobrando: linhasWp.filter((_, k) => !usados.has(k)) };
}

function compararWp(campos: Record<ChaveCampo, Campo>, pos: Posicao, w: LinhaWP, tolerancia: number) {
  const pares: [ChaveCampo, unknown, string, boolean][] = [
    ["valor", w.valorAquisicao, fmtValor(w.valorAquisicao), w.valorAquisicao !== null && Math.abs(w.valorAquisicao - pos.valorAplicado) <= tolerancia],
    ["emissao", w.dataEmissao, fmtData(w.dataEmissao), w.dataEmissao === pos.dataEmissao],
    ["vencimento", w.dataVencimento, fmtData(w.dataVencimento), w.dataVencimento === pos.dataVencimento],
  ];
  for (const [k, bruto, textoWp, igual] of pares) {
    campos[k].wp = textoWp;
    campos[k].wpStatus = igual ? "Confere" : bruto === null ? "Não localizado" : "Diverge";
  }
}

/** Acima disto (estoque inteiro), só os itens que estão na WP_Termo — a amostra — são conferidos. */
export const LIMITE_ITENS_CARTEIRA = 1500;

export function recortarPelaWp(posicoes: Posicao[], linhasWp: LinhaWP[]): { posicoes: Posicao[]; aviso: string } {
  if (posicoes.length <= LIMITE_ITENS_CARTEIRA || !linhasWp.length) return { posicoes, aviso: "" };
  const numeros = new Set(linhasWp.map((w) => soDigitos(w.numeroDoc)).filter(Boolean));
  const valores = new Set(linhasWp.map((w) => `${w.valorAquisicao}|${w.dataVencimento}`));
  const recorte = posicoes.filter((p) => numeros.has(soDigitos(p.codigo)) || valores.has(`${p.valorAplicado}|${p.dataVencimento}`));
  return {
    posicoes: recorte,
    aviso: `A carteira tem ${posicoes.length.toLocaleString("pt-BR")} itens: foram conferidos só os ${recorte.length} que estão na WP_Termo (amostra).`,
  };
}

// ------------------------------------------------------------------ conferência completa

function situacaoDe(campos: Record<ChaveCampo, Campo>, noWp: boolean): Situacao {
  const docs = Object.values(campos).map((c) => c.status);
  const wp = noWp ? Object.values(campos).map((c) => c.wpStatus).filter((s) => s !== "—") : [];
  if (docs.includes("Diverge") || wp.includes("Diverge")) return "Divergente";
  if (docs.every((s) => s === "Não localizado")) return "Sem documentos";
  if ([...docs, ...wp].some((s) => s === "Verificar" || s === "Não localizado")) return "Verificar";
  return "OK";
}

export function conferir(
  posicoes: Posicao[], linhasWp: LinhaWP[], docs: Documento[], cnpjFundo = "", tolerancia = TOLERANCIA_CENTAVOS,
): ResultadoConferencia {
  const { casados, sobrando } = casarWp(posicoes, linhasWp, tolerancia);
  const tipo: TipoCarteira = posicoes.some((p) => p.tipo === "recebivel") ? "recebiveis" : "titulos";
  const fonte = tipo === "recebiveis" ? "a carteira" : "a Britech";
  const linhas: LinhaResultado[] = [];
  const vinculosPorDoc = new Map<number, string[]>();

  posicoes.forEach((pos, i) => {
    const v = vincular(pos, docs, tolerancia);
    const evid: Evidencia[] = [];
    const campos: Record<ChaveCampo, Campo> = {
      valor: avaliarValor(pos, v, evid, tolerancia),
      emissao: avaliarData("emissao", pos.dataEmissao, v, evid, fonte, pos.tipo === "recebivel"),
      vencimento: avaliarData("vencimento", pos.dataVencimento, v, evid, fonte, pos.tipo === "recebivel"),
      emissor: avaliarEmissor(pos, v, evid),
    };
    const w = casados.get(i);
    if (w) compararWp(campos, pos, w, tolerancia);
    const rotulo = `${pos.ativo || pos.emissor} — R$ ${fmtValor(pos.valorAplicado)}`;
    for (const nivel of ["direto", "mesma operação"] as const) {
      for (const d of v[nivel]) vinculosPorDoc.set(d.id, [...(vinculosPorDoc.get(d.id) ?? []), `${rotulo} (${nivel})`]);
    }
    linhas.push({
      id: i + 1, ativo: pos.ativo, emissor: pos.emissor, cedente: pos.cedente, codigo: pos.codigo, valorAplicado: fmtValor(pos.valorAplicado),
      dataAquisicao: fmtData(pos.dataAquisicao), noWp: !!w, wpLinha: w?.linhaExcel ?? null,
      situacao: situacaoDe(campos, !!w), campos, docsDiretos: v.direto.length,
      docsMesmaOperacao: v["mesma operação"].length, evidencias: evid,
    });
  });

  for (const w of sobrando) {
    const campos = {
      valor: campo({ status: "—", wp: fmtValor(w.valorAquisicao), wpStatus: "Diverge", nota: `linha do WP_Termo sem posição correspondente n${fonte}` }),
      emissao: campo({ status: "—", wp: fmtData(w.dataEmissao), wpStatus: "Diverge" }),
      vencimento: campo({ status: "—", wp: fmtData(w.dataVencimento), wpStatus: "Diverge" }),
      emissor: campo({ status: "—", wpStatus: "Diverge" }),
    };
    linhas.push({
      id: linhas.length + 1, ativo: [w.tipoRecebivel, tipo === "recebiveis" ? w.numeroDoc : ""].filter(Boolean).join(" "),
      emissor: tipo === "recebiveis" ? w.nomeSacado : w.nomeCedente || w.nomeSacado, cedente: tipo === "recebiveis" ? w.nomeCedente : "",
      codigo: w.numeroDoc,
      valorAplicado: "", dataAquisicao: fmtData(w.dataAquisicao), noWp: true, wpLinha: w.linhaExcel, situacao: "Só no WP",
      campos, docsDiretos: 0, docsMesmaOperacao: 0, evidencias: [],
    });
  }

  const documentos: ItemInventario[] = docs.map((d) => {
    const vinculos = vinculosPorDoc.get(d.id) ?? [];
    return {
      nome: d.nome, caminho: d.caminho, tipo: d.tipo,
      paginas: d.paginasTotal > d.paginasLidas ? `${d.paginasLidas} de ${d.paginasTotal}` : String(d.paginasLidas || ""),
      vinculos, citaCnpjFundo: !!cnpjFundo && d.cnpjs.has(cnpjFundo),
      observacao: [d.erro, d.aviso, d.erro || vinculos.length ? "" : "não ligado a nenhuma posição"].filter(Boolean).join("; "),
    };
  });

  const contagem: Partial<Record<Situacao, number>> = {};
  for (const l of linhas) contagem[l.situacao] = (contagem[l.situacao] ?? 0) + 1;
  return { tipo, linhas, documentos, contagem };
}
