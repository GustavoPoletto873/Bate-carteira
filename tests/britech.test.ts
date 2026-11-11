/** Britech de várias administradoras: escolha pela variável de ambiente e pausa depois de login recusado. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { carteirasPorCnpj, limparPausas } from "../lib/servidor/britech";
import { instanciasBritech } from "../lib/servidor/config";

describe("Britech por administradora", () => {
  beforeEach(() => {
    vi.stubEnv("BRITECH_TESTE_URL", "https://teste.invalid/WS/api/");
    vi.stubEnv("BRITECH_TESTE_USUARIO", "u");
    vi.stubEnv("BRITECH_TESTE_SENHA", "s");
    limparPausas();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("monta a instância a partir de BRITECH_<ADM>_*", () => {
    expect(instanciasBritech().find((i) => i.adm === "TESTE")).toMatchObject({ url: "https://teste.invalid/WS/api", nome: "TESTE" });
  });

  it("devolve as carteiras com a administradora", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ ClientesCarteira: [{ Cliente: { IdCliente: 77, Nome: "FUNDO X - CLASSE" } }] }])));
    const r = await carteirasPorCnpj("11222333000181", "TESTE");
    expect(r.carteiras).toEqual([{ id: "77", nome: "FUNDO X - CLASSE", adm: "TESTE", admNome: "TESTE" }]);
  });

  it("não repete o login recusado (evita bloquear o usuário)", async () => {
    const chamadas = vi.fn(async () => new Response("", { status: 401 }));
    vi.stubGlobal("fetch", chamadas);
    await expect(carteirasPorCnpj("11222333000181", "TESTE")).rejects.toThrow(/recusou o usuário e a senha/);
    await expect(carteirasPorCnpj("11222333000181", "TESTE")).rejects.toThrow(/nova tentativa/);
    expect(chamadas).toHaveBeenCalledTimes(1);
  });
});
