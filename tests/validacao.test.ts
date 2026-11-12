/** Validação da carteira como a aba CVM do workpaper (carteiraInforme × estoque × amostra). Dados fictícios. */
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { lerWorkpaper, type LinhaWP, type Posicao, type Workpaper } from "../lib/lastro/planilhas";
import { ehVencido, validarCarteira } from "../lib/lastro/validacao-carteira";

const CNPJ = "11222333000181";

function xlsxWp(): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Data Base", "CNPJ Fundo", "Descricao", "Valor", "Quantidade de Cotas", "Valor da Cota", "Mapeamento"],
    ["2026-03-31", "11.222.333/0001-81", "Direitos Creditorios SEM a Vencer", 1000.05, "", "", "Direitos creditórios vincendos"],
    ["2026-03-31", "11.222.333/0001-81", "Direitos Creditorios COM a Vencidos", 500, "", "", "Direitos creditórios vencidos"],
    ["2026-03-31", "11.222.333/0001-81", "PDD COM", -400, "", "", "Provisão para perdas com direitos creditórios"],
    ["2026-03-31", "11.222.333/0001-81", "Disponibilidades", 10, "", "", "Disponibilidades"],
    ["2026-03-31", "11.222.333/0001-81", "Valores a pagar", -10, "", "", "valores a pagar / a receber"],
    ["2026-03-31", "11.222.333/0001-81", "Subclasse Senior", 1100.05, 100, 11, "Patrimônio líquido"],
    ["2026-03-31", "99.999.999/0001-99", "Outro fundo", 999999, "", "", "Disponibilidades"],
  ]), "carteiraInforme");
  const cab = ["ID_BASE", "STATUS", "BASE_NUMERO_DOC", "BASE_NOME_SACADO", "BASE_NOME_CEDENTE", "BASE_CNPJ_FUNDO", "BASE_VALOR_NOMINAL",
    "BASE_VALOR_AQUISICAO", "BASE_DATA_EMISSAO", "BASE_DATA_VENCIMENTO", "Amostra"];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], cab,
    ["1", "V", "D1", "SACADO A", "CEDENTE", CNPJ, 600, 550, "2026-01-10", "2026-06-10", "Direitos creditórios vincendos"],
    ["2", "P", "D2", "SACADO B", "CEDENTE", CNPJ, 300, 280, "2025-10-10", "2026-02-10", "Direitos creditórios vencidos"],
  ]), "WP_Termo");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], ["ID_BASE", "STATUS"], ["1", "V"], ["2", "V"]]), "WP_Lastro");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

const recebivel = (p: Partial<Posicao>): Posicao => ({
  linha: 2, tipo: "recebivel", codigo: "X", ativo: "Duplicata X", emissor: "S", cedente: "C", valorAplicado: 0, valorNominal: 0,
  valorPresente: 0, dataAquisicao: null, dataEmissao: null, dataVencimento: "2026-06-10", grupo: "", situacao: "A vencer", valorPdd: 0, ...p,
});

describe("validação da carteira (aba CVM)", () => {
  it("lê a carteiraInforme do CNPJ do fundo, a coluna Amostra e o status da WP_Lastro", () => {
    const wp = lerWorkpaper(xlsxWp(), `WP_FUNDO X_${CNPJ}.xlsm`);
    expect(wp.carteiraInforme).toHaveLength(6);
    expect(wp.carteiraInforme[0]).toMatchObject({ valor: 100005, mapeamento: "Direitos creditórios vincendos", dataBase: "2026-03-31" });
    expect(wp.linhas.map((l) => [l.status, l.amostra])).toEqual([["V", "Direitos creditórios vincendos"], ["P", "Direitos creditórios vencidos"]]);
    expect(wp.lastro).toEqual({ verificados: 2, pendentes: 0 });
  });

  it("soma das categorias × PL e carteira × estoque por situação, PDD e amostra", () => {
    const wp = lerWorkpaper(xlsxWp(), `WP_FUNDO X_${CNPJ}.xlsm`);
    const estoque = [
      recebivel({ valorPresente: 60000 }), recebivel({ valorPresente: 40000 }), // 1.000,00 a vencer (carteira 1.000,05: dentro de R$ 1)
      recebivel({ situacao: "Vencido", valorPresente: 50000, valorPdd: 40000, dataVencimento: "2026-02-10" }),
    ];
    const v = validarCarteira(wp, estoque, "estoque.csv")!;
    expect(v.pl).toBe(110005);
    expect(v.somaCategorias).toBe(110005);
    expect(v.statusPl).toBe("OK");
    expect(v.estoque.map((e) => [e.carteira, e.estoque, e.status])).toEqual([[100005, 100000, "OK"], [50000, 50000, "OK"], [40000, 40000, "OK"]]);
    expect(v.amostra.filter((a) => a.quantidade).map((a) => [a.categoria, a.quantidade, a.valor])).toEqual([
      ["Direitos creditórios vincendos", 1, 60000], ["Direitos creditórios vencidos", 1, 30000],
    ]);
    expect(v.verificacao).toEqual([
      { item: "Termos de cessão (WP_Termo)", total: 2, verificados: 1, pendentes: 1 },
      { item: "Lastros (WP_Lastro)", total: 2, verificados: 2, pendentes: 0 },
    ]);
    expect(v.status).toBe("OK");
    expect(v.avisoEstoque).toBe("");

    // estoque de outra data: avisa que a diferença pode ser só da data
    const antigo = validarCarteira(wp, estoque.map((p) => ({ ...p, dataReferencia: "2026-02-27" })))!;
    expect(antigo.dataEstoque).toBe("2026-02-27");
    expect(antigo.avisoEstoque).toContain("27/02/2026 e a carteira de 31/03/2026");
  });

  it("aponta diferença acima de R$ 1 e PL que não fecha; sem estoque, diz o que falta", () => {
    const wp: Workpaper = {
      arquivo: "x", fundo: "F", cnpj: CNPJ, dataBase: "2026-03-31", linhas: [] as LinhaWP[], lastro: null,
      carteiraInforme: [
        { dataBase: "2026-03-31", descricao: "", valor: 100000, mapeamento: "Direitos creditórios vincendos" },
        { dataBase: "2026-03-31", descricao: "", valor: 90000, mapeamento: "Patrimônio líquido" },
      ],
    };
    const v = validarCarteira(wp, [recebivel({ valorPresente: 95000 })])!;
    expect(v.statusPl).toBe("VERIFICAR");
    expect(v.estoque[0]).toMatchObject({ diferenca: 5000, status: "VERIFICAR" });
    expect(v.status).toBe("VERIFICAR");
    expect(validarCarteira(wp, null)!.origemEstoque).toMatch(/sem o estoque completo/);
    expect(validarCarteira({ ...wp, carteiraInforme: [] }, null)).toBeNull();
  });

  it("vencido pela situação do estoque ou, sem ela, pelo vencimento antes da data-base", () => {
    expect(ehVencido(recebivel({ situacao: "Vencido" }), "2026-03-31")).toBe(true);
    expect(ehVencido(recebivel({ situacao: "A vencer" }), "2026-03-31")).toBe(false);
    expect(ehVencido(recebivel({ situacao: "", dataVencimento: "2026-01-01" }), "2026-03-31")).toBe(true);
  });
});
