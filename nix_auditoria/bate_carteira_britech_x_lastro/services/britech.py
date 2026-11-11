"""Carteira Britech do fundo, padronizada em `Posicao`.

Três origens:
- arquivo já formatado pelo Gerar_Amostras_Planner (<id>_<cnpj>_<dd.mm.aaaa>_BRITECH.xlsx);
- planilha exportada do PAS (colunas como "VL Aplic.", "Dt. Emissão", "Emissor"...);
- API da Britech (relatório Composição da Carteira), com o leitor oficial do hub
  (denver_contabifi/carteira_britech/processor.py) e as credenciais da Planner já cadastradas.
"""
import importlib.util
import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import pandas as pd
import requests

from . import config
from .textos import fmt_data, normalizar, para_data, para_decimal, so_digitos

SINONIMOS = {
    'codigo': ['cod', 'codigo', 'id titulo', 'cod ativo', 'cod titulo'],
    'ativo': ['ativo', 'descricao', 'titulo', 'papel', 'nome do ativo'],
    'emissor': ['emissor', 'instituicaoemissor', 'instituicao emissor', 'nome emissor', 'nome do emissor'],
    'valor_aplicado': ['vl aplic', 'vlr aplic', 'valor aplicado', 'vl aplicado', 'vlr aquisicao', 'valor aquisicao',
                       'vl aquisicao', 'valorcusto', 'valor custo', 'valor aplicacao', 'aplicacao'],
    'valor_presente': ['vlr presente', 'valor presente', 'valormercado', 'valor mercado', 'vl mercado',
                       'vl atual', 'valor atual', 'vl bruto', 'valor bruto'],
    'data_aquisicao': ['dt aquisicao', 'data aquisicao', 'dataaquisicao', 'dt aplic', 'dt aplicacao',
                       'data aplicacao', 'dt operacao', 'data operacao'],
    'data_emissao': ['dt emissao', 'data emissao', 'emissao', 'dt de emissao', 'data de emissao'],
    'data_vencimento': ['dt vencimento', 'data vencimento', 'vencimento', 'dt vencto', 'vencto',
                        'data de vencimento', 'dt de vencimento'],
    'grupo': ['e financeira', 'grupo', 'tipo', 'mercado', 'tipo ativo'],
}
OBRIGATORIAS = ('valor_aplicado', 'emissor')


@dataclass
class Posicao:
    linha: int
    codigo: str
    ativo: str
    emissor: str
    valor_aplicado: object
    valor_presente: object
    data_aquisicao: object
    data_emissao: object
    data_vencimento: object
    grupo: str

    def como_dict(self) -> dict:
        return {'codigo': self.codigo, 'ativo': self.ativo, 'emissor': self.emissor,
                'valor_aplicado': float(self.valor_aplicado) if self.valor_aplicado is not None else None,
                'data_emissao': fmt_data(self.data_emissao), 'data_vencimento': fmt_data(self.data_vencimento),
                'data_aquisicao': fmt_data(self.data_aquisicao), 'grupo': self.grupo}


def _chave(cabecalho) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', normalizar(cabecalho)).strip()


def _mapear_colunas(cabecalhos: list) -> dict:
    """{campo: índice da coluna}. Primeiro nome exato, depois 'começa com'."""
    chaves = [_chave(c) for c in cabecalhos]
    mapa = {}
    for campo, nomes in SINONIMOS.items():
        for i, k in enumerate(chaves):
            if k in nomes and i not in mapa.values():
                mapa[campo] = i
                break
    for campo, nomes in SINONIMOS.items():
        if campo in mapa:
            continue
        for i, k in enumerate(chaves):
            if k and i not in mapa.values() and any(k.startswith(n) for n in nomes if len(n) > 4):
                mapa[campo] = i
                break
    return mapa


def _texto(v) -> str:
    if v is None or (isinstance(v, float) and v != v):
        return ''
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    texto = str(v).strip()
    return '' if texto in ('-', 'nan', 'NaT', 'None') else texto


def posicoes_de_tabela(df: pd.DataFrame) -> list:
    """Acha a linha de cabeçalho (nas 40 primeiras) e devolve as posições com emissor e data."""
    linhas = [list(df.columns)] + df.values.tolist()
    for n, linha in enumerate(linhas[:41]):
        mapa = _mapear_colunas(linha)
        if all(c in mapa for c in OBRIGATORIAS) and ('data_emissao' in mapa or 'data_vencimento' in mapa):
            break
    else:
        return []
    posicoes = []
    for i, linha in enumerate(linhas[n + 1:], start=n + 2):
        def col(campo, _l=linha):
            j = mapa.get(campo)
            return _l[j] if j is not None and j < len(_l) else None
        emissor = _texto(col('emissor'))
        valor = para_decimal(col('valor_aplicado'))
        emissao, vencimento = para_data(col('data_emissao')), para_data(col('data_vencimento'))
        if not emissor or valor is None or not (emissao or vencimento):
            continue  # cotas de fundo, caixa, valores a liquidar: fora da conferência
        posicoes.append(Posicao(
            linha=i, codigo=_texto(col('codigo')), ativo=_texto(col('ativo')), emissor=emissor,
            valor_aplicado=valor, valor_presente=para_decimal(col('valor_presente')),
            data_aquisicao=para_data(col('data_aquisicao')), data_emissao=emissao, data_vencimento=vencimento,
            grupo=_texto(col('grupo'))))
    return posicoes


def ler_arquivo(conteudo: bytes, nome: str) -> list:
    """Posições de uma planilha da Britech (formatada pelo hub ou exportada do PAS)."""
    ext = Path(nome).suffix.lower()
    try:
        if ext == '.csv':
            texto = conteudo.decode('utf-8-sig', errors='replace')
            separador = ';' if texto.count(';') > texto.count(',') else ','
            abas = {'csv': pd.read_csv(BytesIO(conteudo), sep=separador, header=None, dtype=str,
                                       encoding='utf-8-sig', encoding_errors='replace')}
        else:
            abas = pd.read_excel(BytesIO(conteudo), sheet_name=None, header=None)
    except Exception as exc:
        raise ValueError(f'Não consegui ler a carteira Britech "{nome}". Envie o Excel exportado do PAS '
                         f'ou o arquivo _BRITECH.xlsx gerado pelo hub. ({str(exc)[:120]})') from exc
    for df in abas.values():
        posicoes = posicoes_de_tabela(df)
        if posicoes:
            return posicoes
    raise ValueError(f'A carteira "{nome}" não tem as colunas esperadas (Emissor, VL Aplic./Vlr. Aquisição, '
                     f'Dt. Emissão, Dt. Vencimento) ou não tem nenhum título com emissor e datas.')


# ---------------------------------------------------------------- arquivo já baixado no Drive

def localizar_arquivo(pasta: Path, cnpj: str, data_base) -> object:
    """Arquivo <id>_<cnpj>_<dd.mm.aaaa>_BRITECH.xlsx da data-base, ou None."""
    if not pasta or not cnpj or not data_base or not pasta.is_dir():
        return None
    alvo = data_base.strftime('%d.%m.%Y')
    subpasta = pasta / alvo
    candidatos = sorted(subpasta.glob(f'*{cnpj}*BRITECH*.xls*')) if subpasta.is_dir() else []
    if not candidatos:
        candidatos = sorted(pasta.glob(f'*{cnpj}*{alvo}*BRITECH*.xls*'))
    return candidatos[0] if candidatos else None


def id_do_nome(caminho) -> str:
    m = re.match(r'(\d+)_\d{14}_', Path(str(caminho)).name)
    return m.group(1) if m else ''


# ---------------------------------------------------------------- API da Britech

_processor = None


def _carregar_processor():
    global _processor
    if _processor is None:
        caminho = config.BRITECH_PROCESSOR_PATH
        if not caminho.is_file():
            raise ValueError('O leitor da Britech do hub (denver_contabifi/carteira_britech/processor.py) não foi '
                             'encontrado. Use a opção "Arquivo da carteira" ou peça ajuda à TI.')
        spec = importlib.util.spec_from_file_location('_bate_carteira_lastro_britech_processor', caminho)
        modulo = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(modulo)
        _processor = modulo
    return _processor


def buscar_api(id_carteira: str, data_base) -> list:
    faltando = config.credenciais_britech_faltando()
    if faltando:
        raise ValueError('Configuração ausente: ' + ', '.join(faltando) +
                         '. Peça para a TI cadastrar (são as mesmas do Gerar Amostras Planner).')
    if not so_digitos(id_carteira):
        raise ValueError('Informe o ID da carteira na Britech (ex.: 52230) ou use a opção "Arquivo da carteira".')
    try:
        df = _carregar_processor().processar_carteira(
            so_digitos(id_carteira), data_base.isoformat(), config.BRITECH_URL_ADM,
            config.BRITECH_USUARIO, config.BRITECH_SENHA)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f'A Britech não devolveu a carteira {id_carteira} em {fmt_data(data_base)}: '
                         f'{str(exc)[:200]}') from exc
    if df is None or len(df) == 0:
        raise ValueError(f'A Britech não tem carteira {id_carteira} em {fmt_data(data_base)}.')
    posicoes = posicoes_de_tabela(df.reset_index(drop=True))
    if not posicoes:
        raise ValueError(f'A carteira {id_carteira} em {fmt_data(data_base)} não tem títulos com emissor e datas.')
    return posicoes


def id_carteira_monday(cnpj: str) -> str:
    """ID da carteira Britech do fundo no board de fundos do Monday (coluna CARTEIRA). Vazio se não achar."""
    if not config.MONDAY_API_TOKEN or len(cnpj) != 14:
        return ''
    cursor = None
    for _ in range(30):
        pagina = f', cursor: "{cursor}"' if cursor else ''
        consulta = (f'{{ boards(ids: {config.MONDAY_BOARD_ID}) {{ items_page(limit: 100{pagina}) {{ cursor '
                    f'items {{ column_values(ids: ["{config.MONDAY_COLUNA_CNPJ}", "{config.MONDAY_COLUNA_CARTEIRA}"])'
                    f' {{ id text }} }} }} }} }}')
        resposta = requests.post('https://api.monday.com/v2', json={'query': consulta}, timeout=30,
                                 headers={'Authorization': config.MONDAY_API_TOKEN,
                                          'Content-Type': 'application/json'})
        resposta.raise_for_status()
        dados = resposta.json()
        pagina_itens = dados['data']['boards'][0]['items_page']
        for item in pagina_itens['items']:
            valores = {c['id']: c.get('text') or '' for c in item.get('column_values', [])}
            if so_digitos(valores.get(config.MONDAY_COLUNA_CNPJ)) == cnpj:
                return so_digitos(valores.get(config.MONDAY_COLUNA_CARTEIRA))
        cursor = pagina_itens.get('cursor')
        if not cursor:
            break
    return ''
