"use client";

import { HelpCircle, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";

interface Passo {
  /** o primeiro seletor que existir na tela é destacado */
  seletores: string[];
  titulo: string;
  texto: string;
  /** só entra no tour se o bloco estiver na tela (ex.: os blocos do resultado) */
  opcional?: boolean;
  /** só entra no tour se este seletor NÃO estiver na tela */
  soSem?: string;
  /** se o bloco for um <details> fechado, abre enquanto o passo estiver na tela */
  abrir?: boolean;
}

const PASSOS: Passo[] = [
  {
    seletores: ['[data-tour="modo"]'],
    titulo: "Duas formas de trazer as fontes",
    texto: "\"Buscar no Drive e na Britech\" acha tudo pelo fundo. \"Escolher arquivos\" é para quando você já tem o workpaper, a carteira e a pasta em mãos.",
  },
  {
    seletores: ['[data-tour="cartao-01"]'],
    titulo: "1 · Fundo",
    texto: "Escolha a administradora e busque o fundo pelo nome ou CNPJ. O app abre o workpaper e lê a WP_Termo, o CNPJ e a data-base. Fundo só com amostra aparece como \"sem workpaper\".",
  },
  {
    seletores: ['[data-tour="dica-administradora"]', '[data-campo="administradora"]'],
    opcional: true,
    abrir: true,
    titulo: "Cada administradora é diferente",
    texto: "De onde vem a carteira muda de uma administradora para outra. \"Como funciona na…\" mostra o que já funciona, o que ainda não roda e por quê, e como conferir hoje. Troque a administradora e o painel acompanha.",
  },
  {
    seletores: ['[data-tour="cartao-02"]'],
    titulo: "2 · Carteira",
    texto: "De onde vem a carteira: API da Britech, arquivo no Drive (carteira formatada, amostra ou estoque) ou Fromtis. O app já escolhe a melhor fonte; troque aqui se precisar.",
  },
  {
    seletores: ['[data-tour="cartao-03"]'],
    titulo: "3 · Lastro e termo",
    texto: "A pasta com os documentos do fundo. O app sugere a de nome mais parecido; confira se é a certa antes de seguir.",
  },
  {
    seletores: ['[data-tour="conferir"]'],
    titulo: "Conferir",
    texto: "Com as três fontes prontas, clique em Conferir. Os documentos são lidos no seu navegador; pastas grandes levam alguns minutos e a barra mostra o andamento.",
  },
  {
    seletores: ["#resultado"],
    soSem: '[data-tour="bloco-atencao"]',
    titulo: "Resultado",
    texto: "Depois de conferir, o resultado aparece aqui em três blocos: Precisam de atenção, Validados e Pendentes. Com um resultado na tela, abra o tour de novo para ver cada bloco.",
  },
  {
    seletores: ['[data-tour="bloco-atencao"]'],
    opcional: true,
    titulo: "Precisam de atenção",
    texto: "O que diverge ou falta confirmar: uma linha por campo, carteira × documentos. \"Detalhes\" mostra o porquê e onde está no documento; \"abrir\" leva o PDF à página.",
  },
  {
    seletores: ['[data-tour="bloco-validado"]'],
    opcional: true,
    titulo: "Validados",
    texto: "O que confere. Com valor e data de emissão batendo, o título fica validado visualmente e espera a sua aprovação: \"Aprovar\" ou \"Aprovar todos\".",
  },
  {
    seletores: ['[data-tour="bloco-pendente"]'],
    opcional: true,
    titulo: "Pendentes",
    texto: "Nenhum documento da pasta cita o título. Se forem muitos, confira se a pasta de lastro é a do fundo. \"Bater PDF\" procura à mão.",
  },
  {
    seletores: ['[data-tour="acoes"]'],
    opcional: true,
    titulo: "Buscar, pré-classificar e baixar",
    texto: "\"Buscar nos PDFs\" procura qualquer valor. \"Pré-classificar pendências\" sugere o documento e as marcas de todas de uma vez. \"Baixar Excel\" leva tudo, com as suas marcas e aprovações.",
  },
  {
    seletores: ["#documentos"],
    titulo: "Documentos",
    texto: "Cada arquivo lido, a que título foi ligado e o que não tem texto (PDF escaneado não é lido).",
  },
];

interface Caixa { top: number; left: number; width: number; height: number }

function alvoDe(p: Passo): Element | null {
  for (const s of p.seletores) {
    const el = document.querySelector(s);
    if (el && (el as HTMLElement).offsetParent !== null) return el;
  }
  return null;
}

/** O passo entra no tour? Decidido na hora, pelo que está na tela (sem resultado, os blocos do resultado viram um passo só). */
function cabe(p: Passo): boolean {
  if (p.soSem && document.querySelector(p.soSem)) return false;
  return !p.opcional || !!alvoDe(p);
}

/** O próximo passo que cabe na tela, andando para frente (+1) ou para trás (-1) a partir de `de`; null se não houver. */
function vizinho(de: number, sentido: 1 | -1): number | null {
  for (let i = de + sentido; i >= 0 && i < PASSOS.length; i += sentido) if (cabe(PASSOS[i])) return i;
  return null;
}

/** Tour guiado: destaca cada bloco da tela e explica para que serve. Abre pelo botão, pelo menu (#tour) ou por evento. */
export function Tour() {
  const [passo, setPasso] = useState<number | null>(null);
  const [caixa, setCaixa] = useState<Caixa | null>(null);

  const medir = useCallback(() => {
    if (passo === null) return;
    const el = alvoDe(PASSOS[passo]);
    if (!el) return setCaixa(null);
    const r = el.getBoundingClientRect();
    const altura = Math.min(r.height, window.innerHeight - 220);
    setCaixa({ top: Math.max(8, r.top - 6), left: Math.max(8, r.left - 6), width: Math.min(r.width + 12, window.innerWidth - 16), height: altura + 12 });
  }, [passo]);

  // abre pelo link do menu (#tour) ou pelo evento "lastro:tour"
  useEffect(() => {
    const abrir = () => setPasso(vizinho(-1, 1));
    const peloHash = () => {
      if (window.location.hash === "#tour") {
        history.replaceState(null, "", window.location.pathname);
        abrir();
      }
    };
    peloHash();
    window.addEventListener("hashchange", peloHash);
    window.addEventListener("lastro:tour", abrir);
    return () => {
      window.removeEventListener("hashchange", peloHash);
      window.removeEventListener("lastro:tour", abrir);
    };
  }, []);

  // leva a tela até o bloco do passo e mede de novo depois da rolagem
  useLayoutEffect(() => {
    if (passo === null) return;
    const el = alvoDe(PASSOS[passo]);
    let abriu: HTMLDetailsElement | null = null;
    if (el) {
      if (PASSOS[passo].abrir && el instanceof HTMLDetailsElement && !el.open) {
        el.open = true;
        abriu = el;
      }
      const alto = el.getBoundingClientRect().height > window.innerHeight - 260;
      // "instant" ignora o scroll-behavior: smooth do globals.css; rolagem animada deixaria o destaque para trás
      el.scrollIntoView({ block: alto ? "start" : "center", behavior: "instant" });
      if (alto) window.scrollBy({ top: -24, behavior: "instant" });
    }
    const quadro = requestAnimationFrame(medir);
    const t = setTimeout(medir, 250);
    window.addEventListener("scroll", medir, true);
    window.addEventListener("resize", medir);
    return () => {
      cancelAnimationFrame(quadro);
      clearTimeout(t);
      window.removeEventListener("scroll", medir, true);
      window.removeEventListener("resize", medir);
      if (abriu) abriu.open = false;
    };
  }, [passo, medir]);

  useEffect(() => {
    if (passo === null) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPasso(null);
      if (e.key === "ArrowRight") setPasso((p) => (p === null ? p : vizinho(p, 1) ?? p));
      if (e.key === "ArrowLeft") setPasso((p) => (p === null ? p : vizinho(p, -1) ?? p));
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [passo]);

  if (passo === null) {
    return (
      <button
        type="button"
        onClick={() => setPasso(vizinho(-1, 1))}
        className="fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm text-creme/85 shadow-xl ring-1 ring-creme/20 hover:bg-creme/[0.08]"
        data-tour-abrir
      >
        <HelpCircle className="size-4 text-primary" /> Tour guiado
      </button>
    );
  }

  const p = PASSOS[passo];
  const anterior = vizinho(passo, -1);
  const proximo = vizinho(passo, 1);
  const visiveis = PASSOS.map((x, i) => i === passo || cabe(x));
  const posicao = visiveis.slice(0, passo + 1).filter(Boolean).length;
  const total = visiveis.filter(Boolean).length;
  // o balão fica embaixo do bloco; sem espaço, em cima; sem bloco na tela, no centro
  const embaixo = caixa ? caixa.top + caixa.height + 190 < window.innerHeight : false;
  const estiloBalao: React.CSSProperties = !caixa
    ? { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
    : {
      left: Math.min(Math.max(12, caixa.left), window.innerWidth - 372),
      ...(embaixo ? { top: caixa.top + caixa.height + 12 } : caixa.top > 200 ? { top: Math.max(12, caixa.top - 12), transform: "translateY(-100%)" } : { bottom: 16 }),
    };

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Tour guiado">
      {/* escurece tudo menos o bloco destacado */}
      {caixa ? (
        <div
          className="pointer-events-none fixed rounded-2xl ring-2 ring-primary transition-all duration-200"
          style={{ ...caixa, boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)" }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/70" />
      )}
      <div className="fixed w-[min(22.5rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-card p-4 shadow-2xl" style={estiloBalao}>
        <div className="flex items-start justify-between gap-3">
          <p className="font-medium text-creme">{p.titulo}</p>
          <button type="button" onClick={() => setPasso(null)} className="rounded-full p-1 text-creme/50 hover:bg-creme/[0.06] hover:text-creme" aria-label="Fechar o tour">
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-creme/70">{p.texto}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-xs tabular-nums text-creme/45">{posicao} de {total}</span>
          <div className="flex gap-2">
            {anterior !== null && (
              <button type="button" onClick={() => setPasso(anterior)} className="rounded-full px-3 py-1.5 text-sm text-creme/75 ring-1 ring-creme/20 hover:bg-creme/[0.06]">
                Voltar
              </button>
            )}
            <button type="button" onClick={() => setPasso(proximo)} className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-black">
              {proximo === null ? "Concluir" : "Próximo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
