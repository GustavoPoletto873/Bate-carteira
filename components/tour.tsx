"use client";

import { HelpCircle, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";

/** O tour manda este evento (detail true/false) para abrir e fechar a lista de fundos do cartão Fundo. */
export const EVENTO_LISTA_FUNDOS = "lastro:tour-lista-fundos";
/** O tour manda este evento (detail true/false) para mostrar os cartões de exemplo enquanto a pasta não foi escolhida. */
export const EVENTO_DEMONSTRACAO = "lastro:tour-demonstracao";

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
  /** evento mandado com detail true ao entrar no passo e false ao sair (ex.: abrir a lista de fundos) */
  evento?: string;
  /** outros elementos que entram no destaque junto com o bloco (ex.: a lista de fundos aberta) */
  incluir?: string[];
  /** o passo espera o usuário agir no bloco: quando este seletor aparecer, o tour segue sozinho */
  avancaQuando?: string;
  /** sem a pasta do trimestre escolhida, o passo usa os cartões de exemplo (FontesDemo) */
  demonstracao?: boolean;
  /** também entra no tour se este seletor estiver na tela (o passo da pasta, enquanto o exemplo está no lugar do painel) */
  ouCom?: string;
}

const PASSOS: Passo[] = [
  {
    seletores: ['[data-tour="modo"]'],
    titulo: "Duas formas de trazer as fontes",
    texto: "\"Buscar no Drive e na Britech\" acha tudo pelo fundo. \"Escolher arquivos\" é para quando você já tem o workpaper, a carteira e a pasta em mãos.",
  },
  {
    seletores: ['[data-tour="escolher-pasta"]'],
    opcional: true,
    ouCom: "[data-demo]",
    avancaQuando: '[data-tour="cartao-01"]',
    titulo: "Escolha a pasta do trimestre",
    texto: "Por aqui, o app lê o Drive pela pasta que você escolher no G:. Clique em \"Escolher pasta\" (ou \"Usar a última\") para ver os seus fundos, ou siga para ver os cartões num exemplo.",
  },
  {
    seletores: ['[data-tour="cartao-01"]:has([data-campo="busca-fundo"])'],
    opcional: true,
    demonstracao: true,
    titulo: "1 · Fundo",
    texto: "Tudo começa pelo fundo que você vai conferir. Com o fundo escolhido, o app acha sozinho o workpaper, a carteira e a pasta de lastro.",
  },
  {
    seletores: ['[data-tour="administradora"]'],
    opcional: true,
    demonstracao: true,
    titulo: "Administradora",
    texto: "Uma por pasta dentro do trimestre (PLANNER, ID, AZUMI…). Trocar a administradora troca a lista de fundos.",
  },
  {
    seletores: ['[data-tour="dica-administradora"]'],
    opcional: true,
    demonstracao: true,
    abrir: true,
    titulo: "Como funciona na administradora",
    texto: "Cada administradora tem fontes diferentes: aqui está o que já funciona, o que ainda não roda e por quê, e como conferir hoje. Troque a administradora e o painel acompanha.",
  },
  {
    seletores: ['[data-tour="busca-fundo"]'],
    opcional: true,
    demonstracao: true,
    evento: EVENTO_LISTA_FUNDOS,
    incluir: ['[data-tour="lista-fundos"]'],
    titulo: "Buscar o fundo",
    texto: "Os fundos da administradora, tirados dos workpapers. Busque pelo nome ou CNPJ e clique num fundo: o app abre o workpaper e lê a WP_Termo, o CNPJ e a data-base. \"Sem workpaper\" é fundo que só tem a amostra.",
  },
  {
    seletores: ['[data-tour="cartao-01"]'],
    opcional: true,
    soSem: '[data-campo="busca-fundo"]',
    titulo: "1 · Workpaper",
    texto: "Escolha o WP_<fundo>_<cnpj>.xlsm (ou arraste para o cartão). O app lê a WP_Termo, o CNPJ e a data-base.",
  },
  {
    seletores: ['[data-tour="cartao-02"]'],
    opcional: true,
    demonstracao: true,
    titulo: "2 · Carteira",
    texto: "A carteira do fundo na data-base, que o app compara com a WP_Termo e com os documentos. Buscando pelo fundo, o app já escolhe a melhor fonte.",
  },
  {
    seletores: ['[data-tour="fonte-carteira"]'],
    opcional: true,
    demonstracao: true,
    titulo: "De onde vem a carteira",
    texto: "API Britech: direto da Britech da administradora, pelo CNPJ. Arquivo no Drive: a carteira formatada, a amostra ou o estoque da pasta (fundo de recebíveis começa na amostra). Fromtis e Sinqia aparecem nas administradoras que usam esses sistemas.",
  },
  {
    seletores: ['[data-tour="cartao-03"]'],
    opcional: true,
    demonstracao: true,
    titulo: "3 · Lastro e termo",
    texto: "A pasta com os documentos do fundo (PDF, boletas HTML, DOCX e TXT). O app sugere a de nome mais parecido com o fundo; confira se é a certa.",
  },
  {
    seletores: ['[data-tour="conferir"]'],
    opcional: true,
    demonstracao: true,
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

/** Altura reservada para o balão ao decidir onde ele cabe. */
const ALTURA_BALAO = 240;

interface Caixa { top: number; left: number; width: number; height: number }

/** O elemento visível do seletor; null se não houver (ou se o navegador não entender o seletor, ex.: :has antigo). */
function achar(seletor: string): HTMLElement | null {
  try {
    const el = document.querySelector<HTMLElement>(seletor);
    return el && el.offsetParent !== null ? el : null;
  } catch {
    return null;
  }
}

function alvoDe(p: Passo): HTMLElement | null {
  for (const s of p.seletores) {
    const el = achar(s);
    if (el) return el;
  }
  return null;
}

/** O retângulo do bloco do passo somado aos elementos de `incluir` (ex.: o cartão Fundo e a lista de fundos aberta). */
function retanguloDe(p: Passo): DOMRect | null {
  const el = alvoDe(p);
  if (!el) return null;
  const rs = [el, ...(p.incluir ?? []).map(achar)].filter((x): x is HTMLElement => !!x).map((x) => x.getBoundingClientRect());
  const top = Math.min(...rs.map((r) => r.top));
  const left = Math.min(...rs.map((r) => r.left));
  return new DOMRect(left, top, Math.max(...rs.map((r) => r.right)) - left, Math.max(...rs.map((r) => r.bottom)) - top);
}

/** O passo entra no tour? Decidido na hora, pelo que está na tela (sem resultado, os blocos do resultado viram um passo só). */
function cabe(p: Passo): boolean {
  if (p.soSem && achar(p.soSem)) return false;
  if (p.ouCom && achar(p.ouCom)) return true;
  // sem a pasta, os cartões de exemplo entram no lugar do painel "Escolha a pasta do trimestre"
  if (p.demonstracao && (achar('[data-tour="escolher-pasta"]') || achar("[data-demo]"))) return true;
  return !p.opcional || !!alvoDe(p);
}

/** O próximo passo que cabe na tela, andando para frente (+1) ou para trás (-1) a partir de `de`; null se não houver. */
function vizinho(de: number, sentido: 1 | -1): number | null {
  for (let i = de + sentido; i >= 0 && i < PASSOS.length; i += sentido) if (cabe(PASSOS[i])) return i;
  return null;
}

/** Onde o balão cabe: embaixo do bloco, em cima, à direita, à esquerda; sem lugar, no rodapé. Sem bloco, no centro. */
function lugarDoBalao(c: Caixa | null): React.CSSProperties {
  if (!c) return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  const largura = Math.min(360, window.innerWidth - 24); // a mesma do w-[min(22.5rem,calc(100vw-1.5rem))]
  const alinhada = Math.max(12, Math.min(c.left, window.innerWidth - largura - 12));
  if (c.top + c.height + 12 + ALTURA_BALAO <= window.innerHeight) return { left: alinhada, top: c.top + c.height + 12 };
  if (c.top - 12 - ALTURA_BALAO >= 0) return { left: alinhada, top: c.top - 12, transform: "translateY(-100%)" };
  const topoAoLado = Math.max(12, Math.min(c.top, window.innerHeight - ALTURA_BALAO - 12));
  if (c.left + c.width + 12 + largura <= window.innerWidth - 12) return { left: c.left + c.width + 12, top: topoAoLado };
  if (c.left - 12 - largura >= 12) return { left: c.left - 12 - largura, top: topoAoLado };
  return { left: alinhada, bottom: 16 };
}

const digitando = (alvo: EventTarget | null) =>
  alvo instanceof HTMLElement && (alvo.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName));

/**
 * Tour guiado: destaca cada bloco da tela e explica para que serve. O bloco destacado continua clicável (dá para
 * escolher a pasta ou um fundo com o tour aberto); o resto da tela fica bloqueado. Abre pelo botão ou pelo link #tour.
 */
export function Tour() {
  const [passo, setPasso] = useState<number | null>(null);
  const [caixa, setCaixa] = useState<Caixa | null>(null);

  const medir = useCallback(() => {
    if (passo === null) return;
    const r = retanguloDe(PASSOS[passo]);
    let nova: Caixa | null = null;
    if (r) {
      // recorta no que está na tela e deixa espaço para o balão quando o bloco é muito alto
      const top = Math.max(8, r.top - 6);
      const bottom = Math.min(r.bottom + 6, window.innerHeight - 8, top + window.innerHeight - 220);
      const left = Math.max(8, r.left - 6);
      nova = { top, left, width: Math.min(r.width + 12, window.innerWidth - 8 - left), height: Math.max(0, bottom - top) };
    }
    setCaixa((c) => (c && nova && c.top === nova.top && c.left === nova.left && c.width === nova.width && c.height === nova.height ? c : nova));
  }, [passo]);

  // abre pelo link do menu e do tutorial (#tour)
  useEffect(() => {
    const peloHash = () => {
      if (window.location.hash === "#tour") {
        history.replaceState(null, "", window.location.pathname);
        setPasso(vizinho(-1, 1));
      }
    };
    peloHash();
    window.addEventListener("hashchange", peloHash);
    return () => window.removeEventListener("hashchange", peloHash);
  }, []);

  // prepara o bloco do passo (abre o painel/lista), leva a tela até ele e acompanha o que muda enquanto o passo está aberto
  useLayoutEffect(() => {
    if (passo === null) return;
    const p = PASSOS[passo];
    const el = alvoDe(p);
    let abriu: HTMLDetailsElement | null = null;
    if (el && p.abrir && el instanceof HTMLDetailsElement && !el.open) {
      el.open = true;
      abriu = el;
    }
    // os eventos de passos seguidos se anulam no mesmo commit (sai false, entra true): o exemplo não pisca entre passos
    if (p.demonstracao) window.dispatchEvent(new CustomEvent(EVENTO_DEMONSTRACAO, { detail: true }));
    if (p.evento) window.dispatchEvent(new CustomEvent(p.evento, { detail: true }));

    let alturaPosicionada = 0;
    const posicionar = () => {
      const r = retanguloDe(p);
      if (r) {
        const alto = r.height > window.innerHeight - 260;
        const desvio = alto ? r.top - 24 : r.top - (window.innerHeight - r.height) / 2;
        // "instant" ignora o scroll-behavior: smooth do globals.css; rolagem animada deixaria o destaque para trás
        if (Math.abs(desvio) > 2) window.scrollBy({ top: desvio, behavior: "instant" });
        alturaPosicionada = r.height;
      }
      medir();
    };
    posicionar();
    // de novo depois que o painel ou a lista abrir (o React desenha depois do evento)
    const t = setTimeout(posicionar, 150);
    // a tela muda com o tour aberto (lista carregando, pasta escolhida, bloco aberto): mede de novo e segue o usuário
    const intervalo = setInterval(() => {
      if (p.avancaQuando && achar(p.avancaQuando)) return setPasso(vizinho(passo, 1));
      // o bloco mudou de tamanho e saiu da tela (ex.: a lista de fundos terminou de carregar): leva a tela até ele de novo;
      // fora isso só mede, para não brigar com a rolagem nem com a busca do usuário
      const r = retanguloDe(p);
      const foraDaTela = !!r && (r.top < 0 || r.bottom > window.innerHeight);
      if (r && foraDaTela && Math.abs(r.height - alturaPosicionada) > 40) posicionar();
      else medir();
    }, 300);
    window.addEventListener("scroll", medir, true);
    window.addEventListener("resize", medir);
    return () => {
      clearTimeout(t);
      clearInterval(intervalo);
      window.removeEventListener("scroll", medir, true);
      window.removeEventListener("resize", medir);
      if (abriu) abriu.open = false;
      if (p.evento) window.dispatchEvent(new CustomEvent(p.evento, { detail: false }));
      if (p.demonstracao) window.dispatchEvent(new CustomEvent(EVENTO_DEMONSTRACAO, { detail: false }));
    };
  }, [passo, medir]);

  useEffect(() => {
    if (passo === null) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setPasso(null);
      if (digitando(e.target)) return; // as setas movem o cursor na busca, não o tour
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
  // bloqueia a tela em volta do bloco destacado; o bloco continua clicável
  const bloqueios: React.CSSProperties[] = caixa
    ? [
      { top: 0, left: 0, right: 0, height: caixa.top },
      { top: caixa.top + caixa.height, left: 0, right: 0, bottom: 0 },
      { top: caixa.top, left: 0, width: caixa.left, height: caixa.height },
      { top: caixa.top, left: caixa.left + caixa.width, right: 0, height: caixa.height },
    ]
    : [];

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Tour guiado">
      {caixa ? (
        <>
          {/* escurece tudo menos o bloco destacado */}
          <div className="fixed rounded-2xl ring-2 ring-primary transition-all duration-200" style={{ ...caixa, boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)" }} />
          {bloqueios.map((b, i) => <div key={i} className="pointer-events-auto fixed" style={b} />)}
        </>
      ) : (
        <div className="pointer-events-auto fixed inset-0 bg-black/70" />
      )}
      <div className="pointer-events-auto fixed w-[min(22.5rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-card p-4 shadow-2xl" style={lugarDoBalao(caixa)}>
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
