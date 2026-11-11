"""Utilitários de texto: normalização, datas e valores em formato brasileiro."""
import re
import unicodedata
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

MESES = {'janeiro': 1, 'fevereiro': 2, 'marco': 3, 'abril': 4, 'maio': 5, 'junho': 6, 'julho': 7,
         'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12}
MESES_ABREV = {'jan': 1, 'fev': 2, 'feb': 2, 'mar': 3, 'abr': 4, 'apr': 4, 'mai': 5, 'may': 5, 'jun': 6,
               'jul': 7, 'ago': 8, 'aug': 8, 'set': 9, 'sep': 9, 'out': 10, 'oct': 10, 'nov': 11,
               'dez': 12, 'dec': 12}
ORDINAIS = {'primeira': 1, 'segunda': 2, 'terceira': 3, 'quarta': 4, 'quinta': 5, 'sexta': 6,
            'setima': 7, 'oitava': 8, 'nona': 9, 'decima': 10}

_RE_DATA_NUM = re.compile(r'(?<!\d)(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?!\d)')
_RE_DATA_EXT = re.compile(r'(?<!\d)(\d{1,2})o?\s+de\s+(' + '|'.join(MESES) + r')\s+de\s+(\d{4})(?!\d)')
_RE_DATA_ABREV = re.compile(r'(?<!\d)(\d{1,2})[-/ ](' + '|'.join(MESES_ABREV) + r')[-/ ](\d{4})(?!\d)')
_RE_VALOR = re.compile(r'(?<![\d.,])(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})(?![\d,])')
_SUFIXOS_EMPRESA = {'ltda', 'sa', 's', 'a', 'eireli', 'me', 'epp', 'de', 'da', 'do', 'das', 'dos', 'e', 'em'}


def sem_acento(texto: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFKD', texto) if not unicodedata.combining(c))


def normalizar(texto) -> str:
    """minúsculas, sem acento e com espaços simples."""
    return re.sub(r'\s+', ' ', sem_acento(str(texto or '')).lower()).strip()


def normalizar_com_mapa(texto: str) -> tuple:
    """Como normalizar(), mas devolve também o texto original (com espaços simples) e um mapa
    posição_normalizada -> posição_original, para mostrar o trecho do documento como ele é."""
    original = re.sub(r'\s+', ' ', texto or '').strip()
    partes, mapa = [], []
    for i, c in enumerate(original):
        n = sem_acento(c).lower()
        for ch in n:
            partes.append(ch)
            mapa.append(i)
    mapa.append(len(original))
    return ''.join(partes), original, mapa


def palavras(texto: str) -> str:
    """Texto normalizado só com letras e números separados por um espaço (para buscar nomes)."""
    return ' ' + re.sub(r'[^a-z0-9]+', ' ', normalizar(texto)).strip() + ' '


def nome_essencial(nome: str) -> str:
    """Nome da empresa sem sufixos (LTDA, S.A., EIRELI...) e sem preposições: 'credito estrategico assessoria'."""
    tokens = [t for t in palavras(nome).split() if t not in _SUFIXOS_EMPRESA]
    return ' '.join(tokens)


# ---------------------------------------------------------------- datas

def _montar(d, m, a):
    try:
        return date(int(a), int(m), int(d))
    except (ValueError, TypeError):
        return None


def achar_datas(texto_normalizado: str) -> list:
    """Todas as datas do texto (já normalizado), em ordem: [(posição, date)].
    Aceita 10/06/2026, 10.06.2026, 10-06-2026, '10 de junho de 2026' e '10-jun-2026'."""
    achadas = []
    for m in _RE_DATA_NUM.finditer(texto_normalizado):
        d = _montar(m.group(1), m.group(2), m.group(3))
        if d:
            achadas.append((m.start(), m.end(), d))
    for m in _RE_DATA_EXT.finditer(texto_normalizado):
        d = _montar(m.group(1), MESES[m.group(2)], m.group(3))
        if d:
            achadas.append((m.start(), m.end(), d))
    for m in _RE_DATA_ABREV.finditer(texto_normalizado):
        d = _montar(m.group(1), MESES_ABREV[m.group(2)], m.group(3))
        if d:
            achadas.append((m.start(), m.end(), d))
    return sorted(achadas)


def para_data(valor):
    """Converte célula/str em date. Aceita datetime, '10/06/2026', '2026-06-10', '10-jun-2026'. None se vazio."""
    if valor is None:
        return None
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    if hasattr(valor, 'to_pydatetime'):  # pandas.Timestamp
        try:
            return valor.to_pydatetime().date()
        except (ValueError, OverflowError):
            return None
    texto = str(valor).strip()
    if not texto or texto in ('-', 'nan', 'NaT', 'None'):
        return None
    m = re.fullmatch(r'(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?', texto)
    if m:
        return _montar(m.group(3), m.group(2), m.group(1))
    achadas = achar_datas(normalizar(texto))
    return achadas[0][2] if achadas else None


def fmt_data(d) -> str:
    return d.strftime('%d/%m/%Y') if d else ''


# ---------------------------------------------------------------- valores

def achar_valores(texto_normalizado: str) -> list:
    """Valores no formato brasileiro (1.234.567,89 ou 1234567,89): [(início, fim, Decimal)]."""
    achados = []
    for m in _RE_VALOR.finditer(texto_normalizado):
        try:
            achados.append((m.start(), m.end(), Decimal(m.group(1).replace('.', '') + '.' + m.group(2))))
        except InvalidOperation:
            continue
    return achados


def para_decimal(valor):
    """Converte célula em Decimal com 2 casas. Aceita número ou texto '1.234,56'. None se vazio."""
    if valor is None:
        return None
    if isinstance(valor, (int, float)):
        if valor != valor:  # NaN
            return None
        return Decimal(str(round(float(valor), 2)))
    texto = str(valor).strip().replace('R$', '').strip()
    if not texto or texto in ('-', 'nan'):
        return None
    if ',' in texto:
        texto = texto.replace('.', '').replace(',', '.')
    try:
        return Decimal(texto).quantize(Decimal('0.01'))
    except InvalidOperation:
        return None


def fmt_valor(v) -> str:
    if v is None:
        return ''
    return f'{Decimal(v):,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')


# ---------------------------------------------------------------- emissão

def numeros_de_emissao(texto_normalizado: str) -> set:
    """Números de emissão citados: '2a (segunda) emissao', '70a emissao', 'emissao segunda'."""
    numeros = set()
    for m in re.finditer(r'(?<!\d)(\d{1,3})\s*[ao]\s*(?:\(\s*[a-z]+\s*\)\s*)?emissao', texto_normalizado):
        numeros.add(int(m.group(1)))
    for m in re.finditer(r'emissao:?\s+(' + '|'.join(ORDINAIS) + r')\b', texto_normalizado):
        numeros.add(ORDINAIS[m.group(1)])
    return numeros


def numero_emissao_britech(descricao: str):
    """'NC_CREDITO ESTRATEGICO 2E   Vcto: ...' -> 2. None se a descrição não traz."""
    m = re.search(r'[_\s](\d{1,3})\s*E\b', str(descricao or ''))
    return int(m.group(1)) if m else None


def codigo_britech(descricao: str) -> str:
    """Primeiro 'código' da descrição do ativo (ex.: '26C4044095' de um CRI). Vazio se não houver."""
    primeiro = str(descricao or '').strip().split(' ')[0] if descricao else ''
    if len(primeiro) >= 8 and re.search(r'\d', primeiro) and re.search(r'[A-Za-z]', primeiro) and '_' not in primeiro:
        return primeiro.lower()
    return ''


def so_digitos(texto) -> str:
    return re.sub(r'\D', '', str(texto or ''))
