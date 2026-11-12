"use client";

import { Check, ChevronDown, Download, FileSearch, FileText, Link2, Sparkles, Undo2 } from "lucide-react";
import { Fragment, useCallback, useMemo, useState } from "react";
import type { Comparacao, Relacao } from "@/lib/lastro/comparacao";
import { camposDe, type Campo, type ChaveCampo, type LinhaResultado, type Situacao } from "@/lib/lastro/conciliacao";
import type { ResultadoCompleto } from "@/lib/lastro/pipeline";
import { aplicarVinculos, type Vinculo } from "@/lib/lastro/marcacoes";
import { pendentes } from "@/lib/lastro/pre-classificacao";
import { aplicarAprovacoes, pontosDaLinha, resumirParaTela } from "@/lib/lastro/resumo";
import { detalhesPorCampo, documentosDoTitulo, type DetalheCampo } from "@/lib/lastro/detalhe";
import { cn } from "@/lib/utils";
import { BaterPdf } from "./bater-pdf";
import { ConferenciaPreClassificacao } from "./pre-classificacao";
import { Alternador } from "./comum";
import { corDoStatus, Status } from "./status";

const ORDEM: Situacao[] = ["Divergente", "Só no WP", "Verificar", "Provável", "OK", "Sem documentos"];

const COR_RELACAO: Record<Relacao, string> = {
  igual: "text-ok bg-ok/12 ring-ok/25",
  "campo diferente": "text-sky-300 bg-sky-400/12 ring-sky-400/25",
  "sem rótulo": "text-sky-300 bg-sky-400/12 ring-sky-400/25",
  calculado: "text-sky-300 bg-sky-400/12 ring-sky-400/25",
  aproximado: "text-aviso bg-aviso/12 ring-aviso/25",
};

/** Carteira × documento: cada valor/data com a coluna de onde veio e o rótulo/página onde está no documento. */
function TabelaComparacoes({ comparacoes, campos }: { comparacoes: Comparacao[]; campos: Campos }) {
  const rotulos = { ...Object.fromEntries(campos), aquisicao: "Dt. Aquisição" } as Record<string, string>;
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-creme/10">
      <table className="w-full text-xs">
        <thead className="bg-creme/[0.04] text-left text-creme/50">
          <tr>
            {["Campo", "Na carteira (coluna)", "Relação", "No documento (rótulo · página)", "Detalhe"].map((t) => (
              <th key={t} className="px-3 py-2 font-medium">{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparacoes.map((c, i) => (
            <tr key={i} className="border-t border-creme/[0.06] align-top">
              <td className="whitespace-nowrap px-3 py-2 text-creme/70">{c.tipo === "valor" ? rotulos.valor : rotulos[c.campo]}</td>
              <td className="px-3 py-2">
                <div className="tabular-nums text-creme">{c.carteira.valor}</div>
                <div className="text-creme/45">{c.carteira.coluna} · {c.carteira.origem}</div>
              </td>
              <td className="px-3 py-2">
                <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", COR_RELACAO[c.relacao])}>{c.relacao}</span>
              </td>
              <td className="max-w-[22rem] px-3 py-2">
                <div className="tabular-nums text-creme">{c.documento.valor}</div>
                <div className="break-words text-creme/45">
                  {c.documento.rotulo ? `"${c.documento.rotulo}"` : "sem rótulo"} · {c.documento.arquivo}{c.documento.pagina ? ` p. ${c.documento.pagina}` : ""}
                </div>
              </td>
              <td className="min-w-[18rem] px-3 py-2 leading-relaxed text-creme/60">{c.detalhe || c.documento.trecho}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
type Campos = [ChaveCampo, string][];

function CelulaCampo({ c }: { c: Campo }) {
  return (
    <td className="px-3 py-3 align-top">
      <div className="whitespace-nowrap tabular-nums text-creme">{c.britech || "—"}</div>
      <Status status={c.status} titulo={c.nota} className="mt-1.5" />
      {c.documentos && c.documentos !== c.britech && (
        <div className="mt-1 max-w-[14rem] text-xs leading-snug text-creme/55">docs: {c.documentos}</div>
      )}
    </td>
  );
}

function CelulaWp({ l }: { l: LinhaResultado }) {
  if (!l.noWp) return <td className="px-3 py-3 align-top text-xs text-creme/40">fora da WP_Termo</td>;
  const chaves = ["valor", "emissao", "vencimento"] as const;
  const status = chaves.map((k) => l.campos[k].wpStatus);
  const geral = status.includes("Diverge") ? "Diverge" : status.every((s) => s === "Confere") ? "Confere" : "Verificar";
  const difs = chaves.filter((k) => l.campos[k].wpStatus !== "Confere")
    .map((k) => `${{ valor: "VL", emissao: "emissão", vencimento: "venc." }[k]} ${l.campos[k].wp || "—"}`);
  return (
    <td className="px-3 py-3 align-top">
      <div className="whitespace-nowrap text-creme/80">linha {l.wpLinha}</div>
      <Status status={geral} className="mt-1.5" />
      {difs.length > 0 && <div className="mt-1 text-xs text-creme/55">WP: {difs.join(" · ")}</div>}
    </td>
  );
}

/** Abrir o Bater PDF já no documento e na página da evidência, procurando o valor. */
export interface AlvoPdf { termo: string; arquivo?: string; pagina?: number }
type AbrirPdf = (l: LinhaResultado, alvo?: AlvoPdf) => void;

const COR_STATUS_CAMPO: Record<string, { ponto: string; texto: string }> = {
  Confere: { ponto: "bg-ok", texto: "text-ok" },
  Provável: { ponto: "bg-sky-400", texto: "text-sky-300" },
  Diverge: { ponto: "bg-erro", texto: "text-erro" },
  Verificar: { ponto: "bg-aviso", texto: "text-aviso" },
  "Não localizado": { ponto: "bg-creme/35", texto: "text-creme/55" },
};
const SEM_STATUS = { ponto: "bg-creme/25", texto: "text-creme/55" };

/** Nome do arquivo sem a extensão (o nome inteiro fica no título, ao passar o mouse). */
const semExtensao = (arquivo: string) => arquivo.replace(/\.[a-z0-9]{2,5}$/i, "");

function LinhaDoCampo({ d, onAbrir }: { d: DetalheCampo; onAbrir?: (alvo: AlvoPdf) => void }) {
  const cor = d.status ? COR_STATUS_CAMPO[d.status] ?? SEM_STATUS : SEM_STATUS;
  return (
    <li className="grid gap-x-4 gap-y-1 px-3 py-2.5 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
      <div className="flex items-center gap-2 self-start pt-0.5">
        <span className={cn("size-1.5 shrink-0 rounded-full", cor.ponto)} />
        <span className="text-sm text-creme/75">{d.rotulo}</span>
      </div>
      <div className="min-w-0 space-y-1 text-sm">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="tabular-nums text-creme">{d.carteira || "—"}</span>
          {d.porque && <span className={cor.texto}>{d.porque}</span>}
        </p>
        {d.achado && (
          <p className="flex min-w-0 items-baseline gap-1.5 text-xs text-creme/55">
            <span className="shrink-0">{d.status === "Confere" || d.achado.relacao === "igual" || d.achado.relacao === "citado" ? "✓" : "≈"}</span>
            <span className="min-w-0 truncate" title={`${d.achado.arquivo}${d.achado.trecho ? ` — ${d.achado.trecho}` : ""}`}>
              {semExtensao(d.achado.arquivo)}
            </span>
            {d.achado.pagina > 0 && <span className="shrink-0">p. {d.achado.pagina}</span>}
            {d.achado.rotulo && <span className="hidden shrink-0 text-creme/40 md:inline">· &quot;{d.achado.rotulo}&quot;</span>}
            {onAbrir && (
              <button
                type="button"
                onClick={() => onAbrir({ termo: d.achado!.valor, arquivo: d.achado!.arquivo, pagina: d.achado!.pagina })}
                className="shrink-0 text-primary underline-offset-4 hover:underline"
              >
                abrir
              </button>
            )}
          </p>
        )}
        {d.outros.length > 0 && (
          <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-creme/55">
            <span>{d.achado ? "outros documentos trazem" : "os documentos trazem"}</span>
            {d.outros.slice(0, 4).map((o) => (
              <button
                key={o.valor}
                type="button"
                onClick={() => onAbrir?.({ termo: o.valor })}
                className="tabular-nums text-aviso underline-offset-4 hover:underline"
                title="Procurar este valor nos PDFs"
              >
                {o.valor}{o.docs > 1 ? ` (${o.docs} docs)` : ""}
              </button>
            ))}
            {d.outros.length > 4 && <span>+{d.outros.length - 4}</span>}
          </p>
        )}
        {d.wp && (
          <p className="text-xs text-creme/55">
            WP_Termo: <span className="tabular-nums text-aviso">{d.wp.valor || "em branco"}</span> ({d.wp.status === "Diverge" ? "diverge" : "conferir"})
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * O detalhe do título, campo a campo: o valor da carteira, onde ele aparece (arquivo e página, com atalho para abrir),
 * os outros valores dos documentos e o porquê numa frase. As comparações e evidências completas ficam em "ver tudo".
 */
function Detalhe({ l, campos, onBaterPdf }: { l: LinhaResultado; campos: Campos; onBaterPdf?: AbrirPdf }) {
  const [tudo, setTudo] = useState(false);
  const detalhes = useMemo(() => detalhesPorCampo(l, campos), [l, campos]);
  const docs = useMemo(() => documentosDoTitulo(l), [l]);
  const rotulos = Object.fromEntries(campos) as Record<string, string>;
  const abrir = onBaterPdf ? (alvo: AlvoPdf) => onBaterPdf(l, alvo) : undefined;
  return (
    <div className="space-y-3 px-4 pb-4 pt-1">
      <ul className="divide-y divide-creme/[0.06] rounded-xl bg-creme/[0.02] ring-1 ring-creme/10">
        {detalhes.map((d) => <LinhaDoCampo key={d.chave} d={d} onAbrir={abrir} />)}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-creme/50">
        <p className="min-w-0">
          {docs.length
            ? <>Documentos ligados ({docs.length}): {docs.slice(0, 3).map((d) => semExtensao(d.arquivo)).join(" · ")}{docs.length > 3 ? ` +${docs.length - 3}` : ""}</>
            : "Nenhum documento da pasta foi ligado a este título."}
        </p>
        {(l.comparacoes.length > 0 || l.evidencias.length > 0) && (
          <button type="button" onClick={() => setTudo((t) => !t)} className="inline-flex items-center gap-1 underline-offset-4 hover:text-creme hover:underline">
            {tudo ? "Esconder as comparações e evidências" : `Ver todas as comparações e evidências (${l.comparacoes.length + l.evidencias.length})`}
            <ChevronDown className={cn("size-3.5 transition-transform", tudo && "rotate-180")} />
          </button>
        )}
      </div>
      {tudo && (
        <div className="space-y-3">
          {campos.some(([k]) => l.campos[k].nota) && (
            <ul className="space-y-1 text-xs leading-relaxed text-creme/55">
              {campos.filter(([k]) => l.campos[k].nota).map(([k, rot]) => <li key={k}><span className="text-creme/75">{rot}:</span> {l.campos[k].nota}</li>)}
            </ul>
          )}
          {l.comparacoes.length > 0 && <TabelaComparacoes comparacoes={l.comparacoes} campos={campos} />}
          {l.evidencias.length > 0 && (
            <div className="overflow-x-auto rounded-xl ring-1 ring-creme/10">
              <table className="w-full text-xs">
                <thead className="bg-creme/[0.04] text-left text-creme/50">
                  <tr>
                    {["Campo", "No documento", "x carteira", "Documento", "Ligação", "Trecho"].map((t) => (
                      <th key={t} className="px-3 py-2 font-medium">{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {l.evidencias.map((e, i) => (
                    <tr key={i} className="border-t border-creme/[0.06] align-top">
                      <td className="whitespace-nowrap px-3 py-2 text-creme/70">{rotulos[e.campo]}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-creme">{e.valor}</td>
                      <td className="px-3 py-2"><Status status={e.confere ? "Confere" : "Diverge"} /></td>
                      <td className="max-w-[16rem] break-words px-3 py-2 text-creme/80">{e.documento}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-creme/55">{e.nivel}</td>
                      <td className="min-w-[22rem] px-3 py-2 leading-relaxed text-creme/60">{e.trecho}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TabelaCompleta({ resultado, onBaterPdf }: { resultado: ResultadoCompleto; onBaterPdf: AbrirPdf }) {
  const [filtro, setFiltro] = useState<Situacao | "">("");
  const [soWp, setSoWp] = useState(false);
  const [abertas, setAbertas] = useState<Set<number>>(new Set());
  const r = resultado;
  const rec = r.tipo === "recebiveis";
  const campos = camposDe(r.tipo);

  const linhas = useMemo(
    () => r.linhas.filter((l) => (!filtro || l.situacao === filtro) && (!soWp || l.noWp)),
    [r.linhas, filtro, soWp],
  );
  const alternar = (id: number) =>
    setAbertas((atual) => {
      const nova = new Set(atual);
      if (nova.has(id)) nova.delete(id);
      else nova.add(id);
      return nova;
    });

  const tiles: { chave: Situacao | ""; rotulo: string; n: number }[] = [
    { chave: "", rotulo: "Todos", n: r.linhas.length },
    ...ORDEM.map((k) => ({ chave: k, rotulo: k, n: r.linhas.filter((l) => l.situacao === k).length })).filter((t) => t.n > 0),
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => {
          const ativo = filtro === t.chave;
          return (
            <button
              key={t.rotulo}
              type="button"
              onClick={() => setFiltro(t.chave)}
              className={cn(
                "rounded-2xl border px-4 py-3 text-left transition-colors",
                ativo ? "border-creme/50 bg-creme/[0.07]" : "border-border bg-card hover:border-creme/25",
              )}
            >
              <span className={cn("block text-3xl font-medium tracking-tight tabular-nums",
                t.chave ? corDoStatus(t.chave).split(" ")[0] : "text-creme")}>{t.n}</span>
              <span className="text-xs text-creme/60">{t.rotulo}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-creme/70">
          <input type="checkbox" checked={soWp} onChange={(e) => setSoWp(e.target.checked)} className="size-4 accent-[#e1e0cc]" />
          Só os itens da WP_Termo (amostra)
        </label>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-creme/50">
              {["", "Situação", rec ? "Recebível / Sacado" : "Ativo / Emissor", campos[0][1], "Dt. Emissão", "Dt. Vencimento", `${campos[3][1]} nos docs`, "WP_Termo"].map((t, i) => (
                <th key={i} className="px-3 py-3 font-medium">{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-creme/50">Nenhum item neste filtro.</td></tr>
            )}
            {linhas.map((l) => {
              const aberta = abertas.has(l.id);
              return (
                <Fragment key={l.id}>
                  <tr
                    onClick={() => alternar(l.id)}
                    className={cn("cursor-pointer border-t border-creme/[0.06] transition-colors hover:bg-creme/[0.03]", aberta && "bg-creme/[0.03]")}
                  >
                    <td className="w-8 px-3 py-3 align-top">
                      <ChevronDown className={cn("size-4 text-creme/40 transition-transform", aberta && "rotate-180")} />
                    </td>
                    <td className="px-3 py-3 align-top"><Status status={l.situacao} /></td>
                    <td className="max-w-[22rem] px-3 py-3 align-top">
                      <div className="font-medium text-creme">{l.ativo || "—"}</div>
                      <div className="mt-0.5 text-xs text-creme/50">
                        {[l.emissor, l.codigo && `cód. ${l.codigo}`, l.dataAquisicao && `aquisição ${l.dataAquisicao}`].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <CelulaCampo c={l.campos.valor} />
                    <CelulaCampo c={l.campos.emissao} />
                    <CelulaCampo c={l.campos.vencimento} />
                    <td className="px-3 py-3 align-top">
                      <Status status={l.campos.emissor.status} titulo={l.campos.emissor.nota} />
                      {l.campos.emissor.status !== "Confere" && l.campos.emissor.documentos && (
                        <div className="mt-1 max-w-[12rem] text-xs text-creme/55">{l.campos.emissor.documentos}</div>
                      )}
                    </td>
                    <CelulaWp l={l} />
                  </tr>
                  {aberta && (
                    <tr className="bg-creme/[0.02]">
                      <td colSpan={8}>
                        <div className="flex justify-end px-3 pt-3">
                          <button type="button" onClick={() => onBaterPdf(l)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-creme/75 ring-1 ring-creme/20 hover:bg-creme/[0.06]">
                            <FileSearch className="size-3.5" /> Bater PDF
                          </button>
                        </div>
                        <Detalhe l={l} campos={campos} onBaterPdf={onBaterPdf} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const COR_PONTO = { diverge: "bg-erro", conferir: "bg-aviso", aproximado: "bg-sky-400" } as const;
const COR_OUTRO = { diverge: "text-erro", conferir: "text-aviso", aproximado: "text-sky-300" } as const;

/**
 * Um título que precisa de atenção, direto ao ponto: uma linha por campo — o que está na carteira × o que os
 * documentos (ou a WP_Termo) trazem. O porquê, as comparações e as evidências abrem em "Detalhes".
 */
function CartaoAtencao({ l, campos, onBaterPdf, acao, confirma }: {
  l: LinhaResultado; campos: Campos; onBaterPdf: AbrirPdf; acao?: React.ReactNode; confirma?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const pontos = pontosDaLinha(l, campos);
  const rec = campos[3][1] === "Sacado";
  const vl = l.campos.valor.britech || l.campos.valor.wp;
  const sub = [rec && l.emissor, vl && `${rec ? "valor" : "VL"} ${vl}`, l.noWp && `WP_Termo linha ${l.wpLinha}`].filter(Boolean).join(" · ");
  return (
    <li className="rounded-xl border border-border bg-card" data-cartao={l.id}>
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Status status={l.situacao} />
          <p className="min-w-0 flex-1 truncate font-medium text-creme" title={l.ativo || l.emissor}>{l.ativo || l.emissor || "—"}</p>
          {sub && <p className="hidden max-w-[40%] truncate text-xs text-creme/45 lg:block" title={sub}>{sub}</p>}
          <div className="flex shrink-0 items-center gap-1">
            {acao}
            <button
              type="button"
              onClick={() => onBaterPdf(l)}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-creme/75 ring-1 ring-creme/15 hover:bg-creme/[0.06]"
            >
              <FileSearch className="size-3.5" /> Bater PDF
            </button>
            <button
              type="button"
              onClick={() => setAberto((a) => !a)}
              aria-expanded={aberto}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-creme/55 hover:bg-creme/[0.06] hover:text-creme"
            >
              Detalhes <ChevronDown className={cn("size-3.5 transition-transform", aberto && "rotate-180")} />
            </button>
          </div>
        </div>
        {sub && <p className="mt-0.5 truncate text-xs text-creme/45 lg:hidden">{sub}</p>}
        {confirma && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-ok">
            <Check className="size-3.5" /> {campos[0][1]} e {campos[1][1]} conferem com os documentos
          </p>
        )}
        <ul className={cn("mt-2 space-y-1 text-sm", aberto && "hidden")}>
          {pontos.map((p, i) => (
            <li key={i} className="grid grid-cols-[0.375rem_minmax(0,1fr)] items-baseline gap-x-2.5 sm:grid-cols-[0.375rem_8rem_minmax(0,1fr)]">
              <span className={cn("size-1.5 translate-y-[-0.1rem] rounded-full", COR_PONTO[p.tipo])} />
              <span className="text-creme/55">{p.campo}</span>
              <span className="col-start-2 truncate tabular-nums sm:col-start-auto" title={`${p.carteira || "—"} × ${p.lado === "WP_Termo" ? "WP_Termo " : ""}${p.outro || p.semValor}`}>
                <span className="text-creme">{p.carteira || "—"}</span>
                <span className="px-2 text-creme/30">×</span>
                {p.lado === "WP_Termo" && <span className="text-creme/45">WP_Termo </span>}
                <span className={p.outro ? COR_OUTRO[p.tipo] : "text-creme/45"}>{p.outro || p.semValor}</span>
              </span>
            </li>
          ))}
        </ul>
        {l.manual && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-sky-300"><Link2 className="size-3.5" /> vinculado à mão: {l.manual}</p>
        )}
      </div>
      {aberto && <div className="border-t border-border pt-4"><Detalhe l={l} campos={campos} onBaterPdf={onBaterPdf} /></div>}
    </li>
  );
}

/** Lista de cartões em blocos (50 por vez), para a tela não pesar com centenas de títulos. */
function ListaDeCartoes({ linhas, campos, onBaterPdf, acaoDe, confirma }: {
  linhas: LinhaResultado[]; campos: Campos; onBaterPdf: AbrirPdf;
  acaoDe?: (l: LinhaResultado) => React.ReactNode; confirma?: boolean;
}) {
  const [mostrar, setMostrar] = useState(50);
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {linhas.slice(0, mostrar).map((l) => (
          <CartaoAtencao key={l.id} l={l} campos={campos} onBaterPdf={onBaterPdf} acao={acaoDe?.(l)} confirma={confirma} />
        ))}
      </ul>
      {linhas.length > mostrar && (
        <button
          type="button"
          onClick={() => setMostrar((n) => n + 100)}
          className="w-full rounded-xl px-4 py-2.5 text-sm text-creme/70 ring-1 ring-creme/15 hover:bg-creme/[0.06]"
        >
          Mostrar mais ({linhas.length - mostrar} restantes)
        </button>
      )}
    </div>
  );
}

/** Títulos validados ou pendentes, uma linha cada (os detalhes ficam na tabela completa e no Excel). */
function ListaCompacta({ linhas, acaoDe }: { linhas: LinhaResultado[]; acaoDe?: (l: LinhaResultado) => React.ReactNode }) {
  const [mostrar, setMostrar] = useState(50);
  if (!linhas.length) return null;
  return (
    <div>
      <ul className="divide-y divide-creme/[0.06] text-sm">
        {linhas.slice(0, mostrar).map((l) => (
          <li key={l.id} className="flex flex-col gap-0.5 px-1 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span className="min-w-0 truncate text-creme/85">
              {l.ativo || "—"}
              {l.emissor && l.ativo ? <span className="text-creme/45"> · {l.emissor}</span> : null}
            </span>
            <span className="flex shrink-0 items-center gap-3 text-xs tabular-nums text-creme/55">
              {[
                l.campos.valor.britech && `VL ${l.campos.valor.britech}`,
                l.campos.vencimento.britech && `venc. ${l.campos.vencimento.britech}`,
              ].filter(Boolean).join(" · ")}
              {acaoDe?.(l)}
            </span>
          </li>
        ))}
      </ul>
      {linhas.length > mostrar && (
        <button type="button" onClick={() => setMostrar((n) => n + 200)} className="mt-2 w-full rounded-xl py-2 text-xs text-creme/60 ring-1 ring-creme/15 hover:bg-creme/[0.06]">
          Mostrar mais ({linhas.length - mostrar})
        </button>
      )}
    </div>
  );
}

const TOM_BLOCO = {
  atencao: { borda: "border-erro/25", ponto: "bg-erro" },
  validado: { borda: "border-ok/25", ponto: "bg-ok" },
  pendente: { borda: "border-border", ponto: "bg-creme/35" },
} as const;

/** Um dos três blocos do resumo, expansível, com o que ele significa logo abaixo do título. */
function Bloco({ tom, titulo, n, descricao, aberto, children }: {
  tom: keyof typeof TOM_BLOCO; titulo: string; n: number; descricao: string; aberto?: boolean; children: React.ReactNode;
}) {
  return (
    <details className={cn("group rounded-2xl border bg-card", TOM_BLOCO[tom].borda)} open={aberto}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4">
        <span className={cn("size-2.5 shrink-0 rounded-full", TOM_BLOCO[tom].ponto)} />
        <span className="min-w-0 flex-1">
          <span className="font-medium text-creme">{titulo}</span> <span className="tabular-nums text-creme/50">({n})</span>
          <span className="mt-0.5 block text-xs text-creme/50">{descricao}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-creme/50 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-border p-3">{children}</div>
    </details>
  );
}

export function Resultado({ resultado, onBaixar, baixando }: {
  resultado: ResultadoCompleto; onBaixar: (r: ResultadoCompleto) => void; baixando: boolean;
}) {
  const [vista, setVista] = useState<"resumo" | "tabela">("resumo");
  const [vinculos, setVinculos] = useState<Map<number, Vinculo>>(() => new Map());
  const [bater, setBater] = useState<{ linhaId: number | null; termo: string; doc?: { nome: string; pagina: number } } | null>(null);
  const [preAberta, setPreAberta] = useState(false);
  const [aprovados, setAprovados] = useState<Set<number>>(() => new Set());
  // os vínculos feitos à mão no Bater PDF e as aprovações do analista valem mais que a conferência automática (tela e Excel)
  const r = useMemo(
    () => ({ ...resultado, linhas: aplicarAprovacoes(aplicarVinculos(resultado.linhas, vinculos), aprovados) }),
    [resultado, vinculos, aprovados],
  );
  const aprovar = (ids: number[], sim: boolean) => setAprovados((a) => {
    const n = new Set(a);
    for (const id of ids) {
      if (sim) n.add(id);
      else n.delete(id);
    }
    return n;
  });
  const s = r.resumo;
  const tela = useMemo(() => resumirParaTela(r.linhas, r.tipo), [r.linhas, r.tipo]);
  const rec = r.tipo === "recebiveis";
  const campos = camposDe(r.tipo);
  const termoDe = (l: LinhaResultado) =>
    (rec && l.codigo.length >= 3 ? l.codigo : "") || l.campos.valor.britech.split(" ")[0] || l.emissor.split(" ").slice(0, 2).join(" ");
  const abrirBater = (l: LinhaResultado | null, alvo?: AlvoPdf) => setBater({
    linhaId: l?.id ?? null, termo: alvo?.termo ?? (l ? termoDe(l) : ""),
    doc: alvo?.arquivo ? { nome: alvo.arquivo, pagina: alvo.pagina ?? 1 } : undefined,
  });
  const fecharBater = useCallback(() => setBater(null), []);
  const fecharPre = useCallback(() => setPreAberta(false), []);
  const nPendentes = useMemo(() => pendentes(r.linhas).length, [r.linhas]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <p className="text-sm text-creme/60">{s.fundo} · CNPJ {s.cnpj} · data-base {s.dataBase}</p>
          <p className={cn("text-3xl font-medium tracking-tight md:text-4xl", tela.atencao.length ? "text-creme" : "text-ok")}>{tela.titulo}</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {/* o título já diz quantos precisam de atenção (ou aguardam aprovação); aqui vão os outros números */}
            {tela.aprovar.length > 0 && tela.atencao.length > 0 && (
              <span className="text-sky-300"><b className="font-medium tabular-nums">{tela.aprovar.length}</b> {tela.aprovar.length === 1 ? "aguarda" : "aguardam"} aprovação</span>
            )}
            <span className="text-ok"><b className="font-medium tabular-nums">{tela.validados.length}</b> validados</span>
            <span className="text-creme/50"><b className="font-medium tabular-nums">{tela.pendentes.length}</b> pendentes</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => onBaixar(r)}
          disabled={baixando}
          className="group inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-primary py-1 pl-5 pr-1 text-sm font-medium text-black transition-all hover:gap-3 disabled:opacity-60 md:self-auto"
        >
          {baixando ? "Gerando Excel…" : "Baixar Excel com as evidências"}
          <span className="flex size-9 items-center justify-center rounded-full bg-black">
            <Download className="size-4 text-creme" />
          </span>
        </button>
      </div>

      {r.avisos.length > 0 && (
        <div className="space-y-1 text-sm">{r.avisos.map((a) => <p key={a} className="text-aviso">⚠ {a}</p>)}</div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="sm:w-80">
          <Alternador
            valor={vista}
            onMudar={setVista}
            opcoes={[{ valor: "resumo", rotulo: "Resumo" }, { valor: "tabela", rotulo: "Tabela completa" }]}
          />
        </div>
        {r.docs.length > 0 && (
          <div className="flex flex-wrap gap-2 self-start sm:self-auto">
            <button type="button" onClick={() => abrirBater(null)} className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-creme/80 ring-1 ring-creme/20 hover:bg-creme/[0.06]">
              <FileSearch className="size-4" /> Buscar nos PDFs
            </button>
            {nPendentes > 0 && (
              <button
                type="button"
                onClick={() => setPreAberta(true)}
                title="Sugere o documento e a marca de cada campo das pendências, para conferir em lote"
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-creme/80 ring-1 ring-primary/50 hover:bg-primary/10"
              >
                <Sparkles className="size-4 text-primary" /> Pré-classificar pendências ({nPendentes})
              </button>
            )}
          </div>
        )}
        <p className="text-xs text-creme/45">
          {s.posicoesBritech} {rec ? "recebível(is) na carteira" : "título(s) na Britech"} · {s.linhasWpTermo} na WP_Termo · {s.documentosLidos} documento(s) lido(s)
          {s.documentosSemTexto ? `, ${s.documentosSemTexto} sem texto` : ""}
          {s.arquivosIgnorados ? `, ${s.arquivosIgnorados} não lido(s)` : ""}
        </p>
      </div>

      {vista === "resumo" ? (
        <div className="space-y-3">
          <Bloco
            tom="atencao"
            titulo="Precisam de atenção"
            n={tela.atencao.length}
            aberto={tela.atencao.length > 0}
            descricao={`Divergem dos documentos ou da WP_Termo, ou ainda falta confirmar. Em cada linha: ${rec ? "carteira" : "Britech"} × documentos; o porquê está em "Detalhes".`}
          >
            {tela.atencao.length > 0
              ? <ListaDeCartoes linhas={tela.atencao} campos={campos} onBaterPdf={abrirBater} />
              : <p className="px-2 py-1 text-sm text-creme/60">Nenhum {rec ? "recebível" : "título"} diverge dos documentos nem da WP_Termo.</p>}
          </Bloco>

          <Bloco
            tom="validado"
            titulo="Validados"
            n={tela.validados.length + tela.aprovar.length}
            aberto={tela.aprovar.length > 0}
            descricao={`Conferem com os documentos. Os que têm ${campos[0][1]} e ${campos[1][1]} batendo ficam validados visualmente e aguardam a sua aprovação.`}
          >
            {tela.aprovar.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                  <p className="text-sm text-sky-300">Aguardando sua aprovação ({tela.aprovar.length})</p>
                  <button
                    type="button"
                    onClick={() => aprovar(tela.aprovar.map((l) => l.id), true)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-black"
                  >
                    <Check className="size-3.5" /> Aprovar todos ({tela.aprovar.length})
                  </button>
                </div>
                <ListaDeCartoes
                  linhas={tela.aprovar}
                  campos={campos}
                  onBaterPdf={abrirBater}
                  confirma
                  acaoDe={(l) => (
                    <button type="button" onClick={() => aprovar([l.id], true)} className="inline-flex items-center gap-1 rounded-full bg-ok/15 px-2.5 py-1 text-xs text-ok ring-1 ring-ok/30 hover:bg-ok/25">
                      <Check className="size-3.5" /> Aprovar
                    </button>
                  )}
                />
              </div>
            )}
            {tela.validados.length > 0 && (
              <div className="space-y-1">
                {tela.aprovar.length > 0 && <p className="px-1 pt-2 text-sm text-ok">100% validados ({tela.validados.length})</p>}
                <ListaCompacta
                  linhas={tela.validados}
                  acaoDe={(l) => l.aprovado && (
                    <button type="button" onClick={() => aprovar([l.id], false)} className="inline-flex items-center gap-1 text-sky-300 hover:underline" title="Desfazer a aprovação">
                      aprovado por você <Undo2 className="size-3.5" />
                    </button>
                  )}
                />
              </div>
            )}
            {!tela.validados.length && !tela.aprovar.length && <p className="px-2 py-1 text-sm text-creme/60">Nenhum {rec ? "recebível" : "título"} validado ainda.</p>}
          </Bloco>

          <Bloco
            tom="pendente"
            titulo="Pendentes"
            n={tela.pendentes.length}
            descricao={rec
              ? "Nenhum documento da pasta traz o valor, o número ou o sacado. Se forem muitos, confira se a pasta de lastro é a do fundo."
              : "Nenhum documento da pasta traz o VL Aplic. nem cita o emissor. Se forem muitos, confira se a pasta de lastro é a do fundo."}
          >
            {tela.pendentes.length > 0
              ? (
                <ListaCompacta
                  linhas={tela.pendentes}
                  acaoDe={(l) => (
                    <button type="button" onClick={() => abrirBater(l)} className="inline-flex items-center gap-1 text-creme/70 hover:text-creme hover:underline">
                      <FileSearch className="size-3.5" /> Bater PDF
                    </button>
                  )}
                />
              )
              : <p className="px-2 py-1 text-sm text-creme/60">Nenhum pendente.</p>}
          </Bloco>
          <p className="break-all text-xs text-creme/40">Carteira: {s.fonteBritech}</p>
        </div>
      ) : (
        <TabelaCompleta resultado={r} onBaterPdf={abrirBater} />
      )}

      {preAberta && (
        <ConferenciaPreClassificacao
          resultado={r}
          linhas={r.linhas}
          campos={campos}
          pausado={!!bater}
          onAplicar={(pares) => setVinculos((m) => {
            const n = new Map(m);
            for (const [id, v] of pares) n.set(id, v);
            return n;
          })}
          onBuscar={(l, termo) => setBater({ linhaId: l.id, termo })}
          onFechar={fecharPre}
        />
      )}

      {bater && (
        <BaterPdf
          resultado={r}
          linha={bater.linhaId !== null ? r.linhas.find((x) => x.id === bater.linhaId) ?? null : null}
          campos={campos}
          termoInicial={bater.termo}
          docInicial={bater.doc}
          onVincular={(id, v) => {
            setVinculos((m) => new Map(m).set(id, v));
            setBater(null);
          }}
          onFechar={fecharBater}
        />
      )}
    </div>
  );
}

export function Inventario({ resultado }: { resultado: ResultadoCompleto }) {
  const { documentos, ignorados } = resultado;
  return (
    <details className="group rounded-2xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
        <span className="flex items-center gap-3 text-creme">
          <FileText className="size-4 text-creme/60" />
          {documentos.length} documento(s) lido(s) · {ignorados.length} não lido(s)
        </span>
        <ChevronDown className="size-4 text-creme/50 transition-transform group-open:rotate-180" />
      </summary>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full min-w-[860px] text-xs">
          <thead className="text-left text-creme/50">
            <tr>
              {["Arquivo", "Tipo", "Páginas", "Cita CNPJ do fundo", "Ligado a", "Observação"].map((t) => (
                <th key={t} className="px-4 py-2.5 font-medium">{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {documentos.map((d) => (
              <tr key={d.caminho} className="border-t border-creme/[0.06] align-top">
                <td className="max-w-[22rem] break-words px-4 py-2 text-creme/85">{d.caminho}</td>
                <td className="px-4 py-2 text-creme/60">{d.tipo}</td>
                <td className="whitespace-nowrap px-4 py-2 text-creme/60">{d.paginas}</td>
                <td className="px-4 py-2 text-creme/60">{d.citaCnpjFundo ? "Sim" : "Não"}</td>
                <td className="max-w-[20rem] px-4 py-2 text-creme/70">{d.vinculos.join(" · ") || "—"}</td>
                <td className="px-4 py-2 text-creme/55">{d.observacao}</td>
              </tr>
            ))}
            {ignorados.map((i) => (
              <tr key={i.nome} className="border-t border-creme/[0.06] align-top">
                <td className="px-4 py-2 text-creme/60">{i.nome}</td>
                <td className="px-4 py-2 text-creme/40">—</td>
                <td className="px-4 py-2 text-creme/40">—</td>
                <td className="px-4 py-2 text-creme/40">—</td>
                <td className="px-4 py-2 text-creme/40">—</td>
                <td className="px-4 py-2 text-aviso/80">{i.motivo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
