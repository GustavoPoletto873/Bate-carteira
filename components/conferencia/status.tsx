import { cn } from "@/lib/utils";

const ESTILOS: Record<string, string> = {
  Confere: "text-ok bg-ok/12 ring-ok/25",
  OK: "text-ok bg-ok/12 ring-ok/25",
  Diverge: "text-erro bg-erro/12 ring-erro/25",
  Divergente: "text-erro bg-erro/12 ring-erro/25",
  "Só no WP": "text-erro bg-erro/12 ring-erro/25",
  Verificar: "text-aviso bg-aviso/12 ring-aviso/25",
  Provável: "text-sky-300 bg-sky-400/12 ring-sky-400/25",
};
const NEUTRO = "text-creme/55 bg-creme/6 ring-creme/10";

export function corDoStatus(status: string): string {
  return ESTILOS[status] ?? NEUTRO;
}

export function Status({ status, titulo, className }: { status: string; titulo?: string; className?: string }) {
  return (
    <span
      title={titulo || undefined}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        corDoStatus(status),
        className,
      )}
    >
      {status}
    </span>
  );
}
