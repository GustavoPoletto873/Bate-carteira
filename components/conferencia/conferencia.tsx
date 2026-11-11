"use client";

import { ArrowRight, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { WordsPullUp } from "@/components/ui/prisma-hero";
import type { PdfJs } from "@/lib/lastro/extratores";
import { gerarExcel, lerDocumentos, montarResultado, type ResultadoCompleto } from "@/lib/lastro/pipeline";
import { lerCarteira } from "@/lib/lastro/planilhas";
import { salvarChave, servidor, type StatusServidor } from "@/lib/lastro/servidor-cliente";
import { cn } from "@/lib/utils";
import { Alternador, classeSelect, mensagem } from "./comum";
import { FontesAuto } from "./fontes-auto";
import { FontesManuais } from "./fontes-manuais";
import { Inventario, Resultado } from "./resultado";
import type { Preparo } from "./tipos";

const OPCOES_PDF = {
  cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/",
  verbosity: 0,
};

async function carregarPdfjs(): Promise<PdfJs> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  return pdfjs as unknown as PdfJs;
}

type EstadoServidor = { carregando: true } | { carregando: false; status: StatusServidor | null; erro: string };

export function Conferencia() {
  const [servidorInfo, setServidorInfo] = useState<EstadoServidor>({ carregando: true });
  const [recarga, setRecarga] = useState(0);
  const [chave, setChave] = useState("");
  const [modo, setModo] = useState<"auto" | "manual">("auto");
  const [progresso, setProgresso] = useState<{ atual: number; total: number; texto: string } | null>(null);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<ResultadoCompleto | null>(null);
  const [baixando, setBaixando] = useState(false);

  useEffect(() => {
    let vivo = true;
    servidor.status()
      .then((status) => {
        if (!vivo) return;
        setServidorInfo({ carregando: false, status, erro: "" });
        setModo(status.drive.disponivel ? "auto" : "manual");
      })
      .catch((e) => {
        if (!vivo) return;
        setServidorInfo({ carregando: false, status: null, erro: mensagem(e) });
        setModo("manual");
      });
    return () => {
      vivo = false;
    };
  }, [recarga]);

  const status = servidorInfo.carregando ? null : servidorInfo.status;
  const autoDisponivel = !!status?.drive.disponivel;

  function limpar() {
    setResultado(null);
    setErro("");
  }

  async function conferirAgora(p: Preparo) {
    limpar();
    try {
      setProgresso({ atual: 0, total: 0, texto: "Buscando a carteira Britech" });
      const carteira = await p.carteira.obter();
      const posicoes = lerCarteira(carteira.bytes, carteira.nome);

      setProgresso({ atual: 0, total: 0, texto: "Listando a pasta de lastro e termo" });
      const arquivos = await p.lastro.obter();
      const pdfjs = await carregarPdfjs();
      const { docs, ignorados } = await lerDocumentos(arquivos, pdfjs, OPCOES_PDF, (atual, total, texto) =>
        setProgresso({ atual, total, texto }));

      setProgresso({ atual: 1, total: 1, texto: "Conferindo" });
      const r = montarResultado({
        workpaper: p.workpaper, posicoes, docs, ignorados, dataBase: p.dataBase, fonteBritech: p.carteira.rotulo,
        pastaLastro: p.lastro.nome,
      });
      setResultado(r);
      requestAnimationFrame(() => document.getElementById("resultado")?.scrollIntoView({ behavior: "smooth" }));
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      setProgresso(null);
    }
  }

  async function baixarExcel() {
    if (!resultado) return;
    setBaixando(true);
    try {
      const buffer = await gerarExcel(resultado);
      const url = URL.createObjectURL(new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }));
      const a = document.createElement("a");
      a.href = url;
      const data = resultado.resumo.dataBase.split("/").reverse().join("");
      a.download = `Bate_Carteira_Lastro_${resultado.resumo.cnpj || "fundo"}_${data}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setErro(`Não consegui gerar o Excel: ${mensagem(e)}`);
    } finally {
      setBaixando(false);
    }
  }

  const pct = progresso?.total ? Math.round((100 * progresso.atual) / progresso.total) : 0;

  function barra(preparo: Preparo | null) {
    const pronto = !!preparo && !progresso;
    return (
      <div className="mt-8 flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 md:flex-row md:items-center md:justify-between md:p-6">
        <div className="min-w-0 flex-1 space-y-2">
          {progresso ? (
            <>
              <p className="flex items-center gap-2 truncate text-sm text-creme/80">
                <Loader2 className="size-4 shrink-0 animate-spin" />
                <span className="truncate">{progresso.texto}{progresso.total ? ` (${progresso.atual}/${progresso.total})` : ""}</span>
              </p>
              <div className="h-1 overflow-hidden rounded-full bg-creme/10">
                <div className="h-full bg-creme transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
            </>
          ) : erro ? (
            <p className="text-sm text-erro">{erro}</p>
          ) : (
            <p className="text-sm text-creme/60">
              {pronto ? "Tudo pronto. Os documentos são lidos e conferidos aqui no seu navegador."
                : modo === "auto" ? "Escolha o fundo: o resto o app busca no Drive e na Britech." : "Escolha as três fontes para conferir."}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => preparo && conferirAgora(preparo)}
          disabled={!pronto}
          className="group inline-flex items-center gap-2 self-start rounded-full bg-primary py-1 pl-6 pr-1 text-base font-medium text-black transition-all enabled:hover:gap-3 disabled:opacity-40 md:self-auto"
        >
          Conferir
          <span className="flex size-10 items-center justify-center rounded-full bg-black transition-transform group-enabled:group-hover:scale-110">
            <ArrowRight className="size-4 text-creme" />
          </span>
        </button>
      </div>
    );
  }

  return (
    <>
      <section id="fontes" className="scroll-mt-6 px-2 pt-20 sm:px-4 md:px-8 md:pt-28">
        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <h2 className="text-[16vw] font-medium leading-[0.85] tracking-[-0.06em] text-creme md:text-[9vw]">
            <WordsPullUp text="Fontes" />
          </h2>
          <div className="w-full max-w-md space-y-3">
            <Alternador
              valor={modo}
              onMudar={(m) => {
                limpar();
                setModo(m);
              }}
              opcoes={[
                { valor: "auto", rotulo: "Buscar no Drive e na Britech", desabilitado: !autoDisponivel },
                { valor: "manual", rotulo: "Escolher arquivos" },
              ]}
            />
            <p className="text-sm text-creme/60">
              {servidorInfo.carregando ? "Verificando o acesso ao Drive e à Britech…"
                : modo === "auto" ? "Escolha o fundo: o workpaper e a pasta de lastro vêm do Drive (G:) e a carteira, da API da Britech."
                  : autoDisponivel ? "Escolha o workpaper, a carteira e a pasta à mão (ou arraste para os cartões)."
                    : "O Drive (G:) não está acessível por este servidor: escolha os arquivos à mão. No Chrome e no Edge o app lembra a última escolha."}
            </p>
          </div>
        </div>

        {status?.exigeChave && !status.liberado && (
          <form
            className="mb-4 flex flex-col gap-3 rounded-2xl border border-aviso/30 bg-aviso/[0.05] p-4 md:flex-row md:items-center"
            onSubmit={(e) => {
              e.preventDefault();
              salvarChave(chave.trim());
              setChave("");
              setRecarga((n) => n + 1);
            }}
          >
            <KeyRound className="size-5 shrink-0 text-aviso" />
            <p className="flex-1 text-sm text-creme/75">
              {status.chaveConfigurada
                ? "Para buscar no Drive e na Britech por aqui, informe a chave de acesso do app (fica salva neste navegador)."
                : "As rotas do Drive e da Britech estão fechadas neste servidor: configure LASTRO_CHAVE_ACESSO para usá-las."}
            </p>
            {status.chaveConfigurada && (
              <>
                <input type="password" value={chave} onChange={(e) => setChave(e.target.value)} placeholder="Chave de acesso" className={cn(classeSelect, "md:w-64")} />
                <button type="submit" className="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-medium text-black">Entrar</button>
              </>
            )}
          </form>
        )}

        {servidorInfo.carregando ? (
          <p className="inline-flex items-center gap-2 text-sm text-creme/60"><Loader2 className="size-4 animate-spin" /> Carregando…</p>
        ) : modo === "auto" && status ? (
          <FontesAuto key={`auto-${recarga}`} status={status} acoes={barra} onMudar={limpar} />
        ) : (
          <FontesManuais key={`manual-${recarga}`} status={status} acoes={barra} onMudar={limpar} />
        )}
      </section>

      <section id="resultado" className="scroll-mt-6 px-2 pt-24 sm:px-4 md:px-8 md:pt-32">
        <h2 className="mb-10 text-[16vw] font-medium leading-[0.85] tracking-[-0.06em] text-creme md:text-[9vw]">
          <WordsPullUp text="Resultado" />
        </h2>
        {resultado ? (
          <Resultado resultado={resultado} onBaixar={baixarExcel} baixando={baixando} />
        ) : (
          <p className="rounded-2xl border border-dashed border-border px-6 py-12 text-center text-sm text-creme/50">
            O resultado aparece aqui depois de conferir.
          </p>
        )}
      </section>

      <section id="documentos" className="scroll-mt-6 px-2 pb-24 pt-24 sm:px-4 md:px-8 md:pt-32">
        <h2 className="mb-10 text-[16vw] font-medium leading-[0.85] tracking-[-0.06em] text-creme md:text-[9vw]">
          <WordsPullUp text="Documentos" />
        </h2>
        {resultado ? (
          <Inventario resultado={resultado} />
        ) : (
          <p className="rounded-2xl border border-dashed border-border px-6 py-12 text-center text-sm text-creme/50">
            Depois de conferir, veja aqui cada documento lido, o que foi ligado a qual título e o que não tem texto.
          </p>
        )}
      </section>
    </>
  );
}
