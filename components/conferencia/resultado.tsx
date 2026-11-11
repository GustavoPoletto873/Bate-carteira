"use client";

import { ChevronDown, Download, FileText } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { camposDe, type Campo, type ChaveCampo, type LinhaResultado, type Situacao } from "@/lib/lastro/conciliacao";
import type { ResultadoCompleto } from "@/lib/lastro/pipeline";
import { pendenciasDaLinha, resumirParaTela } from "@/lib/lastro/resumo";
import { cn } from "@/lib/utils";
import { Alternador } from "./comum";
import { corDoStatus, Status } from "./status";

const ORDEM: Situacao[] = ["Divergente", "Só no WP", "Verificar", "OK", "Sem documentos"];
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

function Detalhe({ l, campos, semNotas = false }: { l: LinhaResultado; campos: Campos; semNotas?: boolean }) {
  const rotulos = Object.fromEntries(campos) as Record<string, string>;
  const notas = semNotas ? [] : campos.filter(([k]) => l.campos[k].nota).map(([k, rot]) => `${rot}: ${l.campos[k].nota}`);
  return (
    <div className="space-y-3 px-3 pb-5 pt-1">
      {notas.length > 0 && (
        <ul className="space-y-1 text-sm text-aviso/90">
          {notas.map((n) => <li key={n}>• {n}</li>)}
        </ul>
      )}
      {l.evidencias.length === 0 ? (
        <p className="text-sm text-creme/50">Nenhum documento da pasta foi ligado a este título.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-creme/10">
          <table className="w-full text-xs">
            <thead className="bg-creme/[0.04] text-left text-creme/50">
              <tr>
                {["Campo", "No documento", "x Britech", "Documento", "Ligação", "Trecho"].map((t) => (
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
  );
}

function TabelaCompleta({ resultado }: { resultado: ResultadoCompleto }) {
  const [filtro, setFiltro] = useState<Situacao | "">("");
  const [soWp, setSoWp] = useState(false);
  const [abertas, setAbertas] = useState<Set<number>>(new Set());
  const r = resultado;
  const rec = r.tipo === "recebiveis";
  const campos = camposDe(r.tipo);
  const s = r.resumo;

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
    ...ORDEM.filter((k) => s.contagem[k]).map((k) => ({ chave: k, rotulo: k, n: s.contagem[k] ?? 0 })),
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
                      <td colSpan={8}><Detalhe l={l} campos={campos} /></td>
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

const ROTULO_PARTE: Record<Situacao, (n: number) => string> = {
  Divergente: (n) => (n === 1 ? "divergente" : "divergentes"),
  "Só no WP": () => "só na WP_Termo",
  Verificar: () => "para verificar",
  "Sem documentos": () => "sem documentos",
  OK: (n) => (n === 1 ? "confere" : "conferem"),
};

/** Um título que precisa de atenção: o que está errado, uma linha por problema; as evidências abrem embaixo. */
function CartaoAtencao({ l, campos }: { l: LinhaResultado; campos: Campos }) {
  const [aberto, setAberto] = useState(false);
  const pendencias = pendenciasDaLinha(l, campos);
  const rec = campos[3][1] === "Sacado";
  const vl = l.campos.valor.britech || l.campos.valor.wp;
  const sub = [
    rec ? l.emissor && `sacado ${l.emissor}` : l.ativo && l.emissor, rec && l.cedente && `cedente ${l.cedente}`,
    vl && `${rec ? "valor" : "VL"} ${vl}`, !rec && l.codigo && `cód. ${l.codigo}`, l.noWp && `WP_Termo linha ${l.wpLinha}`,
  ]
    .filter(Boolean).join(" · ");
  return (
    <li className="rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:gap-5 md:p-5">
        <Status status={l.situacao} className="self-start md:mt-0.5" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div>
            <p className="font-medium text-creme">{l.ativo || l.emissor || "—"}</p>
            {sub && <p className="mt-0.5 text-xs text-creme/50">{sub}</p>}
          </div>
          <ul className="space-y-1 text-sm">
            {pendencias.map((p, i) => (
              <li key={i} className="flex gap-2.5">
                <span className={cn("mt-[0.45rem] size-1.5 shrink-0 rounded-full", p.grave ? "bg-erro" : "bg-aviso")} />
                <span><span className="font-medium text-creme/85">{p.campo}:</span> <span className="text-creme/65">{p.texto}</span></span>
              </li>
            ))}
          </ul>
        </div>
        {l.evidencias.length > 0 && (
          <button
            type="button"
            onClick={() => setAberto((a) => !a)}
            className="inline-flex shrink-0 items-center gap-1.5 self-start text-sm text-creme/60 underline-offset-4 hover:text-creme hover:underline"
          >
            {aberto ? "Esconder evidências" : `Ver evidências (${l.evidencias.length})`}
            <ChevronDown className={cn("size-4 transition-transform", aberto && "rotate-180")} />
          </button>
        )}
      </div>
      {aberto && <div className="border-t border-border pt-4"><Detalhe l={l} campos={campos} semNotas /></div>}
    </li>
  );
}

/** Títulos sem problema (ou sem documentos), fechados por padrão, uma linha cada. */
function GrupoCompacto({ titulo, dica, linhas }: { titulo: string; dica?: string; linhas: LinhaResultado[] }) {
  if (!linhas.length) return null;
  return (
    <details className="group rounded-2xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
        <span className="flex items-center gap-3 text-creme">
          <Status status={linhas[0].situacao} />
          {titulo} <span className="tabular-nums text-creme/50">({linhas.length})</span>
        </span>
        <ChevronDown className="size-4 text-creme/50 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-5 py-3">
        {dica && <p className="mb-2 text-xs text-creme/50">{dica}</p>}
        <ul className="divide-y divide-creme/[0.06] text-sm">
          {linhas.map((l) => (
            <li key={l.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <span className="text-creme/85">
                {l.ativo || "—"}
                {l.emissor && l.ativo ? <span className="text-creme/45"> · {l.emissor}</span> : null}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-creme/55">
                {[
                  l.campos.valor.britech && `VL ${l.campos.valor.britech}`,
                  l.campos.vencimento.britech && `venc. ${l.campos.vencimento.britech}`,
                  l.noWp ? `WP linha ${l.wpLinha}` : "fora da WP_Termo",
                ].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export function Resultado({ resultado, onBaixar, baixando }: {
  resultado: ResultadoCompleto; onBaixar: () => void; baixando: boolean;
}) {
  const [vista, setVista] = useState<"resumo" | "tabela">("resumo");
  const r = resultado;
  const s = r.resumo;
  const tela = useMemo(() => resumirParaTela(r.linhas, r.tipo), [r.linhas, r.tipo]);
  const rec = r.tipo === "recebiveis";
  const campos = camposDe(r.tipo);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <p className="text-sm text-creme/60">{s.fundo} · CNPJ {s.cnpj} · data-base {s.dataBase}</p>
          <p className={cn("text-3xl font-medium tracking-tight md:text-4xl", tela.atencao.length ? "text-creme" : "text-ok")}>{tela.titulo}</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {tela.partes.map((p) => (
              <span key={p.situacao} className={corDoStatus(p.situacao).split(" ")[0]}>
                <b className="font-medium tabular-nums">{p.n}</b> {ROTULO_PARTE[p.situacao](p.n)}
              </span>
            ))}
          </p>
        </div>
        <button
          type="button"
          onClick={onBaixar}
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
        <p className="text-xs text-creme/45">
          {s.posicoesBritech} {rec ? "recebível(is) na carteira" : "título(s) na Britech"} · {s.linhasWpTermo} na WP_Termo · {s.documentosLidos} documento(s) lido(s)
          {s.documentosSemTexto ? `, ${s.documentosSemTexto} sem texto` : ""}
          {s.arquivosIgnorados ? `, ${s.arquivosIgnorados} não lido(s)` : ""}
        </p>
      </div>

      {vista === "resumo" ? (
        <div className="space-y-4">
          {tela.atencao.length > 0 ? (
            <ul className="space-y-3">
              {tela.atencao.map((l) => <CartaoAtencao key={l.id} l={l} campos={campos} />)}
            </ul>
          ) : (
            <p className="rounded-2xl border border-ok/25 bg-ok/[0.05] px-5 py-4 text-sm text-creme/75">
              Nenhum título diverge da Britech, dos documentos ou da WP_Termo.
            </p>
          )}
          <GrupoCompacto
            titulo="Sem documentos na pasta"
            dica={rec
              ? "Nenhum documento da pasta traz o valor, o número ou o sacado destes recebíveis. Se forem muitos, confira se a pasta de lastro escolhida é a do fundo."
              : "Nenhum documento da pasta traz o VL Aplic. nem cita o emissor destes títulos. Se forem muitos, confira se a pasta de lastro escolhida é a do fundo."}
            linhas={tela.semDocumentos}
          />
          <GrupoCompacto titulo="Conferem" linhas={tela.ok} />
          <p className="break-all text-xs text-creme/40">Carteira: {s.fonteBritech}</p>
        </div>
      ) : (
        <TabelaCompleta resultado={r} />
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
