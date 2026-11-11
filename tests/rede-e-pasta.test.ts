/** Restrição por rede (proxy) e leitura da pasta do trimestre pelo navegador (handles simulados). */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../proxy";
import { administradorasNaPasta, conferirPastaBase, criarProvedorPasta } from "../lib/lastro/drive-pasta";
import type { HandleArquivo, HandlePasta } from "../lib/lastro/fontes";
import { ipNaLista, listaDeIps } from "../lib/servidor/rede";

describe("restrição por rede", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("aceita IP exato, faixa CIDR e IPv4 escrito como IPv6", () => {
    const lista = listaDeIps("203.0.113.10, 198.51.100.0/24; 2001:db8::1");
    expect(ipNaLista("203.0.113.10", lista)).toBe(true);
    expect(ipNaLista("198.51.100.77", lista)).toBe(true);
    expect(ipNaLista("::ffff:203.0.113.10", lista)).toBe(true);
    expect(ipNaLista("2001:DB8::1", lista)).toBe(true);
    expect(ipNaLista("203.0.113.11", lista)).toBe(false);
    expect(ipNaLista("198.51.101.1", lista)).toBe(false);
    expect(ipNaLista("", lista)).toBe(false);
  });

  const pedido = (ip: string) => new NextRequest("https://lastro.exemplo.app/", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });

  it("na Vercel, com a lista configurada, bloqueia quem está fora e libera o escritório", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("LASTRO_IPS_PERMITIDOS", "203.0.113.10");
    const fora = proxy(pedido("198.51.100.5"));
    expect(fora.status).toBe(403);
    expect(await fora.text()).toContain("198.51.100.5");
    expect(proxy(pedido("203.0.113.10")).headers.get("x-middleware-next")).toBe("1");
  });

  it("sem a lista, ou fora da Vercel, não restringe", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("LASTRO_IPS_PERMITIDOS", "");
    expect(proxy(pedido("198.51.100.5")).status).toBe(200);
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("LASTRO_IPS_PERMITIDOS", "203.0.113.10");
    expect(proxy(pedido("198.51.100.5")).status).toBe(200);
  });
});

// ------------------------------------------------------------------ pasta do trimestre (handles simulados)

type Arvore = { [nome: string]: Arvore | string };

function pasta(name: string, arvore: Arvore): HandlePasta {
  const filhos = Object.entries(arvore).map(([n, v]): HandleArquivo | HandlePasta =>
    typeof v === "string"
      ? { kind: "file", name: n, getFile: async () => new File([v], n, { lastModified: Date.UTC(2026, 9, 5) }) }
      : pasta(n, v));
  return {
    kind: "directory", name,
    async *entries() {
      for (const f of filhos) yield [f.name, f] as [string, HandleArquivo | HandlePasta];
    },
    getDirectoryHandle: async (n: string) => {
      const h = filhos.find((f) => f.kind === "directory" && f.name === n);
      if (!h) throw new Error("NotFoundError");
      return h as HandlePasta;
    },
  };
}

const PLANNER = pasta("PLANNER", {
  _Workpapers: {
    "WP_FUNDO ALFA_11222333000181.xlsm": "wp-raiz",
    WPS: { "WP_FUNDO ALFA_11222333000181.xlsm": "wp-wps", "anotacoes.txt": "x" },
  },
  "Lastro e Termo": {
    "FUNDO ALFA": { "BS.pdf": "%PDF-bs", sub: { "termo.txt": "termo" } },
    "OUTRO FUNDO": {},
  },
  _Carteiras: { FORMATADA: { "30.06.2026": { "999_11222333000181_30.06.2026_BRITECH.xlsx": "carteira" } } },
});

const texto = (b: Uint8Array) => new TextDecoder().decode(b);

describe("pasta do trimestre lida pelo navegador", () => {
  const drive = criarProvedorPasta(PLANNER);

  it("lista os workpapers e abre o arquivo", async () => {
    const fundos = await drive.fundos("");
    expect(fundos.map((f) => [f.fundo, f.pasta, f.caminho])).toEqual([
      ["FUNDO ALFA", "_Workpapers", "pasta:_Workpapers/WP_FUNDO ALFA_11222333000181.xlsm"],
      ["FUNDO ALFA", "_Workpapers/WPS", "pasta:_Workpapers/WPS/WP_FUNDO ALFA_11222333000181.xlsm"],
    ]);
    expect(fundos[0].modificado).toBe("2026-10-05T00:00:00.000Z");
    expect(texto(await drive.arquivo(fundos[1].caminho))).toBe("wp-wps");
  });

  it("sugere a pasta de lastro e lista os arquivos com subpastas", async () => {
    const pastas = await drive.pastasLastro("", "FUNDO ALFA FIDC", "");
    expect(pastas[0]).toMatchObject({ nome: "FUNDO ALFA", caminho: "pasta:Lastro e Termo/FUNDO ALFA", pontos: 1 });
    const arquivos = await drive.listar(pastas[0].caminho);
    expect(arquivos.map((a) => a.caminho)).toEqual(["BS.pdf", "sub/termo.txt"]);
    expect(texto(await arquivos[1].ler())).toBe("termo");
  });

  it("acha a carteira em _Carteiras/FORMATADA/<data>", async () => {
    const c = await drive.carteiraFormatada("", "11222333000181", "2026-06-30");
    expect(c).toMatchObject({ arquivo: "999_11222333000181_30.06.2026_BRITECH.xlsx", idCarteira: "999" });
    expect(texto(await drive.arquivo(c!.caminho))).toBe("carteira");
  });

  it("avisa quando a pasta escolhida não é a do trimestre", async () => {
    expect(await conferirPastaBase(PLANNER)).toBeNull();
    const errada = pasta("Downloads", { "foto.png": "x" });
    expect(await conferirPastaBase(errada)).toContain("Escolha a pasta do trimestre");
    await expect(criarProvedorPasta(errada).fundos("")).rejects.toThrow(/Não achei "_Workpapers"/);
  });
});

describe("pasta do trimestre com várias administradoras", () => {
  const TRIMESTRE = pasta("2T2026", {
    PLANNER: { _Workpapers: { "WP_FUNDO ALFA_11222333000181.xlsm": "wp-planner" }, "Lastro e Termo": { "FUNDO ALFA": {} } },
    // outras administradoras usam "_workpapers" (minúsculo) e "_Lastro e Termo"
    ID: {
      _workpapers: { "WP_FUNDO BETA_44555666000172.xlsm": "wp-id" },
      "_Lastro e Termo": { "FUNDO BETA": { "termo.pdf": "%PDF-id" } },
    },
    ATIVA: {},
    "anotacoes.txt": "x",
  });
  const drive = criarProvedorPasta(TRIMESTRE);

  it("lista só as pastas que têm _Workpapers", async () => {
    expect(await administradorasNaPasta(TRIMESTRE)).toEqual([{ nome: "ID", base: "ID" }, { nome: "PLANNER", base: "PLANNER" }]);
    expect(await administradorasNaPasta(PLANNER)).toEqual([{ nome: "PLANNER", base: "" }]);
    expect(await conferirPastaBase(TRIMESTRE)).toBeNull();
  });

  it("lê os fundos e a pasta _Lastro e Termo da administradora escolhida", async () => {
    const fundos = await drive.fundos("ID");
    expect(fundos.map((f) => [f.fundo, f.caminho])).toEqual([["FUNDO BETA", "pasta:ID/_Workpapers/WP_FUNDO BETA_44555666000172.xlsm"]]);
    expect(texto(await drive.arquivo(fundos[0].caminho))).toBe("wp-id");
    const pastas = await drive.pastasLastro("ID", "FUNDO BETA FIDC", "44555666000172");
    expect(pastas[0]).toMatchObject({ nome: "FUNDO BETA", caminho: "pasta:ID/_Lastro e Termo/FUNDO BETA" });
    expect((await drive.listar(pastas[0].caminho)).map((a) => a.caminho)).toEqual(["termo.pdf"]);
  });

  it("a pasta vazia de uma administradora não quebra a busca", async () => {
    await expect(drive.fundos("ATIVA")).rejects.toThrow(/Não achei "_Workpapers" em "ATIVA"/);
  });
});
