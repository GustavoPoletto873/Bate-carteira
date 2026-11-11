"""Leitura dos documentos de lastro e termo (PDF, HTML das boletas, DOCX, TXT) e extração do que
interessa para a conferência: valores em R$, datas de emissão e vencimento rotuladas, emissores,
números de emissão e CNPJs.

Nada de OCR: PDF escaneado (só imagem) aparece no inventário como "sem texto".
"""
import logging
import re
import threading
import time
import zipfile
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path

from . import config
from .textos import (achar_datas, achar_valores, normalizar_com_mapa, numeros_de_emissao, palavras,
                     so_digitos)

# Rótulos procurados no texto normalizado (minúsculo, sem acento). A data/valor tem que vir logo depois.
ROTULOS_EMISSAO = [r'data\s+(?:de\s+|da\s+)?emissao', r'emitid[ao]s?\s+em']
ROTULOS_VENCIMENTO = [r'data\s+(?:de\s+|do\s+|final\s+de\s+)?vencimento', r'vencimento\s+em',
                      r'vencendo-se,?(?:\s+portanto)?,?\s+em', r'vencimento\s*:', r'data\s+vencto']
# Se entre o rótulo e a data aparecer uma destas palavras, a data é de outro rótulo
# (ex.: "contados da Data de Emissão, vencendo-se, portanto, em 26/03/2031" não é emissão).
CONFLITOS_EMISSAO = ('vencimento', 'vencendo', 'vencto', 'integraliza', 'aquisicao', 'assinatura', 'pagamento')
CONFLITOS_VENCIMENTO = ('emissao', 'integraliza', 'aquisicao', 'assinatura', 'carencia')
ROTULOS_VALOR = [r'valor\s+da\s+aquisicao', r'valor\s+atual\s+do\s+ativo', r'valor\s+a\s+pagar',
                 r'valor\s+em\s+r\$', r'valor\s+total\s+da\s+emissao', r'valor\s+de\s+aquisicao',
                 r'valor\s+aplicado', r'valor\s+da\s+cessao', r'preco\s+de\s+aquisicao']
ROTULOS_EMISSOR = [
    r'emissao,?\s+pela\s+(.{4,90}?),?\s+(?:inscrita|com\s+sede|sociedade)',
    r'emissor\s+\(nome\s+do\s+emissor\)\s+(.{3,90}?)\s+codigo',
    r'contratante/emissora\s+nome\s+(.{3,90}?)\s+cnpj',
    r'nome\s+simplificado\s+do\s+emissor:?\s+(\S{3,30})',
    r'emitente:\s+(.{4,90}?),?\s+(?:inscrita|cnpj|com\s+sede|pessoa)',
    r'(?:securitizadora|emissora)\s*:\s+(.{4,90}?),?\s+(?:inscrita|cnpj|com\s+sede|sociedade)',
]
JANELA_DATA = 70    # caracteres depois do rótulo onde a data precisa aparecer
JANELA_VALOR = 60
TRECHO = 90         # caracteres de contexto mostrados como evidência

_RE_CNPJ = re.compile(r'(?<!\d)\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}(?!\d)')
_RE_GRUPO = re.compile(r'^\d{5}$')


@dataclass
class Achado:
    valor: object           # date, Decimal ou str
    inicio: int
    fim: int
    trecho: str


@dataclass(eq=False)  # comparação por identidade: dois arquivos iguais continuam sendo dois documentos
class Documento:
    nome: str
    caminho: str
    tipo: str
    paginas_lidas: int = 0
    paginas_total: int = 0
    erro: str = ''
    aviso: str = ''         # leitura parcial (PDF longo ou lento)
    texto: str = ''         # original, com espaços simples
    norm: str = ''          # normalizado (minúsculo, sem acento)
    mapa: list = field(default_factory=list)
    palavras: str = ''
    valores: list = field(default_factory=list)            # [Achado(Decimal)]
    valores_rotulados: list = field(default_factory=list)  # [Achado(Decimal)]
    datas: list = field(default_factory=list)              # [Achado(date)] — todas
    datas_emissao: list = field(default_factory=list)      # [Achado(date)]
    datas_vencimento: list = field(default_factory=list)   # [Achado(date)]
    emissores_citados: list = field(default_factory=list)  # [Achado(str)]
    numeros_emissao: set = field(default_factory=set)
    cnpjs: set = field(default_factory=set)
    grupo: str = ''

    @property
    def tem_texto(self) -> bool:
        return len(self.norm) > 40

    def trecho(self, inicio: int, fim: int) -> str:
        """Trecho do texto original em volta da posição (no texto normalizado)."""
        if not self.mapa:
            return ''
        a = self.mapa[max(0, min(inicio, len(self.mapa) - 1))]
        b = self.mapa[max(0, min(fim, len(self.mapa) - 1))]
        ini, fim_o = max(0, a - TRECHO // 2), min(len(self.texto), b + TRECHO // 2)
        return ('…' if ini > 0 else '') + self.texto[ini:fim_o].strip() + ('…' if fim_o < len(self.texto) else '')

    def contem(self, termo_palavras: str) -> bool:
        termo = ' ' + termo_palavras.strip() + ' '
        return len(termo.strip()) > 2 and termo in self.palavras

    def achar(self, termo_palavras: str):
        """Achado com o trecho onde o termo (palavras normalizadas) aparece, ou None."""
        tokens = termo_palavras.split()
        if not tokens or not self.contem(termo_palavras):
            return None
        m = re.search(r'(?<![a-z0-9])' + r'[^a-z0-9]+'.join(map(re.escape, tokens)) + r'(?![a-z0-9])', self.norm)
        if not m:
            return Achado(termo_palavras, 0, 0, '')
        return Achado(termo_palavras, m.start(), m.end(), self.trecho(m.start(), m.end()))


# ---------------------------------------------------------------- leitura dos arquivos

def _texto_pdf(conteudo: bytes) -> tuple:
    """(texto, páginas lidas, total de páginas, aviso). Para cedo em PDF escaneado e em PDF lento demais."""
    import pdfplumber
    logging.getLogger('pdfminer').setLevel(logging.ERROR)  # "Could not get FontBBox..." não interessa
    partes, lidas, aviso = [], 0, ''
    inicio = time.monotonic()
    with pdfplumber.open(BytesIO(conteudo)) as pdf:
        total = len(pdf.pages)
        for i, pagina in enumerate(pdf.pages[:config.MAX_PAGINAS_PDF]):
            try:
                partes.append(pagina.extract_text() or '')
            except Exception:  # página corrompida não derruba o documento
                partes.append('')
            lidas = i + 1
            if lidas == 3 and lidas < total and len(''.join(partes).strip()) < 40:
                break  # três páginas sem texto: é imagem, não adianta continuar
            if time.monotonic() - inicio > config.TEMPO_MAX_PDF and lidas < min(total, config.MAX_PAGINAS_PDF):
                aviso = f'leitura parou na página {lidas} de {total} (PDF lento; limite de {config.TEMPO_MAX_PDF}s)'
                break
    if not aviso and total > lidas and lidas == config.MAX_PAGINAS_PDF:
        aviso = f'lidas as {lidas} primeiras páginas de {total}'
    return '\n'.join(partes), lidas, total, aviso


def _decodificar(conteudo: bytes) -> str:
    for codificacao in ('utf-8', 'cp1252'):
        try:
            return conteudo.decode(codificacao)
        except UnicodeDecodeError:
            continue
    return conteudo.decode('latin-1', errors='replace')


def _texto_html(conteudo: bytes) -> str:
    from bs4 import BeautifulSoup
    texto = _decodificar(conteudo)
    m = re.search(r'charset=["\']?([\w-]+)', texto[:3000], re.I)
    if m and m.group(1).lower() not in ('utf-8', 'utf8'):
        try:
            texto = conteudo.decode(m.group(1))
        except (LookupError, UnicodeDecodeError):
            pass
    sopa = BeautifulSoup(texto, 'lxml')
    for lixo in sopa(['script', 'style', 'noscript']):
        lixo.decompose()
    return sopa.get_text('\n')


def _texto_docx(conteudo: bytes) -> str:
    with zipfile.ZipFile(BytesIO(conteudo)) as z:
        xml = z.read('word/document.xml').decode('utf-8', errors='replace')
    xml = re.sub(r'</w:p>', '\n', xml)
    xml = re.sub(r'<w:tab/>', ' ', xml)
    texto = re.sub(r'<[^>]+>', '', xml)
    return (texto.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
            .replace('&quot;', '"').replace('&apos;', "'"))


def ler_texto(nome: str, conteudo: bytes) -> tuple:
    """(texto, páginas lidas, páginas no arquivo, tipo, aviso). Levanta exceção se não conseguir ler."""
    ext = Path(nome).suffix.lower()
    if ext == '.pdf':
        texto, lidas, total, aviso = _texto_pdf(conteudo)
        return texto, lidas, total, 'PDF', aviso
    if ext in ('.htm', '.html', '.xml'):
        return _texto_html(conteudo), 1, 1, 'HTML', ''
    if ext == '.docx':
        return _texto_docx(conteudo), 1, 1, 'DOCX', ''
    if ext == '.txt':
        return _decodificar(conteudo), 1, 1, 'TXT', ''
    raise ValueError(f'formato {ext or "sem extensão"} não é lido')


# ---------------------------------------------------------------- extração

def _datas_rotuladas(doc: Documento, rotulos: list, datas: list, conflitos: tuple) -> list:
    achados, vistos = [], set()
    for rotulo in rotulos:
        for m in re.finditer(rotulo, doc.norm):
            for ini, fim, d in datas:
                if ini < m.end():
                    continue
                if ini - m.end() > JANELA_DATA:
                    break
                entre = doc.norm[m.end():ini]
                if any(p in entre for p in conflitos):
                    break
                if (ini, d) not in vistos:
                    vistos.add((ini, d))
                    achados.append(Achado(d, m.start(), fim, doc.trecho(m.start(), fim)))
                break
    return achados


def _valores_rotulados(doc: Documento, valores: list) -> list:
    achados, vistos = [], set()
    for rotulo in ROTULOS_VALOR:
        for m in re.finditer(rotulo, doc.norm):
            for ini, fim, v in valores:
                if ini < m.end():
                    continue
                if ini - m.end() > JANELA_VALOR:
                    break
                if ini not in vistos and v > 0:
                    vistos.add(ini)
                    achados.append(Achado(v, m.start(), fim, doc.trecho(m.start(), fim)))
                break
    return achados


def _emissores_citados(doc: Documento) -> list:
    achados, vistos = [], set()
    for rotulo in ROTULOS_EMISSOR:
        for m in re.finditer(rotulo, doc.norm):
            ini, fim = m.span(1)
            nome = doc.texto[doc.mapa[ini]:doc.mapa[fim]].strip(' ,.;:*()"“”')
            chave = palavras(nome)
            if nome and chave not in vistos:
                vistos.add(chave)
                achados.append(Achado(nome, ini, fim, doc.trecho(m.start(), fim)))
    return achados


def _grupo(nome: str) -> str:
    """Número da operação no nome do arquivo (ex.: '789770_12692_TCNC_...' -> '12692')."""
    for parte in re.split(r'[_\-. ]+', nome):
        if _RE_GRUPO.match(parte):
            return parte
    return ''


def analisar(nome: str, caminho: str, texto: str, paginas_lidas: int = 1, paginas_total: int = 1,
             tipo: str = '') -> Documento:
    """Monta o Documento a partir do texto já extraído (função pura: os testes usam direto)."""
    doc = Documento(nome=nome, caminho=caminho, tipo=tipo or Path(nome).suffix.upper().lstrip('.'),
                    paginas_lidas=paginas_lidas, paginas_total=paginas_total)
    doc.norm, doc.texto, doc.mapa = normalizar_com_mapa(texto)
    doc.palavras = palavras(doc.norm)
    doc.grupo = _grupo(nome)
    if not doc.tem_texto:
        doc.erro = 'sem texto (documento escaneado/imagem: não há OCR)' if tipo == 'PDF' else 'sem texto'
        return doc
    valores = achar_valores(doc.norm)
    datas = achar_datas(doc.norm)
    doc.valores = [Achado(v, i, f, '') for i, f, v in valores]
    doc.valores_rotulados = _valores_rotulados(doc, valores)
    doc.datas = [Achado(d, i, f, '') for i, f, d in datas]
    doc.datas_emissao = _datas_rotuladas(doc, ROTULOS_EMISSAO, datas, CONFLITOS_EMISSAO)
    doc.datas_vencimento = _datas_rotuladas(doc, ROTULOS_VENCIMENTO, datas, CONFLITOS_VENCIMENTO)
    doc.emissores_citados = _emissores_citados(doc)
    doc.numeros_emissao = numeros_de_emissao(doc.norm)
    doc.cnpjs = {so_digitos(c) for c in _RE_CNPJ.findall(doc.norm)}
    return doc


# ---------------------------------------------------------------- pasta inteira (com cache)

_cache_lock = threading.Lock()
_cache: dict = {}
_CACHE_MAX = 3000


def _ler_arquivo(caminho: Path) -> Documento:
    info = caminho.stat()
    chave = (str(caminho), info.st_size, int(info.st_mtime))
    with _cache_lock:
        if chave in _cache:
            return _cache[chave]
    try:
        texto, lidas, total, tipo, aviso = ler_texto(caminho.name, caminho.read_bytes())
        doc = analisar(caminho.name, str(caminho), texto, lidas, total, tipo)
        doc.aviso = aviso
    except Exception as exc:  # um arquivo ruim vira linha no inventário, não derruba a conferência
        doc = Documento(nome=caminho.name, caminho=str(caminho), tipo=caminho.suffix.upper().lstrip('.'),
                        erro=f'não foi possível ler: {str(exc)[:150]}')
    with _cache_lock:
        if len(_cache) >= _CACHE_MAX:
            _cache.clear()
        _cache[chave] = doc
    return doc


def listar_arquivos(pasta: Path) -> tuple:
    """(arquivos a ler, arquivos ignorados com motivo). Busca também em subpastas."""
    ler, ignorados = [], []
    for caminho in sorted(pasta.rglob('*')):
        if not caminho.is_file():
            continue
        nome = caminho.name
        ext = caminho.suffix.lower()
        if nome.startswith(('_', '~$', '.')) or ext in config.EXTENSOES_IGNORADAS_EM_SILENCIO:
            continue  # logs do pipeline, temporários do Office
        if ext in config.EXTENSOES_TEXTO:
            ler.append(caminho)
        elif ext in ('.zip', '.7z', '.rar', '.tgz', '.gz', '.tar'):
            ignorados.append((caminho, 'arquivo compactado: descompacte para que os documentos sejam lidos'))
        elif ext in ('.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.gif'):
            ignorados.append((caminho, 'imagem: não há OCR'))
        else:
            ignorados.append((caminho, f'formato {ext or "sem extensão"} não é lido'))
        if len(ler) >= config.MAX_ARQUIVOS:
            break
    return ler, ignorados


def ler_pasta(pasta: Path, progresso=None) -> tuple:
    """Lê todos os documentos da pasta: (documentos, ignorados [(nome, motivo)])."""
    arquivos, ignorados = listar_arquivos(pasta)
    documentos = []
    for i, caminho in enumerate(arquivos, 1):
        if progresso:
            progresso(i, len(arquivos), f'Lendo {caminho.name}')
        documentos.append(_ler_arquivo(caminho))
    return documentos, [(c.name, motivo) for c, motivo in ignorados]
