import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Tutorial — Lastro",
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

type Estado = "ok" | "parcial" | "nao" | "fora";

const ESTADO: Record<Estado, { texto: string; classe: string }> = {
  ok: { texto: "funciona", classe: "text-ok bg-ok/12 ring-ok/25" },
  parcial: { texto: "em parte", classe: "text-sky-300 bg-sky-400/12 ring-sky-400/25" },
  nao: { texto: "ainda não", classe: "text-aviso bg-aviso/12 ring-aviso/25" },
  fora: { texto: "fora do app", classe: "text-creme/55 bg-creme/6 ring-creme/10" },
};

interface Administradora {
  nome: string;
  resumo: string;
  fontes: { nome: string; estado: Estado; porque?: string }[];
  comoConferir: string[];
}

const ADMINISTRADORAS: Administradora[] = [
  {
    nome: "Planner",
    resumo: "Carteira pela Britech (ambiente delta).",
    fontes: [
      { nome: "API da Britech", estado: "ok" },
      { nome: "MAPS", estado: "nao", porque: "a API do MAPS só responde pela VPN, que está numa máquina específica do time" },
      { nome: "AMPLIS", estado: "nao", porque: "o AMPLIS não tem API para o app usar" },
    ],
    comoConferir: [
      "Fundo na Britech: deixe \"API Britech\" (ou o arquivo de _Carteiras\\FORMATADA).",
      "Fundo no MAPS ou no AMPLIS: escolha o arquivo da carteira no Drive.",
    ],
  },
  {
    nome: "ID",
    resumo: "Britech da ID e fundos de recebíveis pela amostra/estoque do Drive.",
    fontes: [
      { nome: "API da Britech", estado: "ok" },
      { nome: "Amostra e estoque no Drive", estado: "ok" },
    ],
    comoConferir: [
      "Fundo de títulos: \"API Britech\".",
      "Fundo de recebíveis (duplicatas, CCB): a amostra (_Amostra) já vem escolhida; o estoque fica em _Insumos.",
      "Na pré-classificação, o termo de cessão de duplicata traz o cedente e não o sacado: o app considera a carteira (convenção do time).",
      "Se o estoque do Drive for de outra data, o app avisa que a diferença pode ser só da data.",
    ],
  },
  {
    nome: "Azumi",
    resumo: "Sistema Sinqia; recebíveis pela amostra/estoque do Drive.",
    fontes: [
      { nome: "Amostra e estoque no Drive", estado: "ok" },
      { nome: "Sinqia", estado: "nao", porque: "o servidor da Azumi recusa pedidos que vêm da nuvem (firewall); só responde da rede do escritório, então está em stand-by" },
      { nome: "Fromtis (estoque)", estado: "nao", porque: "o usuário entra, mas não tem o perfil de webservice; falta a Azumi habilitar" },
    ],
    comoConferir: [
      "Use a amostra (_Amostra) ou o estoque do Drive — o app já começa nela.",
      "Muitos FIC têm a WP_Termo vazia (não há termos de cessão): o app avisa e não há o que conferir.",
      "Notas comerciais em parcelas: o termo traz o cronograma, e a parcela aparece sem número; a pré-classificação acha a linha certa com confiança média.",
    ],
  },
  {
    nome: "Intra",
    resumo: "A Intra envia a carteira (aba carteiraInforme do workpaper).",
    fontes: [
      { nome: "Carteira enviada (no workpaper)", estado: "ok" },
      { nome: "API da Britech", estado: "nao", porque: "a Britech da Intra recusa o usuário que temos (não é o usuário de API)" },
    ],
    comoConferir: [
      "Use o arquivo da carteira ou a amostra/estoque do Drive.",
      "A validação da carteira (categorias × PL e carteira × estoque) sai na aba do Excel.",
    ],
  },
  {
    nome: "Limine",
    resumo: "A Limine envia a carteira; recebíveis pela amostra/estoque do Drive.",
    fontes: [
      { nome: "Amostra e estoque no Drive", estado: "ok" },
      { nome: "Fromtis (estoque)", estado: "nao", porque: "o usuário não tem o perfil de webservice" },
      { nome: "Sinqia", estado: "nao", porque: "em stand-by, como na Azumi" },
    ],
    comoConferir: ["Use a amostra ou o estoque do Drive; a carteira enviada fica na aba carteiraInforme do workpaper."],
  },
  {
    nome: "Finvest",
    resumo: "A Finvest envia a carteira; recebíveis pela amostra/estoque do Drive.",
    fontes: [
      { nome: "Amostra e estoque no Drive", estado: "ok" },
      { nome: "API da Britech", estado: "nao", porque: "a Britech antiga da Finvest saiu do ar (ela migrou para Sinqia/Fromtis)" },
      { nome: "Fromtis e Sinqia", estado: "nao", porque: "o usuário do Fromtis não tem o perfil de webservice e o Sinqia está em stand-by" },
    ],
    comoConferir: ["Use a amostra ou o estoque do Drive."],
  },
  {
    nome: "Solis",
    resumo: "Fundos novos que às vezes ainda não têm workpaper.",
    fontes: [
      { nome: "Amostra no Drive (sem workpaper)", estado: "ok" },
      { nome: "Monday", estado: "parcial", porque: "os fundos da Solis não estão no board de lastro, então não aparece a linha do Monday" },
    ],
    comoConferir: [
      "O fundo sem workpaper aparece como \"sem workpaper (usa a amostra)\"; a data-base vem do trimestre da pasta.",
      "Sem a aba carteiraInforme não há validação da carteira, e o estoque (que pode ter dezenas de MB) não é lido.",
    ],
  },
  {
    nome: "América, Ativa, MF Pepper e Vert",
    resumo: "Britech de cada administradora configurada.",
    fontes: [{ nome: "API da Britech", estado: "ok" }],
    comoConferir: ["\"API Britech\": o app procura o CNPJ em todas as Britech ao mesmo tempo e mostra em qual achou."],
  },
  {
    nome: "RJI e Guide",
    resumo: "Britech cadastrada, mas sem resposta.",
    fontes: [{ nome: "API da Britech", estado: "nao", porque: "a RJI recusa o usuário que temos; o endereço da Guide não é acessível" }],
    comoConferir: ["Use o arquivo da carteira no Drive."],
  },
  {
    nome: "QI Tech e BlueWave",
    resumo: "Só validação de estoque.",
    fontes: [{ nome: "Conferência de lastro", estado: "fora", porque: "o trabalho nessas administradoras é só a validação do estoque, fora do que o app faz" }],
    comoConferir: ["Não aparecem na lista de administradoras."],
  },
];

function Selo({ estado }: { estado: Estado }) {
  const e = ESTADO[estado];
  return <span className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${e.classe}`}>{e.texto}</span>;
}

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
          <h2 className="text-2xl font-medium tracking-tight text-creme">Passo a passo</h2>
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
              Legenda: {(Object.keys(ESTADO) as Estado[]).map((e) => <Selo key={e} estado={e} />)}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {ADMINISTRADORAS.map((a) => (
              <details key={a.nome} className="group rounded-2xl border border-border bg-card" open>
                <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-5 py-4">
                  <span>
                    <span className="block font-medium text-creme">{a.nome}</span>
                    <span className="mt-0.5 block text-xs text-creme/50">{a.resumo}</span>
                  </span>
                  <span className="mt-1 text-creme/40 transition-transform group-open:rotate-180">▾</span>
                </summary>
                <div className="space-y-4 border-t border-border px-5 py-4">
                  <ul className="space-y-2">
                    {a.fontes.map((f) => (
                      <li key={f.nome} className="space-y-0.5">
                        <p className="flex items-center gap-2 text-sm text-creme/80"><Selo estado={f.estado} /> {f.nome}</p>
                        {f.porque && <p className="pl-1 text-xs leading-relaxed text-creme/50">Por quê: {f.porque}.</p>}
                      </li>
                    ))}
                  </ul>
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-creme/45">Como conferir hoje</p>
                    <ul className="list-disc space-y-1 pl-4 text-sm leading-relaxed text-creme/65 marker:text-creme/30">
                      {a.comoConferir.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                  </div>
                </div>
              </details>
            ))}
          </div>
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
