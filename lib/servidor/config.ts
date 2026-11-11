/**
 * Configuração do lado servidor (rotas /api). Tudo vem de variável de ambiente:
 * localmente em `.env.local` (fora do Git), na Vercel em Settings → Environment Variables.
 */

/** Pasta do trimestre/administrador no Drive (dá para trocar na tela). */
export const DRIVE_BASE_PADRAO =
  process.env.LASTRO_DRIVE_BASE ??
  String.raw`G:\Drives compartilhados\Auditoria de Lastro – 1º Semestre – 2026\2T2026\PLANNER`;

/** Só caminhos dentro destas raízes podem ser lidos (separe várias com ";"). */
export const DRIVE_RAIZES = (process.env.LASTRO_DRIVE_RAIZES ?? String.raw`G:\Drives compartilhados`)
  .split(";").map((r) => r.trim()).filter(Boolean);

/** Subpastas dentro da pasta do trimestre. */
export const SUBPASTAS = {
  workpapers: ["_Workpapers", "_Workpapers/WPS"],
  lastro: "Lastro e Termo",
  carteiras: "_Carteiras/FORMATADA",
};

/** Britech da Planner (ambiente "delta"). */
export const BRITECH_URL = (process.env.BRITECH_URL ?? "https://delta.britech.com.br/WS/api").replace(/\/+$/, "");
export const BRITECH_USUARIO = process.env.BRITECH_USUARIO ?? "";
export const BRITECH_SENHA = process.env.BRITECH_SENHA ?? "";

/** Chave exigida nas rotas /api quando o app não está rodando no próprio computador (ex.: Vercel). */
export const CHAVE_ACESSO = process.env.LASTRO_CHAVE_ACESSO ?? "";

export const britechConfigurada = () => !!(BRITECH_USUARIO && BRITECH_SENHA);
