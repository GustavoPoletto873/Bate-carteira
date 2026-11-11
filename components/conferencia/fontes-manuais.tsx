"use client";

import { FileSpreadsheet, FolderOpen, Landmark, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { listarPasta, type FonteArquivo, type FontePasta } from "@/lib/lastro/fontes";
import type { ArquivoEntrada } from "@/lib/lastro/pipeline";
import { ehCarteiraDoFundo, lerWorkpaper, pastaDaData, type Workpaper } from "@/lib/lastro/planilhas";
import { servidor, type CarteiraBritech, type StatusServidor } from "@/lib/lastro/servidor-cliente";
import { fmtData } from "@/lib/lastro/textos";
import { opcoesDeCarteira } from "@/lib/lastro/carteiras";
import { Alternador, CampoDataBase, Cartao, classeSelect, mensagem } from "./comum";
import { SlotFonte } from "./slot-fonte";
import type { Preparo, PropsFontes } from "./tipos";

type ModoCarteira = "pasta" | "arquivo" | "api";

/** Acha <id>_<cnpj>_<dd.mm.aaaa>_BRITECH.xlsx na pasta das carteiras (de preferência na subpasta da data). */
async function localizarCarteira(pasta: FontePasta, cnpj: string, dataBase: string | null): Promise<ArquivoEntrada | null> {
  const sub = pastaDaData(dataBase);
  let lista = pasta.arquivos;
  if (!lista && pasta.handle) {
    try {
      const dir = await pasta.handle.getDirectoryHandle(sub);
      lista = (await listarPasta(dir)).map((a) => ({ ...a, caminho: `${sub}/${a.caminho}` }));
    } catch {
      lista = await listarPasta(pasta.handle);
    }
  }
  const candidatos = (lista ?? []).filter((a) => ehCarteiraDoFundo(a.nome, cnpj, dataBase));
  return candidatos.find((a) => a.caminho.startsWith(`${sub}/`)) ?? candidatos[0] ?? null;
}

/** Fontes escolhidas à mão (seletor de arquivo/pasta ou arrastar e soltar); a carteira também pode vir da API. */
export function FontesManuais({ acoes, onMudar, status }: PropsFontes & { status: StatusServidor | null }) {
  const britechOk = !!status?.britech.configurada;
  const [wpFonte, setWpFonte] = useState<FonteArquivo | null>(null);
  const [wp, setWp] = useState<Workpaper | null>(null);
  const [wpErro, setWpErro] = useState("");
  const [dataBase, setDataBase] = useState("");
  const [modoCarteira, setModoCarteira] = useState<ModoCarteira>("pasta");
  const [carteiraArquivo, setCarteiraArquivo] = useState<FonteArquivo | null>(null);
  const [carteiraPasta, setCarteiraPasta] = useState<{ fonte: FontePasta; versao: number } | null>(null);
  const [busca, setBusca] = useState<{ chave: string; achada: ArquivoEntrada | null } | null>(null);
  const [api, setApi] = useState<{ cnpj: string; lista: CarteiraBritech[]; erro: string } | null>(null);
  const [idCarteira, setIdCarteira] = useState("");
  const [lastro, setLastro] = useState<FontePasta | null>(null);
  const vez = useRef(0);

  // A carteira do fundo é procurada na pasta das carteiras sempre que muda a pasta, o fundo ou a data-base.
  const dataEfetiva = dataBase || wp?.dataBase || null;
  const chaveBusca = modoCarteira === "pasta" && carteiraPasta && wp?.cnpj
    ? `${carteiraPasta.versao}|${wp.cnpj}|${dataEfetiva}` : null;
  const carteiraAchada = busca && busca.chave === chaveBusca ? busca.achada : null;
  const procurandoCarteira = !!chaveBusca && busca?.chave !== chaveBusca;

  useEffect(() => {
    if (!chaveBusca || !carteiraPasta || !wp) return;
    let vivo = true;
    localizarCarteira(carteiraPasta.fonte, wp.cnpj, dataEfetiva)
      .catch(() => null)
      .then((achada) => {
        if (vivo) setBusca({ chave: chaveBusca, achada });
      });
    return () => {
      vivo = false;
    };
  }, [chaveBusca, carteiraPasta, wp, dataEfetiva]);

  async function buscarNaBritech(cnpj: string) {
    const v = ++vez.current;
    setApi(null);
    setIdCarteira("");
    try {
      const { carteiras } = await servidor.carteirasBritech(cnpj);
      if (v !== vez.current) return;
      const { opcoes, padrao } = opcoesDeCarteira(carteiras);
      setApi({ cnpj, lista: opcoes, erro: opcoes.length ? "" : "A Britech não tem carteira para este CNPJ." });
      setIdCarteira(padrao);
    } catch (e) {
      if (v === vez.current) setApi({ cnpj, lista: [], erro: mensagem(e) });
    }
  }

  async function aoEscolherWp(f: FonteArquivo | FontePasta) {
    if (f.tipo !== "arquivo") return;
    onMudar();
    setWpFonte(f);
    setWp(null);
    setWpErro("");
    try {
      const lido = lerWorkpaper(await f.entrada.ler(), f.nome);
      setWp(lido);
      setDataBase(lido.dataBase ?? "");
      if (britechOk && lido.cnpj) void buscarNaBritech(lido.cnpj);
    } catch (e) {
      setWpErro(mensagem(e));
    }
  }

  function trocarModo(m: ModoCarteira) {
    onMudar();
    setModoCarteira(m);
    if (m === "api" && wp?.cnpj && api?.cnpj !== wp.cnpj) void buscarNaBritech(wp.cnpj);
  }

  let carteira: Preparo["carteira"] | null = null;
  if (modoCarteira === "api") {
    if (idCarteira && dataEfetiva) {
      carteira = {
        rotulo: `API Britech — carteira ${idCarteira} em ${fmtData(dataEfetiva)}`,
        obter: async () => ({ bytes: await servidor.composicaoBritech(idCarteira, dataEfetiva), nome: `carteira_${idCarteira}_${dataEfetiva}.xlsx` }),
      };
    }
  } else {
    const entrada = modoCarteira === "arquivo" ? carteiraArquivo?.entrada ?? null : carteiraAchada;
    if (entrada) {
      carteira = {
        rotulo: modoCarteira === "pasta" && carteiraPasta ? `${carteiraPasta.fonte.nome}/${entrada.caminho}` : entrada.caminho,
        obter: async () => ({ bytes: await entrada.ler(), nome: entrada.nome }),
      };
    }
  }
  const preparo: Preparo | null = wp && lastro && carteira ? {
    workpaper: wp,
    dataBase: dataEfetiva,
    carteira,
    lastro: { nome: lastro.nome, obter: async () => lastro.arquivos ?? (lastro.handle ? await listarPasta(lastro.handle) : []) },
  } : null;

  const alternador = (
    <Alternador
      valor={modoCarteira}
      onMudar={trocarModo}
      opcoes={[
        { valor: "pasta", rotulo: "Pasta das carteiras" },
        { valor: "arquivo", rotulo: "Arquivo" },
        ...(britechOk ? [{ valor: "api" as const, rotulo: "API Britech" }] : []),
      ]}
    />
  );

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <SlotFonte
          numero="01"
          titulo="Workpaper"
          icone={<FileSpreadsheet className="size-5" />}
          descricao={<>O <code className="text-creme/80">WP_&lt;fundo&gt;_&lt;cnpj&gt;.xlsm</code>. A conferência usa a aba <b className="font-medium text-creme/80">WP_Termo</b>.</>}
          tipo="arquivo"
          memoria="lastro-workpaper"
          extensoes={[".xlsm", ".xlsx", ".xls"]}
          descricaoTipos="Workpaper do Excel"
          escolhido={wpFonte?.nome ?? null}
          erro={wpErro}
          onEscolher={aoEscolherWp}
          detalhe={wp && (
            <>
              <span className="text-creme/85">{wp.fundo}</span> · CNPJ {wp.cnpj || "?"} · {wp.linhas.length} linha(s) na WP_Termo
            </>
          )}
        >
          <CampoDataBase valor={dataBase} onMudar={(v) => { onMudar(); setDataBase(v); }} />
        </SlotFonte>

        {modoCarteira === "api" ? (
          <Cartao
            numero="02"
            titulo="Carteira Britech"
            icone={<Landmark className="size-5" />}
            pronto={!!carteira}
            descricao={<>Composição da carteira na data-base, direto da API da Britech, achada pelo CNPJ do workpaper.</>}
          >
            {alternador}
            {!wp ? (
              <p className="text-xs text-creme/45">Escolha o workpaper primeiro.</p>
            ) : !api ? (
              <p className="inline-flex items-center gap-2 text-xs text-creme/60"><Loader2 className="size-3 animate-spin" /> Buscando as carteiras do CNPJ na Britech…</p>
            ) : (
              <div className="space-y-2">
                {api.lista.length > 0 ? (
                  <select value={idCarteira} onChange={(e) => { onMudar(); setIdCarteira(e.target.value); }} className={classeSelect}>
                    {api.lista.map((c) => <option key={c.id} value={c.id}>{c.id} — {c.nome}</option>)}
                  </select>
                ) : (
                  <input
                    value={idCarteira}
                    onChange={(e) => { onMudar(); setIdCarteira(e.target.value.replace(/\D/g, "")); }}
                    placeholder="ID da carteira (ex.: 52230)"
                    className={classeSelect}
                  />
                )}
                {api.erro && <p className="text-xs text-erro">{api.erro}</p>}
              </div>
            )}
          </Cartao>
        ) : (
          <SlotFonte
            key={modoCarteira}
            numero="02"
            titulo="Carteira Britech"
            icone={<Landmark className="size-5" />}
            descricao={modoCarteira === "pasta"
              ? <>A pasta das carteiras formatadas (<code className="text-creme/80">_Carteiras\FORMATADA</code>). O app acha o <code className="text-creme/80">&lt;id&gt;_&lt;cnpj&gt;_&lt;data&gt;_BRITECH.xlsx</code> do fundo.</>
              : <>O <code className="text-creme/80">_BRITECH.xlsx</code> do fundo ou o Excel exportado do PAS (VL Aplic., Dt. Emissão, Dt. Vencto, Emissor).</>}
            tipo={modoCarteira === "pasta" ? "pasta" : "arquivo"}
            memoria={modoCarteira === "pasta" ? "lastro-carteiras-pasta" : "lastro-carteira-arquivo"}
            extensoes={[".xlsx", ".xls", ".xlsm", ".csv"]}
            descricaoTipos="Carteira Britech"
            listar={false}
            escolhido={modoCarteira === "pasta" ? carteiraPasta?.fonte.nome ?? null : carteiraArquivo?.nome ?? null}
            onEscolher={(f) => {
              onMudar();
              if (f.tipo === "pasta") setCarteiraPasta((atual) => ({ fonte: f, versao: (atual?.versao ?? 0) + 1 }));
              else setCarteiraArquivo(f);
            }}
            detalhe={modoCarteira === "pasta" && carteiraPasta && (
              !wp ? "Escolha o workpaper para achar a carteira do fundo."
                : procurandoCarteira ? "Procurando a carteira do fundo…"
                  : carteiraAchada ? <>Achei: <span className="break-all text-creme/85">{carteiraAchada.caminho}</span></>
                    : <span className="text-erro">Não achei a carteira do CNPJ {wp.cnpj} em {fmtData(dataEfetiva)} nesta pasta.</span>
            )}
          >
            {alternador}
          </SlotFonte>
        )}

        <SlotFonte
          numero="03"
          titulo="Lastro e termo"
          icone={<FolderOpen className="size-5" />}
          descricao={<>A pasta do fundo em <code className="text-creme/80">Lastro e Termo</code>. Lê PDF, boletas HTML, DOCX e TXT (inclusive subpastas).</>}
          tipo="pasta"
          memoria="lastro-pasta-lastro"
          escolhido={lastro?.nome ?? null}
          onEscolher={(f) => {
            onMudar();
            if (f.tipo === "pasta") setLastro(f);
          }}
          detalhe={lastro?.arquivos && `${lastro.arquivos.length} arquivo(s) na pasta`}
        />
      </div>
      {acoes(preparo)}
    </>
  );
}
