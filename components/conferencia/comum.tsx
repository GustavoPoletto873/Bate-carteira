"use client";

import { CalendarDays, Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function mensagem(e: unknown): string {
  return (e as Error)?.message ?? String(e);
}

export function CampoDataBase({ valor, onMudar }: { valor: string; onMudar: (v: string) => void }) {
  return (
    <label className="flex items-center gap-3 rounded-xl bg-creme/[0.04] px-3 py-2 text-sm text-creme/70">
      <CalendarDays className="size-4 shrink-0 text-creme/50" />
      <span className="shrink-0">Data-base</span>
      <input
        type="date"
        value={valor}
        onChange={(e) => onMudar(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-right text-creme outline-none [color-scheme:dark]"
      />
    </label>
  );
}

export function Alternador<T extends string>({ opcoes, valor, onMudar }: {
  opcoes: { valor: T; rotulo: string; desabilitado?: boolean }[]; valor: T; onMudar: (v: T) => void;
}) {
  return (
    <div className="flex rounded-full bg-creme/[0.05] p-1 text-sm">
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          disabled={o.desabilitado}
          onClick={() => onMudar(o.valor)}
          className={cn("flex-1 rounded-full px-3 py-1.5 transition-colors disabled:opacity-35",
            valor === o.valor ? "bg-creme text-black" : "text-creme/65 enabled:hover:text-creme")}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

/** Casca dos cartões de fonte (mesmo visual do cartão manual). */
export function Cartao({ numero, titulo, icone, descricao, pronto, children }: {
  numero: string; titulo: string; icone: ReactNode; descricao: ReactNode; pronto?: boolean; children?: ReactNode;
}) {
  return (
    <div data-tour={`cartao-${numero}`} className={cn("flex flex-col gap-4 rounded-2xl border bg-card p-5 md:p-6", pronto ? "border-creme/25" : "border-border")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-creme/8 text-creme">{icone}</span>
          <div>
            <p className="font-mono text-[11px] tracking-widest text-creme/45">{numero}</p>
            <h3 className="text-lg font-medium tracking-tight text-creme">{titulo}</h3>
          </div>
        </div>
        {pronto && (
          <span className="flex size-7 items-center justify-center rounded-full bg-ok/15 text-ok" title="Pronto">
            <Check className="size-4" />
          </span>
        )}
      </div>
      <p className="text-sm leading-snug text-creme/60">{descricao}</p>
      {children}
    </div>
  );
}

export const classeSelect =
  "w-full rounded-xl border border-border bg-creme/[0.04] px-3 py-2 text-sm text-creme outline-none focus:border-creme/40 [color-scheme:dark]";
