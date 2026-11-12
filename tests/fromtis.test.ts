/** Estoque pela API SOAP do Fromtis (serviço simulado) e CSV em Latin-1. Dados fictícios. */
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lerCarteira } from "../lib/lastro/planilhas";
import { estoqueFromtis, instanciasFromtis, limparPausasFromtis, partesMultipart } from "../lib/servidor/fromtis";

const CSV = "NOME_CEDENTE;NOME_SACADO;NU_DOCUMENTO;VALOR_NOMINAL;VALOR_AQUISICAO;DATA_EMISSAO;DATA_VENCIMENTO_ORIGINAL\n"
  + "EMPRESA EXEMPLO LTDA;JOAO EXEMPLO;50001-001;1000.00;950.00;2026-05-04;2026-07-05\n";

async function respostaMultipart(): Promise<Response> {
  const zip = new JSZip();
  zip.file("Estoque_11222333000181.csv", CSV);
  const conteudo = await zip.generateAsync({ type: "uint8array" });
  const b = "uuid:fronteira-teste";
  const xml = `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><ns2:realizarDownloadResponse xmlns:ns2="http://soap.consulta.servicos.portal.fidc.fromtis.com.br/"><retornoDownloadRelatorio><idAgendamento>123</idAgendamento><nomeArquivo>Estoque.zip</nomeArquivo><arquivo><xop:Include xmlns:xop="http://www.w3.org/2004/08/xop/include" href="cid:arquivo"/></arquivo></retornoDownloadRelatorio></ns2:realizarDownloadResponse></S:Body></S:Envelope>`;
  const corpo = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Type: application/xop+xml;charset=utf-8;type="text/xml"\r\n\r\n${xml}\r\n`),
    Buffer.from(`--${b}\r\nContent-Type: application/zip\r\nContent-ID: <arquivo>\r\n\r\n`), Buffer.from(conteudo),
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  return new Response(corpo, { headers: { "content-type": `multipart/related;start="<root>";type="application/xop+xml";boundary="${b}"` } });
}

describe("Fromtis SOAP", () => {
  beforeEach(() => {
    vi.stubEnv("FROMTIS_TESTE_URL", "https://fromtis.invalid/");
    vi.stubEnv("FROMTIS_TESTE_USUARIO", "u");
    vi.stubEnv("FROMTIS_TESTE_SENHA", "s");
    limparPausasFromtis();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("monta a instância pelas variáveis FROMTIS_<ADM>_*", () => {
    expect(instanciasFromtis().find((i) => i.adm === "TESTE")).toMatchObject({ url: "https://fromtis.invalid", usuario: "u" });
  });

  it("agenda, consulta e baixa o estoque; devolve o CSV de dentro do ZIP", async () => {
    const pedidos: { url: string; headers: Record<string, string>; corpo: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      pedidos.push({ url, headers: init.headers as Record<string, string>, corpo: String(init.body) });
      if (url.endsWith("/relatorioEstoque")) {
        return new Response("<S:Envelope><S:Body><ns2:agendadorRelatorioEstoqueResponse><retornoRelatorioEstoque><idAgendamento>123</idAgendamento></retornoRelatorioEstoque></ns2:agendadorRelatorioEstoqueResponse></S:Body></S:Envelope>");
      }
      if (url.endsWith("/consultarRelatorio")) {
        return new Response("<S:Envelope><S:Body><retornoConsultaRelatorio><idAgendamento>123</idAgendamento><idMensagem>3</idMensagem><mensagem>Disponível para download</mensagem></retornoConsultaRelatorio></S:Body></S:Envelope>");
      }
      return respostaMultipart();
    }));
    const { nome, bytes } = await estoqueFromtis("TESTE", "11222333000181", "2026-06-30");
    expect(nome).toBe("Estoque_11222333000181.csv");
    expect(new TextDecoder().decode(bytes)).toBe(CSV);
    expect(pedidos.map((p) => p.url.replace("https://fromtis.invalid/servicos/soap/agendador/", ""))).toEqual(["relatorioEstoque", "consultarRelatorio", "realizarDownload"]);
    expect(pedidos[0].headers).toMatchObject({ username: "u", password: "s" });
    expect(pedidos[0].corpo).toContain("<cnpjFundo>11222333000181</cnpjFundo><dataReferencia>2026-06-30</dataReferencia><tipoArquivo>CSV</tipoArquivo>");
    expect(lerCarteira(bytes, nome)[0]).toMatchObject({ codigo: "50001-001", valorAplicado: 95000, valorNominal: 100000 });
  });

  it("erro do Fromtis (tipoRetorno ERRO) vira mensagem; login recusado não é repetido", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<retornoRelatorioEstoque><messangemRetorno><tipoRetorno>ERRO</tipoRetorno><descricaoRetorno>Fundo não encontrado</descricaoRetorno></messangemRetorno></retornoRelatorioEstoque>")));
    await expect(estoqueFromtis("TESTE", "11222333000181", "2026-06-30")).rejects.toThrow(/Fundo não encontrado/);

    // usuário sem perfil de webservice: diz o que pedir à administradora
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<r><tipoRetorno>ERRO</tipoRetorno><descricaoRetorno>Usuário não tem perfil de acesso ao webServices</descricaoRetorno></r>")));
    await expect(estoqueFromtis("TESTE", "11222333000181", "2026-06-30")).rejects.toThrow(/FROMTIS_TESTE_USUARIO entra no Fromtis, mas não tem o perfil de webservice/);

    const chamadas = vi.fn(async () => new Response("", { status: 401 }));
    vi.stubGlobal("fetch", chamadas);
    await expect(estoqueFromtis("TESTE", "11222333000181", "2026-06-30")).rejects.toThrow(/recusou o usuário e a senha/);
    await expect(estoqueFromtis("TESTE", "11222333000181", "2026-06-30")).rejects.toThrow(/nova tentativa/);
    expect(chamadas).toHaveBeenCalledTimes(1);
  });

  it("separa as partes da resposta MTOM sem estragar o binário", async () => {
    const r = await respostaMultipart();
    const partes = partesMultipart(new Uint8Array(await r.arrayBuffer()), r.headers.get("content-type")!);
    expect(partes).toHaveLength(2);
    expect(partes[1].corpo[0]).toBe(0x50); // "PK" do ZIP
  });
});

describe("CSV das administradoras em Latin-1", () => {
  it("lê os acentos de um CSV em Windows-1252", () => {
    const texto = "NOME_CEDENTE;NOME_SACADO;NU_DOCUMENTO;VALOR_NOMINAL;DATA_VENCIMENTO_ORIGINAL\nCOMÉRCIO EXEMPLO;JOÃO AÇÃO;9001;10,00;2026-07-05\n";
    const latin1 = Uint8Array.from([...texto].map((c) => c.charCodeAt(0)));
    expect(lerCarteira(latin1, "estoque.csv")[0]).toMatchObject({ emissor: "JOÃO AÇÃO", cedente: "COMÉRCIO EXEMPLO" });
  });
});
