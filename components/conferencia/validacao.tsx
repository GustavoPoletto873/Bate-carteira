"use client";

import { ChevronDown } from "lucide-react";
import type { StatusValidacao, ValidacaoCarteira } from "@/lib/lastro/validacao-carteira";
import { fmtData, fmtValor } from "@/lib/lastro/textos";
import { cn } from "@/lib/utils";

const COR: Record<StatusValidacao, string> = {
  OK: "text-ok bg-ok/12 ring-ok/25",
  VERIFICAR: "text-erro bg-erro/12 ring-erro/25",
  "SEM DADOS": "text-creme/55 bg-creme/6 ring-creme/10",
};

function Selo({ status }: { status: StatusValidacao }) {
  return <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", COR[status])}>{status}</span>;
}

const reais = (c: number | null) => (c === null ? "—" : fmtValor(c));
const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);

function Tabela({ titulo, cabecalho, linhas }: { titulo: string; cabecalho: string[]; linhas: React.ReactNode[][] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-creme/45">{titulo}</p>
      <div className="overflow-x-auto rounded-xl ring-1 ring-creme/10">
        <table className="w-full text-xs">
          <thead className="bg-creme/[0.04] text-left text-creme/50">
            <tr>{cabecalho.map((t, i) => <th key={i} className={cn("px-3 py-2 font-medium", i > 0 && "text-right")}>{t}</th>)}</tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i} className="border-t border-creme/[0.06]">
                {l.map((c, j) => <td key={j} className={cn("px-3 py-2", j === 0 ? "text-creme/80" : "text-right tabular-nums text-creme")}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Validação da carteira enviada pela administradora, no mesmo formato da aba CVM do workpaper. */
export function ValidacaoDaCarteira({ v }: { v: ValidacaoCarteira }) {
  const statusEstoque: StatusValidacao = !v.estoque.length ? "SEM DADOS" : v.estoque.some((e) => e.status === "VERIFICAR") ? "VERIFICAR" : "OK";
  return (
    <details className="group rounded-2xl border border-border bg-card" open={v.status === "VERIFICAR"}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4">
        <span className="flex flex-wrap items-center gap-3 text-creme">
          Validação da carteira <span className="text-xs text-creme/45">(como a aba CVM do WP{v.dataBase ? `, ${fmtData(v.dataBase)}` : ""})</span>
          <span className="flex items-center gap-1.5 text-xs text-creme/60">PL <Selo status={v.statusPl} /></span>
          <span className="flex items-center gap-1.5 text-xs text-creme/60">Estoque <Selo status={statusEstoque} /></span>
        </span>
        <ChevronDown className="size-4 text-creme/50 transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid gap-5 border-t border-border p-4 lg:grid-cols-2">
        <Tabela
          titulo="Composição da carteira (aba carteiraInforme)"
          cabecalho={["Categoria", "R$", "% PL"]}
          linhas={[
            ...v.composicao.filter((c) => c.valor !== 0).map((c) => [c.categoria, reais(c.valor), pct(c.pctPl)]),
            ...v.foraDasCategorias.map((c) => [<span key="f" className="text-aviso">fora das categorias: {c.mapeamento}</span>, reais(c.valor), "—"]),
            [<b key="pl" className="font-medium text-creme">Patrimônio líquido</b>, reais(v.pl), <Selo key="s" status={v.statusPl} />],
            ["Soma das categorias", reais(v.somaCategorias), v.pl === null ? "—" : `dif ${reais(v.pl - v.somaCategorias)}`],
          ]}
        />
        <div className="space-y-5">
          {v.estoque.length ? (
            <Tabela
              titulo="Carteira × estoque"
              cabecalho={["Item", "Carteira", "Estoque", "Diferença", ""]}
              linhas={v.estoque.map((e) => [
                <span key="i">{e.item} <span className="text-creme/40">({e.quantidade})</span></span>,
                reais(e.carteira), reais(e.estoque), reais(e.diferenca), <Selo key="s" status={e.status} />,
              ])}
            />
          ) : (
            <p className="text-xs text-creme/50">Carteira × estoque: {v.origemEstoque}.</p>
          )}
          {v.estoque.length > 0 && <p className="-mt-3 break-all text-xs text-creme/40">Estoque: {v.origemEstoque}</p>}
          {v.avisoEstoque && <p className="-mt-3 text-xs text-aviso">⚠ {v.avisoEstoque}</p>}
          <Tabela
            titulo="Amostra (WP_Termo)"
            cabecalho={["Categoria", "Qtde", "R$", "% PL"]}
            linhas={v.amostra.filter((a) => a.quantidade).map((a) => [a.categoria, a.quantidade, reais(a.valor), pct(a.pctPl)])}
          />
          <Tabela
            titulo="Verificação de lastro"
            cabecalho={["", "Total", "V", "P"]}
            linhas={v.verificacao.map((x) => [x.item, x.total, x.verificados, x.pendentes])}
          />
        </div>
      </div>
    </details>
  );
}
