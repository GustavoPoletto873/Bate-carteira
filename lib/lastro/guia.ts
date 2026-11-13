/**
 * Guia das administradoras: de onde vem a carteira de cada uma, o que já funciona no app, o que ainda não roda (e por
 * quê) e como conferir hoje. Usado no tutorial e na dica que aparece ao escolher a administradora.
 */
export type EstadoFonte = "ok" | "parcial" | "nao" | "fora";

export const ESTADO_FONTE: Record<EstadoFonte, { texto: string; classe: string }> = {
  ok: { texto: "funciona", classe: "text-ok bg-ok/12 ring-ok/25" },
  parcial: { texto: "em parte", classe: "text-sky-300 bg-sky-400/12 ring-sky-400/25" },
  nao: { texto: "ainda não", classe: "text-aviso bg-aviso/12 ring-aviso/25" },
  fora: { texto: "fora do app", classe: "text-creme/55 bg-creme/6 ring-creme/10" },
};

export interface GuiaAdministradora {
  nome: string;
  /** nomes de pasta (sem acento, minúsculas) que caem neste guia */
  chaves: string[];
  resumo: string;
  fontes: { nome: string; estado: EstadoFonte; porque?: string }[];
  comoConferir: string[];
}

export const GUIA_ADMINISTRADORAS: GuiaAdministradora[] = [
  {
    nome: "Planner",
    chaves: ["planner"],
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
    chaves: ["id"],
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
    chaves: ["azumi"],
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
    chaves: ["intra"],
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
    chaves: ["limine"],
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
    chaves: ["finvest"],
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
    chaves: ["solis"],
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
    chaves: ["america", "ativa", "mfpepper", "mf pepper", "vert"],
    resumo: "Britech de cada administradora configurada.",
    fontes: [{ nome: "API da Britech", estado: "ok" }],
    comoConferir: ["\"API Britech\": o app procura o CNPJ em todas as Britech ao mesmo tempo e mostra em qual achou."],
  },
  {
    nome: "RJI e Guide",
    chaves: ["rji", "guide"],
    resumo: "Britech cadastrada, mas sem resposta.",
    fontes: [{ nome: "API da Britech", estado: "nao", porque: "a RJI recusa o usuário que temos; o endereço da Guide não é acessível" }],
    comoConferir: ["Use o arquivo da carteira no Drive."],
  },
  {
    nome: "QI Tech e BlueWave",
    chaves: ["qi tech", "bluewave", "blue wave"],
    resumo: "Só validação de estoque.",
    fontes: [{ nome: "Conferência de lastro", estado: "fora", porque: "o trabalho nessas administradoras é só a validação do estoque, fora do que o app faz" }],
    comoConferir: ["Não aparecem na lista de administradoras."],
  },
];

const chave = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** O guia da administradora pelo nome da pasta (ex.: "AZUMI", "Planner"); null se não houver. */
export function guiaDaAdministradora(nome: string): GuiaAdministradora | null {
  const n = chave(nome);
  return GUIA_ADMINISTRADORAS.find((g) => g.chaves.includes(n)) ?? null;
}

/** O nome da administradora como o guia escreve, mesmo num guia de várias (ex.: "VERT" → "Vert", em "América, Ativa, MF Pepper e Vert"). */
export function nomeNoGuia(g: GuiaAdministradora, nome: string): string {
  const semEspaco = (s: string) => chave(s).replace(/\s+/g, "");
  return g.nome.split(/, | e /).find((parte) => semEspaco(parte) === semEspaco(nome)) ?? g.nome;
}
