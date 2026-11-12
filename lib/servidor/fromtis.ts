/**
 * Estoque de direitos creditórios pela API SOAP do Fromtis (o mesmo serviço que o hub usa em
 * "Extrair relatórios DC Fromtis"): agenda o relatório de estoque do CNPJ na data-base, espera ficar pronto e baixa o
 * ZIP com o CSV (colunas NU_DOCUMENTO, NOME_SACADO, VALOR_NOMINAL, VALOR_AQUISICAO…, o mesmo layout do Estoque_Agrupado).
 *
 * Cada administradora: FROMTIS_<ADM>_URL (ex.: https://sistemaNN.<administradora>.com.br), FROMTIS_<ADM>_USUARIO e
 * FROMTIS_<ADM>_SENHA — usuário e senha vão nos cabeçalhos HTTP "username"/"password", como no hub.
 */
import JSZip from "jszip";

export class ErroFromtis extends Error {}

export interface InstanciaFromtis { adm: string; nome: string; url: string; usuario: string; senha: string }

const NOMES: Record<string, string> = { AZUMI: "Azumi", FINVEST: "Finvest", LIMINE: "Limine", FIDD: "FIDD" };
const NS = "http://soap.consulta.servicos.portal.fidc.fromtis.com.br/";
const CAMINHO = "/servicos/soap/agendador";

export function instanciasFromtis(): InstanciaFromtis[] {
  const lista: InstanciaFromtis[] = [];
  for (const chave of Object.keys(process.env).sort()) {
    const adm = chave.match(/^FROMTIS_([A-Z0-9]+)_USUARIO$/)?.[1];
    if (!adm) continue;
    const url = (process.env[`FROMTIS_${adm}_URL`] ?? "").trim().replace(/\/+$/, "");
    const usuario = process.env[chave] ?? "";
    const senha = process.env[`FROMTIS_${adm}_SENHA`] ?? "";
    if (url && usuario && senha) lista.push({ adm, nome: NOMES[adm] ?? adm, url, usuario, senha });
  }
  return lista;
}

function instancia(adm: string): InstanciaFromtis {
  const alvo = adm.toUpperCase();
  const achada = instanciasFromtis().find((i) => i.adm === alvo);
  if (!achada) throw new ErroFromtis(`Não há acesso ao Fromtis da administradora ${alvo}: defina FROMTIS_${alvo}_URL, _USUARIO e _SENHA (.env.local).`);
  return achada;
}

// login recusado pausa a administradora por 15 min (repetir pode bloquear o usuário que a equipe usa)
const PAUSA_MS = 15 * 60 * 1000;
const pausadas = new Map<string, { ate: number; erro: string }>();
export const limparPausasFromtis = () => pausadas.clear();

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tag = (xml: string, nome: string) => xml.match(new RegExp(`<(?:\\w+:)?${nome}>([\\s\\S]*?)</(?:\\w+:)?${nome}>`))?.[1]?.trim() ?? "";

function envelope(operacao: string, corpo: string): string {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="${NS}">`
    + `<soapenv:Header/><soapenv:Body><soap:${operacao}>${corpo}</soap:${operacao}></soapenv:Body></soapenv:Envelope>`;
}

/** POST de um envelope SOAP (com nova tentativa no HTTP 429, limite de requisições). */
async function soap(inst: InstanciaFromtis, servico: string, xml: string, multipart = false): Promise<Response> {
  const pausa = pausadas.get(inst.adm);
  if (pausa && Date.now() < pausa.ate) throw new ErroFromtis(`${pausa.erro} (nova tentativa em até 15 min ou ao reiniciar o app)`);
  const fronteira = "----=_Parte_lastro_fromtis";
  const corpo = multipart
    ? `--${fronteira}\r\nContent-Type: application/xop+xml; charset=UTF-8; type="text/xml"\r\nContent-Transfer-Encoding: 8bit\r\nContent-ID: <rootpart@lastro>\r\n\r\n${xml}\r\n--${fronteira}--\r\n`
    : xml;
  const headers: Record<string, string> = {
    username: inst.usuario, password: inst.senha, SOAPAction: '""',
    "Content-Type": multipart
      ? `multipart/related; type="application/xop+xml"; start="<rootpart@lastro>"; start-info="text/xml"; boundary="${fronteira}"`
      : "text/xml; charset=utf-8",
  };
  for (let tentativa = 0; ; tentativa++) {
    let r: Response;
    try {
      r = await fetch(`${inst.url}${CAMINHO}/${servico}`, { method: "POST", headers, body: corpo, signal: AbortSignal.timeout(60_000), cache: "no-store" });
    } catch (e) {
      throw new ErroFromtis(`Não consegui falar com o Fromtis da ${inst.nome} (${new URL(inst.url).host}): ${(e as Error)?.message ?? e}`);
    }
    if (r.status === 429 && tentativa < 3) {
      await espera(2000 * 2 ** tentativa);
      continue;
    }
    if (r.status === 401 || r.status === 403) {
      const erro = `O Fromtis da ${inst.nome} recusou o usuário e a senha (HTTP ${r.status}). Confira FROMTIS_${inst.adm}_USUARIO e _SENHA`;
      pausadas.set(inst.adm, { ate: Date.now() + PAUSA_MS, erro });
      throw new ErroFromtis(erro);
    }
    if (!r.ok && r.status !== 500) throw new ErroFromtis(`O Fromtis da ${inst.nome} respondeu HTTP ${r.status}.`);
    return r;
  }
}

/** Erro de negócio do Fromtis (tipoRetorno=ERRO, SOAP Fault). */
function erroNoRetorno(xml: string): string {
  const fault = tag(xml, "faultstring");
  if (fault) return fault;
  if (/<(?:\w+:)?tipoRetorno>\s*ERRO/i.test(xml)) return tag(xml, "descricaoRetorno") || "erro sem descrição";
  return "";
}

/** 1. agenda o relatório de estoque (CSV) do CNPJ na data (aaaa-mm-dd); devolve o id do agendamento */
export async function agendarEstoque(inst: InstanciaFromtis, cnpj: string, data: string): Promise<string> {
  const xml = await (await soap(inst, "relatorioEstoque", envelope("agendadorRelatorioEstoque",
    `<requisicaoRelatorioEstoque><cnpjFundo>${cnpj}</cnpjFundo><dataReferencia>${data}</dataReferencia><tipoArquivo>CSV</tipoArquivo></requisicaoRelatorioEstoque>`))).text();
  const erro = erroNoRetorno(xml);
  if (erro) throw new ErroFromtis(`O Fromtis da ${inst.nome} não agendou o estoque do CNPJ ${cnpj} em ${data}: ${erro}`);
  const id = tag(xml, "idAgendamento");
  if (!id) throw new ErroFromtis(`O Fromtis da ${inst.nome} não devolveu o número do agendamento.`);
  return id;
}

/** 2. situação do relatório agendado */
export async function situacaoDoRelatorio(inst: InstanciaFromtis, id: string): Promise<"pronto" | "aguardando"> {
  const xml = await (await soap(inst, "consultarRelatorio", envelope("consultarRelatorio",
    `<requisicaoConsultaRelatorio><idAgendamento>${id}</idAgendamento></requisicaoConsultaRelatorio>`))).text();
  const mensagem = tag(xml, "mensagem");
  if (tag(xml, "idMensagem") === "4") {
    throw new ErroFromtis(`O Fromtis da ${inst.nome} não gerou o relatório: ${tag(xml, "descricaoRetorno") || mensagem || "sem arquivo"}`);
  }
  const erro = erroNoRetorno(xml);
  if (erro) throw new ErroFromtis(`O Fromtis da ${inst.nome} respondeu: ${erro}`);
  return /dispon[ií]vel para download|finalizado com sucesso|conclu[ií]do/i.test(mensagem) ? "pronto" : "aguardando";
}

/** Separa as partes de uma resposta multipart/related (MTOM) em bytes. */
export function partesMultipart(bytes: Uint8Array, contentType: string): { cabecalhos: string; corpo: Uint8Array }[] {
  const fronteira = contentType.match(/boundary="?([^";]+)"?/i)?.[1];
  if (!fronteira) return [];
  const buf = Buffer.from(bytes);
  const marca = Buffer.from(`--${fronteira}`);
  const partes: { cabecalhos: string; corpo: Uint8Array }[] = [];
  let pos = buf.indexOf(marca);
  while (pos >= 0) {
    const inicio = pos + marca.length;
    if (buf.slice(inicio, inicio + 2).toString() === "--") break;
    const proximo = buf.indexOf(marca, inicio);
    if (proximo < 0) break;
    const parte = buf.slice(inicio, proximo);
    const fimCab = parte.indexOf("\r\n\r\n");
    if (fimCab >= 0) {
      let corpo = parte.slice(fimCab + 4);
      if (corpo.slice(-2).toString() === "\r\n") corpo = corpo.slice(0, -2);
      partes.push({ cabecalhos: parte.slice(0, fimCab).toString("latin1"), corpo: new Uint8Array(corpo) });
    }
    pos = proximo;
  }
  return partes;
}

/** 3. baixa o ZIP do relatório (MTOM ou base64 no XML) */
export async function baixarRelatorio(inst: InstanciaFromtis, id: string): Promise<{ nome: string; zip: Uint8Array }> {
  const r = await soap(inst, "realizarDownload", envelope("realizarDownload",
    `<requisicaoDownloadRelatorio><idAgendamento>${id}</idAgendamento></requisicaoDownloadRelatorio>`), true);
  const tipo = r.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (/multipart/i.test(tipo)) {
    const partes = partesMultipart(bytes, tipo);
    const xml = partes.find((p) => /xop\+xml|text\/xml/i.test(p.cabecalhos));
    const textoXml = xml ? Buffer.from(xml.corpo).toString("utf8") : "";
    const erro = erroNoRetorno(textoXml);
    if (erro) throw new ErroFromtis(`O Fromtis da ${inst.nome} não entregou o relatório: ${erro}`);
    const arquivo = partes.find((p) => p !== xml);
    if (!arquivo) throw new ErroFromtis(`O Fromtis da ${inst.nome} respondeu sem o arquivo do relatório.`);
    return { nome: tag(textoXml, "nomeArquivo") || `estoque_${id}.zip`, zip: arquivo.corpo };
  }
  const xml = Buffer.from(bytes).toString("utf8");
  const erro = erroNoRetorno(xml);
  if (erro) throw new ErroFromtis(`O Fromtis da ${inst.nome} não entregou o relatório: ${erro}`);
  const b64 = tag(xml, "arquivo").replace(/\s+/g, "");
  if (!b64) throw new ErroFromtis(`O Fromtis da ${inst.nome} respondeu sem o arquivo do relatório.`);
  return { nome: tag(xml, "nomeArquivo") || `estoque_${id}.zip`, zip: new Uint8Array(Buffer.from(b64, "base64")) };
}

/** Primeiro CSV (ou planilha) de dentro do ZIP; se não for ZIP, devolve como veio. */
export async function arquivoDoZip(nome: string, bytes: Uint8Array): Promise<{ nome: string; bytes: Uint8Array }> {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return { nome: nome.replace(/\.zip$/i, ".csv"), bytes };
  const zip = await JSZip.loadAsync(bytes);
  const entrada = Object.values(zip.files).find((f) => !f.dir && /\.(csv|txt|xlsx?)$/i.test(f.name));
  if (!entrada) throw new ErroFromtis("O ZIP do Fromtis não tem CSV dentro.");
  return { nome: entrada.name.split("/").pop() ?? entrada.name, bytes: await entrada.async("uint8array") };
}

/** Estoque do fundo na data, pronto para a conferência (CSV). Espera até ~90 s pelo relatório. */
export async function estoqueFromtis(adm: string, cnpj: string, data: string, esperaMaxMs = 90_000): Promise<{ nome: string; bytes: Uint8Array }> {
  if (!/^\d{14}$/.test(cnpj)) throw new ErroFromtis("Informe o CNPJ do fundo com 14 dígitos.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new ErroFromtis("Informe a data-base no formato aaaa-mm-dd.");
  const inst = instancia(adm);
  const id = await agendarEstoque(inst, cnpj, data);
  const limite = Date.now() + esperaMaxMs;
  for (let intervalo = 1500; ; intervalo = Math.min(intervalo * 1.5, 6000)) {
    if ((await situacaoDoRelatorio(inst, id)) === "pronto") break;
    if (Date.now() + intervalo > limite) {
      throw new ErroFromtis(`O Fromtis da ${inst.nome} ainda está gerando o estoque (agendamento ${id}). Tente de novo em alguns minutos.`);
    }
    await espera(intervalo);
  }
  const { nome, zip } = await baixarRelatorio(inst, id);
  return arquivoDoZip(nome, zip);
}
