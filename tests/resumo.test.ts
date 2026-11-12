/** Resumo da tela: uma linha curta por campo com problema e os títulos que precisam de atenção primeiro. */
import { describe, expect, it } from "vitest";
import type { Campo, ChaveCampo, LinhaResultado, Situacao } from "../lib/lastro/conciliacao";
import { aguardaAprovacao, aplicarAprovacoes, pontosDaLinha, resumirParaTela } from "../lib/lastro/resumo";

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

describe("pontos de atenção de um título", () => {
  it("uma linha curta por campo (carteira × documentos ou WP_Termo), a mais grave primeiro; o porquê fica na nota", () => {
    const l = linha("Divergente", {
      emissao: { status: "Verificar", britech: "02/01/2026", documentos: "02/01/2026", nota: "a data aparece no documento, mas sem o rótulo de data de emissão" },
      vencimento: { status: "Confere", britech: "10/11/2027", wp: "10/10/2027", wpStatus: "Diverge" },
      valor: { status: "Diverge", britech: "1.000,00", documentos: "990,00" },
    }, { noWp: true, wpLinha: 12 });
    expect(pontosDaLinha(l)).toEqual([
      { campo: "VL Aplic.", carteira: "1.000,00", outro: "990,00", lado: "documentos", tipo: "diverge", semValor: "não está nos documentos", nota: "" },
      { campo: "Dt. Vencimento", carteira: "10/11/2027", outro: "10/10/2027", lado: "WP_Termo", tipo: "diverge", semValor: "em branco", nota: "" },
      {
        campo: "Dt. Emissão", carteira: "02/01/2026", outro: "", lado: "documentos", tipo: "conferir", semValor: "confirmar no documento",
        nota: "a data aparece no documento, mas sem o rótulo de data de emissão",
      },
    ]);
  });

  it("mostra só os valores diferentes do da carteira, no máximo dois", () => {
    const l = linha("Verificar", {
      vencimento: { status: "Verificar", britech: "09/01/2029", documentos: "09/01/2029 | 16/04/2029 | 10/03/2029 | 11/05/2029", nota: "documentos não concordam entre si" },
      emissao: { status: "Não localizado", britech: "09/01/2026" },
      emissor: { status: "Provável", britech: "ALFA LTDA", documentos: "ALFA LTDA", nota: "provável: aparece em outro campo" },
    });
    expect(pontosDaLinha(l).map((p) => [p.campo, p.outro, p.semValor, p.tipo])).toEqual([
      ["Dt. Emissão", "", "não achado", "conferir"],
      ["Dt. Vencimento", "16/04/2029 | 10/03/2029 +1", "confirmar no documento", "conferir"],
      ["Emissor", "", "confere por aproximação", "aproximado"],
    ]);
  });

  it("título só na WP_Termo vira uma linha só", () => {
    const l = linha("Só no WP", { valor: { status: "—", wp: "5.000,00", wpStatus: "Diverge" } }, { noWp: true, wpLinha: 30 });
    expect(pontosDaLinha(l)).toEqual([
      { campo: "Carteira", carteira: "não está na carteira", outro: "linha 30 · VL 5.000,00", lado: "WP_Termo", tipo: "diverge", semValor: "", nota: "" },
    ]);
  });

  it("OK e sem documentos não geram ponto", () => {
    expect(pontosDaLinha(linha("OK"))).toEqual([]);
    expect(pontosDaLinha(linha("Sem documentos", { valor: { status: "Não localizado" } }))).toEqual([]);
  });
});

describe("resumo da tela", () => {
  it("três blocos: atenção (divergentes primeiro), validados e pendentes", () => {
    const linhas = [
      linha("OK"), linha("Verificar", { valor: { status: "Verificar" } }), linha("Sem documentos"),
      linha("Divergente", { valor: { status: "Diverge" } }), linha("Sem documentos"),
    ];
    const r = resumirParaTela(linhas);
    expect(r.titulo).toBe("2 de 5 títulos precisam de atenção");
    expect(r.atencao.map((l) => l.situacao)).toEqual(["Divergente", "Verificar"]);
    expect(r.pendentes).toHaveLength(2);
    expect(r.validados).toHaveLength(1);
    expect(r.aprovar).toHaveLength(0);
  });

  it("valor e emissão batendo: validado visualmente, aguardando a aprovação do analista", () => {
    const quase = linha("Verificar", { valor: { status: "Confere" }, emissao: { status: "Provável" }, vencimento: { status: "Verificar" } });
    const diverge = linha("Divergente", { valor: { status: "Diverge" }, emissao: { status: "Confere" } });
    const r = resumirParaTela([quase, diverge, linha("OK")]);
    expect(r.aprovar.map((l) => l.id)).toEqual([quase.id]);
    expect(r.atencao.map((l) => l.id)).toEqual([diverge.id]);
    expect(aguardaAprovacao(quase)).toBe(true);

    const aprovado = aplicarAprovacoes([quase, diverge], new Set([quase.id]));
    expect(aprovado[0]).toMatchObject({ situacao: "OK", aprovado: true });
    const depois = resumirParaTela(aprovado);
    expect(depois.validados.map((l) => l.id)).toEqual([quase.id]);
    expect(depois.aprovar).toHaveLength(0);
  });

  it("diz quando nada diverge, quando falta aprovar e quando nada foi achado", () => {
    expect(resumirParaTela([linha("OK"), linha("Sem documentos")]).titulo).toBe("Nada diverge");
    expect(resumirParaTela([linha("Verificar", { valor: { status: "Confere" }, emissao: { status: "Confere" } })]).titulo).toBe("1 título aguarda sua aprovação");
    expect(resumirParaTela([linha("Sem documentos")]).titulo).toBe("Nenhum título foi achado nos documentos da pasta");
  });
});
