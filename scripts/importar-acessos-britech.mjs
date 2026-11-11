// Lê a planilha de acessos (uma aba por administradora, blocos "BRITECH / Link / Login / Senha") e grava no
// .env.local SÓ as credenciais da Britech de cada administradora: BRITECH_<ADM>_URL, _USUARIO e _SENHA.
// Não imprime usuário nem senha. Bancos, e-mails, VPNs etc. da planilha são ignorados de propósito.
//
// Uso: node scripts/importar-acessos-britech.mjs "G:\Drives compartilhados\Dados\Acessos\Acessos.xlsx"
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const planilha = process.argv[2];
if (!planilha || !existsSync(planilha)) {
  console.error("Informe o caminho da planilha de acessos (Acessos.xlsx).");
  process.exit(1);
}

/** aba da planilha → código da administradora no app (e qual bloco BRITECH usar, se houver mais de um) */
const ABAS = {
  "AMÉRICA": { adm: "AMERICA" },
  "INTRA": { adm: "INTRA" },
  "ID - IDGR": { adm: "ID" },
  "VERT": { adm: "VERT" },
  "MF PEPPER": { adm: "MFPEPPER" },
  "RJI": { adm: "RJI" },
  "FINVEST": { adm: "FINVEST" },
  "ATIVA": { adm: "ATIVA", bloco: /fundos/i },
  "GUIDE": { adm: "GUIDE" },
};
const ROTULO = { link: /^\s*(link|url|site)\s*:?\s*$/i, login: /^\s*(login|usu[aá]rio|user)\s*:?\s*$/i, senha: /^\s*(senha|password)\s*:?\s*$/i };
const ehRotulo = (s) => Object.values(ROTULO).some((r) => r.test(s));
const texto = (v) => (v == null ? "" : String(v).trim());

function blocosBritech(grade) {
  const blocos = [];
  grade.forEach((linha, i) => (linha || []).forEach((cel, c) => {
    const t = texto(cel);
    if (!/britech/i.test(t) || ehRotulo(t)) return;
    const b = { titulo: t, link: "", login: "", senha: "" };
    for (let k = i + 1; k < grade.length; k++) {
      const r = texto(grade[k]?.[c]);
      if (r && !ehRotulo(r)) break; // começou outro bloco
      for (const campo of ["link", "login", "senha"]) {
        if (ROTULO[campo].test(r) && !b[campo]) b[campo] = texto(grade[k]?.[c + 1]);
      }
    }
    blocos.push(b);
  }));
  return blocos;
}

const aspas = (v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$")}"`;
const wb = XLSX.readFile(planilha);
const linhas = [];
for (const [aba, { adm, bloco }] of Object.entries(ABAS)) {
  if (!wb.Sheets[aba]) {
    console.log(`- ${adm}: aba "${aba}" não encontrada`);
    continue;
  }
  const grade = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, defval: null, blankrows: true });
  const candidatos = blocosBritech(grade).filter((b) => b.link && b.login && b.senha);
  const b = (bloco && candidatos.find((x) => bloco.test(x.titulo))) || candidatos[0];
  if (!b) {
    console.log(`- ${adm}: bloco BRITECH sem link/login/senha completos`);
    continue;
  }
  let host;
  try {
    host = new URL(b.link).host;
  } catch {
    console.log(`- ${adm}: link do bloco "${b.titulo}" não é uma URL`);
    continue;
  }
  linhas.push(`BRITECH_${adm}_URL=${aspas(`https://${host}/WS/api`)}`, `BRITECH_${adm}_USUARIO=${aspas(b.login)}`, `BRITECH_${adm}_SENHA=${aspas(b.senha)}`);
  console.log(`+ ${adm}: https://${host}/WS/api (bloco "${b.titulo}")`);
}

const INICIO = "# >>> Britech por administradora (gerado por scripts/importar-acessos-britech.mjs)";
const FIM = "# <<< Britech por administradora";
const arquivo = join(raiz, ".env.local");
const atual = existsSync(arquivo) ? readFileSync(arquivo, "utf8") : "";
const semBloco = atual.replace(new RegExp(`\\n?${INICIO}[\\s\\S]*?${FIM}\\n?`), "\n").replace(/\n{3,}/g, "\n\n").trimEnd();
writeFileSync(arquivo, `${semBloco}\n\n${INICIO}\n${linhas.join("\n")}\n${FIM}\n`);
console.log(`\n${linhas.length / 3} administradora(s) gravada(s) em .env.local (valores não exibidos).`);
