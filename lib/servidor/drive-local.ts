/**
 * Leitura do Google Drive montado no computador (G:). Só funciona onde o app roda com acesso ao G:
 * (npm run dev / npm start no seu PC). Todo caminho é conferido contra DRIVE_RAIZES.
 */
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { ehCarteiraDoFundo, pastaDaData } from "../lastro/planilhas";
import { palavras } from "../lastro/textos";
import { DRIVE_BASE_PADRAO, DRIVE_RAIZES, SUBPASTAS } from "./config";

export class ErroDrive extends Error {}

const MAX_ARQUIVOS = 3000;

/** Caminho absoluto validado (dentro de uma das raízes). Levanta ErroDrive se estiver fora. */
export function resolverDentro(caminho: string): string {
  const alvo = path.resolve(String(caminho ?? "").trim().replace(/^["']|["']$/g, ""));
  const permitido = DRIVE_RAIZES.some((raiz) => {
    const rel = path.relative(path.resolve(raiz), alvo);
    return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
  });
  if (!permitido) throw new ErroDrive(`O caminho precisa estar dentro de ${DRIVE_RAIZES.join(" ou ")}.`);
  return alvo;
}

async function existePasta(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function basePara(base?: string | null): Promise<string> {
  const p = resolverDentro(base || DRIVE_BASE_PADRAO);
  if (!(await existePasta(p))) {
    throw new ErroDrive(`Pasta não encontrada: ${p}. Confira o caminho e se o Google Drive (G:) está conectado.`);
  }
  return p;
}

export async function driveDisponivel(): Promise<boolean> {
  try {
    return await existePasta(resolverDentro(DRIVE_BASE_PADRAO));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ fundos (workpapers)

export interface FundoDrive {
  fundo: string;
  cnpj: string;
  arquivo: string;
  caminho: string;
  pasta: string;
  modificado: string;
}

export async function listarFundos(base: string): Promise<FundoDrive[]> {
  const fundos: FundoDrive[] = [];
  for (const sub of SUBPASTAS.workpapers) {
    const pasta = path.join(base, sub);
    if (!(await existePasta(pasta))) continue;
    for (const e of await readdir(pasta, { withFileTypes: true })) {
      if (!e.isFile() || !/^WP_.+\.xls[xm]?$/i.test(e.name) || e.name.startsWith("~$")) continue;
      const m = e.name.match(/^WP_(.+?)(?:_(\d{14}))?\.xls[xm]?$/i);
      const caminho = path.join(pasta, e.name);
      const info = await stat(caminho).catch(() => null);
      fundos.push({
        fundo: (m?.[1] ?? e.name).trim(), cnpj: m?.[2] ?? "", arquivo: e.name, caminho, pasta: sub,
        modificado: info ? info.mtime.toISOString() : "",
      });
    }
  }
  return fundos.sort((a, b) => a.fundo.localeCompare(b.fundo, "pt-BR"));
}

// ------------------------------------------------------------------ pasta de lastro do fundo

const GENERICOS = new Set([
  "fidc", "fundo", "fundos", "de", "investimento", "investimentos", "em", "direitos", "direito", "creditorios",
  "creditorio", "resp", "responsabilidade", "limitada", "ltda", "np", "nao", "padronizado", "padronizados", "classe",
  "unica", "fic", "lp", "rl", "fiagro", "fii", "fi", "sa", "s", "a", "do", "da", "dos", "das", "e", "multissetorial",
]);

function tokens(nome: string): string[] {
  return palavras(nome).split(" ").filter((t) => t && !GENERICOS.has(t));
}

export function pontuar(fundo: string, cnpj: string, pasta: string): number {
  if (cnpj && pasta.replace(/\D/g, "").includes(cnpj)) return 1;
  const f = new Set(tokens(fundo));
  const p = tokens(pasta);
  if (!f.size || !p.length) return 0;
  const comuns = p.filter((t) => f.has(t)).length;
  return 0.7 * (comuns / p.length) + 0.3 * (comuns / f.size);
}

export async function pastasDeLastro(base: string, fundo: string, cnpj: string) {
  const raiz = path.join(base, SUBPASTAS.lastro);
  if (!(await existePasta(raiz))) throw new ErroDrive(`Não achei a pasta "${SUBPASTAS.lastro}" em ${base}.`);
  const pastas = (await readdir(raiz, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => ({ nome: e.name, caminho: path.join(raiz, e.name), pontos: pontuar(fundo, cnpj, e.name) }))
    .sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome, "pt-BR"));
  return { raiz, pastas };
}

// ------------------------------------------------------------------ arquivos

export interface ItemListado {
  nome: string;
  relativo: string;
  completo: string;
  tamanho: number;
}

export async function listarRecursivo(pasta: string): Promise<ItemListado[]> {
  const raiz = resolverDentro(pasta);
  if (!(await existePasta(raiz))) throw new ErroDrive(`Pasta não encontrada: ${raiz}.`);
  const itens: ItemListado[] = [];
  const percorrer = async (dir: string, rel: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (itens.length >= MAX_ARQUIVOS) return;
      const completo = path.join(dir, e.name);
      const relativo = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await percorrer(completo, relativo);
      else if (e.isFile()) {
        const info = await stat(completo).catch(() => null);
        itens.push({ nome: e.name, relativo, completo, tamanho: info?.size ?? 0 });
      }
    }
  };
  await percorrer(raiz, "");
  return itens.sort((a, b) => a.relativo.localeCompare(b.relativo, "pt-BR"));
}

export async function responderArquivo(caminho: string): Promise<Response> {
  const p = resolverDentro(caminho);
  const info = await stat(p).catch(() => null);
  if (!info?.isFile()) throw new ErroDrive(`Arquivo não encontrado: ${p}.`);
  const corpo = Readable.toWeb(createReadStream(p)) as unknown as ReadableStream;
  return new Response(corpo, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(info.size),
      "cache-control": "no-store",
    },
  });
}

/** <id>_<cnpj>_<dd.mm.aaaa>_BRITECH.xlsx da data-base em _Carteiras\FORMATADA (ou null). */
export async function carteiraFormatada(base: string, cnpj: string, dataBase: string | null) {
  const raiz = path.join(base, SUBPASTAS.carteiras);
  const sub = path.join(raiz, pastaDaData(dataBase));
  for (const pasta of [sub, raiz]) {
    if (!(await existePasta(pasta))) continue;
    const achado = (await readdir(pasta)).find((n) => ehCarteiraDoFundo(n, cnpj, dataBase));
    if (achado) return { caminho: path.join(pasta, achado), arquivo: achado, idCarteira: achado.match(/^(\d+)_/)?.[1] ?? "" };
  }
  return null;
}
