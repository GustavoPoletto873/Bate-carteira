/**
 * Administradoras sem Britech: amostra/estoque de recebíveis como carteira, achados no Drive e conferidos com duplicatas.
 * Todos os nomes, CNPJs, números e valores aqui são fictícios.
 */
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { conferir, recortarPelaWp } from "../lib/lastro/conciliacao";
import { analisar, grupoDoNome } from "../lib/lastro/documentos";
import { arquivoDeRecebiveis, dataDoTrimestre, fundosSoComAmostra, interpretarAmostra, procurarAmostrasEstoques, type LeitorDePastas } from "../lib/lastro/drive-comum";
import { lerCarteira, recebiveisDaTabela, workpaperDaAmostra, type LinhaWP, type Posicao } from "../lib/lastro/planilhas";

const CAB_FROMTIS = ["NOME_FUNDO", "NOME_CEDENTE", "DOC_CEDENTE", "NOME_SACADO", "DOC_SACADO", "SEU_NUMERO", "NU_DOCUMENTO",
  "TIPO_RECEBIVEL", "VALOR_NOMINAL", "VALOR_PRESENTE", "VALOR_AQUISICAO", "DATA_VENCIMENTO_ORIGINAL", "DATA_VENCIMENTO_AJUSTADA",
  "DATA_EMISSAO", "DATA_AQUISICAO"];

function xlsx(linhas: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), "Sheet1");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

describe("amostra e estoque como carteira", () => {
  it("lê a amostra no layout do Fromtis (sacado = emissor, valor de aquisição e de face)", () => {
    const bytes = xlsx([CAB_FROMTIS, [
      "FIDC ALFA", "ACME ESQUADRIAS LTDA", "1", "CONSTRUTORA EXEMPLO E ACA", "2", "R00000000001 01", "R000000101",
      "Duplicata", 10000.5, 9700.1, 9500.25, "2026-07-13 00:00:00", "2026-07-14 00:00:00", "2026-05-25 00:00:00", "2026-05-25 00:00:00",
    ], ["TOTAL", "", "", "", "", "", "", "", 10000.5, "", 9500.25]]);
    const [p, ...resto] = lerCarteira(bytes, "Amostra_11222333000181_FIDC ALFA.xlsx");
    expect(resto).toHaveLength(0);
    expect(p).toMatchObject({
      tipo: "recebivel", codigo: "R000000101", ativo: "Duplicata R000000101", emissor: "CONSTRUTORA EXEMPLO E ACA",
      cedente: "ACME ESQUADRIAS LTDA", valorAplicado: 950025, valorNominal: 1000050,
      dataEmissao: "2026-05-25", dataVencimento: "2026-07-13", dataAquisicao: "2026-05-25",
    });
  });

  it("aceita cabeçalho com espaços e sem valor de aquisição nem data de emissão", () => {
    const linhas = [
      ["NOME DO FUNDO", "NOME CEDENTE", "NOME SACADO", "NUMERO DOCUMENTO", "TIPO RECEBIVEL", "VALOR NOMINAL", "DATA VENCIMENTO ORIGINAL"],
      ["F", "Securitizadora Exemplo S/A", "MARIA EXEMPLO", "'10001 1/4", "CCB PRE DIGITAL", 1234.56, "2026-05-27"],
    ];
    expect(recebiveisDaTabela(linhas)[0]).toMatchObject({ valorAplicado: 123456, valorNominal: 123456, dataEmissao: null, emissor: "MARIA EXEMPLO" });
  });

  it("lê o estoque em CSV com ponto e vírgula", () => {
    const csv = "NOME_CEDENTE;NOME_SACADO;NU_DOCUMENTO;VALOR_NOMINAL;VALOR_AQUISICAO;DATA_EMISSAO;DATA_VENCIMENTO_ORIGINAL\n"
      + "EMPRESA EXEMPLO LTDA;EMPRESA EXEMPLO LTDA;1000001.01;20000.00;15000.00;2026-05-04;2027-07-05\n";
    const [p] = lerCarteira(new TextEncoder().encode(csv), "11222333000181_Estoque_FIDC ALFA.csv");
    expect(p).toMatchObject({ codigo: "1000001.01", valorAplicado: 1500000, valorNominal: 2000000, dataVencimento: "2027-07-05" });
  });

  it("estoque grande: confere só o que está na WP_Termo", () => {
    const pos = (i: number): Posicao => ({
      linha: i, tipo: "recebivel", codigo: `D${i}`, ativo: "", emissor: "S", cedente: "C", valorAplicado: i, valorNominal: i,
      valorPresente: null, dataAquisicao: null, dataEmissao: null, dataVencimento: "2026-07-01", grupo: "",
    });
    const wp = [{ numeroDoc: "D7" }, { numeroDoc: "D1600" }] as LinhaWP[];
    const { posicoes, aviso } = recortarPelaWp(Array.from({ length: 2000 }, (_, i) => pos(i + 1)), wp);
    expect(posicoes.map((p) => p.codigo)).toEqual(["D7", "D1600"]);
    expect(aviso).toContain("2.000 itens");
    expect(recortarPelaWp([pos(1)], wp).posicoes).toHaveLength(1);
  });
});

describe("amostra e estoque no Drive", () => {
  it("reconhece o arquivo do fundo pelo CNPJ ou, sem CNPJ, pelo nome", () => {
    expect(arquivoDeRecebiveis("Amostra_11222333000181_FIDC ALFA.xlsx", "amostra", "FIDC ALFA", "11222333000181")).toEqual({ tipo: "amostra", pontos: 1 });
    expect(arquivoDeRecebiveis("BETA_GAMA_FIDC.xlsx", "amostra", "BETA GAMA FIDC", "")).toMatchObject({ tipo: "amostra" });
    expect(arquivoDeRecebiveis("ESTOQUE DELTA III.xlsx", "estoque", "FIDC DELTA III", "22333444000155")).toMatchObject({ tipo: "estoque" });
    expect(arquivoDeRecebiveis("Amostra_99999999000199_FIDC ALFA.xlsx", "amostra", "FIDC ALFA", "11222333000181")).toBeNull();
    expect(arquivoDeRecebiveis("0 CARTEIRAS.zip", "estoque", "X", "1")).toBeNull();
    expect(arquivoDeRecebiveis("11222333000181_carteira.xlsx", "estoque", "ALFA", "11222333000181")).toBeNull();
  });

  it("procura em _Amostra(s), _Insumos e Estoques, com subpastas, amostra primeiro", async () => {
    const arvore: Record<string, string[]> = {
      "": ["_Amostras/", "_Insumos/", "_workpapers/", "Estoques/"],
      _Amostras: ["_Revisada/", "Amostra_11222333000181_FUNDO X.xlsx"],
      "_Amostras/_Revisada": ["Amostra_11222333000181_FUNDO X.xlsx"],
      _Insumos: ["_Insumos 1/", "0 ESTOQUES.zip"],
      "_Insumos/_Insumos 1": ["11222333000181_Estoque_Agrupado_FUNDO X.xlsx", "22333444000155_Estoque_Agrupado_OUTRO.xlsx"],
      Estoques: [],
      _workpapers: ["WP_FUNDO X_11222333000181.xlsm"],
    };
    const leitor: LeitorDePastas = {
      itens: async (rel) => (arvore[rel] ?? []).map((n) => ({ nome: n.replace(/\/$/, ""), pasta: n.endsWith("/") })),
      caminho: (rel) => `G:/X/${rel}`,
    };
    const achados = await procurarAmostrasEstoques(leitor, "FUNDO X", "11222333000181");
    expect(achados.map((a) => [a.tipo, a.pasta, a.arquivo])).toEqual([
      ["amostra", "_Amostras", "Amostra_11222333000181_FUNDO X.xlsx"],
      ["amostra", "_Amostras/_Revisada", "Amostra_11222333000181_FUNDO X.xlsx"],
      ["estoque", "_Insumos/_Insumos 1", "11222333000181_Estoque_Agrupado_FUNDO X.xlsx"],
    ]);
    expect(achados[2].caminho).toBe("G:/X/_Insumos/_Insumos 1/11222333000181_Estoque_Agrupado_FUNDO X.xlsx");
  });
});

describe("conferência de recebíveis com duplicatas", () => {
  const ID = "0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0";
  const recebivel = (p: Partial<Posicao> = {}): Posicao => ({
    linha: 2, tipo: "recebivel", codigo: "50001-001", ativo: "Duplicata 50001-001", emissor: "JOAO EXEMPLO DA SILVA E OUTRA",
    cedente: "AGRO EXEMPLO COMERCIO", valorAplicado: 10150000, valorNominal: 12000000, valorPresente: null,
    dataAquisicao: "2025-09-12", dataEmissao: "2025-09-12", dataVencimento: "2026-03-10", grupo: "Duplicata", ...p,
  });
  // duplicata em tabela: os rótulos ficam numa linha e as datas/valores em outra
  const duplicata = analisar(`duplicata_assinada${ID}.pdf`,
    "Reconheço a exatidão desta Duplicata de Venda Mercantil, que pagarei à AGRO EXEMPLO COMERCIO LTDA. "
    + "NF/FATURA NÚMERO VENCIMENTO VALOR DATA EMISSÃO: INSC. ESTADUAL: TELEFONE: CEP: UF: BAIRRO: CNPJ/MF NÚMERO DUPLICATA "
    + "01000000 11.222.333/0001-81 12/09/2025 10/03/2026 EMITENTE 000050001 R$ 120.000,00 50001-001 R$ 120.000,00 "
    + "JOAO EXEMPLO DA SILVA E OUTRA FAZENDA EXEMPLO");
  const folha = analisar(`folha_assinatura${ID}.pdf`,
    "Termo de Cessão de Direitos Creditórios. CEDENTE Denominação Social: AGRO EXEMPLO COMERCIO, IMPORTACAO E EXPORTACAO LTDA "
    + "assinado em 21/08/2025 pelo representante do cedente.");

  it("liga a duplicata pelo valor de face e a folha de assinatura pelo identificador do arquivo", () => {
    expect(grupoDoNome(folha.nome)).toBe(ID);
    const r = conferir([recebivel()], [], [duplicata, folha]);
    const l = r.linhas[0];
    expect(r.tipo).toBe("recebiveis");
    expect(l.campos.valor).toMatchObject({ status: "Confere", britech: "101.500,00 (face 120.000,00)", documentos: "120.000,00" });
    expect(l.campos.valor.fontes).toEqual([duplicata.nome]);
    expect(l.campos.vencimento.status).toBe("Confere");
    expect(l.campos.emissao.status).toBe("Confere");
    expect(l.campos.emissor.status).toBe("Confere");
    expect(l.situacao).toBe("OK");
  });

  it("data diferente: mostra a mais próxima do documento em vez de 'não localizado'", () => {
    const l = conferir([recebivel({ dataEmissao: "2025-09-11" })], [], [duplicata]).linhas[0];
    expect(l.campos.emissao).toMatchObject({ status: "Verificar", documentos: "12/09/2025" });
    expect(l.campos.emissao.nota).toContain("1 dia de diferença");
    expect(l.situacao).toBe("Verificar");
  });

  it("só o termo de cessão (cita o cedente, não o sacado): sacado fica para verificar", () => {
    const termo = analisar("termo.pdf", "Termo de cessão. CEDENTE AGRO EXEMPLO COMERCIO LTDA. Duplicata 50001-001 valor R$ 120.000,00 vencimento 10/03/2026.");
    const l = conferir([recebivel()], [], [termo]).linhas[0];
    expect(l.campos.emissor).toMatchObject({ status: "Verificar", nota: "os documentos citam o cedente, mas não o sacado" });
  });

  it("pelo número do documento, mesmo sem o valor", () => {
    const outra = analisar("dup.pdf", "Duplicata número 50001-001 emitida pela AGRO EXEMPLO, sacado JOAO EXEMPLO DA SILVA, R$ 100,00");
    const l = conferir([recebivel()], [], [outra]).linhas[0];
    expect(l.docsMesmaOperacao).toBe(1);
  });
});

describe("fundo sem workpaper (só a amostra)", () => {
  it("lista o fundo que tem amostra mas não tem WP, e não repete o que tem", async () => {
    const arvore: Record<string, string[]> = {
      "": ["_Amostras/", "_Workpapers/", "Estoques/"],
      _Amostras: ["Amostra_11222333000181_FUNDO X.xlsx", "Amostra_22333444000155_FUNDO NOVO .xlsx", "~$Amostra_22333444000155_FUNDO NOVO .xlsx", "Revisadas/"],
      "_Amostras/Revisadas": ["Amostra_22333444000155_FUNDO NOVO .xlsx", "Amostra_33444555000166_FUNDO OUTRO.csv"],
      _Workpapers: ["WP_FUNDO X_11222333000181.xlsm"],
      Estoques: ["Amostra_44555666000177_FORA.xlsx"],
    };
    const leitor: LeitorDePastas = {
      itens: async (rel) => (arvore[rel] ?? []).map((n) => ({ nome: n.replace(/\/$/, ""), pasta: n.endsWith("/") })),
      caminho: (rel) => `G:/X/${rel}`,
    };
    const fundos = await fundosSoComAmostra(leitor, new Set(["11222333000181"]));
    expect(fundos.map((f) => [f.fundo, f.cnpj, f.pasta, f.caminho, f.semWorkpaper])).toEqual([
      ["FUNDO NOVO", "22333444000155", "_Amostras", "G:/X/_Amostras/Amostra_22333444000155_FUNDO NOVO .xlsx", true],
      ["FUNDO OUTRO", "33444555000166", "_Amostras/Revisadas", "G:/X/_Amostras/Revisadas/Amostra_33444555000166_FUNDO OUTRO.csv", true],
    ]);
    expect(interpretarAmostra("Amostra_FUNDO SEM CNPJ.xlsx")).toBeNull();
  });

  it("a amostra vira a WP_Termo, com a data-base do trimestre da pasta", () => {
    const bytes = xlsx([CAB_FROMTIS, [
      "FIDC ALFA", "ACME ESQUADRIAS LTDA", "1", "CONSTRUTORA EXEMPLO E ACA", "2", "R00000000001 01", "R000000101",
      "Duplicata", 10000.5, 9700.1, 9500.25, "2026-07-13 00:00:00", "2026-07-14 00:00:00", "2026-05-25 00:00:00", "2026-05-26 00:00:00",
    ]]);
    const data = dataDoTrimestre("G:/Drives compartilhados/Auditoria/2T2026/SOLIS/_Amostras/a.xlsx");
    expect(data).toBe("2026-06-30");
    const wp = workpaperDaAmostra(bytes, "Amostra_11222333000181_FIDC ALFA.xlsx", "11222333000181", "FIDC ALFA", data);
    expect(wp).toMatchObject({ cnpj: "11222333000181", fundo: "FIDC ALFA", dataBase: "2026-06-30", carteiraInforme: [], lastro: null });
    expect(wp.linhas[0]).toMatchObject({
      numeroDoc: "R000000101", nomeSacado: "CONSTRUTORA EXEMPLO E ACA", nomeCedente: "ACME ESQUADRIAS LTDA", valorAquisicao: 950025,
      valorNominal: 1000050, dataEmissao: "2026-05-25", dataVencimento: "2026-07-13", dataAquisicao: "2026-05-26", tipoRecebivel: "Duplicata",
    });
    expect(dataDoTrimestre("pasta escolhida/SOLIS")).toBeNull();
    expect(() => workpaperDaAmostra(xlsx([["A", "B"], [1, 2]]), "Amostra_x.xlsx", "1", "F", null)).toThrow(/não tem recebíveis/);
  });
});
