/** Testes da lógica de conferência (dados fictícios; sem rede, sem Drive). Rodar: npm test */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { opcoesDeCarteira } from "../lib/lastro/carteiras";
import { conferir } from "../lib/lastro/conciliacao";
import { analisar } from "../lib/lastro/documentos";
import { classificar, textoHtml } from "../lib/lastro/extratores";
import { ehCarteiraDoFundo, ErroDeEntrada, lerCarteira, lerWorkpaper } from "../lib/lastro/planilhas";
import {
  acharDatas, acharValores, codigoBritech, fmtValor, nomeEssencial, normalizar, numeroEmissaoBritech, paraCentavos,
  paraData,
} from "../lib/lastro/textos";

const CNPJ = "11222333000181";

const BOLETIM = `BOLETIM DE SUBSCRIÇÃO DAS NOTAS COMERCIAIS
BOLETIM DE SUBSCRIÇÃO DA 2ª (SEGUNDA) EMISSÃO DE NOTAS COMERCIAIS, EM SÉRIE ÚNICA, DA ALFA FOMENTO LTDA
Emissão, pela ALFA FOMENTO LTDA, inscrita no CNPJ/MF sob o nº 44.555.666/0001-77, com sede na Rua X,
de 500.000 notas comerciais, com valor nominal unitário de R$ 1,00, vencimento em 15 DE MARÇO DE 2029,
parcelada em 1 parcela. Razão Social FUNDO TESTE FIDC CNPJ: 11.222.333/0001-81
NOTAS COMERCIAIS SUBSCRITAS QUANTIDADE PREÇO UNITÁRIO VALOR EM R$ 500.000 R$ 1,00 500.000,55
São Paulo, 20 de março de 2026`;

const TERMO = `CONDIÇÕES NEGOCIAIS DO INSTRUMENTO PARTICULAR
CONTRATANTE/EMISSORA Nome ALFA FOMENTO LTDA CNPJ 44.555.666/0001-77
DADOS DO ATIVO Natureza do Ativo Nota Comercial Série Única Emissão SEGUNDA
Data de Emissão 10 de março de 2026 Data de Vencimento 15 DE MARÇO DE 2029`;

const TERMO_CRI = `3.6. Data de Emissão dos CRI. A data de emissão dos CRI será 17 de março de 2026 ("Data de Emissão").
3.8. Prazo: 1.835 dias corridos contados da Data de Emissão, vencendo-se, portanto, em 26 de março de 2031
("Data de Vencimento dos CRI"). Código IF 26X1234567`;

const BOLETA_HTML = `<html><body><table>
<tr><td>Emissor (Nome do Emissor)</td><td>BETA SECURITIZADORA S.A.</td></tr>
<tr><td>Código Sinacor (Código do Emissor):</td><td></td></tr>
<tr><td>Data de Aquisição (Data de Compra)</td><td>09/04/2026 00:00:00</td></tr>
<tr><td>Valor Atual do Ativo</td><td>2.000.000,00</td></tr>
</table></body></html>`;

const cp1252 = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));

function xlsx(linhas: unknown[][], aba = "Plan1"): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), aba);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

const CARTEIRA = [
  ["Data Base", "Carteira", "Cód", "Ativo", "Emissor", "Vlr. Aquisição", "Vlr. Presente", "Dt. Aquisição", "Dt. Emissão", "Dt. Vencimento", "e-Financeira"],
  ["30-jun-2026", 999, null, "FUNDO X SENIOR", "GESTORA Y", 100, 110, null, null, null, "FIDC"],
  ["30-jun-2026", 999, 111, "NC_ALFA 2E   Vcto: 15032029 > IPCA + 10%", "ALFA FOMENTO LTDA", 500000.55, 510000, "20-mar-2026", "10-mar-2026", "14-mar-2029", "Nota Comercial"],
  ["30-jun-2026", 999, 222, "NC_GAMA_1E   Vcto: 01012030", "GAMA PARTICIPACOES", 1000, 1010, "01-abr-2026", "01-dez-2025", "01-jan-2030", "Nota Comercial"],
  ["30-jun-2026", 999, 333, "26X1234567   Vcto: 26032031 > 100% CDI", "BETA SECURITIZADORA S.A.", 2000000, 2010000, "09-abr-2026", "17-mar-2026", "26-mar-2031", "CRI"],
  ["30-jun-2026", 999, null, "Taxa de Gestão", null, null, -50, null, "30-jun-2026", "07-jul-2026", "Valores a Liquidar"],
];

function workpaperBytes(): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["RESULTADOS MATCHING - FUNDO TESTE FIDC - 30/06/2026"]]), "Resumo_BateLastro");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["DADOS TERMO"], [],
    ["ID_BASE", "STATUS", "BASE_NUMERO_DOC", "BASE_NOME_SACADO", "BASE_NOME_CEDENTE", "BASE_NOME_FUNDO", "BASE_CNPJ_FUNDO",
      "BASE_VALOR_NOMINAL", "BASE_VALOR_AQUISICAO", "BASE_DATA_EMISSAO", "BASE_DATA_VENCIMENTO", "BASE_DATA_AQUISICAO", "BASE_TIPO_RECEBIVEL"],
    [1, "P", "111", "-", "-", "FUNDO TESTE FIDC", "11.222.333/0001-81", 510000, 500000.55, "10/03/2026", 47191, "20/03/2026", "NC_ALFA 2E"],
    [2, "P", "333", "-", "-", "FUNDO TESTE FIDC", "11.222.333/0001-81", 2010000, 2000000, "17/03/2026", "26/03/2031", null, "26X1234567"],
    [3, "P", "444", "-", "-", "FUNDO TESTE FIDC", "11.222.333/0001-81", 9, 9999.99, "01/01/2026", "01/01/2027", null, "ITEM SÓ NO WP"],
  ]), "WP_Termo");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

function documentos() {
  return [
    analisar("12345_BS_ALFA.pdf", BOLETIM, { tipo: "PDF" }),
    analisar("99999_12345_Term_ALFA.pdf", TERMO, { tipo: "PDF" }),
    analisar("Tela_Cetip.pdf", TERMO_CRI, { tipo: "PDF" }),
    analisar("OCABoleta_1.htm", textoHtml(cp1252(BOLETA_HTML)), { tipo: "HTML" }),
  ];
}

describe("textos", () => {
  it("lê datas em vários formatos", () => {
    expect(acharDatas(normalizar("10/06/2026, 11 DE JUNHO DE 2029 e 26-mar-2031")).map((d) => d.valor))
      .toEqual(["2026-06-10", "2029-06-11", "2031-03-26"]);
    expect(paraData("10-jun-2029")).toBe("2029-06-10");
    expect(paraData(47191)).toBe("2029-03-14"); // data serial do Excel
    expect(paraData("-")).toBeNull();
  });

  it("lê valores brasileiros sem confundir PU com R$", () => {
    const valores = acharValores(normalizar("R$ 1.453.004,29 e 2005653,00 e 1,00278124 e 17,47%")).map((v) => v.valor);
    expect(valores).toContain(145300429);
    expect(valores).toContain(200565300);
    expect(valores).not.toContain(100);
    expect(paraCentavos(72035386.6)).toBe(7203538660);
    expect(fmtValor(7203538661)).toBe("72.035.386,61");
    expect(nomeEssencial("CRÉDITO ESTRATÉGICO ASSESSORIA LTDA")).toBe("credito estrategico assessoria");
    expect(numeroEmissaoBritech("NC_ALFA 2E   Vcto: 15032029")).toBe(2);
    expect(codigoBritech("26X1234567   Vcto: 26032031")).toBe("26x1234567");
  });
});

describe("documentos", () => {
  it("extrai vencimento, valor e emissor do boletim", () => {
    const d = analisar("12345_BS_ALFA.pdf", BOLETIM, { tipo: "PDF" });
    expect(d.datasVencimento.map((a) => a.valor)).toEqual(["2029-03-15"]);
    expect(d.datasEmissao).toEqual([]);
    expect(d.valores.map((a) => a.valor)).toContain(50000055);
    expect(d.emissoresCitados[0].valor).toBe("ALFA FOMENTO LTDA");
    expect([...d.numerosEmissao]).toEqual([2]);
    expect(d.grupo).toBe("12345");
    expect(d.cnpjs.has(CNPJ)).toBe(true);
  });

  it("não confunde a data de outro rótulo com a emissão", () => {
    const d = analisar("termo.pdf", TERMO_CRI, { tipo: "PDF" });
    expect(d.datasEmissao.map((a) => a.valor)).toEqual(["2026-03-17"]);
    expect(d.datasVencimento.map((a) => a.valor)).toEqual(["2031-03-26"]);
    expect(d.datasVencimento[0].trecho).toContain("vencendo-se");
  });

  it("lê boleta HTML em cp1252 e marca PDF escaneado", () => {
    const d = analisar("OCABoleta_1.htm", textoHtml(cp1252(BOLETA_HTML)), { tipo: "HTML" });
    expect(d.emissoresCitados[0].valor).toBe("BETA SECURITIZADORA S.A");
    expect(d.valoresRotulados.map((a) => a.valor)).toContain(200000000);
    expect(analisar("scan.pdf", "  ", { tipo: "PDF" }).erro).toContain("escaneado");
    expect(classificar("_log_pipeline.txt")).toBe("silencio");
    expect(classificar("foto.png")).toContain("OCR");
  });
});

describe("planilhas", () => {
  it("lê a carteira formatada pelo hub", () => {
    const p = lerCarteira(xlsx(CARTEIRA), "999_x_BRITECH.xlsx");
    expect(p.map((x) => x.emissor)).toEqual(["ALFA FOMENTO LTDA", "GAMA PARTICIPACOES", "BETA SECURITIZADORA S.A."]);
    expect(p[0]).toMatchObject({ codigo: "111", valorAplicado: 50000055, dataEmissao: "2026-03-10", dataVencimento: "2029-03-14" });
  });

  it("lê exportação do PAS com o cabeçalho no meio", () => {
    const p = lerCarteira(xlsx([["Carteira: FUNDO TESTE"], [],
      ["Título", "Emissor", "VL Aplic.", "Dt. Emissão", "Dt. Vencto"],
      ["NC ALFA", "ALFA FOMENTO LTDA", "500.000,55", "10/03/2026", "14/03/2029"]]), "export.xlsx");
    expect(p).toHaveLength(1);
    expect(p[0].valorAplicado).toBe(50000055);
    expect(p[0].dataVencimento).toBe("2029-03-14");
  });

  it("lê o relatório bruto da API (ExcelAlinhado), juntando colunas equivalentes", () => {
    const p = lerCarteira(xlsx([
      ["Relatório de Composição da Carteira"], [],
      ["MERCADO", "GRUPO", "ID TÍTULO", "CÓDIGO", "DESCRIÇÃO", "EMISSOR", "INSTITUIÇÃO", "DATA AQUISIÇÃO", "DATA OPERAÇÃO",
        "DATA EMISSÃO", "DATA VENCIMENTO", "VALOR CUSTO", "APLICAÇÃO", "VALOR APLICAÇÃO", "VALOR MERCADO"],
      ["Renda Fixa", "Nota Comercial", "111", "", "NC_ALFA 2E", "ALFA FOMENTO LTDA", "", "", "20/03/2026",
        "10/03/2026", "14/03/2029", "", "", "500000.55", "510000"],
      ["Renda Fixa", "CRI", "", "26X1234567", "26X1234567 Vcto", "", "BETA SECURITIZADORA S.A.", "09/04/2026", "",
        "17/03/2026", "26/03/2031", "2000000.10", "", "2000000", "2010000"],
      ["Cotas", "FIDC", "", "", "FUNDO X SENIOR", "GESTORA Y", "", "", "", "", "", "100", "", "", "110"],
      ["Patrimônio Líquido", "Patrimônio Líquido", "", "", "", "", "", "", "", "", "", "", "", "", "99999"],
    ]), "carteira_52230_2026-06-30.xlsx");
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ codigo: "111", emissor: "ALFA FOMENTO LTDA", valorAplicado: 50000055, dataAquisicao: "2026-03-20", dataVencimento: "2029-03-14" });
    expect(p[1]).toMatchObject({ codigo: "26X1234567", emissor: "BETA SECURITIZADORA S.A.", valorAplicado: 200000000, dataEmissao: "2026-03-17" });
  });

  it("carteira sem colunas dá erro amigável", () => {
    expect(() => lerCarteira(xlsx([["a"], [1]]), "errada.xlsx")).toThrow(ErroDeEntrada);
  });

  it("lê a WP_Termo, CNPJ e data-base", () => {
    const wp = lerWorkpaper(workpaperBytes(), `WP_FUNDO TESTE_${CNPJ}.xlsm`);
    expect(wp).toMatchObject({ cnpj: CNPJ, fundo: "FUNDO TESTE FIDC", dataBase: "2026-06-30" });
    expect(wp.linhas).toHaveLength(3);
    expect(wp.linhas[0]).toMatchObject({ valorAquisicao: 50000055, dataVencimento: "2029-03-14", linhaExcel: 4 });
  });

  it("workpaper sem WP_Termo dá erro amigável", () => {
    expect(() => lerWorkpaper(xlsx([["x"]]), "WP_x.xlsm")).toThrow(/não tem a aba WP_Termo/);
    // FIC: a aba existe, só com colunas auxiliares e sem a tabela BASE_…
    expect(() => lerWorkpaper(xlsx([[], [], ["", "", "DataBase", "Prazo", "Amostra"]], "WP_Termo"), "WP_FIC.xlsm")).toThrow(/WP_Termo deste workpaper está vazia/);
    expect(() => lerWorkpaper(xlsx([["ID_BASE", "BASE_NOME_SACADO"]], "WP_Termo"), "WP_x.xlsm")).toThrow(/Não achei o cabeçalho/);
  });

  it("reconhece o arquivo da carteira do fundo na data", () => {
    expect(ehCarteiraDoFundo(`999_${CNPJ}_30.06.2026_BRITECH.xlsx`, CNPJ, "2026-06-30")).toBe(true);
    expect(ehCarteiraDoFundo(`999_${CNPJ}_31.03.2026_BRITECH.xlsx`, CNPJ, "2026-06-30")).toBe(false);
    expect(ehCarteiraDoFundo(`999_00000000000000_30.06.2026_BRITECH.xlsx`, CNPJ, "2026-06-30")).toBe(false);
  });
});

describe("escolha da carteira Britech", () => {
  const subclasses = [
    { id: "77001", nome: "FUNDO X - SUBORDINADA" }, { id: "77002", nome: "FUNDO X - MEZANINO" },
    { id: "770022", nome: "FUNDO X - MEZANINO 2" }, { id: "77003", nome: "FUNDO X - SENIOR" },
  ];
  it("prefere o ID do arquivo já baixado, mesmo fora da lista", () => {
    const r = opcoesDeCarteira(subclasses, "77");
    expect(r.padrao).toBe("77");
    expect(r.opcoes[0].id).toBe("77");
  });
  it("escolhe a CLASSE quando ela vem na lista", () => {
    expect(opcoesDeCarteira([...subclasses, { id: "77", nome: "FUNDO X - CLASSE" }]).padrao).toBe("77");
  });
  it("deduz a carteira-mãe pelo prefixo quando só vieram subclasses", () => {
    const r = opcoesDeCarteira(subclasses);
    expect(r.padrao).toBe("7700");
    expect(r.opcoes[0].nome).toContain("deduzida");
  });
  it("a carteira deduzida fica na mesma Britech (administradora) das subclasses", () => {
    const daId = subclasses.map((c) => ({ ...c, adm: "ID", admNome: "ID" }));
    expect(opcoesDeCarteira(daId).opcoes[0]).toMatchObject({ id: "7700", adm: "ID", admNome: "ID" });
    expect(opcoesDeCarteira(daId, "55").opcoes[0]).toMatchObject({ id: "55", adm: "ID" });
  });
});

describe("conferência", () => {
  it("aponta vencimento divergente, OK e item só no WP", () => {
    const posicoes = lerCarteira(xlsx(CARTEIRA), "c.xlsx");
    const wp = lerWorkpaper(workpaperBytes(), `WP_T_${CNPJ}.xlsm`);
    const r = conferir(posicoes, wp.linhas, documentos(), CNPJ);
    const por = Object.fromEntries(r.linhas.map((l) => [l.emissor, l]));

    const alfa = por["ALFA FOMENTO LTDA"];
    expect(alfa.campos.valor.status).toBe("Confere");
    expect(alfa.campos.emissao.status).toBe("Confere");
    expect(alfa.campos.vencimento.status).toBe("Diverge");
    expect(alfa.campos.vencimento.documentos).toBe("15/03/2029");
    expect(alfa.campos.emissor.status).toBe("Confere");
    expect(alfa.campos.vencimento.wpStatus).toBe("Confere"); // o WP copia a Britech
    expect(alfa.situacao).toBe("Divergente");

    const beta = por["BETA SECURITIZADORA S.A."];
    expect(beta.situacao).toBe("OK");
    expect(beta.campos.vencimento.fontes).toEqual(["Tela_Cetip.pdf"]);

    expect(por["GAMA PARTICIPACOES"].situacao).toBe("Sem documentos");
    const soWp = r.linhas.filter((l) => l.situacao === "Só no WP");
    expect(soWp.map((l) => l.codigo)).toEqual(["444"]);
    expect(r.contagem).toEqual({ Divergente: 1, OK: 1, "Sem documentos": 1, "Só no WP": 1 });
    expect(r.documentos.find((d) => d.nome === "12345_BS_ALFA.pdf")?.citaCnpjFundo).toBe(true);
  });

  it("valor dentro da tolerância confere com nota", () => {
    const carteira = CARTEIRA.map((l) => [...l]);
    carteira[4][5] = 1999999.99;
    const r = conferir(lerCarteira(xlsx(carteira), "c.xlsx"), [], documentos(), CNPJ);
    const beta = r.linhas.find((l) => l.emissor.startsWith("BETA"))!;
    expect(beta.campos.valor.status).toBe("Confere");
    expect(beta.campos.valor.nota).toContain("diferença de R$ 0,01");
  });
});
