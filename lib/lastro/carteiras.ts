/** Qual carteira da Britech conferir quando o CNPJ tem classe + subclasses. Função pura (testada). */

export interface OpcaoCarteira {
  id: string;
  nome: string;
  /** administradora (Britech) onde a carteira está; vazio = não informado */
  adm?: string;
  admNome?: string;
}

const SUBCLASSE = /sub\s*classe|s[eê]nior|subordinad|mezanino|\bmez\b|\bsub\b/i;

function prefixoComum(ids: string[]): string {
  if (!ids.length) return "";
  let p = ids[0];
  for (const id of ids.slice(1)) while (!id.startsWith(p)) p = p.slice(0, -1);
  return p;
}

/**
 * Opções para a tela e a escolhida por padrão. Preferência:
 * 1. o ID do arquivo já baixado (<id>_<cnpj>_<data>_BRITECH.xlsx);
 * 2. a carteira "CLASSE" / a que não é subclasse (sênior, mezanino, subordinada);
 * 3. o prefixo comum dos IDs das subclasses (52230001, 52230002… → 52230), que é a carteira-mãe na Britech;
 * 4. a primeira da lista.
 * Opções criadas aqui herdam a administradora da lista (o CNPJ está numa Britech só).
 */
export function opcoesDeCarteira(lista: OpcaoCarteira[], idArquivo = ""): { opcoes: OpcaoCarteira[]; padrao: string } {
  const opcoes = [...lista];
  const adm = { adm: lista[0]?.adm, admNome: lista[0]?.admNome };
  if (idArquivo && !opcoes.some((c) => c.id === idArquivo)) {
    opcoes.unshift({ id: idArquivo, nome: "carteira do arquivo já baixado (FORMATADA)", ...adm });
  }
  if (idArquivo) return { opcoes, padrao: idArquivo };

  const principal = lista.find((c) => /classe/i.test(c.nome) && !/sub\s*classe/i.test(c.nome))
    ?? lista.find((c) => !SUBCLASSE.test(c.nome));
  if (principal) return { opcoes, padrao: principal.id };

  const prefixo = prefixoComum(lista.map((c) => c.id));
  if (prefixo.length >= 4 && lista.length > 1 && !lista.some((c) => c.id === prefixo)) {
    opcoes.unshift({ id: prefixo, nome: "carteira principal (deduzida dos IDs das subclasses)", ...adm });
    return { opcoes, padrao: prefixo };
  }
  return { opcoes, padrao: lista[0]?.id ?? "" };
}
