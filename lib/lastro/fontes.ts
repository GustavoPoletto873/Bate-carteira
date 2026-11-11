/**
 * Acesso a arquivos e pastas no navegador.
 * - Chrome/Edge: File System Access API — a pasta escolhida fica lembrada (IndexedDB) e pode ser reaberta.
 * - Outros navegadores: <input type="file"> comum (sem memória).
 * Nada é enviado para servidor: os bytes são lidos sob demanda, só no computador de quem usa.
 */
import { get, set } from "idb-keyval";
import type { ArquivoEntrada } from "./pipeline";

interface Permissoes {
  queryPermission?(o: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" }): Promise<PermissionState>;
}
export interface HandleArquivo extends Permissoes {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}
export interface HandlePasta extends Permissoes {
  kind: "directory";
  name: string;
  entries(): AsyncIterable<[string, HandleArquivo | HandlePasta]>;
  getDirectoryHandle(nome: string): Promise<HandlePasta>;
}
type Handle = HandleArquivo | HandlePasta;

interface JanelaComPicker {
  showDirectoryPicker?(o?: { id?: string; mode?: "read" }): Promise<HandlePasta>;
  showOpenFilePicker?(o?: {
    id?: string; multiple?: boolean; types?: { description: string; accept: Record<string, string[]> }[];
  }): Promise<HandleArquivo[]>;
}

export interface FonteArquivo {
  tipo: "arquivo";
  nome: string;
  entrada: ArquivoEntrada;
}
export interface FontePasta {
  tipo: "pasta";
  nome: string;
  /** Lista completa (quando já listada) — no modo <input> sempre vem preenchida. */
  arquivos?: ArquivoEntrada[];
  handle?: HandlePasta;
}

const janela = () => (typeof window === "undefined" ? {} : (window as unknown as JanelaComPicker));
export const suportaAcessoDireto = () => typeof janela().showDirectoryPicker === "function";

const cancelou = (e: unknown) => (e as { name?: string })?.name === "AbortError";

function entradaDeHandle(h: HandleArquivo, caminho: string): ArquivoEntrada {
  return { nome: h.name, caminho, ler: async () => new Uint8Array(await (await h.getFile()).arrayBuffer()) };
}

export function entradaDeFile(f: File): ArquivoEntrada {
  const relativo = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
  return { nome: f.name, caminho: relativo || f.name, ler: async () => new Uint8Array(await f.arrayBuffer()) };
}

/** Arquivos de um <input webkitdirectory> ou de vários arquivos soltos; tira o nome da pasta raiz do caminho. */
export function pastaDeFiles(files: FileList | File[]): FontePasta {
  const lista = Array.from(files);
  const raiz = (lista[0] as File & { webkitRelativePath?: string })?.webkitRelativePath?.split("/")[0] || "";
  const arquivos = lista.map((f) => {
    const e = entradaDeFile(f);
    return raiz && e.caminho.startsWith(raiz + "/") ? { ...e, caminho: e.caminho.slice(raiz.length + 1) } : e;
  });
  return { tipo: "pasta", nome: raiz || `${lista.length} arquivo(s)`, arquivos };
}

export async function listarPasta(dir: HandlePasta, base = ""): Promise<ArquivoEntrada[]> {
  const saida: ArquivoEntrada[] = [];
  for await (const [nome, h] of dir.entries()) {
    const rel = base ? `${base}/${nome}` : nome;
    if (h.kind === "directory") saida.push(...(await listarPasta(h, rel)));
    else saida.push(entradaDeHandle(h, rel));
  }
  return saida.sort((a, b) => a.caminho.localeCompare(b.caminho, "pt-BR"));
}

async function permitir(h: Handle, pedir: boolean): Promise<boolean> {
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode: "read" })) === "granted") return true;
  if (!pedir || !h.requestPermission) return false;
  return (await h.requestPermission({ mode: "read" })) === "granted";
}

async function deHandle(h: Handle, listar: boolean): Promise<FonteArquivo | FontePasta> {
  if (h.kind === "file") return { tipo: "arquivo", nome: h.name, entrada: entradaDeHandle(h, h.name) };
  return { tipo: "pasta", nome: h.name, handle: h, arquivos: listar ? await listarPasta(h) : undefined };
}

/** Abre o seletor de pasta (Chrome/Edge). null se a pessoa cancelar. */
export async function escolherPasta(memoria: string, listar = true): Promise<FontePasta | null> {
  try {
    const dir = await janela().showDirectoryPicker!({ id: memoria, mode: "read" });
    await set(memoria, dir).catch(() => undefined);
    return (await deHandle(dir, listar)) as FontePasta;
  } catch (e) {
    if (cancelou(e)) return null;
    throw e;
  }
}

/** Abre o seletor de arquivo (Chrome/Edge). null se a pessoa cancelar. */
export async function escolherArquivo(memoria: string, descricao: string, extensoes: string[]): Promise<FonteArquivo | null> {
  try {
    const [h] = await janela().showOpenFilePicker!({
      id: memoria, multiple: false,
      types: [{ description: descricao, accept: { "application/octet-stream": extensoes } }],
    });
    await set(memoria, h).catch(() => undefined);
    return (await deHandle(h, false)) as FonteArquivo;
  } catch (e) {
    if (cancelou(e)) return null;
    throw e;
  }
}

/** Nome do que foi escolhido da última vez (para o botão "Usar a última"). */
export async function lembrada(memoria: string): Promise<string | null> {
  if (!suportaAcessoDireto()) return null;
  try {
    const h = (await get(memoria)) as Handle | undefined;
    return h?.name ?? null;
  } catch {
    return null;
  }
}

/** Reabre o que foi escolhido da última vez (pede permissão de leitura de novo, se preciso). */
export async function reabrir(memoria: string, listar = true): Promise<FonteArquivo | FontePasta | null> {
  const h = (await get(memoria)) as Handle | undefined;
  if (!h) return null;
  if (!(await permitir(h, true))) throw new Error("Sem permissão para ler. Escolha de novo.");
  return deHandle(h, listar);
}

/** Lê os arquivos de pastas/arquivos soltos num arrastar-e-soltar (percorre subpastas). */
export async function arquivosDoDrop(dt: DataTransfer): Promise<FontePasta | null> {
  const raizes = Array.from(dt.items ?? [])
    .map((i) => (typeof i.webkitGetAsEntry === "function" ? i.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => !!e);
  if (!raizes.length) return dt.files?.length ? pastaDeFiles(dt.files) : null;

  const arquivos: ArquivoEntrada[] = [];
  const percorrer = async (e: FileSystemEntry, base: string): Promise<void> => {
    if (e.isFile) {
      const f = await new Promise<File>((ok, erro) => (e as FileSystemFileEntry).file(ok, erro));
      arquivos.push({ nome: f.name, caminho: base ? `${base}/${f.name}` : f.name, ler: async () => new Uint8Array(await f.arrayBuffer()) });
      return;
    }
    const leitor = (e as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const lote = await new Promise<FileSystemEntry[]>((ok, erro) => leitor.readEntries(ok, erro));
      if (!lote.length) break;
      for (const filho of lote) await percorrer(filho, base ? `${base}/${filho.name}` : filho.name);
    }
  };
  const unicaPasta = raizes.length === 1 && raizes[0].isDirectory;
  for (const r of raizes) await percorrer(r, unicaPasta ? "" : r.isDirectory ? r.name : "");
  return { tipo: "pasta", nome: unicaPasta ? raizes[0].name : `${arquivos.length} arquivo(s)`, arquivos };
}
