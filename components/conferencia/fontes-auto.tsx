"use client";

import { FileSpreadsheet, FolderOpen, Landmark, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArquivoEntrada } from "@/lib/lastro/pipeline";
import { opcoesDeCarteira } from "@/lib/lastro/carteiras";
import { lerWorkpaper, type Workpaper } from "@/lib/lastro/planilhas";
import {
  servidor, type CarteiraBritech, type CarteiraFormatada, type FundoDrive, type PastaLastro, type StatusServidor,
} from "@/lib/lastro/servidor-cliente";
import { fmtData, normalizar } from "@/lib/lastro/textos";
import { cn } from "@/lib/utils";
import { Alternador, CampoDataBase, Cartao, classeSelect, mensagem } from "./comum";
import type { Preparo, PropsFontes } from "./tipos";

const fmtCnpj = (c: string) =>
  c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c;
const nomeDaPasta = (caminho: string) => caminho.split(/[\\/]/).filter(Boolean).pop() ?? caminho;
const fmtDia = (iso: string) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "");


function SeletorFundo({ fundos, carregando, erro, escolhido, onEscolher }: {
  fundos: FundoDrive[]; carregando: boolean; erro: string; escolhido: FundoDrive | null; onEscolher: (f: FundoDrive) => void;
}) {
  const [filtro, setFiltro] = useState("");
  const [aberto, setAberto] = useState(false);
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
      {aberto && !carregando && (
        <ul className="absolute z-30 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-border bg-popover p-1 shadow-2xl">
          {lista.length === 0 && <li className="px-3 py-2 text-sm text-creme/50">Nenhum fundo com esse nome ou CNPJ.</li>}
          {lista.map((f) => (
            <li key={f.caminho}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setFiltro("");
                  setAberto(false);
                  onEscolher(f);
                }}
                className={cn("w-full rounded-lg px-3 py-2 text-left hover:bg-creme/[0.06]", escolhido?.caminho === f.caminho && "bg-creme/[0.06]")}
                data-fundo={f.arquivo}
              >
                <span className="block truncate text-sm text-creme">{f.fundo}</span>
                <span className="block text-xs text-creme/45">
                  {f.cnpj ? fmtCnpj(f.cnpj) : "sem CNPJ no nome"} · {f.pasta} · {fmtDia(f.modificado)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Fontes buscadas sozinhas: workpaper e lastro no Drive (G:), carteira na API da Britech. */
export function FontesAuto({ status, acoes, onMudar }: PropsFontes & { status: StatusServidor }) {
  const [base, setBase] = useState(status.drive.base);
  const [baseAplicada, setBaseAplicada] = useState(status.drive.base);
  const [fundos, setFundos] = useState<{ chave: string; lista: FundoDrive[]; erro: string } | null>(null);
  const [fundo, setFundo] = useState<FundoDrive | null>(null);
  const [wp, setWp] = useState<Workpaper | null>(null);
  const [wpErro, setWpErro] = useState("");
  const [carregandoWp, setCarregandoWp] = useState(false);
  const [dataBase, setDataBase] = useState("");
  const [modoCarteira, setModoCarteira] = useState<"api" | "formatada">(status.britech.configurada ? "api" : "formatada");
  const [carteiras, setCarteiras] = useState<{ lista: CarteiraBritech[]; erro: string } | null>(null);
  const [idCarteira, setIdCarteira] = useState("");
  const [formatada, setFormatada] = useState<CarteiraFormatada | null | undefined>(undefined);
  const [pastas, setPastas] = useState<{ lista: PastaLastro[]; erro: string } | null>(null);
  const [pastaSel, setPastaSel] = useState("");
  const [lastro, setLastro] = useState<{ pasta: string; arquivos: ArquivoEntrada[]; erro: string } | null>(null);
  const vez = useRef(0);
  const vezPasta = useRef(0);

  const chaveFundos = baseAplicada;
  useEffect(() => {
    let vivo = true;
    servidor.fundos(baseAplicada)
      .then((r) => vivo && setFundos({ chave: chaveFundos, lista: r.fundos, erro: "" }))
      .catch((e) => vivo && setFundos({ chave: chaveFundos, lista: [], erro: mensagem(e) }));
    return () => {
      vivo = false;
    };
  }, [baseAplicada, chaveFundos]);
  const carregandoFundos = fundos?.chave !== chaveFundos;

  async function escolherPasta(caminho: string) {
    const v = ++vezPasta.current;
    onMudar();
    setPastaSel(caminho);
    setLastro(null);
    if (!caminho) return;
    try {
      const arquivos = await servidor.listar(caminho);
      if (v === vezPasta.current) setLastro({ pasta: caminho, arquivos, erro: "" });
    } catch (e) {
      if (v === vezPasta.current) setLastro({ pasta: caminho, arquivos: [], erro: mensagem(e) });
    }
  }

  async function buscarCarteiras(v: number, cnpj: string, data: string) {
    const [fmt, api] = await Promise.allSettled([
      servidor.carteiraFormatada(baseAplicada, cnpj, data || null),
      status.britech.configurada
        ? servidor.carteirasBritech(cnpj)
        : Promise.reject(new Error("Credenciais da Britech não configuradas neste servidor (BRITECH_USUARIO e BRITECH_SENHA).")),
    ]);
    if (v !== vez.current) return;
    const arquivo = fmt.status === "fulfilled" ? fmt.value.carteira : null;
    setFormatada(arquivo);
    if (api.status === "fulfilled") {
      const { opcoes, padrao } = opcoesDeCarteira(api.value.carteiras, arquivo?.idCarteira);
      setCarteiras({ lista: opcoes, erro: opcoes.length ? "" : "A Britech não tem carteira para este CNPJ." });
      setIdCarteira(padrao);
    } else {
      setCarteiras({ lista: [], erro: mensagem(api.reason) });
      setIdCarteira(arquivo?.idCarteira ?? "");
      if (arquivo) setModoCarteira("formatada");
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
    setPastas(null);
    setPastaSel("");
    setLastro(null);
    try {
      const lido = lerWorkpaper(await servidor.arquivo(f.caminho), f.arquivo);
      if (v !== vez.current) return;
      setWp(lido);
      setDataBase(lido.dataBase ?? "");
      const cnpj = lido.cnpj || f.cnpj;
      void buscarCarteiras(v, cnpj, lido.dataBase ?? "");
      try {
        const r = await servidor.pastasLastro(baseAplicada, f.fundo, cnpj);
        if (v !== vez.current) return;
        setPastas({ lista: r.pastas, erro: "" });
        const melhor = r.pastas[0];
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
    servidor.carteiraFormatada(baseAplicada, wp.cnpj || fundo?.cnpj || "", valor || null)
      .then((r) => v === vez.current && setFormatada(r.carteira))
      .catch(() => v === vez.current && setFormatada(null));
  }

  const dataEf = dataBase || wp?.dataBase || null;
  const carteiraPronta = modoCarteira === "api" ? !!(idCarteira && dataEf && status.britech.configurada) : !!formatada;
  const lastroPronto = !!lastro && lastro.pasta === pastaSel && !lastro.erro;
  const preparo: Preparo | null = wp && lastroPronto && carteiraPronta && lastro ? {
    workpaper: wp,
    dataBase: dataEf,
    carteira: modoCarteira === "api"
      ? {
        rotulo: `API Britech — carteira ${idCarteira} em ${fmtData(dataEf)}`,
        obter: async () => ({ bytes: await servidor.composicaoBritech(idCarteira, dataEf!), nome: `carteira_${idCarteira}_${dataEf}.xlsx` }),
      }
      : {
        rotulo: formatada!.caminho,
        obter: async () => ({ bytes: await servidor.arquivo(formatada!.caminho), nome: formatada!.arquivo }),
      },
    lastro: { nome: nomeDaPasta(pastaSel), obter: async () => lastro.arquivos },
  } : null;

  const nomeCarteira = carteiras?.lista.find((c) => c.id === idCarteira)?.nome;

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
                    : wp && <><span className="text-creme/85">{wp.fundo}</span> · CNPJ {fmtCnpj(wp.cnpj)} · {wp.linhas.length} linha(s) na WP_Termo</>}
              </div>
            </div>
          )}
          {wp && <CampoDataBase valor={dataBase} onMudar={mudarData} />}
        </Cartao>

        <Cartao
          numero="02"
          titulo="Carteira Britech"
          icone={<Landmark className="size-5" />}
          pronto={!!wp && carteiraPronta}
          descricao={modoCarteira === "api"
            ? <>Composição da carteira na data-base, direto da API da Britech (<code className="text-creme/80">delta</code>), achada pelo CNPJ.</>
            : <>A carteira já baixada em <code className="text-creme/80">_Carteiras\FORMATADA\&lt;data&gt;</code>.</>}
        >
          <Alternador
            valor={modoCarteira}
            onMudar={(m) => {
              onMudar();
              setModoCarteira(m);
            }}
            opcoes={[{ valor: "api", rotulo: "API Britech" }, { valor: "formatada", rotulo: "Arquivo baixado" }]}
          />
          {!wp ? (
            <p className="text-xs text-creme/45">Escolha o fundo primeiro.</p>
          ) : modoCarteira === "api" ? (
            !status.britech.configurada ? (
              <p className="text-sm text-aviso">Credenciais da Britech não configuradas: crie o <code>.env.local</code> com BRITECH_USUARIO e BRITECH_SENHA e reinicie o app.</p>
            ) : !carteiras ? (
              <p className="inline-flex items-center gap-2 text-xs text-creme/60"><Loader2 className="size-3 animate-spin" /> Buscando as carteiras do CNPJ na Britech…</p>
            ) : (
              <div className="space-y-2">
                {carteiras.lista.length > 0 ? (
                  <select value={idCarteira} onChange={(e) => { onMudar(); setIdCarteira(e.target.value); }} className={classeSelect}>
                    {carteiras.lista.map((c) => <option key={c.id} value={c.id}>{c.id} — {c.nome}</option>)}
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
                {idCarteira && <p className="text-xs text-creme/55">Carteira {idCarteira}{nomeCarteira ? ` (${nomeCarteira})` : ""} em {fmtData(dataEf)} — baixada ao conferir.</p>}
              </div>
            )
          ) : formatada === undefined ? (
            <p className="inline-flex items-center gap-2 text-xs text-creme/60"><Loader2 className="size-3 animate-spin" /> Procurando a carteira do fundo…</p>
          ) : formatada ? (
            <p className="break-all rounded-xl bg-creme/[0.04] px-3 py-2.5 text-xs text-creme/70">{formatada.arquivo}</p>
          ) : (
            <p className="text-sm text-erro">Não há carteira deste CNPJ em {fmtData(dataEf)} em _Carteiras\FORMATADA.</p>
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
            O padrão vem de LASTRO_DRIVE_BASE.
          </p>
        </div>
      </details>

      {acoes(preparo)}
    </>
  );
}
