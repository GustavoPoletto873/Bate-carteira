"use client";

import { Check, ChevronDown, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChaveCampo, LinhaResultado } from "@/lib/lastro/conciliacao";
import type { Vinculo } from "@/lib/lastro/marcacoes";
import { abrirPdf, destaquesNaPagina, type ItemDeTexto } from "@/lib/lastro/pdfjs-navegador";
import type { ResultadoCompleto } from "@/lib/lastro/pipeline";
import {
  pendentes, preClassificar, ROTULO_CONFIANCA, secoes, valorDaCarteiraPre, vinculoDaSugestao,
  type Confianca, type Decisao, type Destaque, type Grupo, type Sugestao, type Veredito,
} from "@/lib/lastro/pre-classificacao";
import { fmtData, fmtValor } from "@/lib/lastro/textos";
import { cn } from "@/lib/utils";
import { mensagem } from "./comum";

type Campos = [ChaveCampo, string][];

const COR_CONFIANCA: Record<Confianca, string> = {
  alta: "bg-ok", media: "bg-sky-400", baixa: "bg-aviso", ambigua: "bg-aviso", sem_candidato: "bg-creme/30",
};
const SELO_DECISAO: Record<Decisao, { texto: string; classe: string }> = {
  confirmar: { texto: "Pronto", classe: "text-ok bg-ok/12 ring-ok/25" },
  revisar: { texto: "Confira", classe: "text-aviso bg-aviso/12 ring-aviso/25" },
  pendente: { texto: "Não aplicar", classe: "text-pink-300 bg-pink-400/12 ring-pink-400/25" },
};
const COR_MARCA = { V: "text-ok", D: "text-aviso", P: "text-creme/50" } as const;

const REGRAS: Record<string, string> = {
  cnpj_mesma_raiz: "CNPJ da mesma raiz (outra filial)",
  vencimento_um_dia_antes: "o documento traz um dia antes (fim de semana)",
  planilha_um_dia_depois: "a carteira traz um dia depois do documento",
  numero_com_parcela: "número sem o sufixo da parcela",
  cronograma_parcelas: "parcela do cronograma do documento",
  parcela_na_tabela: "parcela na tabela do documento",
  nome_parcial_com_cpf: "nome parcial ao lado do CPF/CNPJ",
  pelo_cpf_cnpj: "pelo CPF/CNPJ",
  termo_sem_sacado: "o termo da duplicata não traz o sacado — vale a carteira",
  no_documento: "em outra página do documento",
  planilha_sem_vencimento: "a carteira não tem vencimento — vale o do documento",
};

/** Recorte da página do PDF só com as faixas onde estão os valores, V em verde e D em âmbar (como o pdf_recorte do bate-lastro). */
function RecortePdf({ abrir, caminho, pagina, destaques }: {
  abrir: (caminho: string) => Promise<Uint8Array>; caminho: string; pagina: number; destaques: Destaque[];
}) {
  const saida = useRef<HTMLCanvasElement>(null);
  const [estado, setEstado] = useState<"carregando" | "pronto" | string>("carregando");

  useEffect(() => {
    let vivo = true;
    let fechar: (() => Promise<void>) | null = null;
    (async () => {
      const { pdf, fechar: f } = await abrirPdf(await abrir(caminho));
      fechar = f;
      const page = await pdf.getPage(Math.min(Math.max(1, pagina), pdf.numPages));
      const viewport = page.getViewport({ scale: 1.6 });
      const folha = document.createElement("canvas");
      folha.width = viewport.width;
      folha.height = viewport.height;
      const ctx = folha.getContext("2d");
      if (!ctx) return;
      await page.render({ canvasContext: ctx, canvas: folha, viewport }).promise;
      const { items } = await page.getTextContent();
      page.cleanup();
      const caixas = destaques.flatMap((d) => destaquesNaPagina(items as ItemDeTexto[], d.termo, viewport).map((c) => ({ ...c, marca: d.marca })));
      // faixas: caixas próximas (menos de 5% da página) viram uma faixa; no máximo 6
      const faixas: { y0: number; y1: number }[] = [];
      for (const c of [...caixas].sort((a, b) => a.y - b.y)) {
        const ultima = faixas[faixas.length - 1];
        if (ultima && c.y - ultima.y1 < 0.05) ultima.y1 = Math.max(ultima.y1, c.y + c.h);
        else faixas.push({ y0: c.y, y1: c.y + c.h });
      }
      const usadas = (faixas.length ? faixas.slice(0, 6) : [{ y0: 0, y1: 0.25 }])
        .map((f) => ({ y0: Math.max(0, f.y0 - 0.012), y1: Math.min(1, f.y1 + 0.012) }));
      const separador = 8;
      const alturas = usadas.map((f) => Math.round((f.y1 - f.y0) * folha.height));
      const c = saida.current;
      if (!vivo || !c) return;
      c.width = folha.width;
      c.height = alturas.reduce((s, h) => s + h, 0) + separador * (usadas.length - 1);
      const o = c.getContext("2d");
      if (!o) return;
      o.fillStyle = "#e5e7eb";
      o.fillRect(0, 0, c.width, c.height);
      let y = 0;
      usadas.forEach((f, i) => {
        const sy = Math.round(f.y0 * folha.height);
        o.drawImage(folha, 0, sy, folha.width, alturas[i], 0, y, c.width, alturas[i]);
        for (const cx of caixas) {
          if (cx.y + cx.h < f.y0 || cx.y > f.y1) continue;
          const cor = cx.marca === "V" ? "22,163,74" : "217,119,6";
          const bx = cx.x * folha.width - 2;
          const by = y + (cx.y * folha.height - sy) - 2;
          o.fillStyle = `rgba(${cor},0.22)`;
          o.fillRect(bx, by, cx.w * folha.width + 4, cx.h * folha.height + 4);
          o.strokeStyle = `rgb(${cor})`;
          o.lineWidth = 3;
          o.strokeRect(bx, by, cx.w * folha.width + 4, cx.h * folha.height + 4);
        }
        y += alturas[i] + separador;
      });
      setEstado("pronto");
    })().catch((e) => vivo && setEstado(mensagem(e)));
    return () => {
      vivo = false;
      void fechar?.();
    };
  }, [abrir, caminho, pagina, destaques]);

  return (
    <div className="overflow-hidden rounded-lg bg-white">
      {estado !== "pronto" && (
        <p className="flex items-center gap-2 px-3 py-4 text-xs text-black/55">
          {estado === "carregando" ? <><Loader2 className="size-3.5 animate-spin" /> Recortando a página {pagina}…</> : `Não consegui abrir o PDF: ${estado}`}
        </p>
      )}
      <canvas ref={saida} className={cn("block h-auto w-full", estado !== "pronto" && "hidden")} />
    </div>
  );
}

/** O porquê de um campo que pede atenção, numa linha: marca · campo · carteira → documento (e a regra). */
function porqueDoCampo(v: Veredito, carteira: string): string {
  if (v.regra === "sem_valor_na_carteira") return "a carteira não tem este campo";
  if (v.marca === "P") return "não achado no documento";
  if (v.marca === "D") return `${carteira || "—"} → ${v.documento || "sem valor no documento"}${v.regra && REGRAS[v.regra] ? ` (${REGRAS[v.regra]})` : ""}`;
  if (v.alerta) return `o documento traz ${v.alerta}${v.regra && REGRAS[v.regra] ? ` — ${REGRAS[v.regra]}` : ""}`;
  return REGRAS[v.regra] ?? v.regra;
}
const pedeAtencao = (v: Veredito) => v.marca !== "V" ? v.regra !== "sem_valor_na_carteira" : !!v.alerta || (!!v.regra && v.regra !== "no_documento");

function Cartao({ s, linha, campos, marcado, aplicado, onMarcar, onBuscar, abrir }: {
  s: Sugestao; linha: LinhaResultado; campos: Campos; marcado: boolean; aplicado: boolean;
  onMarcar: (v: boolean) => void; onBuscar: (l: LinhaResultado, termo: string) => void;
  abrir?: (caminho: string) => Promise<Uint8Array>;
}) {
  const [verPdf, setVerPdf] = useState(false);
  const d = linha.dados!;
  const c = s.candidato;
  const atencao = campos.filter(([k]) => pedeAtencao(s.campos[k]));
  const conferem = campos.filter(([k]) => s.campos[k].marca === "V" && !pedeAtencao(s.campos[k]));
  const termoDe = (k: ChaveCampo) => {
    const v = s.campos[k];
    return (v.marca === "D" && v.documento) || valorDaCarteiraPre(d, k) || v.documento;
  };
  const destaques = useMemo(() => (c ? c.destaques.filter((x) => x.pagina === c.pagina) : []), [c]);
  return (
    <li className={cn("rounded-xl border border-border bg-background/60", aplicado && "opacity-60")}>
      <div className="flex gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          checked={marcado && !aplicado}
          disabled={aplicado || !c}
          onChange={(e) => onMarcar(e.target.checked)}
          className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
          aria-label={`Marcar ${linha.ativo || d.sacado} para aplicar`}
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <p className="truncate text-sm font-medium text-creme">{d.sacado || linha.ativo}</p>
            <p className="text-xs tabular-nums text-creme/50">
              {[d.nominal ?? d.aquisicao ? `R$ ${fmtValor(d.nominal ?? d.aquisicao)}` : "", d.numero && `nº ${d.numero}`, d.vencimento && `venc. ${fmtData(d.vencimento)}`]
                .filter(Boolean).join(" · ")}
            </p>
            {aplicado && <span className="inline-flex items-center gap-1 text-xs text-ok"><Check className="size-3.5" /> aplicado</span>}
          </div>
          {c && (
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-creme/55">
              <span className={cn("size-1.5 rounded-full", COR_CONFIANCA[s.confianca])} />
              confiança {ROTULO_CONFIANCA[s.confianca]} ·
              <span className="truncate text-creme/75" title={c.arquivo}>{c.arquivo}</span>
              <span>p. {c.pagina}{c.modo === "linha" ? " (linha da tabela)" : ""}</span>
              {c.tipo === "termo" && <span className="rounded bg-creme/[0.06] px-1.5">termo</span>}
              {s.alternativas.length > 0 && <span className="text-creme/40">+{s.alternativas.length} alternativa(s)</span>}
            </p>
          )}
          {atencao.length > 0 && (
            <ul className="space-y-0.5 text-xs">
              {atencao.map(([k, rotulo]) => {
                const v = s.campos[k];
                return (
                  <li key={k}>
                    <button type="button" onClick={() => onBuscar(linha, termoDe(k))} className="text-left hover:underline" title="Procurar este valor nos PDFs">
                      <span className={cn("font-semibold", COR_MARCA[v.marca])}>{v.marca}</span>
                      <span className="text-creme/45"> · </span>
                      <span className="text-creme/75">{rotulo}</span>
                      <span className="text-creme/45"> · </span>
                      <span className="text-creme/65">{porqueDoCampo(v, valorDaCarteiraPre(d, k))}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {conferem.length > 0 && (
            <p className="flex flex-wrap gap-1.5 text-xs text-creme/45">
              {atencao.length ? "Conferem:" : "Tudo confere:"}
              {conferem.map(([k, rotulo]) => (
                <button key={k} type="button" onClick={() => onBuscar(linha, termoDe(k))} className="rounded bg-ok/10 px-1.5 text-ok/90 hover:bg-ok/20">
                  {rotulo}
                </button>
              ))}
            </p>
          )}
          {verPdf && c && abrir && <RecortePdf abrir={abrir} caminho={c.caminho} pagina={c.pagina} destaques={destaques} />}
        </div>
        {c && abrir && /\.pdf$/i.test(c.arquivo) && (
          <button type="button" onClick={() => setVerPdf((v) => !v)} className="h-fit shrink-0 rounded-full px-2.5 py-1 text-xs text-creme/60 ring-1 ring-creme/15 hover:bg-creme/[0.06]">
            {verPdf ? "Esconder PDF" : "Ver no PDF"}
          </button>
        )}
      </div>
    </li>
  );
}

function BlocoGrupo({ g, linhas, campos, marcados, aplicados, onMarcar, onAplicar, onBuscar, abrir }: {
  g: Grupo; linhas: Map<number, LinhaResultado>; campos: Campos; marcados: Set<number>; aplicados: Set<number>;
  onMarcar: (ids: number[], v: boolean) => void; onAplicar: (itens: Sugestao[]) => void;
  onBuscar: (l: LinhaResultado, termo: string) => void; abrir?: (caminho: string) => Promise<Uint8Array>;
}) {
  const [aberto, setAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [mostrar, setMostrar] = useState(20);
  const abertos = g.itens.filter((s) => !aplicados.has(s.linhaId));
  const escolhidos = abertos.filter((s) => marcados.has(s.linhaId));
  const selo = SELO_DECISAO[g.motivo.decisao];
  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", selo.classe)}>{selo.texto}</span>
        <button type="button" onClick={() => setAberto((a) => !a)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-creme">
          <span className="min-w-0">{g.motivo.titulo}</span>
          <span className="shrink-0 tabular-nums text-creme/45">({abertos.length}{abertos.length !== g.itens.length ? ` de ${g.itens.length}` : ""})</span>
          <ChevronDown className={cn("size-4 shrink-0 text-creme/45 transition-transform", aberto && "rotate-180")} />
        </button>
        {confirmando ? (
          <span className="flex items-center gap-2 text-xs text-creme/70">
            Aplicar as marcações de {escolhidos.length} título(s)?
            <button type="button" onClick={() => { onAplicar(escolhidos); setConfirmando(false); }} className="rounded-full bg-primary px-3 py-1 font-medium text-black">Sim</button>
            <button type="button" onClick={() => setConfirmando(false)} className="rounded-full px-3 py-1 ring-1 ring-creme/20">Não</button>
          </span>
        ) : (
          <button
            type="button"
            disabled={!escolhidos.length}
            onClick={() => setConfirmando(true)}
            className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-black disabled:bg-creme/10 disabled:text-creme/40"
          >
            Aplicar {escolhidos.length}
          </button>
        )}
      </div>
      {aberto && (
        <div className="space-y-2 border-t border-border px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-creme/50">
            <span>{escolhidos.length ? `${escolhidos.length} de ${abertos.length} marcado(s) para aplicar` : "nenhum marcado — marque os que conferem para aplicar"}</span>
            <button type="button" onClick={() => onMarcar(abertos.map((s) => s.linhaId), escolhidos.length < abertos.length)} className="underline-offset-4 hover:text-creme hover:underline">
              {escolhidos.length < abertos.length ? "marcar todos" : "desmarcar todos"}
            </button>
          </div>
          <ul className="space-y-2">
            {g.itens.slice(0, mostrar).map((s) => {
              const l = linhas.get(s.linhaId);
              return l?.dados ? (
                <Cartao
                  key={s.linhaId} s={s} linha={l} campos={campos} marcado={marcados.has(s.linhaId)} aplicado={aplicados.has(s.linhaId)}
                  onMarcar={(v) => onMarcar([s.linhaId], v)} onBuscar={onBuscar} abrir={abrir}
                />
              ) : null;
            })}
          </ul>
          {g.itens.length > mostrar && (
            <button type="button" onClick={() => setMostrar((n) => n + 50)} className="w-full rounded-xl py-2 text-xs text-creme/60 ring-1 ring-creme/15 hover:bg-creme/[0.06]">
              Mostrar mais ({g.itens.length - mostrar})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Conferência em lote da pré-classificação (como no bate-lastro): o motor sugere o documento e a marca de cada campo;
 * os títulos com o mesmo motivo ficam juntos e quem confere aplica o grupo de uma vez. Nada é gravado sem clique.
 */
export function ConferenciaPreClassificacao({ resultado, linhas, campos, pausado, onAplicar, onBuscar, onFechar }: {
  resultado: ResultadoCompleto; linhas: LinhaResultado[]; campos: Campos; pausado: boolean;
  onAplicar: (pares: [number, Vinculo][]) => void; onBuscar: (l: LinhaResultado, termo: string) => void; onFechar: () => void;
}) {
  const [inicio] = useState(() => linhas);
  const porId = useMemo(() => new Map(inicio.map((l) => [l.id, l])), [inicio]);
  const rotulos = useMemo(() => Object.fromEntries(campos) as Record<ChaveCampo, string>, [campos]);
  const [sugestoes, setSugestoes] = useState<Sugestao[] | null>(null);
  const [progresso, setProgresso] = useState({ feitos: 0, total: pendentes(inicio).length });
  const [erro, setErro] = useState("");
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [aplicados, setAplicados] = useState<Set<number>>(new Set());

  useEffect(() => {
    let vivo = true;
    preClassificar(inicio, resultado.docs, (feitos, total) => vivo && setProgresso({ feitos, total }))
      .then((lista) => {
        if (!vivo) return;
        setSugestoes(lista);
        // nos grupos prontos, todos já vêm marcados; nos que pedem decisão, nenhum
        setMarcados(new Set(secoes(lista, rotulos).prontos.flatMap((g) => g.itens.map((s) => s.linhaId))));
      })
      .catch((e) => vivo && setErro(mensagem(e)));
    return () => {
      vivo = false;
    };
  }, [inicio, resultado.docs, rotulos]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && !pausado && onFechar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onFechar, pausado]);

  const s = useMemo(() => (sugestoes ? secoes(sugestoes, rotulos) : null), [sugestoes, rotulos]);
  const marcar = (ids: number[], v: boolean) => setMarcados((m) => {
    const n = new Set(m);
    for (const id of ids) {
      if (v) n.add(id);
      else n.delete(id);
    }
    return n;
  });
  const aplicar = (itens: Sugestao[]) => {
    const pares = itens.filter((x) => !aplicados.has(x.linhaId)).flatMap((x) => {
      const v = vinculoDaSugestao(x);
      return v ? [[x.linhaId, v] as [number, Vinculo]] : [];
    });
    if (!pares.length) return;
    onAplicar(pares);
    setAplicados((a) => new Set([...a, ...pares.map(([id]) => id)]));
  };
  const prontosAbertos = s ? s.prontos.flatMap((g) => g.itens).filter((x) => !aplicados.has(x.linhaId) && marcados.has(x.linhaId)) : [];
  const conta = (gs: Grupo[]) => gs.reduce((n, g) => n + g.itens.filter((x) => !aplicados.has(x.linhaId)).length, 0);
  const porConfianca = sugestoes
    ? (["alta", "media", "baixa", "ambigua"] as Confianca[]).map((c) => [c, sugestoes.filter((x) => x.confianca === c).length] as const).filter(([, n]) => n)
    : [];

  const grupo = (g: Grupo) => (
    <BlocoGrupo
      key={g.motivo.chave} g={g} linhas={porId} campos={campos} marcados={marcados} aplicados={aplicados}
      onMarcar={marcar} onAplicar={aplicar} onBuscar={onBuscar} abrir={resultado.abrir}
    />
  );

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-center bg-black/75 p-2 backdrop-blur-sm md:p-6" role="dialog" aria-modal="true" aria-label="Conferir pré-classificação">
      <div className="flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium text-creme"><Sparkles className="size-4 text-primary" /> Conferir pré-classificação</p>
            {s ? (
              <p className="flex flex-wrap items-center gap-x-3 text-xs text-creme/55">
                <span>{conta(s.paraDecidir)} para decidir · {conta(s.prontos)} prontos · {s.semPdf.length} sem documento</span>
                {porConfianca.map(([c, n]) => (
                  <span key={c} className="inline-flex items-center gap-1"><span className={cn("size-1.5 rounded-full", COR_CONFIANCA[c])} />{n} {ROTULO_CONFIANCA[c]}</span>
                ))}
              </p>
            ) : (
              <p className="text-xs text-creme/50">O app sugere o documento e a marca (V/D/P) de cada campo. Nada é gravado sem o seu clique.</p>
            )}
          </div>
          <button type="button" onClick={onFechar} className="rounded-full p-2 text-creme/60 hover:bg-creme/[0.06] hover:text-creme" aria-label="Fechar">
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-auto p-4">
          {erro && <p className="text-sm text-erro">{erro}</p>}
          {!s && !erro && (
            <p className="flex items-center gap-2 text-sm text-creme/70">
              <Loader2 className="size-4 animate-spin" /> Pré-classificando {progresso.feitos} de {progresso.total} pendência(s)…
            </p>
          )}
          {s && !sugestoes?.length && <p className="text-sm text-creme/60">Não há pendências para pré-classificar.</p>}
          {s && s.paraDecidir.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-creme/45">Para decidir</h3>
              <p className="text-xs text-creme/45">Nenhum vem marcado: abra o grupo, confira (os campos e &quot;Ver no PDF&quot; ajudam) e marque o que confere.</p>
              {s.paraDecidir.map(grupo)}
            </section>
          )}
          {s && s.prontos.length > 0 && (
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-creme/45">Prontos para aplicar</h3>
                <button
                  type="button"
                  disabled={!prontosAbertos.length}
                  onClick={() => aplicar(prontosAbertos)}
                  className="rounded-full px-3 py-1 text-xs text-creme/80 ring-1 ring-creme/20 hover:bg-creme/[0.06] disabled:opacity-40"
                >
                  Aplicar todos os prontos marcados ({prontosAbertos.length})
                </button>
              </div>
              <p className="text-xs text-creme/45">A leitura confere com a carteira ou a diferença segue uma regra combinada (o título do grupo diz qual).</p>
              {s.prontos.map(grupo)}
            </section>
          )}
          {s && s.semPdf.length > 0 && (
            <details className="rounded-2xl border border-border bg-card">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm text-creme/80">
                Sem documento encontrado <span className="text-creme/45">({s.semPdf.length})</span>
              </summary>
              <ul className="space-y-1 border-t border-border px-4 py-3 text-xs">
                {s.semPdf.map((x) => {
                  const l = porId.get(x.linhaId);
                  if (!l?.dados) return null;
                  return (
                    <li key={x.linhaId} className="flex flex-wrap gap-x-3">
                      <span className="text-creme/80">{l.dados.sacado || l.ativo}</span>
                      <span className="tabular-nums text-creme/45">{l.dados.numero && `nº ${l.dados.numero}`}</span>
                      <button type="button" onClick={() => onBuscar(l, l.dados!.numero || l.dados!.sacado)} className="text-primary underline-offset-4 hover:underline">procurar nos PDFs</button>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
