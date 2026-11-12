/** Detalhe do título por campo: onde o valor da carteira aparece, os outros valores e o porquê. Dados fictícios. */
import { describe, expect, it } from "vitest";
import type { Comparacao } from "../lib/lastro/comparacao";
import type { Campo, ChaveCampo, LinhaResultado } from "../lib/lastro/conciliacao";
import { detalhesPorCampo, documentosDoTitulo } from "../lib/lastro/detalhe";

const CAMPOS: [ChaveCampo, string][] = [["valor", "VL Aplic."], ["emissao", "Dt. Emissão"], ["vencimento", "Dt. Vencimento"], ["emissor", "Emissor"]];
const campo = (p: Partial<Campo>): Campo => ({ status: "Confere", britech: "", documentos: "", fontes: [], nota: "", wp: "", wpStatus: "—", ...p });
const comp = (p: Partial<Comparacao> & Pick<Comparacao, "campo" | "relacao">): Comparacao => ({
  tipo: p.campo === "valor" ? "valor" : "data", detalhe: "", distancia: 0,
  carteira: { origem: "carteira", coluna: "DATA EMISSÃO", valor: "10/03/2026" },
  documento: { arquivo: "nc_5816.pdf", pagina: 4, rotulo: "na data de emissao", valor: "10/03/2026", trecho: "…na data de emissão (10/03/2026)…" },
  ...p,
});

describe("detalhe por campo", () => {
  const l: LinhaResultado = {
    id: 1, ativo: "NC ALFA", emissor: "ALFA SA", cedente: "", codigo: "", valorAplicado: "", dataAquisicao: "", noWp: true, wpLinha: 4,
    situacao: "Verificar", docsDiretos: 2, docsMesmaOperacao: 0, comparacoes: [
      comp({ campo: "emissao", relacao: "sem rótulo", documento: { arquivo: "nc_5816.pdf", pagina: 1, rotulo: "", valor: "10/03/2026", trecho: "Datado de 10 de março" } }),
      comp({ campo: "emissao", relacao: "igual" }),
      comp({ campo: "valor", relacao: "campo diferente", carteira: { origem: "carteira", coluna: "VALOR APLICAÇÃO", valor: "1.000.000,00" },
        documento: { arquivo: "nc_5816.pdf", pagina: 15, rotulo: "valor unitario de", valor: "1.000.000,00", trecho: "" } }),
      comp({ campo: "aquisicao", relacao: "igual", carteira: { origem: "carteira", coluna: "DATA OPERAÇÃO", valor: "10/03/2026" },
        documento: { arquivo: "nc_5816.pdf", pagina: 13, rotulo: "data", valor: "10/03/2026", trecho: "" } }),
    ],
    evidencias: [
      { campo: "emissao", valor: "28/05/2026", confere: false, documento: "nc_6931.pdf", trecho: "", nivel: "mesma operação" },
      { campo: "emissao", valor: "28/05/2026", confere: false, documento: "nc_6932.pdf", trecho: "", nivel: "mesma operação" },
      { campo: "emissao", valor: "10/03/2026", confere: true, documento: "nc_5816.pdf", trecho: "", nivel: "direto" },
      { campo: "emissor", valor: "ALFA SA", confere: true, documento: "nc_5816.pdf", trecho: "Emissora: ALFA SA", nivel: "direto" },
    ],
    campos: {
      valor: campo({ status: "Provável", britech: "1.000.000,00", documentos: "1.000.000,00", nota: "provável: …" }),
      emissao: campo({ status: "Verificar", britech: "10/03/2026", documentos: "10/03/2026 | 28/05/2026 | 11/05/2026", nota: "documentos não concordam entre si; também aparece: …" }),
      vencimento: campo({ status: "Diverge", britech: "10/07/2028", documentos: "28/05/2029", wp: "10/07/2028", wpStatus: "Confere" }),
      emissor: campo({ status: "Confere", britech: "ALFA SA", documentos: "ALFA SA" }),
    },
  };

  it("um campo por linha: a melhor evidência, os outros valores e o porquê curto", () => {
    const d = detalhesPorCampo(l, CAMPOS);
    expect(d.map((x) => x.rotulo)).toEqual(["VL Aplic.", "Dt. Emissão", "Dt. Vencimento", "Emissor", "Dt. Aquisição"]);
    const [valor, emissao, venc, emissor, aquisicao] = d;
    expect(valor).toMatchObject({ porque: 'aparece no documento como "valor unitario de"', coluna: "VALOR APLICAÇÃO", achado: { pagina: 15 } });
    expect(emissao.achado).toMatchObject({ arquivo: "nc_5816.pdf", pagina: 4, relacao: "igual" }); // o "igual" vence o "sem rótulo"
    expect(emissao.outros).toEqual([{ valor: "28/05/2026", docs: 2 }, { valor: "11/05/2026", docs: 1 }]);
    expect(emissao.porque).toBe("os documentos não concordam entre si");
    expect(venc).toMatchObject({ achado: null, porque: "o documento traz outro valor", outros: [{ valor: "28/05/2029", docs: 1 }], wp: null });
    expect(emissor.achado).toMatchObject({ arquivo: "nc_5816.pdf", relacao: "citado" });
    expect(aquisicao).toMatchObject({ status: null, carteira: "10/03/2026", porque: "confere com o documento" });
  });

  it("documentos ligados, sem repetir, o nível mais forte primeiro", () => {
    expect(documentosDoTitulo(l)).toEqual([
      { arquivo: "nc_5816.pdf", nivel: "direto" }, { arquivo: "nc_6931.pdf", nivel: "mesma operação" }, { arquivo: "nc_6932.pdf", nivel: "mesma operação" },
    ]);
  });
});
