"use client";

import { FileSpreadsheet, FolderOpen, Landmark, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArquivoEntrada } from "@/lib/lastro/pipeline";
import { opcoesDeCarteira, type OpcaoCarteira } from "@/lib/lastro/carteiras";
import { DicaAdministradora } from "@/components/guia-administradoras";
import { EVENTO_LISTA_FUNDOS } from "@/components/tour";
import { dataDoTrimestre, type Administradora, type ProvedorDrive } from "@/lib/lastro/drive-comum";
import { lerWorkpaper, workpaperDaAmostra, type Workpaper } from "@/lib/lastro/planilhas";
import {
  servidor, type ArquivoDeRecebiveis, type CarteiraFormatada, type FundoDrive, type FundoMonday, type PapelDoFundo, type PastaLastro,
  type StatusServidor,
} from "@/lib/lastro/servidor-cliente";
import { fmtData, normalizar } from "@/lib/lastro/textos";
import { cn } from "@/lib/utils";
import { Alternador, CampoDataBase, Cartao, classeSelect, mensagem } from "./comum";
import type { Preparo, PropsFontes } from "./tipos";

const fmtCnpj = (c: string) =>
  c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c;
const nomeDaPasta = (caminho: string) => caminho.split(/[\\/]/).filter(Boolean).pop() ?? caminho;
const fmtDia = (iso: string) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "");
/** WP_Termo de direitos creditórios (linhas com sacado/cedente) — a carteira certa é a amostra/estoque, não a Britech. */
const ehDeRecebiveis = (wp: Workpaper) => wp.linhas.filter((l) => l.nomeSacado || l.nomeCedente).length > wp.linhas.length / 2;


function SeletorFundo({ fundos, carregando, erro, escolhido, onEscolher }: {
  fundos: FundoDrive[]; carregando: boolean; erro: string; escolhido: FundoDrive | null; onEscolher: (f: FundoDrive) => void;
}) {
  const [filtro, setFiltro] = useState("");
  const [aberto, setAberto] = useState(false);
  // o tour guiado abre a lista para mostrar como escolher o fundo (e fecha ao sair do passo)
  const [peloTour, setPeloTour] = useState(false);
  useEffect(() => {
    const mudar = (e: Event) => setPeloTour((e as CustomEvent<boolean>).detail);
    window.addEventListener(EVENTO_LISTA_FUNDOS, mudar);
    return () => window.removeEventListener(EVENTO_LISTA_FUNDOS, mudar);
  }, []);
  const lista = useMemo(() => {
    const termo = normalizar(filtro);
    const digitos = filtro.replace(/\D/g, "");
    return fundos
      .filter((f) => !termo || normalizar(f.fundo).includes(termo) || (digitos.length >= 3 && f.cnpj.includes(digitos)))
      .slice(0, 100);
  }, [fundos, filtro]);

  return (
    <div className="relative">
      <label className="flex items-center gap-2 rounded-xl border border-border bg-creme/[0.04] px-3 py-2 focus-within:border-creme/40">
        <Search className="size-4 shrink-0 text-creme/50" />
        <input
          value={filtro}
          onChange={(e) => {
            setFiltro(e.target.value);
            setAberto(true);
          }}
          onFocus={() => setAberto(true)}
          onBlur={() => setTimeout(() => setAberto(false), 150)}
          placeholder={carregando ? "Carregando fundos…" : escolhido ? "Trocar de fundo (nome ou CNPJ)" : `Buscar entre ${fundos.length} fundos (nome ou CNPJ)`}
          className="min-w-0 flex-1 bg-transparent text-sm text-creme outline-none placeholder:text-creme/40"
          data-campo="busca-fundo"
        />
        {carregando && <Loader2 className="size-4 animate-spin text-creme/50" />}
      </label>
      {erro && <p className="mt-2 text-sm text-erro">{erro}</p>}
      {(aberto || peloTour) && !carregando && (
        <ul className="absolute z-30 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-border bg-popover p-1 shadow-2xl" data-tour="lista-fundos">
          {lista.length === 0 && <li className="px-3 py-2 text-sm text-creme/50">Nenhum fundo com esse nome ou CNPJ.</li>}
          {lista.map((f) => (
            <li key={f.caminho}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setFiltro("");
                  setAberto(false);
                  setPeloTour(false);
                  onEscolher(f);
                }}
                className={cn("w-full rounded-lg px-3 py-2 text-left hover:bg-creme/[0.06]", escolhido?.caminho === f.caminho && "bg-creme/[0.06]")}
                data-fundo={f.arquivo}
              >
                <span className="block truncate text-sm text-creme">{f.fundo}</span>
                <span className="block text-xs text-creme/45">
                  {f.cnpj ? fmtCnpj(f.cnpj) : "sem CNPJ no nome"} · {f.pasta}
                  {f.semWorkpaper ? <> · <span className="text-aviso">sem workpaper (usa a amostra)</span></> : <> · {fmtDia(f.modificado)}</>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Fontes buscadas sozinhas: workpaper e lastro no Drive (G:), carteira na Britech da administradora do fundo. */
export function FontesAuto({ status, provedor, basePadrao, acoes, onMudar }: PropsFontes & {
  status: StatusServidor; provedor: ProvedorDrive; basePadrao: string;
}) {
  const motivoSemBritech = status.exigeChave && !status.liberado
    ? "Informe a chave de acesso do app (acima) para usar a API da Britech."
    : "Credenciais da Britech não configuradas neste servidor (BRITECH_<ADM>_USUARIO e _SENHA no .env.local).";
  const [base, setBase] = useState(basePadrao);
  const [baseAplicada, setBaseAplicada] = useState(basePadrao);
  const [adms, setAdms] = useState<Administradora[]>([]);
  const [avisoBritech, setAvisoBritech] = useState("");
  const [fundos, setFundos] = useState<{ chave: string; lista: FundoDrive[]; erro: string } | null>(null);
  const [fundo, setFundo] = useState<FundoDrive | null>(null);
  const [wp, setWp] = useState<Workpaper | null>(null);
  const [wpErro, setWpErro] = useState("");
  const [carregandoWp, setCarregandoWp] = useState(false);
  const [dataBase, setDataBase] = useState("");
  const [modoCarteira, setModoCarteira] = useState<"api" | "drive" | "fromtis" | "sinqia">(status.britech.configurada ? "api" : "drive");
  // Monday: administradora, sistema e carteira do fundo (de onde buscar a carteira)
  const [monday, setMonday] = useState<{ fundo: FundoMonday | null; papel: PapelDoFundo | null; erro: string } | null>(null);
  // Sinqia (posição da carteira; Azumi)
  const admsSinqia = useMemo(() => status.sinqia?.administradoras ?? [], [status.sinqia]);
  const [escolhaSinqia, setEscolhaSinqia] = useState("");
  const [carteiraSinqia, setCarteiraSinqia] = useState("");
  // Fromtis (API SOAP de estoque): a administradora padrão é a da pasta escolhida no Drive (AZUMI, FINVEST, LIMINE…)
  const admsFromtis = useMemo(() => status.fromtis?.administradoras ?? [], [status.fromtis]);
  const [escolhaFromtis, setEscolhaFromtis] = useState("");
  const admFromtisDaPasta = useMemo(() => {
    const pasta = normalizar(adms.find((a) => a.base === baseAplicada)?.nome ?? nomeDaPasta(baseAplicada));
    return admsFromtis.find((a) => pasta === normalizar(a.adm) || pasta.includes(normalizar(a.nome)))?.adm ?? "";
  }, [adms, baseAplicada, admsFromtis]);
  const [carteiras, setCarteiras] = useState<{ lista: OpcaoCarteira[]; erro: string } | null>(null);
  const [idCarteira, setIdCarteira] = useState("");
  const [formatada, setFormatada] = useState<CarteiraFormatada | null | undefined>(undefined);
  const [recebiveis, setRecebiveis] = useState<ArquivoDeRecebiveis[] | undefined>(undefined);
  const [arquivoSel, setArquivoSel] = useState("");
  const [pastas, setPastas] = useState<{ lista: PastaLastro[]; erro: string } | null>(null);
  const [pastaSel, setPastaSel] = useState("");
  const [lastro, setLastro] = useState<{ pasta: string; arquivos: ArquivoEntrada[]; erro: string } | null>(null);
  const vez = useRef(0);
  const vezPasta = useRef(0);

  // administradoras do trimestre (pastas com _Workpapers): escolher uma troca a pasta de onde vêm os fundos
  useEffect(() => {
    let vivo = true;
    provedor.administradoras(basePadrao)
      .then((lista) => {
        if (!vivo) return;
        setAdms(lista);
        if (lista.length && !lista.some((a) => a.base === basePadrao)) {
          const padrao = lista.find((a) => normalizar(a.nome) === "planner") ?? lista[0];
          setBase(padrao.base);
          setBaseAplicada(padrao.base);
        }
      })
      .catch(() => vivo && setAdms([]));
    return () => {
      vivo = false;
    };
  }, [provedor, basePadrao]);

  function trocarAdministradora(novaBase: string) {
    onMudar();
    vez.current++;
    setFundo(null);
    setWp(null);
    setCarteiras(null);
    setPastas(null);
    setPastaSel("");
    setLastro(null);
    setBase(novaBase);
    setBaseAplicada(novaBase);
  }

  const chaveFundos = baseAplicada;
  useEffect(() => {
    let vivo = true;
    provedor.fundos(baseAplicada)
      .then((lista) => vivo && setFundos({ chave: chaveFundos, lista, erro: "" }))
      .catch((e) => vivo && setFundos({ chave: chaveFundos, lista: [], erro: mensagem(e) }));
    return () => {
      vivo = false;
    };
  }, [provedor, baseAplicada, chaveFundos]);
  const carregandoFundos = fundos?.chave !== chaveFundos;

  async function escolherPasta(caminho: string) {
    const v = ++vezPasta.current;
    onMudar();
    setPastaSel(caminho);
    setLastro(null);
    if (!caminho) return;
    try {
      const arquivos = await provedor.listar(caminho);
      if (v === vezPasta.current) setLastro({ pasta: caminho, arquivos, erro: "" });
    } catch (e) {
      if (v === vezPasta.current) setLastro({ pasta: caminho, arquivos: [], erro: mensagem(e) });
    }
  }

  /**
   * Carteira do fundo: Britech (API ou FORMATADA) e, nas administradoras sem Britech, a amostra/estoque do Drive.
   * Fundo de recebíveis (WP_Termo com sacado/cedente) com amostra no Drive começa na amostra.
   */
  async function buscarCarteiras(v: number, cnpj: string, data: string, nomeFundo: string, deRecebiveis: boolean) {
    const [fmt, rec, api, mon] = await Promise.allSettled([
      provedor.carteiraFormatada(baseAplicada, cnpj, data || null),
      provedor.amostrasEstoques(baseAplicada, nomeFundo, cnpj),
      status.britech.configurada
        ? servidor.carteirasBritech(cnpj)
        : Promise.reject(new Error(motivoSemBritech)),
      status.monday?.configurado ? servidor.fundoMonday(cnpj) : Promise.resolve(null),
    ]);
    if (v !== vez.current) return;
    const noMonday = mon.status === "fulfilled" && mon.value ? mon.value : null;
    setMonday(mon.status === "fulfilled" ? (noMonday ? { fundo: noMonday.fundo, papel: noMonday.papel, erro: "" } : null) : { fundo: null, papel: null, erro: mensagem(mon.reason) });
    const fundoMon = noMonday?.fundo ?? null;
    const fonteMon = noMonday?.papel?.fonte;
    // Sinqia: carteira do Monday (ou os 8 primeiros dígitos do CNPJ, como nos fundos da Azumi)
    setCarteiraSinqia(fundoMon?.carteira || cnpj.slice(0, 8));
    const admSinqia = admsSinqia.find((a) => a.adm === (fundoMon?.adm ?? "").toUpperCase());
    if (admSinqia) setEscolhaSinqia(admSinqia.adm);
    const preferirSinqia = fonteMon === "sinqia" && !!admSinqia && !deRecebiveis;
    const arquivo = fmt.status === "fulfilled" ? fmt.value : null;
    const lista = rec.status === "fulfilled" ? rec.value : [];
    setFormatada(arquivo);
    setRecebiveis(lista);
    const preferirDrive = deRecebiveis && lista.length > 0;
    const temNoDrive = !!arquivo || lista.length > 0;
    const preferirFromtis = deRecebiveis && !preferirDrive && !!admFromtisDaPasta;
    setArquivoSel(preferirDrive ? lista[0].caminho : arquivo?.caminho ?? lista[0]?.caminho ?? "");
    if (api.status === "fulfilled") {
      const { opcoes, padrao } = opcoesDeCarteira(api.value.carteiras, arquivo?.idCarteira);
      setCarteiras({ lista: opcoes, erro: opcoes.length ? "" : "Nenhuma Britech configurada tem carteira para este CNPJ." });
      // a carteira do Monday manda, se a Britech a devolveu
      setIdCarteira(fundoMon?.carteira && opcoes.some((o) => o.id === fundoMon.carteira) ? fundoMon.carteira : padrao);
      const falhas = api.value.falhas.map((f) => f.adm).join(", ");
      setAvisoBritech(!opcoes.length && falhas ? `Não consegui consultar: ${falhas}.` : "");
      setModoCarteira(preferirDrive ? "drive" : preferirSinqia ? "sinqia" : preferirFromtis ? "fromtis"
        : (!opcoes.length || fonteMon === "arquivo") && temNoDrive ? "drive" : "api");
    } else {
      setCarteiras({ lista: [], erro: mensagem(api.reason) });
      setIdCarteira(arquivo?.idCarteira ?? fundoMon?.carteira ?? "");
      if (preferirSinqia) setModoCarteira("sinqia");
      else if (preferirFromtis) setModoCarteira("fromtis");
      else if (temNoDrive) setModoCarteira("drive");
    }
  }

  async function escolherFundo(f: FundoDrive) {
    const v = ++vez.current;
    onMudar();
    setFundo(f);
    setWp(null);
    setWpErro("");
    setCarregandoWp(true);
    setCarteiras(null);
    setIdCarteira("");
    setFormatada(undefined);
    setRecebiveis(undefined);
    setArquivoSel("");
    setMonday(null);
    setPastas(null);
    setPastaSel("");
    setLastro(null);
    try {
      const bytes = await provedor.arquivo(f.caminho);
      const lido = f.semWorkpaper
        ? workpaperDaAmostra(bytes, f.arquivo, f.cnpj, f.fundo, dataDoTrimestre(`${baseAplicada}/${f.caminho}`))
        : lerWorkpaper(bytes, f.arquivo);
      if (v !== vez.current) return;
      setWp(lido);
      setDataBase(lido.dataBase ?? "");
      const cnpj = lido.cnpj || f.cnpj;
      void buscarCarteiras(v, cnpj, lido.dataBase ?? "", f.fundo, ehDeRecebiveis(lido));
      try {
        const lista = await provedor.pastasLastro(baseAplicada, f.fundo, cnpj);
        if (v !== vez.current) return;
        setPastas({ lista, erro: "" });
        const melhor = lista[0];
        if (melhor && melhor.pontos >= 0.5) void escolherPasta(melhor.caminho);
      } catch (e) {
        if (v === vez.current) setPastas({ lista: [], erro: mensagem(e) });
      }
    } catch (e) {
      if (v === vez.current) setWpErro(mensagem(e));
    } finally {
      if (v === vez.current) setCarregandoWp(false);
    }
  }

  function mudarData(valor: string) {
    onMudar();
    setDataBase(valor);
    if (!wp) return;
    const v = vez.current;
    setFormatada(undefined);
    provedor.carteiraFormatada(baseAplicada, wp.cnpj || fundo?.cnpj || "", valor || null)
      .then((c) => v === vez.current && setFormatada(c))
      .catch(() => v === vez.current && setFormatada(null));
  }

  const dataEf = dataBase || wp?.dataBase || null;
  const opcaoCarteira = carteiras?.lista.find((c) => c.id === idCarteira);
  const nomePasta = pastas?.lista.find((p) => p.caminho === pastaSel)?.nome ?? nomeDaPasta(pastaSel);
  const opcoesDrive = [
    ...(formatada ? [{ caminho: formatada.caminho, arquivo: formatada.arquivo, tipo: "britech" as const, rotulo: `Carteira Britech — ${formatada.arquivo}` }] : []),
    ...(recebiveis ?? []).map((r) => ({
      caminho: r.caminho, arquivo: r.arquivo, tipo: r.tipo,
      rotulo: `${r.tipo === "amostra" ? "Amostra" : "Estoque"} — ${r.pasta ? `${r.pasta}/` : ""}${r.arquivo}`,
    })),
  ];
  const noDrive = opcoesDrive.find((o) => o.caminho === arquivoSel) ?? opcoesDrive[0];
  const estoqueNoDrive = (recebiveis ?? []).find((r) => r.tipo === "estoque");
  const procurandoNoDrive = formatada === undefined || recebiveis === undefined;
  const cnpjFundo = wp?.cnpj || fundo?.cnpj || "";
  const admFromtis = admsFromtis.find((a) => a.adm === escolhaFromtis) ?? admsFromtis.find((a) => a.adm === admFromtisDaPasta) ?? admsFromtis[0];
  const admSinqia = admsSinqia.find((a) => a.adm === escolhaSinqia) ?? admsSinqia[0];
  const carteiraPronta = modoCarteira === "api" ? !!(idCarteira && dataEf && status.britech.configurada)
    : modoCarteira === "fromtis" ? !!(admFromtis && dataEf && cnpjFundo.length === 14)
      : modoCarteira === "sinqia" ? !!(admSinqia && dataEf && carteiraSinqia)
        : !!noDrive;
  const lastroPronto = !!lastro && lastro.pasta === pastaSel && !lastro.erro;
  const preparo: Preparo | null = wp && lastroPronto && carteiraPronta && lastro ? {
    workpaper: wp,
    dataBase: dataEf,
    carteira: modoCarteira === "api"
      ? {
        rotulo: `API Britech ${opcaoCarteira?.admNome ?? ""} — carteira ${idCarteira} em ${fmtData(dataEf)}`.replace("  ", " "),
        obter: async () => ({
          bytes: await servidor.composicaoBritech(opcaoCarteira?.adm ?? "PLANNER", idCarteira, dataEf!),
          nome: `carteira_${idCarteira}_${dataEf}.xlsx`,
        }),
      }
      : modoCarteira === "sinqia"
        ? {
          rotulo: `Sinqia ${admSinqia!.nome} — carteira ${carteiraSinqia} em ${fmtData(dataEf)}`,
          obter: async () => ({
            bytes: await servidor.carteiraSinqia(admSinqia!.adm, carteiraSinqia, dataEf!),
            nome: `sinqia_${carteiraSinqia}_${dataEf}.csv`,
          }),
        }
      : modoCarteira === "fromtis"
        ? {
          rotulo: `Fromtis ${admFromtis!.nome} — estoque do CNPJ ${fmtCnpj(cnpjFundo)} em ${fmtData(dataEf)}`,
          obter: async () => ({
            bytes: await servidor.estoqueFromtis(admFromtis!.adm, cnpjFundo, dataEf!),
            nome: `estoque_fromtis_${cnpjFundo}_${dataEf}.csv`,
          }),
        }
        : {
          rotulo: noDrive!.caminho.replace(/^pasta:/, ""),
          obter: async () => ({ bytes: await provedor.arquivo(noDrive!.caminho), nome: noDrive!.arquivo }),
        },
    lastro: { nome: nomePasta, obter: async () => lastro.arquivos },
    // carteira = amostra: o estoque do Drive (se houver) entra só para validar a carteira
    estoque: modoCarteira === "drive" && noDrive?.tipo === "amostra" && estoqueNoDrive
      ? { rotulo: estoqueNoDrive.caminho.replace(/^pasta:/, ""), obter: async () => ({ bytes: await provedor.arquivo(estoqueNoDrive.caminho), nome: estoqueNoDrive.arquivo }) }
      : undefined,
  } : null;

  const nomeCarteira = opcaoCarteira?.nome;

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <Cartao
          numero="01"
          titulo="Fundo"
          icone={<FileSpreadsheet className="size-5" />}
          pronto={!!wp}
          descricao={<>Escolha o fundo: o app abre o <code className="text-creme/80">WP_&lt;fundo&gt;_&lt;cnpj&gt;.xlsm</code> de <code className="text-creme/80">_Workpapers</code> e usa a aba <b className="font-medium text-creme/80">WP_Termo</b>.</>}
        >
          {adms.length > 1 && (
            <label className="flex items-center gap-3 text-sm text-creme/70">
              <span className="shrink-0">Administradora</span>
              <select value={baseAplicada} onChange={(e) => trocarAdministradora(e.target.value)} className={classeSelect} data-campo="administradora">
                {adms.map((a) => <option key={a.base} value={a.base}>{a.nome}</option>)}
              </select>
            </label>
          )}
          <DicaAdministradora nome={adms.find((a) => a.base === baseAplicada)?.nome ?? nomeDaPasta(baseAplicada)} />
          <SeletorFundo
            fundos={fundos?.lista ?? []}
            carregando={carregandoFundos}
            erro={fundos?.erro ?? ""}
            escolhido={fundo}
            onEscolher={escolherFundo}
          />
          {fundo && (
            <div className="rounded-xl bg-creme/[0.04] px-3 py-2.5 text-sm">
              <p className="truncate font-medium text-creme" title={fundo.arquivo}>{fundo.arquivo}</p>
              <div className="mt-1 text-xs text-creme/60">
                {carregandoWp ? <span className="inline-flex items-center gap-2"><Loader2 className="size-3 animate-spin" /> Lendo o workpaper…</span>
                  : wpErro ? <span className="text-erro">{wpErro}</span>
                    : wp && (fundo.semWorkpaper
                      ? <><span className="text-creme/85">{wp.fundo}</span> · CNPJ {fmtCnpj(wp.cnpj)} · sem workpaper: {wp.linhas.length} recebível(is) da amostra no lugar da WP_Termo</>
                      : <><span className="text-creme/85">{wp.fundo}</span> · CNPJ {fmtCnpj(wp.cnpj)} · {wp.linhas.length} linha(s) na WP_Termo</>)}
              </div>
            </div>
          )}
          {wp && monday?.fundo && (
            <p className="text-xs text-creme/60" data-campo="monday">
              Monday: <span className="text-creme/85">{monday.fundo.adm || "—"}</span> · {monday.fundo.sistema || "sistema não informado"}
              {monday.fundo.carteira ? <> · carteira <span className="tabular-nums text-creme/85">{monday.fundo.carteira}</span></> : null}
            </p>
          )}
          {wp && monday?.papel?.aviso && <p className={cn("text-xs", monday.papel.fonte === "fora" ? "text-erro" : "text-aviso")}>{monday.papel.aviso}</p>}
          {wp && monday?.erro && <p className="text-xs text-aviso">Monday: {monday.erro}</p>}
          {wp && monday === null && status.monday?.configurado && !carregandoWp && carteiras && (
            <p className="text-xs text-creme/45">Fundo não encontrado no board do Monday.</p>
          )}
          {wp && <CampoDataBase valor={dataBase} onMudar={mudarData} />}
        </Cartao>

        <Cartao
          numero="02"
          titulo="Carteira"
          icone={<Landmark className="size-5" />}
          pronto={!!wp && carteiraPronta}
          descricao={modoCarteira === "api"
            ? <>Composição da carteira na data-base, direto da API da Britech da administradora, achada pelo CNPJ.</>
            : modoCarteira === "sinqia"
              ? <>Posição da carteira na data-base pelo Sinqia da administradora (o mesmo do boleta_sinqia), com o código da carteira do Monday.</>
            : modoCarteira === "fromtis"
              ? <>Estoque de direitos creditórios do fundo na data-base, pela API do Fromtis da administradora (o mesmo do hub).</>
              : <>Do Drive: a carteira Britech já baixada (<code className="text-creme/80">_Carteiras\FORMATADA</code>) ou, nas administradoras sem Britech, a amostra (<code className="text-creme/80">_Amostra</code>) ou o estoque (<code className="text-creme/80">_Insumos</code>) do fundo.</>}
        >
          <Alternador
            valor={modoCarteira}
            onMudar={(m) => {
              onMudar();
              setModoCarteira(m);
            }}
            opcoes={[
              { valor: "api", rotulo: "API Britech" },
              { valor: "drive", rotulo: "Arquivo no Drive" },
              ...(admsSinqia.length ? [{ valor: "sinqia" as const, rotulo: "Sinqia" }] : []),
              ...(admsFromtis.length ? [{ valor: "fromtis" as const, rotulo: "Fromtis" }] : []),
            ]}
          />
          {!wp ? (
            <p className="text-xs text-creme/45">Escolha o fundo primeiro.</p>
          ) : modoCarteira === "api" ? (
            !status.britech.configurada ? (
              <p className="text-sm text-aviso">{motivoSemBritech}</p>
            ) : !carteiras ? (
              <p className="inline-flex items-center gap-2 text-xs text-creme/60"><Loader2 className="size-3 animate-spin" /> Buscando as carteiras do CNPJ na Britech…</p>
            ) : (
              <div className="space-y-2">
                {carteiras.lista.length > 0 ? (
                  <select value={idCarteira} onChange={(e) => { onMudar(); setIdCarteira(e.target.value); }} className={classeSelect}>
                    {carteiras.lista.map((c) => <option key={c.id} value={c.id}>{c.id} — {c.nome}{c.admNome ? ` (${c.admNome})` : ""}</option>)}
                  </select>
                ) : (
                  <input
                    value={idCarteira}
                    onChange={(e) => { onMudar(); setIdCarteira(e.target.value.replace(/\D/g, "")); }}
                    placeholder="ID da carteira (ex.: 52230)"
                    className={classeSelect}
                  />
                )}
                {carteiras.erro && <p className="text-xs text-erro">{carteiras.erro}</p>}
                {avisoBritech && <p className="text-xs text-aviso">{avisoBritech}</p>}
                {idCarteira && <p className="text-xs text-creme/55">Carteira {idCarteira}{nomeCarteira ? ` (${nomeCarteira})` : ""}{opcaoCarteira?.admNome ? ` na Britech ${opcaoCarteira.admNome}` : ""} em {fmtData(dataEf)} — baixada ao conferir.</p>}
              </div>
            )
          ) : modoCarteira === "sinqia" ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                {admsSinqia.length > 1 && (
                  <select value={admSinqia?.adm ?? ""} onChange={(e) => { onMudar(); setEscolhaSinqia(e.target.value); }} className={classeSelect} aria-label="Sinqia da administradora">
                    {admsSinqia.map((a) => <option key={a.adm} value={a.adm}>{a.nome}</option>)}
                  </select>
                )}
                <input
                  value={carteiraSinqia}
                  onChange={(e) => { onMudar(); setCarteiraSinqia(e.target.value.replace(/\D/g, "")); }}
                  placeholder="Código da carteira no Sinqia"
                  className={classeSelect}
                  aria-label="Código da carteira no Sinqia"
                />
              </div>
              <p className="text-xs text-creme/55">
                Posição da carteira {carteiraSinqia || "—"} em {fmtData(dataEf)} no Sinqia da {admSinqia?.nome} — títulos de renda fixa
                (os direitos creditórios vêm só em totais; por recebível, use a amostra/estoque).
              </p>
            </div>
          ) : modoCarteira === "fromtis" ? (
            <div className="space-y-2">
              {admsFromtis.length > 1 && (
                <select
                  value={admFromtis?.adm ?? ""}
                  onChange={(e) => { onMudar(); setEscolhaFromtis(e.target.value); }}
                  className={classeSelect}
                  aria-label="Fromtis da administradora"
                >
                  {admsFromtis.map((a) => <option key={a.adm} value={a.adm}>{a.nome}</option>)}
                </select>
              )}
              <p className="text-xs text-creme/55">
                Estoque do CNPJ {fmtCnpj(cnpjFundo)} em {fmtData(dataEf)} no Fromtis da {admFromtis?.nome} — gerado e baixado ao
                conferir (pode levar 1 a 2 minutos). Estoque grande: o app confere só os recebíveis da WP_Termo.
              </p>
            </div>
          ) : procurandoNoDrive ? (
            <p className="inline-flex items-center gap-2 text-xs text-creme/60"><Loader2 className="size-3 animate-spin" /> Procurando a carteira, a amostra e o estoque do fundo…</p>
          ) : noDrive ? (
            <div className="space-y-2">
              <select value={noDrive.caminho} onChange={(e) => { onMudar(); setArquivoSel(e.target.value); }} className={classeSelect} data-campo="carteira-drive">
                {opcoesDrive.map((o) => <option key={o.caminho} value={o.caminho}>{o.rotulo}</option>)}
              </select>
              {noDrive.tipo === "estoque" && (
                <p className="text-xs text-creme/55">Estoque com muitos recebíveis: o app confere só os que estão na WP_Termo.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-erro">
              Não achei no Drive a carteira deste CNPJ em {fmtData(dataEf)} (_Carteiras\FORMATADA) nem a amostra/estoque do fundo (_Amostra, _Insumos).
            </p>
          )}
        </Cartao>

        <Cartao
          numero="03"
          titulo="Lastro e termo"
          icone={<FolderOpen className="size-5" />}
          pronto={lastroPronto}
          descricao={<>A pasta do fundo em <code className="text-creme/80">Lastro e Termo</code>, sugerida pelo nome do fundo. Lê PDF, boletas HTML, DOCX e TXT.</>}
        >
          {!wp ? (
            <p className="text-xs text-creme/45">Escolha o fundo primeiro.</p>
          ) : !pastas ? (
            <p className="inline-flex items-center gap-2 text-xs text-creme/60"><Loader2 className="size-3 animate-spin" /> Procurando a pasta do fundo…</p>
          ) : pastas.erro ? (
            <p className="text-sm text-erro">{pastas.erro}</p>
          ) : (
            <div className="space-y-2">
              <select value={pastaSel} onChange={(e) => escolherPasta(e.target.value)} className={classeSelect} data-campo="pasta-lastro">
                <option value="">Escolha a pasta…</option>
                {pastas.lista.map((p, i) => (
                  <option key={p.caminho} value={p.caminho}>
                    {p.nome}{i === 0 && p.pontos >= 0.5 ? " — sugerida" : ""}
                  </option>
                ))}
              </select>
              {pastaSel && !lastro && <p className="inline-flex items-center gap-2 text-xs text-creme/60"><Loader2 className="size-3 animate-spin" /> Listando os arquivos…</p>}
              {lastro?.erro && <p className="text-sm text-erro">{lastro.erro}</p>}
              {lastroPronto && <p className="text-xs text-creme/55">{lastro.arquivos.length} arquivo(s) na pasta.</p>}
              {!pastaSel && <p className="text-xs text-aviso">Nenhuma pasta com nome parecido com o fundo: escolha na lista.</p>}
            </div>
          )}
        </Cartao>
      </div>

      {provedor.tipo !== "pasta" && (
      <details className="mt-4 rounded-2xl border border-border bg-card px-5 py-3 text-sm text-creme/70">
        <summary className="cursor-pointer text-creme/60">Pasta do trimestre no Drive</summary>
        <div className="mt-3 space-y-3 pb-2">
          <div className="flex flex-col gap-2 md:flex-row">
            <input value={base} onChange={(e) => setBase(e.target.value)} className={cn(classeSelect, "font-mono text-xs")} />
            <button
              type="button"
              onClick={() => {
                onMudar();
                vez.current++;
                setFundo(null);
                setWp(null);
                setBaseAplicada(base.trim());
              }}
              className="shrink-0 rounded-full px-4 py-2 text-sm text-creme ring-1 ring-creme/20 hover:bg-creme/[0.06]"
            >
              Usar esta pasta
            </button>
          </div>
          <p className="text-xs text-creme/45">
            Dentro dela o app procura <code>_Workpapers</code>, <code>Lastro e Termo</code> e <code>_Carteiras\FORMATADA</code>.
            {" O padrão vem de LASTRO_DRIVE_BASE."}
          </p>
        </div>
      </details>
      )}

      {acoes(preparo)}
    </>
  );
}
