/** Chamadas do navegador às rotas /api (Drive e Britech). */
import type { CarteiraBritech } from "../servidor/britech";
import type { ItemListado } from "../servidor/drive-local";
import type {
  Administradora, ArquivoDeRecebiveis, CarteiraFormatada, FundoDrive, PastaLastro, ProvedorDrive,
} from "./drive-comum";
import type { ArquivoEntrada } from "./pipeline";

export type { ArquivoDeRecebiveis, CarteiraBritech, CarteiraFormatada, FundoDrive, PastaLastro };

export interface StatusServidor {
  local: boolean;
  exigeChave: boolean;
  chaveConfigurada: boolean;
  /** a chave (se exigida) foi aceita */
  liberado: boolean;
  drive: { disponivel: boolean; base: string };
  britech: { configurada: boolean; url: string; administradoras: { adm: string; nome: string }[] };
}

const CHAVE = "lastro:chave-acesso";

export function salvarChave(chave: string) {
  try {
    if (chave) localStorage.setItem(CHAVE, chave);
    else localStorage.removeItem(CHAVE);
  } catch {
    /* sem storage */
  }
}

function cabecalhos(): HeadersInit {
  try {
    const chave = localStorage.getItem(CHAVE);
    return chave ? { "x-lastro-chave": chave } : {};
  } catch {
    return {};
  }
}

const q = (params: Record<string, string | null | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: cabecalhos(), cache: "no-store" });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados?.erro ?? `Erro ${r.status} em ${url.split("?")[0]}`);
  return dados as T;
}

async function bytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { headers: cabecalhos(), cache: "no-store" });
  if (!r.ok) {
    const dados = await r.json().catch(() => ({}));
    throw new Error(dados?.erro ?? `Erro ${r.status} em ${url.split("?")[0]}`);
  }
  return new Uint8Array(await r.arrayBuffer());
}

export const servidor = {
  status: () => json<StatusServidor>("/api/status"),
  administradoras: (base: string) => json<{ administradoras: Administradora[] }>(`/api/drive/administradoras?${q({ base })}`),
  fundos: (base: string) => json<{ base: string; fundos: FundoDrive[] }>(`/api/drive/fundos?${q({ base })}`),
  pastasLastro: (base: string, fundo: string, cnpj: string) =>
    json<{ raiz: string; pastas: PastaLastro[] }>(`/api/drive/lastro?${q({ base, fundo, cnpj })}`),
  arquivo: (caminho: string) => bytes(`/api/drive/arquivo?${q({ caminho })}`),
  async listar(pasta: string): Promise<ArquivoEntrada[]> {
    const { arquivos } = await json<{ arquivos: ItemListado[] }>(`/api/drive/listar?${q({ pasta })}`);
    return arquivos.map((a) => ({ nome: a.nome, caminho: a.relativo, ler: () => servidor.arquivo(a.completo) }));
  },
  carteiraFormatada: (base: string, cnpj: string, data: string | null) =>
    json<{ carteira: CarteiraFormatada | null }>(`/api/drive/carteira?${q({ base, cnpj, data })}`),
  amostrasEstoques: (base: string, fundo: string, cnpj: string) =>
    json<{ arquivos: ArquivoDeRecebiveis[] }>(`/api/drive/amostras?${q({ base, fundo, cnpj })}`),
  carteirasBritech: (cnpj: string, adm?: string) =>
    json<{ carteiras: CarteiraBritech[]; falhas: { adm: string; erro: string }[] }>(`/api/britech/carteiras?${q({ cnpj, adm })}`),
  composicaoBritech: (adm: string, id: string, data: string) => bytes(`/api/britech/composicao?${q({ adm, id, data })}`),
};

/** Drive pelo G: do computador onde o servidor do app roda (rotas /api/drive). */
export const provedorLocal: ProvedorDrive = {
  tipo: "local",
  administradoras: async (base) => (await servidor.administradoras(base)).administradoras,
  fundos: async (base) => (await servidor.fundos(base)).fundos,
  pastasLastro: async (base, fundo, cnpj) => (await servidor.pastasLastro(base, fundo, cnpj)).pastas,
  listar: (pasta) => servidor.listar(pasta),
  arquivo: (caminho) => servidor.arquivo(caminho),
  carteiraFormatada: async (base, cnpj, data) => (await servidor.carteiraFormatada(base, cnpj, data)).carteira,
  amostrasEstoques: async (base, fundo, cnpj) => (await servidor.amostrasEstoques(base, fundo, cnpj)).arquivos,
};
