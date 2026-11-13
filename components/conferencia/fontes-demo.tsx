"use client";

import { ArrowRight, FileSpreadsheet, FolderOpen, Landmark, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DicaAdministradora } from "@/components/guia-administradoras";
import { EVENTO_LISTA_FUNDOS } from "@/components/tour";
import { cn } from "@/lib/utils";
import { Alternador, Cartao, classeSelect } from "./comum";

/** Fundos fictícios: o exemplo não lê nada do Drive. */
const FUNDOS = [
  { fundo: "FIDC EXEMPLO MULTISSETORIAL", cnpj: "12.345.678/0001-90", pasta: "_Workpapers", data: "10/10/2026" },
  { fundo: "FIDC EXEMPLO DUPLICATAS", cnpj: "23.456.789/0001-01", pasta: "_Amostra", data: "" },
  { fundo: "FIDC EXEMPLO CONSIGNADO", cnpj: "34.567.890/0001-12", pasta: "_Workpapers", data: "08/10/2026" },
  { fundo: "FIC FIDC EXEMPLO", cnpj: "45.678.901/0001-23", pasta: "_Workpapers", data: "01/10/2026" },
];
const ADMINISTRADORAS = ["PLANNER", "ID", "AZUMI", "INTRA", "LIMINE", "FINVEST", "SOLIS"];

type FonteCarteira = "api" | "drive" | "fromtis";
const DESCRICAO_CARTEIRA: Record<FonteCarteira, string> = {
  api: "Composição da carteira na data-base, direto da API da Britech da administradora, achada pelo CNPJ.",
  drive: "Do Drive: a carteira Britech já baixada (_Carteiras\\FORMATADA) ou, nas administradoras sem Britech, a amostra (_Amostra) ou o estoque (_Insumos) do fundo.",
  fromtis: "Estoque de direitos creditórios do fundo na data-base, pela API do Fromtis da administradora.",
};

/**
 * Os cartões de fonte com dados de exemplo. O tour guiado mostra este exemplo no lugar do "Escolha a pasta do
 * trimestre", para explicar cada cartão antes de a pasta ser escolhida. Dá para clicar: nada é lido nem conferido.
 */
export function FontesDemo() {
  const [adm, setAdm] = useState("PLANNER");
  const [filtro, setFiltro] = useState("");
  const [focado, setFocado] = useState(false);
  const [peloTour, setPeloTour] = useState(false);
  const [escolhido, setEscolhido] = useState<(typeof FUNDOS)[number] | null>(null);
  const [fonte, setFonte] = useState<FonteCarteira>("api");

  useEffect(() => {
    const mudar = (e: Event) => setPeloTour((e as CustomEvent<boolean>).detail);
    window.addEventListener(EVENTO_LISTA_FUNDOS, mudar);
    return () => window.removeEventListener(EVENTO_LISTA_FUNDOS, mudar);
  }, []);

  const lista = useMemo(() => {
    const termo = filtro.toLowerCase();
    const digitos = filtro.replace(/\D/g, "");
    return FUNDOS.filter((f) => !termo || f.fundo.toLowerCase().includes(termo) || (digitos.length >= 3 && f.cnpj.replace(/\D/g, "").includes(digitos)));
  }, [filtro]);

  return (
    <div data-demo className="space-y-3">
      <p className="text-sm text-aviso">Exemplo do tour guiado, com fundos fictícios. Escolha a pasta do trimestre para ver os seus fundos.</p>
      <div className="grid gap-4 lg:grid-cols-3">
        <Cartao
          numero="01"
          titulo="Fundo"
          icone={<FileSpreadsheet className="size-5" />}
          pronto={!!escolhido}
          descricao={<>Escolha o fundo: o app abre o <code className="text-creme/80">WP_&lt;fundo&gt;_&lt;cnpj&gt;.xlsm</code> de <code className="text-creme/80">_Workpapers</code> e usa a aba <b className="font-medium text-creme/80">WP_Termo</b>.</>}
        >
          <label className="flex items-center gap-3 text-sm text-creme/70" data-tour="administradora">
            <span className="shrink-0">Administradora</span>
            <select value={adm} onChange={(e) => setAdm(e.target.value)} className={classeSelect} data-campo="administradora">
              {ADMINISTRADORAS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <DicaAdministradora nome={adm} />
          <div className="relative" data-tour="busca-fundo">
            <label className="flex items-center gap-2 rounded-xl border border-border bg-creme/[0.04] px-3 py-2 focus-within:border-creme/40">
              <Search className="size-4 shrink-0 text-creme/50" />
              <input
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                onFocus={() => setFocado(true)}
                onBlur={() => setTimeout(() => setFocado(false), 150)}
                placeholder={escolhido ? "Trocar de fundo (nome ou CNPJ)" : `Buscar entre ${FUNDOS.length} fundos (nome ou CNPJ)`}
                className="min-w-0 flex-1 bg-transparent text-sm text-creme outline-none placeholder:text-creme/40"
                data-campo="busca-fundo"
              />
            </label>
            {(focado || peloTour) && (
              <ul className="absolute z-30 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-border bg-popover p-1 shadow-2xl" data-tour="lista-fundos">
                {lista.length === 0 && <li className="px-3 py-2 text-sm text-creme/50">Nenhum fundo com esse nome ou CNPJ.</li>}
                {lista.map((f) => (
                  <li key={f.cnpj}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setFiltro("");
                        setFocado(false);
                        setPeloTour(false);
                        setEscolhido(f);
                      }}
                      className={cn("w-full rounded-lg px-3 py-2 text-left hover:bg-creme/[0.06]", escolhido?.cnpj === f.cnpj && "bg-creme/[0.06]")}
                    >
                      <span className="block truncate text-sm text-creme">{f.fundo}</span>
                      <span className="block text-xs text-creme/45">
                        {f.cnpj} · {f.pasta}
                        {f.data ? <> · {f.data}</> : <> · <span className="text-aviso">sem workpaper (usa a amostra)</span></>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {escolhido && (
            <div className="rounded-xl bg-creme/[0.04] px-3 py-2.5 text-sm">
              <p className="truncate font-medium text-creme">{escolhido.fundo}</p>
              <p className="mt-1 text-xs text-creme/60">
                CNPJ {escolhido.cnpj} · data-base 30/06/2026 ·{" "}
                {escolhido.data ? "37 título(s) na WP_Termo" : "sem workpaper: 120 recebível(is) da amostra no lugar da WP_Termo"}
              </p>
            </div>
          )}
        </Cartao>

        <Cartao numero="02" titulo="Carteira" icone={<Landmark className="size-5" />} pronto={!!escolhido} descricao={DESCRICAO_CARTEIRA[fonte]}>
          <div data-tour="fonte-carteira">
            <Alternador
              valor={fonte}
              onMudar={setFonte}
              opcoes={[
                { valor: "api", rotulo: "API Britech" },
                { valor: "drive", rotulo: "Arquivo no Drive" },
                { valor: "fromtis", rotulo: "Fromtis" },
              ]}
            />
          </div>
          {!escolhido ? (
            <p className="text-xs text-creme/45">Escolha o fundo primeiro.</p>
          ) : (
            <p className="text-xs text-creme/55">
              {fonte === "api" ? "Carteira 52230 na Britech em 30/06/2026 — baixada ao conferir."
                : fonte === "drive" ? `Arquivo do Drive: ${escolhido.data ? "_Carteiras\\FORMATADA\\carteira_30062026.xlsx" : "_Amostra\\amostra_2T2026.xlsx"}.`
                  : "Estoque do CNPJ em 30/06/2026 no Fromtis — gerado e baixado ao conferir."}
            </p>
          )}
        </Cartao>

        <Cartao
          numero="03"
          titulo="Lastro e termo"
          icone={<FolderOpen className="size-5" />}
          pronto={!!escolhido}
          descricao={<>A pasta do fundo em <code className="text-creme/80">Lastro e Termo</code>, sugerida pelo nome do fundo. Lê PDF, boletas HTML, DOCX e TXT.</>}
        >
          {!escolhido ? (
            <p className="text-xs text-creme/45">Escolha o fundo primeiro.</p>
          ) : (
            <select className={classeSelect} defaultValue="sugerida" aria-label="Pasta de lastro do exemplo">
              <option value="sugerida">{escolhido.fundo.replace(/^(FIC )?FIDC /, "")} — sugerida</option>
              <option value="outra">OUTRO FUNDO EXEMPLO</option>
            </select>
          )}
        </Cartao>
      </div>

      <div data-tour="conferir" className="mt-8 flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 md:flex-row md:items-center md:justify-between md:p-6">
        <p className="text-sm text-creme/60">
          {escolhido ? "Tudo pronto. Os documentos são lidos e conferidos aqui no seu navegador." : "Escolha o fundo: o resto o app busca no Drive e na Britech."}
        </p>
        <button
          type="button"
          disabled
          title="No exemplo não há o que conferir"
          className="group inline-flex items-center gap-2 self-start rounded-full bg-primary py-1 pl-6 pr-1 text-base font-medium text-black disabled:opacity-40 md:self-auto"
        >
          Conferir
          <span className="flex size-10 items-center justify-center rounded-full bg-black">
            <ArrowRight className="size-4 text-creme" />
          </span>
        </button>
      </div>
    </div>
  );
}
