"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { ESTADO_FONTE, GUIA_ADMINISTRADORAS, guiaDaAdministradora, nomeNoGuia, type EstadoFonte, type GuiaAdministradora } from "@/lib/lastro/guia";
import { cn } from "@/lib/utils";

export function SeloFonte({ estado }: { estado: EstadoFonte }) {
  const e = ESTADO_FONTE[estado];
  return <span className={cn("inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", e.classe)}>{e.texto}</span>;
}

/** O que funciona, o que ainda não roda (e por quê) e como conferir hoje. */
function Painel({ g }: { g: GuiaAdministradora }) {
  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {g.fontes.map((f) => (
          <li key={f.nome} className="space-y-0.5">
            <p className="flex items-center gap-2 text-sm text-creme/80"><SeloFonte estado={f.estado} /> {f.nome}</p>
            {f.porque && <p className="pl-1 text-xs leading-relaxed text-creme/50">Por quê: {f.porque}.</p>}
          </li>
        ))}
      </ul>
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-creme/45">Como conferir hoje</p>
        <ul className="list-disc space-y-1 pl-4 text-sm leading-relaxed text-creme/65 marker:text-creme/30">
          {g.comoConferir.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
    </div>
  );
}

/** Tutorial: escolha a administradora e veja só o guia dela. */
export function GuiaAdministradoras() {
  const [escolhida, setEscolhida] = useState(GUIA_ADMINISTRADORAS[0].nome);
  const g = GUIA_ADMINISTRADORAS.find((x) => x.nome === escolhida) ?? GUIA_ADMINISTRADORAS[0];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Administradoras">
        {GUIA_ADMINISTRADORAS.map((x) => (
          <button
            key={x.nome}
            type="button"
            role="tab"
            aria-selected={x.nome === escolhida}
            onClick={() => setEscolhida(x.nome)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm ring-1 transition-colors",
              x.nome === escolhida ? "bg-primary text-black ring-primary" : "text-creme/70 ring-creme/20 hover:bg-creme/[0.06]",
            )}
          >
            {x.nome}
          </button>
        ))}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5" role="tabpanel">
        <p className="font-medium text-creme">{g.nome}</p>
        <p className="mb-4 mt-0.5 text-xs text-creme/50">{g.resumo}</p>
        <Painel g={g} />
      </div>
    </div>
  );
}

/** Na conferência: a dica da administradora escolhida, fechada por padrão (os selos resumem). */
export function DicaAdministradora({ nome }: { nome: string }) {
  const g = guiaDaAdministradora(nome);
  if (!g) return null;
  return (
    <details className="group rounded-xl bg-creme/[0.03] ring-1 ring-creme/10" data-tour="dica-administradora">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-creme/60">
        <span className="min-w-0 flex-1 truncate">Como funciona na {nomeNoGuia(g, nome)}</span>
        {g.fontes.some((f) => f.estado === "nao") && <SeloFonte estado="nao" />}
        <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-creme/10 px-3 py-3"><Painel g={g} /></div>
    </details>
  );
}
