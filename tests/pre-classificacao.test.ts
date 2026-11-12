/**
 * Pré-classificação das pendências (adaptada do motor do bate-lastro): formas de impressão, documento sugerido,
 * confiança, marca de cada campo, proteções e os motivos da conferência em lote. Todos os dados são fictícios.
 */
import { describe, expect, it } from "vitest";
import type { ChaveCampo, DadosDoTitulo, LinhaResultado } from "../lib/lastro/conciliacao";
import { analisar } from "../lib/lastro/documentos";
import {
  chavesDocumento, extrairDatas, extrairMoedas, extrairPessoas, normalizarMesmoTamanho, normalizarPessoa, numeroConfere, termosDeBusca,
} from "../lib/lastro/formas";
import {
  indexar, motivoDe, preClassificarTitulo, secoes, vinculoDaSugestao, type Sugestao, type Veredito,
} from "../lib/lastro/pre-classificacao";

const ROTULOS: Record<ChaveCampo, string> = { valor: "Valor", emissao: "Emissão", vencimento: "Vencimento", emissor: "Sacado" };

function linha(d: Partial<DadosDoTitulo>, id = 1): LinhaResultado {
  const campo = { status: "Não localizado" as const, britech: "", documentos: "", fontes: [], nota: "", wp: "", wpStatus: "—" as const };
  return {
    id, ativo: "", emissor: d.sacado ?? "", cedente: d.cedente ?? "", codigo: d.numero ?? "", valorAplicado: "", dataAquisicao: "",
    noWp: false, wpLinha: null, situacao: "Verificar", docsDiretos: 0, docsMesmaOperacao: 0, evidencias: [], comparacoes: [],
    campos: { valor: campo, emissao: campo, vencimento: campo, emissor: campo },
    dados: {
      numero: "", sacado: "", docSacado: "", cedente: "", docCedente: "", nominal: null, aquisicao: null,
      emissao: null, vencimento: null, tipo: "Duplicata", ...d,
    },
  };
}
const doc = (nome: string, ...paginas: string[]) => {
  const texto = paginas.join("\n");
  const inicios = paginas.reduce<number[]>((acc, p, i) => [...acc, i ? acc[i - 1] + paginas[i - 1].length + 1 : 0], []);
  return analisar(nome, texto, { paginas: inicios, tipo: "PDF" });
};

describe("formas de impressão", () => {
  it("datas numéricas, ISO, por extenso e com o mês escrito; rejeita data com hora e 31/02", () => {
    const t = normalizarMesmoTamanho("Em 12/06/2026, 1º de Julho de 2026, 15 (quinze) de agosto de 2026, 2026-09-30, 05.10.26, 7 mar. 2027, 15 mar 26, 31/02/2026, 10 jan 2027 às 10:30");
    expect(extrairDatas(t).map((d) => d.valor)).toEqual(["2026-06-12", "2026-07-01", "2026-08-15", "2026-09-30", "2026-10-05", "2027-03-07"]);
  });

  it("moedas no formato brasileiro e americano, em centavos", () => {
    const t = normalizarMesmoTamanho("R$ 1.613,33 | 1613,33 | R$ 1613.33 | 1,613.33 | 12,345 | 1.5");
    expect(extrairMoedas(t).map((m) => m.valor)).toEqual([161333, 161333, 161333, 161333]);
  });

  it("CPF/CNPJ com e sem máscara; o zero perdido volta só com o dígito verificador", () => {
    const t = normalizarMesmoTamanho("CPF 111.444.777-35 CNPJ 11.222.333/0001-81 corrido 1222333000181");
    expect(extrairPessoas(t).map((p) => p.valor)).toEqual(["11144477735", "11222333000181", "01222333000181"]);
    expect(normalizarPessoa("1222333000181")).toBeNull(); // DV não confere com o zero
    expect(normalizarPessoa("9876543200")).toBeNull();
    expect(normalizarPessoa("111.444.777-35")).toBe("11144477735");
  });

  it("número do documento: exato, parcela da CCB e código alfanumérico", () => {
    const n = (s: string) => {
      const c = chavesDocumento(s);
      return { grupos: c.grupos, corrido: c.corrido, digitos: c.digitos };
    };
    expect(numeroConfere(chavesDocumento("'0052635-01"), n("52635-01"), false)).toBe("exato");
    expect(numeroConfere(chavesDocumento("445566701"), n("4455667"), true)).toBe("parcela");
    expect(numeroConfere(chavesDocumento("445566701"), n("4455667"), false)).toBeNull();
    expect(numeroConfere(chavesDocumento("CR123456-1"), n("123456"), true)).toBe("parcela");
    expect(chavesDocumento("12C3-45678").codigo).toBe("12c345678");
    expect(chavesDocumento("CCB-1").codigo).toBeNull();
  });

  it("formas de um valor conhecido para a busca", () => {
    expect(termosDeBusca("1.613,33", "moeda")).toEqual(["1.613,33", "1613,33", "1,613.33", "1613.33"]);
    expect(termosDeBusca("2026-07-01", "data").slice(0, 7)).toEqual(["01/07/2026", "01.07.2026", "01-07-2026", "01/07/26", "2026-07-01", "1 de julho de 2026", "1º de julho de 2026"]);
    expect(termosDeBusca("11144477735", "pessoa")).toContain("111.444.777-35");
  });
});

describe("documento sugerido e marca de cada campo", () => {
  const DUPLICATA = "DUPLICATA MERCANTIL\nNº 52635-01\nValor R$ 1.613,33\nVENCIMENTO: 05/09/2026\n"
    + "Sacado: ACADEMIA TESTE LTDA CNPJ 33.444.555/0002-07\nEmitente: FABRICA EXEMPLO LTDA CNPJ 11.222.333/0001-81";

  it("duplicata: número, valor e sacado (CNPJ da mesma raiz) conferem; o vencimento rotulado diverge", () => {
    const s = preClassificarTitulo(linha({
      numero: "52635-01", sacado: "ACADEMIA TESTE LTDA", docSacado: "33.444.555/0001-81", nominal: 161333, vencimento: "2026-08-05",
    }), indexar([doc("dup.pdf", DUPLICATA)]));
    expect(s.candidato).toMatchObject({ arquivo: "dup.pdf", pagina: 1, modo: "pagina" });
    expect(s.confianca).toBe("alta");
    expect(s.candidato!.detalhes.numero.marca).toBe("V");
    expect(s.candidato!.detalhes.sacadoDoc).toMatchObject({ marca: "V", regra: "cnpj_mesma_raiz" });
    expect(s.campos.valor).toMatchObject({ marca: "V", documento: "1.613,33" });
    expect(s.campos.vencimento).toMatchObject({ marca: "D", documento: "05/09/2026", regra: "" });
    expect(s.campos.emissor.marca).toBe("V");
    expect(motivoDe(s, ROTULOS)).toMatchObject({ chave: "divergente:vencimento", decisao: "revisar", titulo: "O documento traz outro Vencimento" });
    expect(vinculoDaSugestao(s)).toEqual({
      arquivo: "dup.pdf", pagina: 1,
      campos: {
        emissor: { marca: "V", documento: expect.any(String) }, valor: { marca: "V", documento: "1.613,33" },
        emissao: { marca: "P", documento: "" }, vencimento: { marca: "D", documento: "05/09/2026" }, // emissão: a carteira não tem
      },
    });
  });

  it("cópias idênticas não contam como ambiguidade", () => {
    const ind = indexar([doc("a.pdf", DUPLICATA), doc("b.pdf", DUPLICATA)]);
    const s = preClassificarTitulo(linha({ numero: "52635-01", sacado: "ACADEMIA TESTE LTDA", nominal: 161333, vencimento: "2026-09-05" }), ind);
    expect(s.confianca).toBe("alta");
    expect(s.candidato!.arquivo).toBe("a.pdf");
    expect(s.alternativas).toHaveLength(0);
    expect(motivoDe(s, ROTULOS)).toMatchObject({ chave: "confere", decisao: "confirmar" }); // a carteira não tem emissão
  });

  it("termo com vários títulos: vale a linha do título, não o valor da linha vizinha", () => {
    const termo = doc("termo.pdf", "TERMO DE CESSÃO\nRelação dos títulos cedidos\n"
      + "52623-05 MERCEARIA EXEMPLO 12.345.678/0001-95 R$ 2.000,00 10/09/2026\n"
      + "52623-06 MERCEARIA EXEMPLO 12.345.678/0001-95 R$ 2.500,00 10/10/2026\n");
    const s = preClassificarTitulo(linha({
      numero: "52623-06", sacado: "MERCEARIA EXEMPLO", docSacado: "12345678000195", nominal: 200000, vencimento: "2026-10-10",
    }), indexar([termo]));
    expect(s.candidato).toMatchObject({ arquivo: "termo.pdf", modo: "linha", tipo: "termo" });
    expect(s.candidato!.detalhes.numero.documento).toBe("52623-06");
    expect(s.campos.vencimento).toMatchObject({ marca: "V", documento: "10/10/2026" });
    expect(s.campos.valor).toMatchObject({ marca: "D", documento: "2.500,00" });
  });

  it("termo de duplicata não traz o sacado: vale a carteira (convenção), com o motivo explícito", () => {
    const termo = doc("termo.pdf", "TERMO DE CESSÃO DE DIREITOS CREDITÓRIOS\nCedente: ACME ESQUADRIAS LTDA\n"
      + "R000000101 01 ACME ESQUADRIAS LTDA R$ 10.000,50 13/07/2026\nR000000102 01 ACME ESQUADRIAS LTDA R$ 2.000,00 14/08/2026\n");
    const s = preClassificarTitulo(linha({
      numero: "R000000101", sacado: "CONSTRUTORA EXEMPLO E ACABAME", cedente: "ACME ESQUADRIAS LTDA", nominal: 1000050, vencimento: "2026-07-13",
    }), indexar([termo]));
    expect(s.candidato).toMatchObject({ modo: "linha", tipo: "termo" });
    expect(s.campos.emissor).toMatchObject({ marca: "V", regra: "termo_sem_sacado" });
    expect(motivoDe(s, ROTULOS).titulo).toContain("Sacado: o termo da duplicata não traz — vale a carteira");
  });

  it("nome cortado na carteira: a última palavra vale pelo começo", () => {
    const d = doc("dup.pdf", "DUPLICATA Nº 7782\nSacado: CONSTRUTORA EXEMPLO E ACABAMENTOS LTDA\nValor R$ 700,00\nVencimento: 10/04/2027");
    const s = preClassificarTitulo(linha({ numero: "7782", sacado: "CONSTRUTORA EXEMPLO E ACABAME", nominal: 70000, vencimento: "2027-04-10" }), indexar([d]));
    expect(s.campos.emissor).toMatchObject({ marca: "V", regra: "" });
  });

  it("vencimento um dia antes na linha do termo: mantém a data da carteira, com o alerta", () => {
    const termo = doc("termo.pdf", "TERMO DE CESSÃO\n"
      + "4410022 FULANO DE TAL 111.444.777-35 R$ 900,00 21/01/2029\n"
      + "4410023 BELTRANO SILVA 222.333.444-05 R$ 950,00 21/02/2029\n");
    const s = preClassificarTitulo(linha({
      numero: "4410022", sacado: "FULANO DE TAL", docSacado: "111.444.777-35", nominal: 90000, vencimento: "2029-01-22",
    }), indexar([termo]));
    expect(s.campos.vencimento).toMatchObject({ marca: "V", regra: "vencimento_um_dia_antes", alerta: "21/01/2029" });
    expect(["alta", "media"]).toContain(s.confianca);
  });

  it("CCB: número sem o sufixo da parcela e vencimento dentro do cronograma", () => {
    const ccb = doc("ccb.pdf", "CÉDULA DE CRÉDITO BANCÁRIO Nº 4455667\nEmitente: JOANA EXEMPLO CPF 111.444.777-35\n"
      + "Valor da parcela R$ 284,23\nVencimento da 1ª parcela: 21/06/2026\nVencimento final: 21/05/2027\n");
    const s = preClassificarTitulo(linha({
      tipo: "CCB PRE DIGITAL", numero: "445566701", sacado: "JOANA EXEMPLO", docSacado: "11144477735", nominal: 28423, vencimento: "2026-11-21",
    }), indexar([ccb]));
    expect(s.candidato!.detalhes.numero).toMatchObject({ marca: "V", regra: "numero_com_parcela" });
    expect(s.campos.vencimento).toMatchObject({ marca: "V", regra: "cronograma_parcelas" });
    expect(s.confianca).toBe("alta");
  });

  it("nome parcial ao lado do CPF confirmado conta como o sacado", () => {
    const d = doc("dup.pdf", "DUPLICATA Nº 7781\nSACADO ANA B. SOUZA CPF 111.444.777-35\nValor R$ 500,00\nVencimento: 10/03/2027");
    const s = preClassificarTitulo(linha({
      numero: "7781", sacado: "ANA BEATRIZ LIMA SOUZA", docSacado: "11144477735", nominal: 50000, vencimento: "2027-03-10",
    }), indexar([d]));
    expect(s.candidato!.detalhes.sacadoNome).toMatchObject({ marca: "V", regra: "nome_parcial_com_cpf" });
    expect(motivoDe(s, ROTULOS).chave).toBe("confere");
  });

  it("valor só depois de um encargo (IOF) não confirma o título", () => {
    const d = doc("ccb.pdf", "CCB Nº 9988776\nIOF (financiado): 290,00\nEmitente: JOANA EXEMPLO CPF 111.444.777-35\nVencimento: 10/03/2027");
    const s = preClassificarTitulo(linha({ numero: "9988776", sacado: "JOANA EXEMPLO", docSacado: "11144477735", nominal: 29000, vencimento: "2027-03-10" }), indexar([d]));
    expect(s.campos.valor.marca).not.toBe("V");
  });

  it("listagem de muitos devedores não vira o documento de um título só pela página", () => {
    const linhas = Array.from({ length: 6 }, (_, i) => `86383763${i}${i} 01 10/07/2029 R$ ${i + 1}.000,00 15/08/2026 R$ 900,00 DEVEDOR ${i} ${String(11144477735 + i * 1111).padStart(11, "0")}`);
    const relatorio = doc("relatorio.pdf", `RELATÓRIO DA REGISTRADORA\n${linhas.join("\n")}\n`);
    const s = preClassificarTitulo(linha({ numero: "8638376300", sacado: "OUTRA PESSOA", nominal: 77700, vencimento: "2031-01-01" }), indexar([relatorio]));
    expect(s.candidato).toBeNull();
    expect(s.confianca).toBe("sem_candidato");
  });

  it("bilhete de seguro prestamista nunca é sugerido", () => {
    const seguro = doc("seguro.pdf", "BILHETE DE SEGURO PRESTAMISTA\nDados do segurado\nCCB Nº 9988776 Valor R$ 290,00 Vencimento: 10/03/2027");
    const s = preClassificarTitulo(linha({ numero: "9988776", nominal: 29000, vencimento: "2027-03-10" }), indexar([seguro]));
    expect(s.candidato).toBeNull();
  });
});

describe("conferência em lote: motivos e seções", () => {
  const v = (marca: Veredito["marca"], documento = "", regra = ""): Veredito => ({ marca, documento, regra, pagina: 1, pos: 0, fim: 0 });
  const sug = (parcial: Partial<Sugestao>, campos: Partial<Record<ChaveCampo, Veredito>> = {}): Sugestao => ({
    linhaId: 1, confianca: "alta", alternativas: [], avisos: [],
    candidato: { docId: 1, arquivo: "a.pdf", caminho: "a.pdf", tipo: "documento", pagina: 1, modo: "pagina", score: 9, detalhes: {} as never, destaques: [] },
    campos: { valor: v("V", "1,00"), emissao: v("V", "01/01/2026"), vencimento: v("V", "01/02/2026"), emissor: v("V", "X"), ...campos },
    ...parcial,
  });

  it("um motivo por título, com todos os pontos no título do grupo", () => {
    expect(motivoDe(sug({}), ROTULOS)).toEqual({ chave: "confere", decisao: "confirmar", titulo: "Tudo confere com o documento" });
    expect(motivoDe(sug({ confianca: "baixa" }), ROTULOS)).toMatchObject({ chave: "confianca:baixa", decisao: "revisar" });
    expect(motivoDe(sug({ avisos: ["so_a_pessoa"] }), ROTULOS)).toMatchObject({ decisao: "pendente" });
    expect(motivoDe(sug({}, { emissao: v("P"), valor: v("D", "2,00", "vencimento_um_dia_antes") }), ROTULOS)).toEqual({
      chave: "nao_encontrado:emissao|correcao:valor", decisao: "confirmar", titulo: "Emissão não achado + correção sugerida em Valor",
    });
    expect(motivoDe(sug({ candidato: null }), ROTULOS).chave).toBe("sem_pdf");
  });

  it("seções: para decidir, prontos e sem documento", () => {
    const lista = [sug({ linhaId: 1 }), sug({ linhaId: 2 }), sug({ linhaId: 3, confianca: "media" }), sug({ linhaId: 4, candidato: null })];
    const s = secoes(lista, ROTULOS);
    expect(s.prontos.map((g) => [g.motivo.chave, g.itens.length])).toEqual([["confere", 2]]);
    expect(s.paraDecidir.map((g) => g.motivo.chave)).toEqual(["confianca:media"]);
    expect(s.semPdf.map((x) => x.linhaId)).toEqual([4]);
  });
});
