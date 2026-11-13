import type { Metadata } from "next";
import Link from "next/link";
import { GuiaAdministradoras, SeloFonte } from "@/components/guia-administradoras";
import { ESTADO_FONTE, type EstadoFonte } from "@/lib/lastro/guia";

export const metadata: Metadata = {
  description: "Passo a passo da conferência de lastro e o que muda em cada administradora.",
};

const PASSOS: { titulo: string; texto: string; dica?: string }[] = [
  {
    titulo: "Abra o app na rede do escritório",
    texto: "Na rede do escritório o app abre direto. Fora dela, ele pede a chave de acesso.",
  },
  {
    titulo: "Escolha a pasta do trimestre",
    texto:
      "Em \"Ler o Drive por\", use \"Pasta deste computador\" e selecione a pasta do trimestre no G: (…\\Auditoria de Lastro – 1º Semestre – 2026\\2T2026). Os arquivos são lidos no seu navegador e não saem do computador.",
    dica: "No app rodando no computador do escritório, \"Servidor (G:)\" lê a pasta sozinho.",
  },
  {
    titulo: "Escolha a administradora e o fundo",
    texto:
      "A lista vem dos workpapers (WP_<fundo>_<cnpj>.xlsm em _Workpapers). Busque pelo nome ou pelo CNPJ. Fundo que só tem a amostra aparece como \"sem workpaper\": a amostra faz o papel da WP_Termo.",
    dica: "Embaixo do fundo aparece o que o Monday diz dele: administradora, sistema e código da carteira.",
  },
  {
    titulo: "Confira a carteira que o app escolheu",
    texto:
      "O app escolhe sozinho a melhor fonte: API da Britech, arquivo no Drive (carteira formatada, amostra ou estoque) ou Fromtis. Fundo de recebíveis começa na amostra. Se precisar, troque no cartão Carteira.",
  },
  {
    titulo: "Confira a pasta de lastro e termo",
    texto: "O app sugere a pasta em \"Lastro e Termo\" com o nome mais parecido com o do fundo. Troque na lista se não for a certa.",
  },
  {
    titulo: "Clique em Conferir",
    texto:
      "Os PDFs, boletas, DOCX e TXT da pasta são lidos no navegador. Uma pasta com centenas de PDFs leva alguns minutos; a barra mostra o andamento.",
  },
  {
    titulo: "Leia o resultado em três blocos",
    texto:
      "Precisam de atenção (divergem ou falta confirmar), Validados e Pendentes (nenhum documento cita o título). Valor e data de emissão batendo = validado visualmente: confira e clique em Aprovar (ou Aprovar todos).",
    dica: "Em \"Detalhes\", cada campo mostra o porquê numa frase e onde está no documento; \"abrir\" leva o PDF direto à página.",
  },
  {
    titulo: "Resolva as pendências",
    texto:
      "\"Bater PDF\" procura o valor em todos os documentos e deixa marcar cada campo (V confere, D diverge, P sem valor). \"Pré-classificar pendências\" sugere o documento e as marcas de todas de uma vez, agrupadas por motivo; você confere e aplica.",
  },
  {
    titulo: "Baixe o Excel",
    texto:
      "\"Baixar Excel com as evidências\" leva o resultado da tela, com as marcas e aprovações, as comparações e a validação da carteira (aba CVM do workpaper).",
  },
];

export default function Tutorial() {
  return (
    <main className="min-h-screen bg-background px-4 pb-24 pt-10 sm:px-6 md:px-10">
      <div className="mx-auto max-w-5xl space-y-14">
        <header className="space-y-4">
          <Link href="/" className="text-sm text-creme/55 underline-offset-4 hover:text-creme hover:underline">← Voltar para a conferência</Link>
          <h1 className="text-5xl font-medium tracking-[-0.04em] text-creme md:text-7xl">Tutorial</h1>
          <p className="max-w-3xl text-base leading-relaxed text-creme/60">
            O passo a passo da conferência de lastro e o que muda em cada administradora: de onde vem a carteira, o que já
            funciona e por que algumas integrações ainda não rodam.
          </p>
        </header>

        <section className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-medium tracking-tight text-creme">Passo a passo</h2>
            <Link href="/#tour" className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-black">Fazer o tour guiado na tela →</Link>
          </div>
          <ol className="space-y-3">
            {PASSOS.map((p, i) => (
              <li key={p.titulo} className="flex gap-4 rounded-2xl border border-border bg-card p-5">
                <span className="font-mono text-sm tabular-nums text-primary">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0 space-y-1.5">
                  <h3 className="font-medium text-creme">{p.titulo}</h3>
                  <p className="text-sm leading-relaxed text-creme/65">{p.texto}</p>
                  {p.dica && <p className="text-xs leading-relaxed text-creme/45">{p.dica}</p>}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="space-y-5">
          <div className="space-y-2">
            <h2 className="text-2xl font-medium tracking-tight text-creme">Cada administradora</h2>
            <p className="flex flex-wrap items-center gap-2 text-xs text-creme/50">
              Escolha a administradora. Legenda: {(Object.keys(ESTADO_FONTE) as EstadoFonte[]).map((e) => <SeloFonte key={e} estado={e} />)}
            </p>
          </div>
          <GuiaAdministradoras />
        </section>

        <section className="space-y-3 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-medium text-creme">O que destrava as que ainda não rodam</h2>
          <ul className="list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-creme/65 marker:text-creme/30">
            <li><span className="text-creme/85">Fromtis (Azumi, Limine, Finvest):</span> a administradora habilitar o perfil de webservice no usuário que já entra no sistema.</li>
            <li><span className="text-creme/85">Sinqia:</span> o servidor aceitar pedidos do app publicado (hoje só responde da rede do escritório).</li>
            <li><span className="text-creme/85">Britech da Intra e da RJI:</span> o usuário de API (o que temos é o do portal).</li>
            <li><span className="text-creme/85">MAPS e AMPLIS:</span> sem acesso fora da VPN / sem API — continuam pelo arquivo da carteira.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
