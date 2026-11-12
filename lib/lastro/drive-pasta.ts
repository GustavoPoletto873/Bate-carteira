/**
 * G: lido pelo navegador de quem usa (File System Access API, Chrome/Edge): a pessoa escolhe a pasta do trimestre
 * (…\2T2026, com uma pasta por administradora) ou a de uma administradora (…\2T2026\PLANNER), e o app busca o resto
 * dentro dela — sem servidor.
 * `base` = caminho da administradora relativo à pasta escolhida ("" quando a escolhida já é a administradora).
 * Caminhos de arquivo/pasta neste provedor são "pasta:<caminho relativo à pasta escolhida>".
 */
import {
  foraDoApp, fundosSoComAmostra, interpretarWorkpaper, ordenarFundos, ordenarPastas, procurarAmostrasEstoques, SUBPASTAS, type Administradora,
  type CarteiraFormatada, type FundoDrive, type ProvedorDrive,
} from "./drive-comum";
import { listarPasta, type HandleArquivo, type HandlePasta } from "./fontes";
import { ehCarteiraDoFundo, pastaDaData } from "./planilhas";
import { normalizar } from "./textos";

const PREFIXO = "pasta:";
const relativo = (caminho: string) => caminho.replace(/^pasta:/, "").replace(/\\/g, "/");
const juntar = (...partes: string[]) => partes.filter(Boolean).join("/");
const mesmoNome = (a: string, b: string) => normalizar(a) === normalizar(b);

async function filhos(dir: HandlePasta): Promise<(HandleArquivo | HandlePasta)[]> {
  const itens: (HandleArquivo | HandlePasta)[] = [];
  for await (const [, h] of dir.entries()) itens.push(h);
  return itens;
}

/** Subpasta pelo caminho relativo (nomes comparados sem acento/maiúsculas). null se não existir. */
async function subpasta(raiz: HandlePasta, rel: string): Promise<HandlePasta | null> {
  let atual = raiz;
  for (const seg of rel.split("/").filter(Boolean)) {
    const achada = (await filhos(atual)).find((h): h is HandlePasta => h.kind === "directory" && mesmoNome(h.name, seg));
    if (!achada) return null;
    atual = achada;
  }
  return atual;
}

async function temWorkpapers(dir: HandlePasta): Promise<boolean> {
  return (await filhos(dir)).some((h) => h.kind === "directory" && mesmoNome(h.name, SUBPASTAS.workpapers[0]));
}

/** Administradoras na pasta escolhida: ela mesma (se tiver _Workpapers) ou as subpastas que têm. */
export async function administradorasNaPasta(raiz: HandlePasta): Promise<Administradora[]> {
  if (await temWorkpapers(raiz)) return [{ nome: raiz.name, base: "" }];
  const lista: Administradora[] = [];
  for (const h of await filhos(raiz)) {
    if (h.kind === "directory" && !foraDoApp(h.name) && (await temWorkpapers(h))) lista.push({ nome: h.name, base: h.name });
  }
  return lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Mensagem de erro se a pasta escolhida não tem nenhuma administradora; null se estiver certa. */
export async function conferirPastaBase(raiz: HandlePasta): Promise<string | null> {
  if ((await administradorasNaPasta(raiz)).length) return null;
  return `A pasta "${raiz.name}" não tem "${SUBPASTAS.workpapers[0]}" (nem subpastas com ela). Escolha a pasta do trimestre (ex.: …\\2026\\2T2026) ou de uma administradora (…\\2T2026\\PLANNER).`;
}

export function criarProvedorPasta(raiz: HandlePasta): ProvedorDrive {
  /** leitura de pastas a partir da pasta da administradora (buscas comuns ao servidor e ao navegador) */
  const leitor = (base: string) => ({
    async itens(rel: string) {
      const dir = await subpasta(raiz, juntar(base, rel));
      return dir ? (await filhos(dir)).map((h) => ({ nome: h.name, pasta: h.kind === "directory" })) : [];
    },
    caminho: (rel: string) => PREFIXO + juntar(base, rel),
  });

  async function arquivo(caminho: string): Promise<HandleArquivo> {
    const partes = relativo(caminho).split("/").filter(Boolean);
    const nome = partes.pop() ?? "";
    const dir = await subpasta(raiz, partes.join("/"));
    const h = dir && (await filhos(dir)).find((x): x is HandleArquivo => x.kind === "file" && x.name === nome);
    if (!h) throw new Error(`Arquivo não encontrado na pasta escolhida: ${relativo(caminho)}`);
    return h;
  }

  return {
    tipo: "pasta",

    administradoras: () => administradorasNaPasta(raiz),

    async fundos(base) {
      const fundos: FundoDrive[] = [];
      for (const sub of SUBPASTAS.workpapers) {
        const dir = await subpasta(raiz, juntar(base, sub));
        if (!dir) continue;
        const arquivos = (await filhos(dir)).filter((h): h is HandleArquivo => h.kind === "file");
        const achados = await Promise.all(arquivos.map(async (h) => {
          const wp = interpretarWorkpaper(h.name);
          if (!wp) return null;
          const modificado = await h.getFile().then((f) => new Date(f.lastModified).toISOString()).catch(() => "");
          return { ...wp, arquivo: h.name, caminho: PREFIXO + juntar(base, sub, h.name), pasta: sub, modificado };
        }));
        fundos.push(...achados.filter((f): f is FundoDrive => !!f));
      }
      fundos.push(...await fundosSoComAmostra(leitor(base), new Set(fundos.map((f) => f.cnpj))));
      if (!fundos.length && !(await subpasta(raiz, juntar(base, SUBPASTAS.workpapers[0])))) {
        throw new Error(`Não achei "${SUBPASTAS.workpapers[0]}" em "${base || raiz.name}".`);
      }
      return ordenarFundos(fundos);
    },

    async pastasLastro(base, fundo, cnpj) {
      for (const nome of SUBPASTAS.lastro) {
        const dir = await subpasta(raiz, juntar(base, nome));
        if (!dir) continue;
        const pastas = (await filhos(dir)).filter((h) => h.kind === "directory")
          .map((h) => ({ nome: h.name, caminho: PREFIXO + juntar(base, dir.name, h.name) }));
        return ordenarPastas(fundo, cnpj, pastas);
      }
      throw new Error(`Não achei a pasta "${SUBPASTAS.lastro[0]}" em "${base || raiz.name}".`);
    },

    async listar(pasta) {
      const dir = await subpasta(raiz, relativo(pasta));
      if (!dir) throw new Error(`Pasta não encontrada: ${relativo(pasta)}`);
      return listarPasta(dir);
    },

    async arquivo(caminho) {
      const f = await (await arquivo(caminho)).getFile();
      return new Uint8Array(await f.arrayBuffer());
    },

    async carteiraFormatada(base, cnpj, data): Promise<CarteiraFormatada | null> {
      const relCarteiras = juntar(base, SUBPASTAS.carteiras);
      const raizCarteiras = await subpasta(raiz, relCarteiras);
      if (!raizCarteiras) return null;
      const sub = pastaDaData(data);
      for (const [dir, rel] of [[await subpasta(raizCarteiras, sub), juntar(relCarteiras, sub)], [raizCarteiras, relCarteiras]] as const) {
        if (!dir) continue;
        const h = (await filhos(dir)).find((x) => x.kind === "file" && ehCarteiraDoFundo(x.name, cnpj, data));
        if (h) return { caminho: PREFIXO + juntar(rel, h.name), arquivo: h.name, idCarteira: h.name.match(/^(\d+)_/)?.[1] ?? "" };
      }
      return null;
    },

    amostrasEstoques: (base, fundo, cnpj) => procurarAmostrasEstoques(leitor(base), fundo, cnpj),
  };
}
