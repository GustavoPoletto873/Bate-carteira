"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Link2, Loader2, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buscarNosDocumentos, MIN_CARACTERES_BUSCA, type OcorrenciaBusca } from "@/lib/lastro/busca";
import type { ChaveCampo, LinhaResultado } from "@/lib/lastro/conciliacao";
import type { Documento } from "@/lib/lastro/documentos";
import {
  marcaAutomatica, sugestaoDoDocumento, valorDaCarteira, type Marca, type Vinculo,
} from "@/lib/lastro/marcacoes";
import { abrirPdf, destaquesNaPagina, type DocumentoPdf, type ItemDeTexto } from "@/lib/lastro/pdfjs-navegador";
import type { ResultadoCompleto } from "@/lib/lastro/pipeline";
import { cn } from "@/lib/utils";
import { classeSelect, mensagem } from "./comum";

type Campos = [ChaveCampo, string][];
const ESCALA_RENDER = 2;

/** Trecho com o termo encontrado destacado. */
function Realce({ texto, alvo }: { texto: string; alvo: string }) {
  const i = alvo ? texto.toLowerCase().indexOf(alvo.toLowerCase()) : -1;
  if (i < 0) return <>{texto}</>;
  return (
    <>
      {texto.slice(0, i)}
      <mark className="rounded bg-primary/80 px-0.5 text-black">{texto.slice(i, i + alvo.length)}</mark>
      {texto.slice(i + alvo.length)}
    </>
  );
}

/** Página do PDF desenhada com o pdf.js e o termo destacado (posição em % da página). */
function PaginaPdf({ abrir, doc, pagina, destacar, onTotal }: {
  abrir: (caminho: string) => Promise<Uint8Array>; doc: Documento; pagina: number; destacar: string; onTotal: (n: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<DocumentoPdf | null>(null);
  const [erro, setErro] = useState("");
  const [destaques, setDestaques] = useState<{ x: number; y: number; w: number; h: number }[]>([]);
  const [desenhando, setDesenhando] = useState(true);

  useEffect(() => {
    let vivo = true;
    let fechar: (() => Promise<void>) | null = null;
    abrir(doc.caminho)
      .then(abrirPdf)
      .then((r) => {
        if (!vivo) return void r.fechar();
        fechar = r.fechar;
        setPdf(r.pdf);
        onTotal(r.pdf.numPages);
      })
      .catch((e) => vivo && setErro(mensagem(e)));
    return () => {
      vivo = false;
      void fechar?.();
    };
  }, [abrir, doc, onTotal]);

  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let vivo = true;
    let cancelar: (() => void) | null = null;
    (async () => {
      const page = await pdf.getPage(Math.min(Math.max(1, pagina), pdf.numPages));
      const viewport = page.getViewport({ scale: ESCALA_RENDER });
      const c = canvas.current;
      const ctx = c?.getContext("2d");
      if (!vivo || !c || !ctx) return;
      c.width = viewport.width;
      c.height = viewport.height;
      const tarefa = page.render({ canvasContext: ctx, canvas: c, viewport });
      cancelar = () => tarefa.cancel();
      await tarefa.promise;
      const { items } = await page.getTextContent();
      if (vivo) {
        setDestaques(destaquesNaPagina(items as ItemDeTexto[], destacar, viewport));
        setDesenhando(false);
      }
      page.cleanup();
    })().catch((e) => {
      if (vivo && (e as Error)?.name !== "RenderingCancelledException") setErro(mensagem(e));
    });
    return () => {
      vivo = false;
      cancelar?.();
    };
  }, [pdf, pagina, destacar]);

  // rola a área do PDF até o primeiro destaque (centralizado)
  const folha = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = folha.current;
    const area = el?.closest(".overflow-auto");
    if (!el || !area || !destaques.length) return;
    const topoDaFolha = el.getBoundingClientRect().top - area.getBoundingClientRect().top + area.scrollTop;
    const alvo = topoDaFolha + destaques[0].y * el.clientHeight - area.clientHeight / 2;
    area.scrollTop = Math.max(0, alvo);
  }, [destaques]);

  if (erro) return <p className="p-4 text-sm text-erro">Não consegui abrir o PDF: {erro}</p>;
  return (
    <div ref={folha} className="relative mx-auto w-full max-w-[56rem] bg-white shadow-xl">
      <canvas ref={canvas} className="block h-auto w-full" />
      {destaques.map((d, i) => (
        <span
          key={i}
          className="pointer-events-none absolute rounded-sm bg-yellow-300/45 ring-2 ring-yellow-500/70"
          style={{ left: `${d.x * 100}%`, top: `${d.y * 100}%`, width: `${d.w * 100}%`, height: `${d.h * 100}%` }}
        />
      ))}
      {(desenhando || !pdf) && (
        <div className="absolute inset-0 flex min-h-48 items-center justify-center text-sm text-black/50">
          <Loader2 className="mr-2 size-4 animate-spin" /> Abrindo o documento…
        </div>
      )}
    </div>
  );
}

const ESTILO_MARCA: Record<Marca, string> = {
  V: "bg-ok/20 text-ok ring-ok/40", D: "bg-erro/20 text-erro ring-erro/40", P: "bg-creme/10 text-creme/70 ring-creme/25",
};
const TITULO_MARCA: Record<Marca, string> = { V: "Confere", D: "Divergente", P: "Sem valor no documento" };

/** Grade do vínculo: Campo | Carteira | Documento (editável) | V/D/P. A marca de quem confere vence a automática. */
function GradeVinculo({ linha, doc, pagina, campos, onVincular }: {
  linha: LinhaResultado; doc: Documento; pagina: number; campos: Campos; onVincular: (v: Vinculo) => void;
}) {
  const sugestao = useMemo(() => sugestaoDoDocumento(linha, doc), [linha, doc]);
  const [valores, setValores] = useState<Record<ChaveCampo, string>>(sugestao);
  const [marcas, setMarcas] = useState<Partial<Record<ChaveCampo, Marca>>>({});
  const linhas = campos.map(([k, rotulo]) => {
    const carteira = valorDaCarteira(linha, k);
    const auto = marcaAutomatica(k, carteira, valores[k]);
    return { k, rotulo, carteira, marca: marcas[k] ?? auto, auto };
  });
  return (
    <details open className="group border-t border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm text-creme/80">
        <span>
          Vincular <b className="font-medium text-creme">{linha.ativo || linha.emissor}</b> a <b className="font-medium text-creme">{doc.nome}</b>
          <span className="text-creme/50"> (p. {pagina})</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-creme/50 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 px-4 pb-4">
      <div className="overflow-x-auto rounded-xl ring-1 ring-creme/10">
        <table className="w-full text-xs">
          <thead className="bg-creme/[0.04] text-left text-creme/50">
            <tr>{["Campo", "Carteira", "Documento", "Marca"].map((t) => <th key={t} className="px-3 py-2 font-medium">{t}</th>)}</tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.k} className="border-t border-creme/[0.06] align-middle">
                <td className="whitespace-nowrap px-3 py-2 text-creme/70">{l.rotulo}</td>
                <td className="px-3 py-2 tabular-nums text-creme">{l.carteira || "—"}</td>
                <td className="px-3 py-2">
                  <input
                    value={valores[l.k]}
                    onChange={(e) => setValores((v) => ({ ...v, [l.k]: e.target.value }))}
                    placeholder="valor no documento"
                    className={cn(classeSelect, "py-1.5 text-xs")}
                    aria-label={`${l.rotulo} no documento`}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    {(["V", "D", "P"] as Marca[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        title={`${TITULO_MARCA[m]}${m === l.auto ? " (sugestão automática)" : ""}`}
                        onClick={() => setMarcas((x) => ({ ...x, [l.k]: m }))}
                        className={cn("size-7 rounded-md text-xs font-semibold ring-1", l.marca === m ? ESTILO_MARCA[m] : "text-creme/40 ring-creme/10 hover:text-creme/80")}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-creme/45">V confere · D divergente · P sem valor no documento. A sua marca vale mais que a automática.</p>
        <button
          type="button"
          onClick={() => onVincular({
            arquivo: doc.nome, pagina,
            campos: Object.fromEntries(linhas.map((l) => [l.k, { documento: valores[l.k], marca: l.marca }])),
          })}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-black"
        >
          <Link2 className="size-4" /> Vincular a este documento
        </button>
      </div>
      </div>
    </details>
  );
}

/**
 * Bater PDF: busca em todos os documentos lidos, visualizador com o termo destacado e vínculo da pendência ao
 * documento, campo a campo (como no bate-lastro).
 */
export function BaterPdf({ resultado, linha, campos, termoInicial, docInicial, onVincular, onFechar }: {
  resultado: ResultadoCompleto; linha: LinhaResultado | null; campos: Campos; termoInicial: string;
  /** abre já neste documento e página (ex.: a evidência clicada no detalhe do título) */
  docInicial?: { nome: string; pagina: number };
  onVincular: (id: number, v: Vinculo) => void; onFechar: () => void;
}) {
  const [termo, setTermo] = useState(termoInicial);
  const [consulta, setConsulta] = useState(termoInicial);
  const busca = useMemo(() => buscarNosDocumentos(resultado.docs, consulta), [resultado.docs, consulta]);
  const [escolha, setEscolha] = useState<{ docId: number; pagina: number } | null>(() => {
    const d = docInicial && resultado.docs.find((x) => x.nome === docInicial.nome);
    return d ? { docId: d.id, pagina: Math.max(1, docInicial.pagina) } : null;
  });
  const [totalPaginas, setTotalPaginas] = useState<Record<number, number>>({});

  const selecionado = busca.resultados.find((r) => r.doc.id === escolha?.docId) ?? busca.resultados[0] ?? null;
  const pagina = selecionado ? (escolha?.docId === selecionado.doc.id ? escolha.pagina : selecionado.paginas[0] ?? 1) : 1;
  const total = selecionado ? totalPaginas[selecionado.doc.id] ?? selecionado.doc.paginasLidas : 1;
  const ehPdf = !!selecionado && selecionado.doc.tipo === "PDF" && !!resultado.abrir;
  const docAtual = selecionado?.doc.id;
  const registrarTotal = useCallback((n: number) => {
    if (docAtual !== undefined) setTotalPaginas((t) => (t[docAtual] === n ? t : { ...t, [docAtual]: n }));
  }, [docAtual]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onFechar]);

  const irPara = (docId: number, p: number) => setEscolha({ docId, pagina: p });
  const ocorrenciasNaPagina = (ocs: OcorrenciaBusca[]) => ocs.filter((o) => o.pagina === pagina);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/75 p-2 backdrop-blur-sm md:p-6" role="dialog" aria-modal="true" aria-label="Bater PDF">
      <div className="flex w-full max-w-[110rem] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="font-medium text-creme">Bater PDF</p>
            <p className="truncate text-xs text-creme/50">
              {linha ? <>Pendência: <span className="text-creme/80">{linha.ativo || linha.emissor}</span> · {linha.situacao}</> : "Busca em todos os documentos lidos"}
            </p>
          </div>
          <button type="button" onClick={onFechar} className="rounded-full p-2 text-creme/60 hover:bg-creme/[0.06] hover:text-creme" aria-label="Fechar">
            <X className="size-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[24rem_1fr]">
          {/* busca */}
          <div className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
            <form
              className="flex gap-2 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                setEscolha(null);
                setConsulta(termo);
              }}
            >
              <input
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                placeholder="Texto, valor (1.234,56) ou data"
                className={classeSelect}
                autoFocus
                data-campo="busca-pdf"
              />
              <button type="submit" className="shrink-0 rounded-xl bg-primary px-3 text-black" aria-label="Buscar"><Search className="size-4" /></button>
            </form>
            <p className="px-4 pb-2 text-xs text-creme/45">
              {busca.motivo === "termo_curto" ? `Digite ao menos ${MIN_CARACTERES_BUSCA} caracteres.`
                : `${busca.resultados.length} documento(s) com "${busca.destacar}" entre ${resultado.docs.length} lidos`}
            </p>
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
              {busca.resultados.map((r) => {
                const ativo = selecionado?.doc.id === r.doc.id;
                return (
                  <li key={r.doc.id}>
                    <button
                      type="button"
                      onClick={() => irPara(r.doc.id, r.paginas[0] ?? 1)}
                      className={cn("w-full rounded-xl px-3 py-2 text-left hover:bg-creme/[0.05]", ativo && "bg-creme/[0.07] ring-1 ring-creme/15")}
                    >
                      <span className="block truncate text-sm text-creme" title={r.doc.caminho}>{r.doc.nome}</span>
                      <span className="block text-xs text-creme/45">{r.total} ocorrência(s) · p. {r.paginas.slice(0, 8).join(", ")}</span>
                      <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-creme/60">
                        <Realce texto={r.ocorrencias[0].trecho} alvo={r.ocorrencias[0].alvo} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* visualizador + vínculo */}
          <div className="flex min-h-0 flex-col">
            {!selecionado ? (
              <p className="m-auto p-6 text-sm text-creme/50">Nenhum documento encontrado. Tente o número do documento, o valor ou parte do nome.</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-sm">
                  <span className="truncate text-creme/80" title={selecionado.doc.caminho}>{selecionado.doc.nome}</span>
                  <div className="flex shrink-0 items-center gap-1 text-creme/60">
                    <button type="button" disabled={pagina <= 1} onClick={() => irPara(selecionado.doc.id, pagina - 1)} className="rounded-lg p-1.5 hover:bg-creme/[0.06] disabled:opacity-30" aria-label="Página anterior"><ChevronLeft className="size-4" /></button>
                    <span className="tabular-nums">p. {pagina} de {total}</span>
                    <button type="button" disabled={pagina >= total} onClick={() => irPara(selecionado.doc.id, pagina + 1)} className="rounded-lg p-1.5 hover:bg-creme/[0.06] disabled:opacity-30" aria-label="Próxima página"><ChevronRight className="size-4" /></button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-black/30 p-3">
                  {ehPdf ? (
                    <PaginaPdf
                      key={selecionado.doc.id}
                      abrir={resultado.abrir!}
                      doc={selecionado.doc}
                      pagina={pagina}
                      destacar={busca.destacar}
                      onTotal={registrarTotal}
                    />
                  ) : (
                    <ul className="space-y-2 text-sm text-creme/75">
                      {(ocorrenciasNaPagina(selecionado.ocorrencias).length ? ocorrenciasNaPagina(selecionado.ocorrencias) : selecionado.ocorrencias).map((o, i) => (
                        <li key={i} className="rounded-xl bg-creme/[0.04] p-3 leading-relaxed"><Realce texto={o.trecho} alvo={o.alvo} /></li>
                      ))}
                    </ul>
                  )}
                </div>
                {linha && (
                  <GradeVinculo
                    key={`${linha.id}-${selecionado.doc.id}`}
                    linha={linha}
                    doc={selecionado.doc}
                    pagina={pagina}
                    campos={campos}
                    onVincular={(v) => onVincular(linha.id, v)}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
