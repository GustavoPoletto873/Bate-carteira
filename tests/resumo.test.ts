/** Resumo da tela: uma linha por problema e os títulos que precisam de atenção primeiro. */
import { describe, expect, it } from "vitest";
import type { Campo, ChaveCampo, LinhaResultado, Situacao } from "../lib/lastro/conciliacao";
import { pendenciasDaLinha, resumirParaTela } from "../lib/lastro/resumo";

const campo = (p: Partial<Campo> = {}): Campo => ({
  status: "Confere", britech: "", documentos: "", fontes: [], nota: "", wp: "", wpStatus: "—", ...p,
});

let id = 0;
function linha(situacao: Situacao, campos: Partial<Record<ChaveCampo, Partial<Campo>>> = {}, extra: Partial<LinhaResultado> = {}): LinhaResultado {
  return {
    id: ++id, ativo: `CCB ${id}`, emissor: "EMISSOR X", cedente: "", codigo: "", valorAplicado: "", dataAquisicao: "", noWp: false, wpLinha: null,
    situacao, docsDiretos: 0, docsMesmaOperacao: 0, evidencias: [], comparacoes: [],
    campos: {
      valor: campo(campos.valor), emissao: campo(campos.emissao), vencimento: campo(campos.vencimento), emissor: campo(campos.emissor),
    },
    ...extra,
  };
}

describe("pendências de um título", () => {
  it("explica a divergência com a WP_Termo e com os documentos, a mais grave primeiro", () => {
    const l = linha("Divergente", {
      emissao: { status: "Verificar", nota: "a data aparece no documento, mas sem o rótulo de data de emissão" },
      vencimento: { status: "Confere", britech: "10/11/2027", wp: "10/10/2027", wpStatus: "Diverge" },
      valor: { status: "Diverge", britech: "1.000,00", documentos: "990,00" },
    }, { noWp: true, wpLinha: 12 });
    expect(pendenciasDaLinha(l)).toEqual([
      { campo: "VL Aplic.", texto: "Britech 1.000,00 × documentos 990,00", grave: true },
      { campo: "Dt. Vencimento", texto: "Britech 10/11/2027 × WP_Termo 10/10/2027", grave: true },
      { campo: "Dt. Emissão", texto: "a data aparece no documento, mas sem o rótulo de data de emissão", grave: false },
    ]);
  });

  it("título só na WP_Termo vira uma linha só", () => {
    const l = linha("Só no WP", { valor: { status: "—", wp: "5.000,00", wpStatus: "Diverge" } }, { noWp: true, wpLinha: 30 });
    expect(pendenciasDaLinha(l)).toEqual([
      { campo: "Carteira", texto: "está na WP_Termo (linha 30, VL 5.000,00) mas não na carteira Britech", grave: true },
    ]);
  });

  it("OK e sem documentos não geram pendência", () => {
    expect(pendenciasDaLinha(linha("OK"))).toEqual([]);
    expect(pendenciasDaLinha(linha("Sem documentos", { valor: { status: "Não localizado" } }))).toEqual([]);
  });
});

describe("resumo da tela", () => {
  it("separa o que precisa de atenção (divergentes primeiro) do resto", () => {
    const linhas = [linha("OK"), linha("Verificar"), linha("Sem documentos"), linha("Divergente"), linha("Sem documentos")];
    const r = resumirParaTela(linhas);
    expect(r.titulo).toBe("2 de 5 títulos precisam de atenção");
    expect(r.atencao.map((l) => l.situacao)).toEqual(["Divergente", "Verificar"]);
    expect(r.semDocumentos).toHaveLength(2);
    expect(r.ok).toHaveLength(1);
    expect(r.partes).toEqual([
      { situacao: "Divergente", n: 1 }, { situacao: "Verificar", n: 1 }, { situacao: "Sem documentos", n: 2 }, { situacao: "OK", n: 1 },
    ]);
  });

  it("diz quando nada diverge e quando nada foi achado", () => {
    expect(resumirParaTela([linha("OK"), linha("Sem documentos")]).titulo).toBe("Nada diverge");
    expect(resumirParaTela([linha("Sem documentos")]).titulo).toBe("Nenhum título foi achado nos documentos da pasta");
  });
});
