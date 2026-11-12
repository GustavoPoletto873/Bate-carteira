/** Monday (fundo → administradora, sistema, carteira) e Sinqia (posição da carteira), com as APIs simuladas. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lerCarteira } from "../lib/lastro/planilhas";
import { fundoNoMonday, papelDoFundo } from "../lib/servidor/monday";
import { carteiraSinqia, csvDaPosicao, limparSinqia } from "../lib/servidor/sinqia";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Monday", () => {
  it("busca o fundo pelo CNPJ e devolve o item mais recente", async () => {
    vi.stubEnv("MONDAY_API_TOKEN", "t");
    const chamada = vi.fn(async (_url: string, init: RequestInit) => {
      const corpo = JSON.parse(String(init.body));
      expect(corpo.variables.valores).toEqual(["11.222.333/0001-81", "11222333000181"]);
      return Response.json({ data: { items_page_by_column_values: { items: [
        { name: "FIDC X", updated_at: "2026-01-01T00:00:00Z", group: { title: "1° TRIMESTRE" }, column_values: [{ id: "color_mky2r9sq", text: "ID" }, { id: "text_mky23n4a", text: "britech" }, { id: "text_mkxt6exv", text: "1234" }] },
        { name: "FIDC X", updated_at: "2026-06-01T00:00:00Z", group: { title: "2° TRIMESTRE" }, column_values: [{ id: "color_mky2r9sq", text: "ID" }, { id: "text_mky23n4a", text: "BRITECH" }, { id: "text_mkxt6exv", text: "45.018.961" }] },
      ] } } });
    });
    vi.stubGlobal("fetch", chamada);
    const f = await fundoNoMonday("11.222.333/0001-81");
    expect(f).toEqual({ nome: "FIDC X", adm: "ID", sistema: "BRITECH", carteira: "45018961", grupo: "2° TRIMESTRE" });
    expect((chamada.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe("t");
  });

  it("decide a fonte pela administradora e pelo sistema", () => {
    const f = (adm: string, sistema = "") => papelDoFundo({ nome: "F", adm, sistema, carteira: "", grupo: "" }).fonte;
    expect(f("ID", "BRITECH")).toBe("britech");
    expect(f("AZUMI", "SINQIA")).toBe("sinqia");
    expect(f("INTRA")).toBe("arquivo");
    expect(f("FINVEST")).toBe("arquivo");
    expect(f("PLANNER", "MAPS")).toBe("arquivo");
    expect(f("PLANNER", "AMPLIS")).toBe("arquivo");
    expect(f("QI TECH")).toBe("fora");
    expect(f("BLUEWAVE")).toBe("fora");
  });
});

const POSICAO = {
  metadata: { type: 1 },
  data: [{
    carteira: { code: 11222333, name: "FIDC X" },
    rendaFixa: { valorBruto: 3000, mercados: [{ nome: "Títulos Privados", papeis: [
      { nome: "CCB EMPRESA ALFA", emissor: "EMPRESA ALFA LTDA", valorBruto: 1000.5, valorLiquido: 990.25, quantidade: 1, vencimento: "2027-01-10", tipo: "CCB" },
      { nome: "NC BETA 1E", emissor: "", valorBruto: 2000, valorLiquido: 2000, quantidade: 2, vencimento: "2028-02-10" },
    ] }] },
  }],
};

describe("Sinqia", () => {
  beforeEach(() => {
    vi.stubEnv("SINQIA_TESTE_URL", "https://sinqia.invalid/");
    vi.stubEnv("SINQIA_TESTE_TOKEN_URL", "https://kc.invalid/realms/sinqia/protocol/openid-connect/token");
    vi.stubEnv("SINQIA_TESTE_USUARIO", "u");
    vi.stubEnv("SINQIA_TESTE_SENHA", "s");
    limparSinqia();
  });

  it("a posição vira uma planilha que o app lê como carteira de títulos", () => {
    const [a, b] = lerCarteira(new TextEncoder().encode(csvDaPosicao(POSICAO)), "sinqia.csv");
    expect(a).toMatchObject({ tipo: "titulo", ativo: "CCB EMPRESA ALFA", emissor: "EMPRESA ALFA LTDA", valorAplicado: 100050, valorPresente: 99025, dataVencimento: "2027-01-10" });
    expect(b).toMatchObject({ ativo: "NC BETA 1E", emissor: "NC BETA 1E" }); // sem emissor: usa o nome do papel
  });

  it("faz login no Keycloak e busca a posição; login recusado não é repetido", async () => {
    const pedidos: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      pedidos.push(url);
      if (url.includes("/token")) {
        expect(String(init.body)).toContain("grant_type=password");
        expect(String(init.body)).toContain("client_id=sqfaas");
        return Response.json({ access_token: "abc", expires_in: 300 });
      }
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer abc");
      return Response.json(POSICAO);
    }));
    const r = await carteiraSinqia("TESTE", "11.222.333", "2026-06-30");
    expect(r.titulos).toBe(2);
    expect(pedidos[1]).toBe("https://sinqia.invalid/api/v1/carteiras/11222333/relatorios/posicao/carteirac?data=2026-06-30");

    limparSinqia();
    const recusa = vi.fn(async () => new Response("", { status: 401 }));
    vi.stubGlobal("fetch", recusa);
    await expect(carteiraSinqia("TESTE", "1", "2026-06-30")).rejects.toThrow(/recusou o usuário e a senha/);
    await expect(carteiraSinqia("TESTE", "1", "2026-06-30")).rejects.toThrow(/nova tentativa/);
    expect(recusa).toHaveBeenCalledTimes(1);
  });
});
