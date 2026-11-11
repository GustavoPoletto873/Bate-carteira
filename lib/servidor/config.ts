/**
 * Configuração do lado servidor (rotas /api). Tudo vem de variável de ambiente:
 * localmente em `.env.local` (fora do Git), na Vercel em Settings → Environment Variables.
 */

import { DRIVE_BASE_PADRAO as BASE_FIXA } from "../lastro/drive-comum";

/** Pasta do trimestre/administrador no Drive (dá para trocar na tela). */
export const DRIVE_BASE_PADRAO = process.env.LASTRO_DRIVE_BASE ?? BASE_FIXA;

/** Só caminhos dentro destas raízes podem ser lidos (separe várias com ";"). */
export const DRIVE_RAIZES = (process.env.LASTRO_DRIVE_RAIZES ?? String.raw`G:\Drives compartilhados`)
  .split(";").map((r) => r.trim()).filter(Boolean);

/** Britech da Planner (ambiente "delta") — nomes antigos, sem a administradora no meio. */
export const BRITECH_URL = (process.env.BRITECH_URL ?? "https://delta.britech.com.br/WS/api").replace(/\/+$/, "");
const BRITECH_USUARIO = process.env.BRITECH_USUARIO ?? "";
const BRITECH_SENHA = process.env.BRITECH_SENHA ?? "";

/** Chave exigida nas rotas /api quando o app não está rodando no próprio computador (ex.: Vercel). */
export const CHAVE_ACESSO = process.env.LASTRO_CHAVE_ACESSO ?? "";

/** Uma Britech de administradora: BRITECH_<ADM>_URL, BRITECH_<ADM>_USUARIO e BRITECH_<ADM>_SENHA. */
export interface InstanciaBritech {
  adm: string;
  nome: string;
  url: string;
  usuario: string;
  senha: string;
}

const NOMES_ADM: Record<string, string> = {
  PLANNER: "Planner", ID: "ID", INTRA: "Intra", FINVEST: "Finvest", ATIVA: "Ativa", AMERICA: "América",
  VERT: "Vert", MFPEPPER: "MF Pepper", RJI: "RJI", GUIDE: "Guide",
};

export function instanciasBritech(): InstanciaBritech[] {
  const lista: InstanciaBritech[] = [];
  if (BRITECH_USUARIO && BRITECH_SENHA) {
    lista.push({ adm: "PLANNER", nome: "Planner", url: BRITECH_URL, usuario: BRITECH_USUARIO, senha: BRITECH_SENHA });
  }
  for (const chave of Object.keys(process.env).sort()) {
    const adm = chave.match(/^BRITECH_([A-Z0-9]+)_USUARIO$/)?.[1];
    const usuario = adm ? process.env[chave] : "";
    const senha = adm ? process.env[`BRITECH_${adm}_SENHA`] : "";
    if (!adm || !usuario || !senha || lista.some((i) => i.adm === adm)) continue;
    const url = (process.env[`BRITECH_${adm}_URL`] || `https://${adm.toLowerCase()}.britech.com.br/WS/api`).replace(/\/+$/, "");
    lista.push({ adm, nome: NOMES_ADM[adm] ?? adm, url, usuario, senha });
  }
  return lista;
}

export const britechConfigurada = () => instanciasBritech().length > 0;
