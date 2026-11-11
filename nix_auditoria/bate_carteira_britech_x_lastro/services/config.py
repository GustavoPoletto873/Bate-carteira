"""Configuração do Bate Carteira Britech x Lastro.

Tudo que muda entre ambientes ou é segredo vem de variável de ambiente.
- Segredos: SEM valor padrão. O app reaproveita as credenciais da Britech da
  Planner (ambiente "delta") que o hub já usa no Gerar_Amostras_Planner
  (CARTEIRABRITECH_PLANNER_USER / _SENHA) e o MONDAY_API_TOKEN.
- Pastas do Drive (G:): valor padrão com o caminho real, sempre sobrescrevível
  por variável de ambiente. Na tela, a pessoa também pode trocar cada caminho.
Nenhum outro arquivo do app deve ter caminho do G: ou segredo escrito no código.
"""
import os
from pathlib import Path

_PREFIXO = 'BATE_CARTEIRA_BRITECH_X_LASTRO_'


def _env(nome: str, padrao: str = '') -> str:
    return os.environ.get(_PREFIXO + nome, padrao)


# ---------------------------------------------------------------- caminhos padrão (a tela permite trocar)
_BASE_PLANNER = os.environ.get(_PREFIXO + 'BASE_PLANNER', r'G:\Drives compartilhados\Auditoria de Lastro – 1º Semestre – 2026\2T2026\PLANNER')  # noqa: E501

WORKPAPER_PADRAO = _env(
    'WORKPAPER', _BASE_PLANNER + r'\_Workpapers\WPS\WP_BNVT ORIGEM FIDC RESP. LTDA._62169240000171.xlsm')
PASTA_LASTRO_PADRAO = _env('PASTA_LASTRO', _BASE_PLANNER + r'\Lastro e Termo\BNVT ORIGEM')
# Onde o Gerar_Amostras_Planner grava as carteiras Britech já formatadas:
# <pasta>\<dd.mm.aaaa>\<id carteira>_<cnpj>_<dd.mm.aaaa>_BRITECH.xlsx
PASTA_CARTEIRAS_BRITECH_PADRAO = _env('PASTA_CARTEIRAS', _BASE_PLANNER + r'\_Carteiras\FORMATADA')

# Só caminhos dentro destas raízes podem ser lidos (separe várias com ";").
# Evita que um caminho digitado na tela leia arquivos do servidor fora do Drive.
RAIZES_PERMITIDAS = [Path(r) for r in os.environ.get(_PREFIXO + 'RAIZES', 'G:\\').split(';') if r.strip()]

# ---------------------------------------------------------------- Britech (API)
BRITECH_URL_ADM = _env('BRITECH_URL_ADM', 'delta')  # Britech da Planner: https://delta.britech.com.br
BRITECH_USUARIO = os.environ.get('CARTEIRABRITECH_PLANNER_USER', '')    # segredo (já existe no deploy)
BRITECH_SENHA = os.environ.get('CARTEIRABRITECH_PLANNER_SENHA', '')     # segredo (já existe no deploy)
# Leitor oficial do relatório "Composição da Carteira" que outros apps do hub já usam.
BRITECH_PROCESSOR_PATH = Path(_env(
    'BRITECH_PROCESSOR',
    str(Path(__file__).resolve().parents[3] / 'denver_contabifi' / 'carteira_britech' / 'processor.py')))

# ---------------------------------------------------------------- Monday (descobrir o ID da carteira pelo CNPJ)
MONDAY_API_TOKEN = os.environ.get('MONDAY_API_TOKEN', '')  # segredo (já existe no deploy)
MONDAY_BOARD_ID = 18383318194          # board de fundos usado pelo Gerar_Amostras_Planner
MONDAY_COLUNA_CNPJ = 'text_mkxtans5'
MONDAY_COLUNA_CARTEIRA = 'text_mkxt6exv'

# ---------------------------------------------------------------- regras da conferência
TOLERANCIA_VALOR = float(_env('TOLERANCIA_VALOR', '0.01'))  # R$: diferença aceita entre valores
MAX_PAGINAS_PDF = int(_env('MAX_PAGINAS_PDF', '40'))         # PDFs longos: lê só as primeiras páginas
TEMPO_MAX_PDF = int(_env('TEMPO_MAX_PDF', '8'))              # segundos por PDF (PDF pesado não trava a fila)
MAX_ARQUIVOS = 1500                                          # limite de arquivos lidos por pasta
EXTENSOES_TEXTO = ('.pdf', '.htm', '.html', '.docx', '.txt', '.xml')
EXTENSOES_IGNORADAS_EM_SILENCIO = ('.jsonl', '.ini', '.db', '.tmp', '.lnk')

TAMANHO_MAXIMO_MB = 30  # arquivo de carteira enviado pela tela
MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


def credenciais_britech_faltando() -> list:
    faltando = []
    if not BRITECH_USUARIO:
        faltando.append('CARTEIRABRITECH_PLANNER_USER')
    if not BRITECH_SENHA:
        faltando.append('CARTEIRABRITECH_PLANNER_SENHA')
    return faltando
