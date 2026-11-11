"use client";

import { Check, History, Loader2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  arquivosDoDrop, entradaDeFile, escolherArquivo, escolherPasta, lembrada, pastaDeFiles, reabrir, suportaAcessoDireto,
  type FonteArquivo, type FontePasta,
} from "@/lib/lastro/fontes";
import { cn } from "@/lib/utils";

interface SlotFonteProps {
  numero: string;
  titulo: string;
  descricao: ReactNode;
  icone: ReactNode;
  tipo: "arquivo" | "pasta";
  /** chave para lembrar a escolha (e para o seletor abrir na última pasta) */
  memoria: string;
  extensoes?: string[];
  descricaoTipos?: string;
  /** listar a pasta inteira na escolha (falso: lista sob demanda) */
  listar?: boolean;
  escolhido: string | null;
  detalhe?: ReactNode;
  erro?: string;
  onEscolher: (fonte: FonteArquivo | FontePasta) => void | Promise<void>;
  children?: ReactNode;
}

export function SlotFonte({
  numero, titulo, descricao, icone, tipo, memoria, extensoes = [], descricaoTipos = "Arquivos", listar = true,
  escolhido, detalhe, erro, onEscolher, children,
}: SlotFonteProps) {
  const input = useRef<HTMLInputElement>(null);
  const [ultima, setUltima] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [falha, setFalha] = useState("");

  useEffect(() => {
    let vivo = true;
    lembrada(memoria).then((nome) => vivo && setUltima(nome));
    return () => {
      vivo = false;
    };
  }, [memoria]);

  async function executar(acao: () => Promise<FonteArquivo | FontePasta | null>) {
    setFalha("");
    setOcupado(true);
    try {
      const fonte = await acao();
      if (fonte) {
        await onEscolher(fonte);
        lembrada(memoria).then(setUltima);
      }
    } catch (e) {
      setFalha((e as Error)?.message ?? String(e));
    } finally {
      setOcupado(false);
    }
  }

  function abrir() {
    if (!suportaAcessoDireto()) {
      input.current?.click();
      return;
    }
    executar(() => (tipo === "pasta" ? escolherPasta(memoria, listar) : escolherArquivo(memoria, descricaoTipos, extensoes)));
  }

  function aoSelecionarNoInput(files: File[]) {
    if (!files.length) return;
    executar(async () => (tipo === "pasta" ? pastaDeFiles(files) : { tipo: "arquivo", nome: files[0].name, entrada: entradaDeFile(files[0]) }));
  }

  function aoSoltar(e: React.DragEvent) {
    e.preventDefault();
    setArrastando(false);
    const dt = e.dataTransfer;
    executar(async () => {
      if (tipo === "pasta") return arquivosDoDrop(dt);
      const f = dt.files?.[0];
      return f ? { tipo: "arquivo", nome: f.name, entrada: entradaDeFile(f) } : null;
    });
  }

  const atributosPasta = tipo === "pasta" ? ({ webkitdirectory: "", directory: "" } as Record<string, string>) : {};

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setArrastando(true);
      }}
      onDragLeave={() => setArrastando(false)}
      onDrop={aoSoltar}
      className={cn(
        "group relative flex flex-col gap-4 rounded-2xl border bg-card p-5 transition-colors md:p-6",
        arrastando ? "border-creme/60 bg-creme/[0.04]" : "border-border",
        escolhido && !erro && "border-creme/25",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-creme/8 text-creme">{icone}</span>
          <div>
            <p className="font-mono text-[11px] tracking-widest text-creme/45">{numero}</p>
            <h3 className="text-lg font-medium tracking-tight text-creme">{titulo}</h3>
          </div>
        </div>
        {escolhido && !erro && (
          <span className="flex size-7 items-center justify-center rounded-full bg-ok/15 text-ok" title="Pronto">
            <Check className="size-4" />
          </span>
        )}
      </div>

      <p className="text-sm leading-snug text-creme/60">{descricao}</p>
      {children}

      {escolhido && (
        <div className="rounded-xl bg-creme/[0.04] px-3 py-2.5 text-sm">
          <p className="truncate font-medium text-creme" title={escolhido}>{escolhido}</p>
          {detalhe && <div className="mt-1 text-xs text-creme/60">{detalhe}</div>}
        </div>
      )}
      {(erro || falha) && <p className="text-sm text-erro">{erro || falha}</p>}

      <div className="mt-auto flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={abrir}
          disabled={ocupado}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {ocupado ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {escolhido ? "Trocar" : tipo === "pasta" ? "Escolher pasta" : "Escolher arquivo"}
        </button>
        {ultima && ultima !== escolhido && (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => executar(() => reabrir(memoria, listar))}
            className="inline-flex max-w-full items-center gap-2 rounded-full px-3 py-2 text-sm text-creme/75 ring-1 ring-creme/15 transition-colors hover:bg-creme/[0.06] hover:text-creme disabled:opacity-50"
            title={`Usar de novo: ${ultima}`}
          >
            <History className="size-4 shrink-0" />
            <span className="truncate">Usar a última: {ultima}</span>
          </button>
        )}
        <span className="text-xs text-creme/35">ou arraste aqui</span>
      </div>

      <input
        ref={input}
        type="file"
        hidden
        data-slot={memoria}
        multiple={tipo === "pasta"}
        accept={tipo === "arquivo" ? extensoes.join(",") : undefined}
        onChange={(e) => {
          const lista = Array.from(e.target.files ?? []); // copia antes de limpar o campo
          e.target.value = "";
          aoSelecionarNoInput(lista);
        }}
        {...atributosPasta}
      />
    </div>
  );
}
