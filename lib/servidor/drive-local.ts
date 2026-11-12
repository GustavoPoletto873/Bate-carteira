/**
 * Leitura do Drive montado no computador (G:). Só funciona onde o app roda com acesso ao G:
 * (npm run dev / npm start no seu PC). Todo caminho é conferido contra DRIVE_RAIZES.
 */
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
  foraDoApp, interpretarWorkpaper, ordenarFundos, ordenarPastas, procurarAmostrasEstoques, SUBPASTAS, type Administradora,
  type ArquivoDeRecebiveis, type CarteiraFormatada, type FundoDrive,
} from "../lastro/drive-comum";
import { ehCarteiraDoFundo, pastaDaData } from "../lastro/planilhas";
import { DRIVE_BASE_PADRAO, DRIVE_RAIZES } from "./config";

export type { FundoDrive };

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
    throw new ErroDrive(`Pasta não encontrada: ${p}. Confira o caminho e se o Drive (G:) está conectado.`);
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

export async function listarFundos(base: string): Promise<FundoDrive[]> {
  const fundos: FundoDrive[] = [];
  for (const sub of SUBPASTAS.workpapers) {
    const pasta = path.join(base, sub);
    if (!(await existePasta(pasta))) continue;
    for (const e of await readdir(pasta, { withFileTypes: true })) {
      const wp = e.isFile() ? interpretarWorkpaper(e.name) : null;
      if (!wp) continue;
      const caminho = path.join(pasta, e.name);
      const info = await stat(caminho).catch(() => null);
      fundos.push({ ...wp, arquivo: e.name, caminho, pasta: sub, modificado: info ? info.mtime.toISOString() : "" });
    }
  }
  return ordenarFundos(fundos);
}

// ------------------------------------------------------------------ pasta de lastro do fundo

export async function pastasDeLastro(base: string, fundo: string, cnpj: string) {
  for (const nome of SUBPASTAS.lastro) {
    const raiz = path.join(base, nome);
    if (!(await existePasta(raiz))) continue;
    const pastas = (await readdir(raiz, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => ({ nome: e.name, caminho: path.join(raiz, e.name) }));
    return { raiz, pastas: ordenarPastas(fundo, cnpj, pastas) };
  }
  throw new ErroDrive(`Não achei a pasta "${SUBPASTAS.lastro[0]}" em ${base}.`);
}

// ------------------------------------------------------------------ administradoras do trimestre

/** Pastas com _Workpapers ao lado da pasta atual (…\2T2026\PLANNER, …\2T2026\ID…), ou dentro dela se for o trimestre. */
export async function listarAdministradoras(base: string): Promise<Administradora[]> {
  const temWp = (p: string) => existePasta(path.join(p, SUBPASTAS.workpapers[0]));
  const trimestre = (await temWp(base)) ? path.dirname(base) : base;
  const lista: Administradora[] = [];
  for (const e of await readdir(trimestre, { withFileTypes: true })) {
    const p = path.join(trimestre, e.name);
    if (e.isDirectory() && !foraDoApp(e.name) && (await temWp(p))) lista.push({ nome: e.name, base: p });
  }
  return lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
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
export async function carteiraFormatada(base: string, cnpj: string, dataBase: string | null): Promise<CarteiraFormatada | null> {
  const raiz = path.join(base, SUBPASTAS.carteiras);
  const sub = path.join(raiz, pastaDaData(dataBase));
  for (const pasta of [sub, raiz]) {
    if (!(await existePasta(pasta))) continue;
    const achado = (await readdir(pasta)).find((n) => ehCarteiraDoFundo(n, cnpj, dataBase));
    if (achado) return { caminho: path.join(pasta, achado), arquivo: achado, idCarteira: achado.match(/^(\d+)_/)?.[1] ?? "" };
  }
  return null;
}

/** Amostra e estoque do fundo nas pastas da administradora (administradoras sem Britech). */
export async function amostrasEstoques(base: string, fundo: string, cnpj: string): Promise<ArquivoDeRecebiveis[]> {
  return procurarAmostrasEstoques({
    itens: async (rel) => (await readdir(path.join(base, rel), { withFileTypes: true }))
      .map((e) => ({ nome: e.name, pasta: e.isDirectory() })),
    caminho: (rel) => path.join(base, rel),
  }, fundo, cnpj);
}
