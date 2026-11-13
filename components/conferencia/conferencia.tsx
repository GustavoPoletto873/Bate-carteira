"use client";

import { ArrowRight, FolderOpen, History, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { WordsPullUp } from "@/components/ui/prisma-hero";
import { DRIVE_BASE_PADRAO } from "@/lib/lastro/drive-comum";
import { conferirPastaBase, criarProvedorPasta } from "@/lib/lastro/drive-pasta";
import { escolherPasta, lembrada, reabrir, suportaAcessoDireto, type HandlePasta } from "@/lib/lastro/fontes";
import { periodoDoCdi, type PontoCdi } from "@/lib/lastro/indexadores";
import { carregarPdfjs, OPCOES_PDF } from "@/lib/lastro/pdfjs-navegador";
import { gerarExcel, lerDocumentos, montarResultado, type ResultadoCompleto } from "@/lib/lastro/pipeline";
import { lerCarteira } from "@/lib/lastro/planilhas";
import { provedorLocal, salvarChave, servidor, type StatusServidor } from "@/lib/lastro/servidor-cliente";
import { cn } from "@/lib/utils";
import { Alternador, classeSelect, mensagem } from "./comum";
import { FontesAuto } from "./fontes-auto";
import { FontesManuais } from "./fontes-manuais";
import { Inventario, Resultado } from "./resultado";
import type { Preparo } from "./tipos";


type EstadoServidor = { carregando: true } | { carregando: false; status: StatusServidor | null; erro: string };

/** De onde o modo automático lê o Drive. */
type FonteDrive = "local" | "pasta";
const ROTULO_FONTE: Record<FonteDrive, string> = {
  local: "Servidor (G:)", pasta: "Pasta deste computador",
};
const MEMORIA_BASE = "lastro-pasta-trimestre";
const semAssinatura = () => () => {};

/** Sem resposta do servidor: nada de Drive local nem Britech. */
const STATUS_VAZIO: StatusServidor = {
  local: false, exigeChave: true, chaveConfigurada: false, liberado: false,
  drive: { disponivel: false, base: "" }, britech: { configurada: false, url: "", administradoras: [] },
};

export function Conferencia() {
  const [servidorInfo, setServidorInfo] = useState<EstadoServidor>({ carregando: true });
  const [recarga, setRecarga] = useState(0);
  const [chave, setChave] = useState("");
  const [modo, setModo] = useState<"auto" | "manual">("auto");
  const [progresso, setProgresso] = useState<{ atual: number; total: number; texto: string } | null>(null);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<ResultadoCompleto | null>(null);
  const [baixando, setBaixando] = useState(false);

  const [escolhaDrive, setEscolhaDrive] = useState<FonteDrive | null>(null);
  const suportePasta = useSyncExternalStore(semAssinatura, suportaAcessoDireto, () => false);
  const [pastaBase, setPastaBase] = useState<HandlePasta | null>(null);
  const [ultimaPasta, setUltimaPasta] = useState<string | null>(null);
  const [erroPasta, setErroPasta] = useState("");
  const [abrindoPasta, setAbrindoPasta] = useState(false);
  const provedorPasta = useMemo(() => (pastaBase ? criarProvedorPasta(pastaBase) : null), [pastaBase]);

  useEffect(() => {
    let vivo = true;
    servidor.status()
      .then((status) => {
        if (!vivo) return;
        setServidorInfo({ carregando: false, status, erro: "" });
        setModo(status.drive.disponivel || suportaAcessoDireto() ? "auto" : "manual");
      })
      .catch((e) => {
        if (!vivo) return;
        setServidorInfo({ carregando: false, status: null, erro: mensagem(e) });
        setModo(suportaAcessoDireto() ? "auto" : "manual");
      });
    return () => {
      vivo = false;
    };
  }, [recarga]);

  useEffect(() => {
    let vivo = true;
    lembrada(MEMORIA_BASE).then((nome) => vivo && setUltimaPasta(nome));
    return () => {
      vivo = false;
    };
  }, []);

  const status = servidorInfo.carregando ? null : servidorInfo.status;
  const localOk = !!status?.drive.disponivel;
  const fontesDisponiveis: FonteDrive[] = [
    ...(localOk ? (["local"] as const) : []),
    ...(suportePasta ? (["pasta"] as const) : []),
  ];
  const fonteDrive: FonteDrive | null = escolhaDrive && fontesDisponiveis.includes(escolhaDrive)
    ? escolhaDrive : fontesDisponiveis[0] ?? null;
  const autoDisponivel = fontesDisponiveis.length > 0;

  /** Escolhe (ou reabre) a pasta do trimestre no computador de quem usa. */
  async function abrirPastaBase(reabrirUltima: boolean) {
    setErroPasta("");
    setAbrindoPasta(true);
    try {
      const fonte = reabrirUltima ? await reabrir(MEMORIA_BASE, false) : await escolherPasta(MEMORIA_BASE, false);
      if (!fonte || fonte.tipo !== "pasta" || !fonte.handle) return;
      const problema = await conferirPastaBase(fonte.handle);
      if (problema) {
        setErroPasta(problema);
        return;
      }
      limpar();
      setPastaBase(fonte.handle);
      setUltimaPasta(fonte.handle.name);
    } catch (e) {
      setErroPasta(mensagem(e));
    } finally {
      setAbrindoPasta(false);
    }
  }

  function limpar() {
    setResultado(null);
    setErro("");
  }

  async function conferirAgora(p: Preparo) {
    limpar();
    try {
      setProgresso({ atual: 0, total: 0, texto: "Buscando a carteira" });
      const carteira = await p.carteira.obter();
      const posicoes = lerCarteira(carteira.bytes, carteira.nome);

      setProgresso({ atual: 0, total: 0, texto: "Listando a pasta de lastro e termo" });
      const arquivos = await p.lastro.obter();
      const pdfjs = await carregarPdfjs();
      const { docs, ignorados } = await lerDocumentos(arquivos, pdfjs, OPCOES_PDF, (atual, total, texto) =>
        setProgresso({ atual, total, texto }));

      // títulos com taxa (% do CDI + spread, prefixado): o CDI do período vem do Banco Central
      const avisos: string[] = [];
      let cdi: PontoCdi[] | undefined;
      const periodo = periodoDoCdi(posicoes, docs, p.dataBase);
      if (periodo) {
        setProgresso({ atual: 0, total: 0, texto: "Buscando o CDI no Banco Central" });
        try {
          cdi = (await servidor.cdi(periodo.de, periodo.ate)).pontos;
        } catch (e) {
          avisos.push(`Não consegui buscar o CDI no Banco Central (${mensagem(e)}): os valores calculados pela taxa ficaram de fora.`);
        }
      }

      setProgresso({ atual: 1, total: 1, texto: "Conferindo" });
      // estoque completo (amostra como carteira): só para a validação da carteira, que precisa da aba carteiraInforme
      // (sem ela — ex.: fundo sem workpaper — não vale ler o estoque, que pode ter dezenas de MB)
      let estoque: { posicoes: ReturnType<typeof lerCarteira>; origem: string } | undefined;
      if (p.estoque && p.workpaper.carteiraInforme.length) {
        setProgresso({ atual: 0, total: 0, texto: "Lendo o estoque para validar a carteira" });
        try {
          const arq = await p.estoque.obter();
          estoque = { posicoes: lerCarteira(arq.bytes, arq.nome), origem: p.estoque.rotulo };
        } catch (e) {
          avisos.push(`Não consegui ler o estoque para validar a carteira (${mensagem(e)}).`);
        }
      }

      const r = montarResultado({
        workpaper: p.workpaper, posicoes, docs, ignorados, dataBase: p.dataBase, fonteBritech: p.carteira.rotulo,
        pastaLastro: p.lastro.nome, avisos, cdi, arquivos, estoque,
      });
      setResultado(r);
      requestAnimationFrame(() => document.getElementById("resultado")?.scrollIntoView({ behavior: "smooth" }));
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      setProgresso(null);
    }
  }

  /** Excel do resultado mostrado na tela (já com os vínculos feitos à mão no Bater PDF). */
  async function baixarExcel(alvo: ResultadoCompleto) {
    setBaixando(true);
    try {
      const buffer = await gerarExcel(alvo);
      const url = URL.createObjectURL(new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }));
      const a = document.createElement("a");
      a.href = url;
      const data = alvo.resumo.dataBase.split("/").reverse().join("");
      a.download = `Bate_Carteira_Lastro_${alvo.resumo.cnpj || "fundo"}_${data}.xlsx`;
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
      <div data-tour="conferir" className="mt-8 flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 md:flex-row md:items-center md:justify-between md:p-6">
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
          <div className="w-full max-w-md space-y-3" data-tour="modo">
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
                : modo === "auto"
                  ? `Escolha o fundo: o workpaper e a pasta de lastro vêm ${fonteDrive === "pasta" ? "da pasta do trimestre neste computador (G:)" : "do Drive (G:)"} e a carteira, da API da Britech.`
                  : autoDisponivel ? "Escolha o workpaper, a carteira e a pasta à mão (ou arraste para os cartões)."
                    : "O Drive não está acessível por aqui (sem G: neste servidor e este navegador não deixa escolher pastas — use Chrome ou Edge): escolha os arquivos à mão."}
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

        {modo === "auto" && !servidorInfo.carregando && (fontesDisponiveis.length > 1 || fonteDrive !== "local") && (
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            {fontesDisponiveis.length > 1 ? (
              <div className="flex flex-col gap-2 text-sm text-creme/60 sm:flex-row sm:items-center sm:gap-3">
                <span className="shrink-0">Ler o Drive por</span>
                <div className={cn("w-full", "sm:w-[24rem]")}>
                  <Alternador
                    valor={fonteDrive ?? fontesDisponiveis[0]}
                    onMudar={(v) => {
                      limpar();
                      setEscolhaDrive(v);
                    }}
                    opcoes={fontesDisponiveis.map((f) => ({ valor: f, rotulo: ROTULO_FONTE[f] }))}
                  />
                </div>
              </div>
            ) : <span />}
            {fonteDrive === "pasta" && pastaBase && (
              <p className="text-sm text-creme/60">
                Pasta: <span className="text-creme/85">{pastaBase.name}</span> ·{" "}
                <button type="button" onClick={() => abrirPastaBase(false)} className="underline underline-offset-4 hover:text-creme">trocar</button>
              </p>
            )}
          </div>
        )}

        {servidorInfo.carregando ? (
          <p className="inline-flex items-center gap-2 text-sm text-creme/60"><Loader2 className="size-4 animate-spin" /> Carregando…</p>
        ) : modo === "auto" && fonteDrive === "pasta" && !pastaBase ? (
          <div className="flex flex-col items-start gap-4 rounded-2xl border border-border bg-card p-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl space-y-1">
              <p className="text-lg font-medium text-creme">Escolha a pasta do trimestre neste computador</p>
              <p className="text-sm text-creme/60">
                No seletor, vá até o <b className="font-medium text-creme/80">G:</b> e escolha a pasta do trimestre (ex.:{" "}
                <code className="text-creme/80">…\2026\2T2026</code>), que tem uma pasta por administradora — ou só a de uma
                administradora (<code className="text-creme/80">…\2T2026\PLANNER</code>). O navegador só lê essa pasta e nada sai do
                seu computador; só a carteira vem da Britech.
              </p>
              {erroPasta && <p className="text-sm text-erro">{erroPasta}</p>}
            </div>
            <div className="flex shrink-0 flex-col items-stretch gap-2">
              <button
                type="button"
                onClick={() => abrirPastaBase(false)}
                disabled={abrindoPasta}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-black disabled:opacity-50"
              >
                {abrindoPasta ? <Loader2 className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}
                Escolher pasta
              </button>
              {ultimaPasta && (
                <button
                  type="button"
                  onClick={() => abrirPastaBase(true)}
                  disabled={abrindoPasta}
                  className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm text-creme/80 ring-1 ring-creme/20 hover:bg-creme/[0.06] disabled:opacity-50"
                >
                  <History className="size-4" /> Usar a última: {ultimaPasta}
                </button>
              )}
            </div>
          </div>
        ) : modo === "auto" && fonteDrive ? (
          <FontesAuto
            key={`auto-${fonteDrive}-${recarga}-${pastaBase?.name ?? ""}`}
            status={status ?? STATUS_VAZIO}
            provedor={fonteDrive === "pasta" && provedorPasta ? provedorPasta : provedorLocal}
            basePadrao={fonteDrive === "pasta" ? pastaBase?.name ?? "" : status?.drive.base || DRIVE_BASE_PADRAO}
            acoes={barra}
            onMudar={limpar}
          />
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
