import type { ReactNode } from "react";
import type { ArquivoEntrada } from "@/lib/lastro/pipeline";
import type { Workpaper } from "@/lib/lastro/planilhas";

/** O que cada modo de fontes entrega para a conferência. */
export interface Preparo {
  workpaper: Workpaper;
  dataBase: string | null;
  carteira: { rotulo: string; obter: () => Promise<{ bytes: Uint8Array; nome: string }> };
  lastro: { nome: string; obter: () => Promise<ArquivoEntrada[]> };
}

export interface PropsFontes {
  /** desenha a barra do "Conferir" com o que está pronto (ou null) */
  acoes: (preparo: Preparo | null) => ReactNode;
  /** alguma fonte mudou: o resultado anterior deixa de valer */
  onMudar: () => void;
}
