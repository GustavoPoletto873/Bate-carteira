"""Leitura do workpaper (.xlsm/.xlsx) do fundo: aba WP_Termo, CNPJ/nome do fundo e data-base."""
import re
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path

from .textos import fmt_data, para_data, para_decimal, so_digitos

ABA_TERMO = 'wp_termo'
COLUNAS_OBRIGATORIAS = ('BASE_VALOR_AQUISICAO', 'BASE_DATA_EMISSAO', 'BASE_DATA_VENCIMENTO')


@dataclass
class LinhaWP:
    linha_excel: int
    id_base: str
    numero_doc: str
    valor_aquisicao: object
    valor_nominal: object
    data_emissao: object
    data_vencimento: object
    data_aquisicao: object
    tipo_recebivel: str
    nome_sacado: str
    nome_cedente: str
    status: str


@dataclass
class Workpaper:
    nome_arquivo: str
    fundo: str = ''
    cnpj: str = ''
    data_base: object = None
    linhas: list = field(default_factory=list)

    def resumo(self) -> dict:
        return {'arquivo': self.nome_arquivo, 'fundo': self.fundo, 'cnpj': self.cnpj,
                'data_base': self.data_base.isoformat() if self.data_base else '',
                'data_base_fmt': fmt_data(self.data_base), 'linhas_wp_termo': len(self.linhas)}


def _texto(v) -> str:
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    texto = str(v).strip()
    return '' if texto == '-' else texto


def _data_base(wb) -> object:
    """Data-base do trabalho: título do Resumo_BateLastro ('... - 30/06/2026') ou 'Data Base' do carteiraInforme."""
    for nome in wb.sheetnames:
        if nome.lower().startswith('resumo'):
            for linha in wb[nome].iter_rows(min_row=1, max_row=3, values_only=True):
                for v in linha:
                    if isinstance(v, str) and re.search(r'\d{2}/\d{2}/\d{4}', v):
                        d = para_data(re.search(r'\d{2}/\d{2}/\d{4}', v).group(0))
                        if d:
                            return d
    for nome in wb.sheetnames:
        if nome.lower() == 'carteirainforme':
            for linha in wb[nome].iter_rows(min_row=2, max_row=2, values_only=True):
                d = para_data(linha[0] if linha else None)
                if d:
                    return d
    return None


def ler_workpaper(conteudo: bytes, nome_arquivo: str) -> Workpaper:
    import openpyxl
    try:
        wb = openpyxl.load_workbook(BytesIO(conteudo), read_only=True, data_only=True, keep_vba=False)
    except Exception as exc:
        raise ValueError(f'Não consegui abrir o workpaper "{nome_arquivo}". Confira se é o .xlsm do fundo '
                         f'e se não está corrompido. ({str(exc)[:120]})') from exc
    try:
        aba = next((wb[n] for n in wb.sheetnames if n.strip().lower() == ABA_TERMO), None)
        if aba is None:
            raise ValueError(f'O workpaper "{nome_arquivo}" não tem a aba WP_Termo. '
                             f'Abas encontradas: {", ".join(wb.sheetnames)}.')
        wp = Workpaper(nome_arquivo=nome_arquivo, data_base=_data_base(wb))

        cabecalho, colunas = None, {}
        for n, linha in enumerate(aba.iter_rows(values_only=True), 1):
            if cabecalho is None:
                nomes = [str(v).strip().upper() if v is not None else '' for v in linha]
                if 'BASE_VALOR_AQUISICAO' in nomes or 'BASE_NUMERO_DOC' in nomes:
                    cabecalho = n
                    colunas = {nome: i for i, nome in enumerate(nomes) if nome}
                    faltando = [c for c in COLUNAS_OBRIGATORIAS if c not in colunas]
                    if faltando:
                        raise ValueError('A aba WP_Termo não tem as colunas ' + ', '.join(faltando) +
                                         '. Confira se o workpaper está no modelo atual.')
                if n > 40 and cabecalho is None:
                    break
                continue

            def col(nome, _linha=linha):
                i = colunas.get(nome)
                return _linha[i] if i is not None and i < len(_linha) else None

            valor = para_decimal(col('BASE_VALOR_AQUISICAO'))
            if valor is None and not _texto(col('BASE_NUMERO_DOC')):
                continue
            wp.linhas.append(LinhaWP(
                linha_excel=n, id_base=_texto(col('ID_BASE')), numero_doc=_texto(col('BASE_NUMERO_DOC')),
                valor_aquisicao=valor, valor_nominal=para_decimal(col('BASE_VALOR_NOMINAL')),
                data_emissao=para_data(col('BASE_DATA_EMISSAO')),
                data_vencimento=para_data(col('BASE_DATA_VENCIMENTO')),
                data_aquisicao=para_data(col('BASE_DATA_AQUISICAO')),
                tipo_recebivel=_texto(col('BASE_TIPO_RECEBIVEL')), nome_sacado=_texto(col('BASE_NOME_SACADO')),
                nome_cedente=_texto(col('BASE_NOME_CEDENTE')), status=_texto(col('STATUS'))))
            if not wp.fundo:
                wp.fundo = _texto(col('BASE_NOME_FUNDO'))
            if not wp.cnpj:
                wp.cnpj = so_digitos(col('BASE_CNPJ_FUNDO'))
        if cabecalho is None:
            raise ValueError('Não achei o cabeçalho da aba WP_Termo (linha com BASE_VALOR_AQUISICAO).')
    finally:
        wb.close()

    if len(wp.cnpj) != 14:  # cai para o CNPJ do nome do arquivo: WP_<fundo>_<cnpj>.xlsm
        m = re.search(r'(?<!\d)(\d{14})(?!\d)', Path(nome_arquivo).stem)
        wp.cnpj = m.group(1) if m else wp.cnpj
    if not wp.fundo:
        wp.fundo = re.sub(r'^WP_|_\d{14}$', '', Path(nome_arquivo).stem)
    return wp
