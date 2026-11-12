/**
 * Conferência com arquivos reais do Drive — só roda quando os caminhos são informados:
 *   LASTRO_WP=<workpaper.xlsm> LASTRO_CARTEIRA=<carteira.xlsx> LASTRO_PASTA=<pasta de lastro> npx vitest run tests/real.test.ts
 * Não é executado no `npm test` comum (os arquivos do fundo não ficam no repositório).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PdfJs } from "../lib/lastro/extratores";
import { gerarExcel, lerDocumentos, montarResultado, type ArquivoEntrada } from "../lib/lastro/pipeline";
import { periodoDoCdi } from "../lib/lastro/indexadores";
import { lerCarteira, lerWorkpaper } from "../lib/lastro/planilhas";
import { serieCdi } from "../lib/servidor/indices";

const { LASTRO_WP, LASTRO_CARTEIRA, LASTRO_PASTA, LASTRO_SAIDA } = process.env;

function listar(pasta: string, base = ""): ArquivoEntrada[] {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    const rel = base ? `${base}/${nome}` : nome;
    if (statSync(caminho).isDirectory()) return listar(caminho, rel);
    return [{ nome, caminho: rel, ler: async () => new Uint8Array(readFileSync(caminho)) }];
  });
}

describe.skipIf(!LASTRO_WP || !LASTRO_CARTEIRA || !LASTRO_PASTA)("arquivos reais", () => {
  it("confere", async () => {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJs;
    const inicio = Date.now();
    const wp = lerWorkpaper(new Uint8Array(readFileSync(LASTRO_WP!)), basename(LASTRO_WP!));
    const posicoes = lerCarteira(new Uint8Array(readFileSync(LASTRO_CARTEIRA!)), basename(LASTRO_CARTEIRA!));
    const { docs, ignorados } = await lerDocumentos(listar(LASTRO_PASTA!), pdfjs, { verbosity: 0 });
    const periodo = periodoDoCdi(posicoes, docs, wp.dataBase);
    const cdi = periodo ? await serieCdi(periodo.de, periodo.ate).catch(() => undefined) : undefined;
    console.log("CDI:", periodo ? `${periodo.de} a ${periodo.ate}, ${cdi?.length ?? 0} dias` : "não precisa");
    const r = montarResultado({
      workpaper: wp, posicoes, docs, ignorados, dataBase: wp.dataBase, cdi,
      fonteBritech: basename(LASTRO_CARTEIRA!), pastaLastro: basename(LASTRO_PASTA!),
    });
    console.log(`tempo ${((Date.now() - inicio) / 1000).toFixed(1)}s`, JSON.stringify(r.resumo, null, 1));
    for (const l of r.linhas) {
      const c = l.campos;
      console.log(`${l.situacao.padEnd(15)} ${l.ativo.slice(0, 40).padEnd(40)} R$ ${l.valorAplicado.padStart(15)} | ` +
        `valor ${c.valor.status} | emissão ${c.emissao.status} [${c.emissao.documentos}] | ` +
        `venc ${c.vencimento.status} [${c.vencimento.documentos}] | emissor ${c.emissor.status} | WP ${l.noWp ? l.wpLinha : "-"}`);
    }
    const erros = new Map<string, number>();
    for (const d of r.documentos) if (d.observacao) erros.set(d.observacao, (erros.get(d.observacao) ?? 0) + 1);
    console.log("observações dos documentos:", Object.fromEntries(erros));
    if (LASTRO_SAIDA) writeFileSync(LASTRO_SAIDA, Buffer.from(await gerarExcel(r)));
    expect(r.linhas.length).toBeGreaterThan(0);
  }, 600_000);
});
