/**
 * Comparação com origem (carteira × documento), dedução "Provável", cálculo pela taxa (CDI/prefixado),
 * busca nos documentos e vínculo manual V/D/P. Dados fictícios.
 */
import { describe, expect, it } from "vitest";
import { buscarNosDocumentos } from "../lib/lastro/busca";
import { compararPosicao, familiaDoRotulo } from "../lib/lastro/comparacao";
import { conferir, type LinhaResultado } from "../lib/lastro/conciliacao";
import { analisar, paginaDe, rotuloAntes } from "../lib/lastro/documentos";
import { CurvaCdi, deducoesPorTaxa, taxasNoTexto, type PontoCdi } from "../lib/lastro/indexadores";
import { aplicarVinculos, marcaAutomatica } from "../lib/lastro/marcacoes";
import type { Posicao } from "../lib/lastro/planilhas";
import { normalizar } from "../lib/lastro/textos";

const titulo = (p: Partial<Posicao> = {}): Posicao => ({
  linha: 2, tipo: "titulo", codigo: "", ativo: "NC_EMPRESA ALFA 1E Vcto: 02012028", emissor: "EMPRESA ALFA LTDA", cedente: "",
  valorAplicado: 100000000, valorNominal: null, valorPresente: null, dataAquisicao: null, dataEmissao: "2026-01-02",
  dataVencimento: "2028-01-02", grupo: "", colunas: { valorAplicado: "VALOR APLICAÇÃO", dataEmissao: "DATA EMISSÃO" }, ...p,
});

/** Dias úteis fictícios (seg–sex) com CDI constante de 0,05% ao dia. */
function serie(de: string, ate: string, taxa = 0.05): PontoCdi[] {
  const pontos: PontoCdi[] = [];
  for (let d = new Date(`${de}T00:00:00Z`); d.toISOString().slice(0, 10) <= ate; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) pontos.push({ data: d.toISOString().slice(0, 10), taxa });
  }
  return pontos;
}

describe("rótulo e página de cada valor/data", () => {
  it("pega o rótulo que vem antes, sem atravessar outro valor", () => {
    const n = normalizar("Valor Total da Emissão: R$ 1.000,00. Data de Emissão: 12/03/2026");
    expect(rotuloAntes(n, n.indexOf("1.000,00"), new Set(["valor", "emissao", "total"]))).toBe("valor total da emissao");
    expect(rotuloAntes(n, n.indexOf("12/03/2026"), new Set(["data", "emissao"]))).toBe("data de emissao");
    const tabela = normalizar("VENCIMENTO VALOR NÚMERO 10/03/2026 R$ 191,00");
    expect(rotuloAntes(tabela, tabela.indexOf("191,00"), new Set(["valor", "vencimento"]))).toBe("");
    const cabecalho = normalizar("Vencimento Prazo Saldo Devedor Amortização Juros Indexador Valor 10/06/2026");
    expect(rotuloAntes(cabecalho, cabecalho.indexOf("10/06/2026"), new Set(["vencimento", "data"]))).toBe("");
  });

  it("sabe a página de cada ocorrência", () => {
    const pag1 = "Boletim de subscrição página um com bastante texto para o teste.";
    const doc = analisar("bs.pdf", `${pag1}\nValor de aplicação: R$ 2.500,00 na página dois`, { paginas: [0, pag1.length + 1] });
    expect(doc.valoresComRotulo[0]).toMatchObject({ valor: 250000, rotulo: "valor de aplicacao", pagina: 2 });
    expect(paginaDe(doc, 0)).toBe(1);
  });
});

describe("comparação carteira × documento", () => {
  it("valor nominal da carteira igual ao 'valor de aplicação' do documento: mostra os dois e de onde vieram", () => {
    const pos: Posicao = { ...titulo(), tipo: "recebivel", valorAplicado: 95000, valorNominal: 100000, colunas: { valorAplicado: "VALOR_AQUISICAO", valorNominal: "VALOR_NOMINAL" } };
    const doc = analisar("ccb.pdf", "Cédula de Crédito Bancário emitida pela EMPRESA ALFA. Valor da aplicação: R$ 1.000,00 com vencimento em 02/01/2028.");
    const [c] = compararPosicao(pos, [doc]).filter((x) => x.tipo === "valor");
    expect(c).toMatchObject({
      relacao: "campo diferente",
      carteira: { origem: "carteira", coluna: "VALOR_NOMINAL", valor: "1.000,00" },
      documento: { arquivo: "ccb.pdf", rotulo: "valor da aplicacao", valor: "1.000,00", pagina: 1 },
    });
    expect(familiaDoRotulo("valor de face")).toBe("nominal");
  });

  it("data da carteira que no documento aparece em outro campo ou sem rótulo vira 'Provável'", () => {
    const doc = analisar("termo.pdf", "Termo da EMPRESA ALFA LTDA. Valor R$ 1.000.000,00. Data de desembolso: 02/01/2026. Data de vencimento: 02/01/2028.");
    const l = conferir([titulo()], [], [doc]).linhas[0];
    expect(l.campos.emissao).toMatchObject({ status: "Provável", documentos: "02/01/2026" });
    expect(l.campos.emissao.nota).toContain('como "data de desembolso"');
    expect(l.comparacoes.find((c) => c.campo === "emissao")).toMatchObject({ relacao: "campo diferente", documento: { rotulo: "data de desembolso" } });
    expect(l.situacao).toBe("Provável");
  });
});

describe("cálculo pela taxa (Nota Comercial)", () => {
  it("lê a taxa do documento e da descrição do ativo", () => {
    const n = normalizar("remunerada por 100% (cem por cento) da variação acumulada das taxas médias diárias dos DI, acrescida de sobretaxa de 3,00% (três por cento) ao ano");
    expect(taxasNoTexto(n, "doc")).toMatchObject([{ indexador: "CDI", percentual: 100, juros: 3 }]);
    expect(taxasNoTexto(normalizar("26C4044095 Vcto: 26032031 > 100% CDI + 3,00%"), "ativo")).toMatchObject([{ indexador: "CDI", percentual: 100, juros: 3 }]);
    expect(taxasNoTexto(normalizar("100,00% IPCA + 17,47%"), "ativo")).toEqual([]);
    expect(taxasNoTexto(normalizar("juros remuneratórios de 18% ao ano"), "doc")).toMatchObject([{ indexador: "PRE", juros: 18, periodo: "ano" }]);
  });

  it("fator do CDI: produto dos dias úteis × spread pelos dias úteis/252", () => {
    const curva = new CurvaCdi(serie("2026-01-01", "2026-03-31"));
    const f = curva.fator({ indexador: "CDI", percentual: 100, juros: 3, periodo: "ano", origem: "", texto: "" }, "2026-01-05", "2026-01-19");
    expect(f?.dias).toBe(10);
    expect(f?.fator).toBeCloseTo(Math.pow(1.0005, 10) * Math.pow(1.03, 10 / 252), 12);
    expect(curva.fator({ indexador: "CDI", percentual: 100, juros: 0, periodo: "ano", origem: "", texto: "" }, "2025-01-01", "2026-01-19")).toBeNull();
  });

  it("o VL Aplic. sai do principal do documento corrigido pela taxa até a aquisição", () => {
    const cdi = serie("2025-12-01", "2026-06-30");
    const curva = new CurvaCdi(cdi);
    const taxa = { indexador: "CDI" as const, percentual: 100, juros: 2, periodo: "ano" as const, origem: "", texto: "" };
    const vlAplic = Math.round(100000000 * curva.fator(taxa, "2026-01-02", "2026-03-02")!.fator);
    const pos = titulo({ valorAplicado: vlAplic, dataAquisicao: "2026-03-02" });
    const nc = analisar("nota_comercial.pdf",
      "Nota Comercial da EMPRESA ALFA LTDA. Valor Nominal: R$ 1.000.000,00. Data de Emissão: 02/01/2026. "
      + "Remuneração: 100% do CDI acrescida de spread de 2,00% ao ano. Vencimento em 02/01/2028.");
    const [d] = deducoesPorTaxa(pos, [nc], undefined, curva, "2026-06-30");
    expect(d).toMatchObject({ relacao: "calculado", carteira: { coluna: "VALOR APLICAÇÃO" }, documento: { arquivo: "nota_comercial.pdf", rotulo: "valor nominal", valor: "1.000.000,00" } });
    expect(d.detalhe).toContain("100% CDI + 2% a.a.");

    const l = conferir([pos], [], [nc], "", 1, { dataBase: "2026-06-30", cdi }).linhas[0];
    expect(l.campos.valor.status).toBe("Provável");
    expect(l.campos.valor.nota).toContain("calculado");

    // título IPCA pela descrição da carteira: não calcula com o CDI citado em outra cláusula do documento
    const ipca = titulo({ ativo: "NC_EMPRESA ALFA 1E Vcto: 02012028 > 100,00% IPCA + 9,00%", valorAplicado: vlAplic, dataAquisicao: "2026-03-02" });
    expect(deducoesPorTaxa(ipca, [nc], undefined, curva, "2026-06-30")).toEqual([]);
  });
});

describe("Bater PDF: busca e vínculo", () => {
  const docs = [
    analisar("a.pdf", "Duplicata número 50001-001 no valor de R$ 1.000,00 sacado Ação Exemplo"),
    analisar("b.pdf", "Outro documento sem relação, com o valor de R$ 2.000,00 e mais texto aqui"),
  ];

  it("acha texto sem acento e valor escrito de outro jeito", () => {
    expect(buscarNosDocumentos(docs, "acao exemplo").resultados.map((r) => r.doc.nome)).toEqual(["a.pdf"]);
    const v = buscarNosDocumentos(docs, "1000,00");
    expect(v).toMatchObject({ tipo: "valor", destacar: "1.000,00" });
    expect(v.resultados[0].ocorrencias[0].alvo).toBe("1.000,00");
    expect(buscarNosDocumentos(docs, "ab").motivo).toBe("termo_curto");
  });

  it("marca automática e marca manual (a de quem confere vence)", () => {
    expect(marcaAutomatica("valor", "950,00 (face 1.000,00)", "R$ 1.000,00")).toBe("V");
    expect(marcaAutomatica("vencimento", "10/03/2026", "11/03/2026")).toBe("D");
    expect(marcaAutomatica("emissor", "AÇÃO EXEMPLO LTDA", "")).toBe("P");
    const l = conferir([titulo()], [], []).linhas[0] as LinhaResultado;
    expect(l.situacao).toBe("Sem documentos");
    const [m] = aplicarVinculos([l], new Map([[l.id, {
      arquivo: "a.pdf", pagina: 1,
      campos: { valor: { documento: "1.000.000,00", marca: "V" }, emissao: { documento: "02/01/2026", marca: "V" }, vencimento: { documento: "03/01/2028", marca: "D" } },
    }]]));
    expect(m.campos.valor).toMatchObject({ status: "Confere", fontes: ["a.pdf"] });
    expect(m.campos.vencimento).toMatchObject({ status: "Diverge", documentos: "03/01/2028" });
    expect(m.situacao).toBe("Divergente");
    expect(m.manual).toBe("a.pdf");
  });
});
