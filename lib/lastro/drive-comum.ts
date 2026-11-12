/**
 * Regras comuns aos dois jeitos de ler o Drive: o G: pelo servidor (rotas /api, no seu computador) e a pasta
 * escolhida no navegador de quem usa (File System Access). Funções puras.
 */
import { normalizar, palavras } from "./textos";

/** Administradoras fora do escopo do app (QI Tech e BlueWave: só validação de estoque). */
const FORA_DO_APP = ["qi tech", "bluewave", "blue wave"];
export const foraDoApp = (nome: string) => FORA_DO_APP.includes(normalizar(nome));

/** Pasta do trimestre/administrador (pode ser trocada na tela e por LASTRO_DRIVE_BASE). */
export const DRIVE_BASE_PADRAO =
  String.raw`G:\Drives compartilhados\Auditoria de Lastro – 1º Semestre – 2026\2T2026\PLANNER`;

/** Subpastas dentro da pasta da administradora (o nome da pasta de lastro varia entre administradoras). */
export const SUBPASTAS = {
  workpapers: ["_Workpapers", "_Workpapers/WPS"],
  lastro: ["Lastro e Termo", "_Lastro e Termo"],
  carteiras: "_Carteiras/FORMATADA",
};

/** Pasta de uma administradora no trimestre (ex.: …\2T2026\PLANNER, …\2T2026\ID). */
export interface Administradora {
  nome: string;
  /** como o leitor localiza a pasta: caminho no G: (servidor) ou relativo à pasta escolhida (navegador) */
  base: string;
}

/** Leitor do Drive: G: pelo servidor do app ("local") ou pela pasta escolhida no navegador ("pasta"). */
export interface ProvedorDrive {
  tipo: "local" | "pasta";
  administradoras(base: string): Promise<Administradora[]>;
  fundos(base: string): Promise<FundoDrive[]>;
  pastasLastro(base: string, fundo: string, cnpj: string): Promise<PastaLastro[]>;
  listar(pasta: string): Promise<import("./pipeline").ArquivoEntrada[]>;
  arquivo(caminho: string): Promise<Uint8Array>;
  carteiraFormatada(base: string, cnpj: string, data: string | null): Promise<CarteiraFormatada | null>;
  /** Amostra e estoque do fundo (administradoras sem Britech), da mais provável para a menos. */
  amostrasEstoques(base: string, fundo: string, cnpj: string): Promise<ArquivoDeRecebiveis[]>;
}

export interface FundoDrive {
  fundo: string;
  cnpj: string;
  arquivo: string;
  /** caminho no G: ou "pasta:<caminho relativo>" na pasta escolhida no navegador */
  caminho: string;
  pasta: string;
  modificado: string;
  /** fundo sem WP_….xlsm em _Workpapers: o arquivo é a amostra, que faz o papel da WP_Termo */
  semWorkpaper?: boolean;
}

export interface PastaLastro {
  nome: string;
  caminho: string;
  pontos: number;
}

export interface CarteiraFormatada {
  caminho: string;
  arquivo: string;
  idCarteira: string;
}

/** Amostra ou estoque de recebíveis exportado do sistema da administradora (Fromtis, Sinqia, MAPS…). */
export interface ArquivoDeRecebiveis {
  tipo: "amostra" | "estoque";
  caminho: string;
  arquivo: string;
  /** subpasta onde está, relativa à pasta da administradora (ex.: "_Insumos/_Insumos 1") */
  pasta: string;
  pontos: number;
}

/** Pastas da administradora com as amostras e com os estoques (os nomes variam: _Amostra, _Amostras, _Insumos, Estoques). */
const PASTA_AMOSTRA = /^_?amostras?$/i;
const PASTA_ESTOQUE = /^_?(insumos?|estoques?)$/i;
const PLANILHA = /\.(xlsx|xlsm|xls|csv)$/i;
const MAX_ITENS_CARTEIRA = 4000;

/** Leitura mínima de pastas, para a mesma busca rodar no servidor (G:) e no navegador. */
export interface LeitorDePastas {
  itens(relativo: string): Promise<{ nome: string; pasta: boolean }[]>;
  caminho(relativo: string): string;
}

/**
 * O arquivo é a amostra/estoque deste fundo? Pelo CNPJ no nome (1) ou, sem CNPJ, pelo nome do fundo (0 a 1).
 * Dentro de _Insumos/Estoques só valem arquivos com "estoque" no nome (lá há também carteiras, zips, PDFs…).
 */
export function arquivoDeRecebiveis(nome: string, emPasta: "amostra" | "estoque", fundo: string, cnpj: string): { tipo: "amostra" | "estoque"; pontos: number } | null {
  if (nome.startsWith("~$") || !PLANILHA.test(nome)) return null;
  const tipo = /amostra/i.test(nome) ? "amostra" : /estoque/i.test(nome) ? "estoque" : emPasta === "amostra" ? "amostra" : null;
  if (!tipo) return null;
  if (cnpj && nome.replace(/\D/g, "").includes(cnpj)) return { tipo, pontos: 1 };
  if (/(?<!\d)\d{14}(?!\d)/.test(nome)) return null; // traz o CNPJ de outro fundo
  const pontos = pontuar(fundo, "", nome.replace(PLANILHA, ""));
  return pontos >= 0.5 ? { tipo, pontos } : null;
}

/** Procura a amostra e o estoque do fundo nas pastas da administradora (até 3 níveis abaixo de _Amostra/_Insumos). */
export async function procurarAmostrasEstoques(leitor: LeitorDePastas, fundo: string, cnpj: string): Promise<ArquivoDeRecebiveis[]> {
  const achados: ArquivoDeRecebiveis[] = [];
  let vistos = 0;
  const percorrer = async (rel: string, emPasta: "amostra" | "estoque", nivel: number) => {
    const itens = await leitor.itens(rel).catch(() => []);
    for (const item of itens) {
      if (++vistos > MAX_ITENS_CARTEIRA) return;
      const filho = rel ? `${rel}/${item.nome}` : item.nome;
      if (item.pasta) {
        if (nivel < 3) await percorrer(filho, emPasta, nivel + 1);
        continue;
      }
      const r = arquivoDeRecebiveis(item.nome, emPasta, fundo, cnpj);
      if (r) achados.push({ ...r, caminho: leitor.caminho(filho), arquivo: item.nome, pasta: rel });
    }
  };
  for (const item of await leitor.itens("").catch(() => [])) {
    if (!item.pasta) continue;
    if (PASTA_AMOSTRA.test(item.nome)) await percorrer(item.nome, "amostra", 1);
    else if (PASTA_ESTOQUE.test(item.nome)) await percorrer(item.nome, "estoque", 1);
  }
  // amostra antes do estoque; depois o nome mais parecido; empate: o mais perto da pasta principal
  const ordem = { amostra: 0, estoque: 1 };
  const nivel = (a: ArquivoDeRecebiveis) => a.pasta.split("/").length;
  return achados.sort((a, b) => ordem[a.tipo] - ordem[b.tipo] || b.pontos - a.pontos || nivel(a) - nivel(b)
    || a.pasta.localeCompare(b.pasta, "pt-BR") || a.arquivo.localeCompare(b.arquivo, "pt-BR"));
}

/** 'Amostra_<cnpj>_<fundo>.xlsx' → { fundo, cnpj }; null se não for amostra com o CNPJ no nome. */
export function interpretarAmostra(nome: string): { fundo: string; cnpj: string } | null {
  if (nome.startsWith("~$")) return null;
  const m = nome.match(/^Amostra_(\d{14})_(.+?)\s*\.(xlsx|xlsm|xls|csv)$/i);
  return m ? { cnpj: m[1], fundo: m[2].trim() } : null;
}

/**
 * Fundos que têm a amostra (_Amostra/_Amostras, até 2 níveis) mas não têm o WP_….xlsm em _Workpapers — ex.: fundo
 * novo da administradora antes de o workpaper ser gerado. Nessas administradoras a WP_Termo é a própria amostra.
 */
export async function fundosSoComAmostra(leitor: LeitorDePastas, comWorkpaper: Set<string>): Promise<FundoDrive[]> {
  const achados = new Map<string, FundoDrive>();
  const percorrer = async (rel: string, nivel: number) => {
    for (const item of await leitor.itens(rel).catch(() => [])) {
      const filho = `${rel}/${item.nome}`;
      if (item.pasta) {
        if (nivel < 2) await percorrer(filho, nivel + 1);
        continue;
      }
      const a = interpretarAmostra(item.nome);
      if (!a || comWorkpaper.has(a.cnpj) || achados.has(a.cnpj)) continue;
      achados.set(a.cnpj, { ...a, arquivo: item.nome, caminho: leitor.caminho(filho), pasta: rel, modificado: "", semWorkpaper: true });
    }
  };
  for (const item of await leitor.itens("").catch(() => [])) {
    if (item.pasta && PASTA_AMOSTRA.test(item.nome)) await percorrer(item.nome, 1);
  }
  return [...achados.values()];
}

/** Fim do trimestre citado no caminho (…\2T2026\… → 2026-06-30); null se não houver. */
export function dataDoTrimestre(texto: string): string | null {
  const m = texto.match(/(?<!\d)([1-4])T(20\d{2})(?!\d)/i);
  return m ? `${m[2]}-${{ 1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31" }[Number(m[1]) as 1 | 2 | 3 | 4]}` : null;
}

/** 'WP_<fundo>_<cnpj>.xlsm' → { fundo, cnpj }; null se não for workpaper. */
export function interpretarWorkpaper(nome: string): { fundo: string; cnpj: string } | null {
  if (nome.startsWith("~$") || !/^WP_.+\.xls[xm]?$/i.test(nome)) return null;
  const m = nome.match(/^WP_(.+?)(?:_(\d{14}))?\.xls[xm]?$/i);
  return { fundo: (m?.[1] ?? nome).trim(), cnpj: m?.[2] ?? "" };
}

export function ordenarFundos(fundos: FundoDrive[]): FundoDrive[] {
  return fundos.sort((a, b) => a.fundo.localeCompare(b.fundo, "pt-BR") || b.modificado.localeCompare(a.modificado));
}

const GENERICOS = new Set([
  "fidc", "fundo", "fundos", "de", "investimento", "investimentos", "em", "direitos", "direito", "creditorios",
  "creditorio", "resp", "responsabilidade", "limitada", "ltda", "np", "nao", "padronizado", "padronizados", "classe",
  "unica", "fic", "lp", "rl", "fiagro", "fii", "fi", "sa", "s", "a", "do", "da", "dos", "das", "e", "multissetorial",
  "amostra", "estoque", "agrupado", "ext",
]);

function tokens(nome: string): string[] {
  return palavras(nome).split(" ").filter((t) => t && !GENERICOS.has(t));
}

/** Quão parecido o nome da pasta de lastro é com o fundo (0 a 1; 1 se a pasta tiver o CNPJ). */
export function pontuar(fundo: string, cnpj: string, pasta: string): number {
  if (cnpj && pasta.replace(/\D/g, "").includes(cnpj)) return 1;
  const f = new Set(tokens(fundo));
  const p = tokens(pasta);
  if (!f.size || !p.length) return 0;
  const comuns = p.filter((t) => f.has(t)).length;
  return 0.7 * (comuns / p.length) + 0.3 * (comuns / f.size);
}

export function ordenarPastas(fundo: string, cnpj: string, pastas: { nome: string; caminho: string }[]): PastaLastro[] {
  return pastas
    .map((p) => ({ ...p, pontos: pontuar(fundo, cnpj, p.nome) }))
    .sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome, "pt-BR"));
}
