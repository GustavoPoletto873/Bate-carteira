"""Bate Carteira Britech x Lastro — confere VL Aplic., datas de emissão e vencimento e emissor da
carteira Britech contra o workpaper (aba WP_Termo) e os documentos de lastro e termo do fundo.

App interno do SimplificaHub (tipo `django_interno`), setor `nix_auditoria`.
Este arquivo só recebe a requisição, valida a entrada e devolve a resposta; a regra fica em `services/`.
A conferência pode levar alguns minutos (muitos PDFs no Drive): roda numa thread, a tela consulta
`progresso/` e baixa o Excel em `baixar/`.
"""
import importlib
import importlib.util
import json
import sys
import threading
import uuid
from datetime import datetime
from pathlib import Path

from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_http_methods

_DIR = Path(__file__).resolve().parent


def _carregar_services():
    """Importa `services/` sob um nome exclusivo deste app (nunca `from services import ...`)."""
    pacote = '_hub_svc_nix_auditoria_bate_carteira_britech_x_lastro'
    spec = importlib.util.spec_from_file_location(
        pacote, _DIR / 'services' / '__init__.py',
        submodule_search_locations=[str(_DIR / 'services')])
    modulo = importlib.util.module_from_spec(spec)
    sys.modules[pacote] = modulo
    spec.loader.exec_module(modulo)
    nomes = ('config', 'textos', 'documentos', 'workpaper', 'britech', 'conciliacao', 'processamento')
    return {n: importlib.import_module(f'{pacote}.{n}') for n in nomes}


_svc = _carregar_services()
config, processamento = _svc['config'], _svc['processamento']

# ---------------------------------------------------------------- jobs em memória (processo do hub é único)
_lock = threading.Lock()
_jobs: dict = {}
_resultados: dict = {}
_TTL_SEGUNDOS = 3 * 3600
_execucoes = threading.BoundedSemaphore(2)  # no máximo duas conferências lendo o Drive ao mesmo tempo


def _limpar_antigos(d: dict) -> None:
    agora = datetime.now()
    with _lock:
        for k in [k for k, v in d.items() if (agora - v['timestamp']).total_seconds() > _TTL_SEGUNDOS]:
            del d[k]


def _novo_job() -> str:
    _limpar_antigos(_jobs)
    _limpar_antigos(_resultados)
    job_id = str(uuid.uuid4())
    with _lock:
        _jobs[job_id] = {'atual': 0, 'total': 0, 'texto': 'Na fila', 'done': False, 'erro': None,
                         'resultado_id': None, 'timestamp': datetime.now()}
    return job_id


def _atualizar_job(job_id: str, **campos) -> None:
    with _lock:
        if job_id in _jobs:
            _jobs[job_id].update(campos)


def _executar(job_id: str, parametros: dict, arquivo_enviado, usuario: str) -> None:
    _atualizar_job(job_id, texto='Aguardando outra conferência terminar')
    with _execucoes:
        try:
            saida = processamento.executar(
                parametros, arquivo_enviado, usuario=usuario,
                progresso=lambda atual, total, texto: _atualizar_job(job_id, atual=atual, total=total, texto=texto))
            resultado_id = str(uuid.uuid4())
            with _lock:
                _resultados[resultado_id] = {'conteudo': saida['excel'], 'nome_arquivo': saida['nome_arquivo'],
                                             'resultado': saida['resultado'], 'timestamp': datetime.now()}
            _atualizar_job(job_id, done=True, resultado_id=resultado_id)
        except ValueError as exc:  # erro esperado: mensagem pronta para a tela
            _atualizar_job(job_id, done=True, erro=str(exc))
        except Exception as exc:  # inesperado: não derruba o hub, vira mensagem curta
            _atualizar_job(job_id, done=True, erro=f'Erro inesperado na conferência: {str(exc)[:300]}')


# ---------------------------------------------------------------- telas e rotas

def index(request):
    from hub.interno import render_interno
    return render_interno(request, __file__, 'index.html', {
        'workpaper_padrao': config.WORKPAPER_PADRAO,
        'pasta_lastro_padrao': config.PASTA_LASTRO_PADRAO,
        'pasta_carteiras_padrao': config.PASTA_CARTEIRAS_BRITECH_PADRAO,
        'api_configurada': not config.credenciais_britech_faltando(),
        'tolerancia': f'{config.TOLERANCIA_VALOR:.2f}'.replace('.', ','),
        'max_paginas': config.MAX_PAGINAS_PDF,
    })


def _json_body(request) -> dict:
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


@require_http_methods(['POST'])
def api_inspecionar(request):
    """Lê o workpaper e devolve fundo, CNPJ, data-base e a carteira Britech sugerida."""
    dados = _json_body(request)
    try:
        return JsonResponse(processamento.inspecionar(dados.get('workpaper', ''), dados.get('pasta_carteiras', '')))
    except ValueError as exc:
        return JsonResponse({'erro': str(exc)}, status=400)
    except Exception as exc:
        return JsonResponse({'erro': f'Erro ao ler o workpaper: {str(exc)[:200]}'}, status=500)


@require_http_methods(['POST'])
def api_processar(request):
    campos = ('workpaper', 'pasta_lastro', 'data_base', 'origem', 'arquivo_britech', 'pasta_carteiras', 'id_carteira')
    parametros = {c: (request.POST.get(c) or '').strip() for c in campos}
    if parametros['origem'] not in ('arquivo', 'api'):
        parametros['origem'] = 'arquivo'
    for obrigatorio, rotulo in (('workpaper', 'do workpaper'), ('pasta_lastro', 'da pasta de lastro e termo')):
        if not parametros[obrigatorio]:
            return JsonResponse({'erro': f'Informe o caminho {rotulo}.'}, status=400)

    arquivo_enviado = None
    enviado = request.FILES.get('arquivo_carteira')
    if enviado and parametros['origem'] == 'arquivo':
        if not enviado.name.lower().endswith(('.xlsx', '.xls', '.xlsm', '.csv')):
            return JsonResponse({'erro': 'A carteira Britech precisa ser Excel (.xlsx/.xls) ou CSV.'}, status=400)
        if enviado.size > config.TAMANHO_MAXIMO_MB * 1024 * 1024:
            return JsonResponse({'erro': f'Arquivo da carteira acima de {config.TAMANHO_MAXIMO_MB} MB.'}, status=400)
        arquivo_enviado = (enviado.name, enviado.read())  # ler antes da thread: o upload some com a requisição

    usuario = getattr(getattr(request, 'user', None), 'username', '') or ''
    job_id = _novo_job()
    threading.Thread(target=_executar, args=(job_id, parametros, arquivo_enviado, usuario), daemon=True).start()
    return JsonResponse({'job_id': job_id})


@require_http_methods(['GET'])
def api_progresso(request):
    with _lock:
        job = _jobs.get(request.GET.get('job', '').strip())
        job = dict(job) if job else None
        resultado = _resultados.get(job['resultado_id']) if job and job.get('resultado_id') else None
    if not job:
        return JsonResponse({'erro': 'Conferência não encontrada (pode ter expirado). Rode de novo.'}, status=404)
    resposta = {k: job[k] for k in ('atual', 'total', 'texto', 'done', 'erro', 'resultado_id')}
    if resultado:
        resposta['resultado'] = resultado['resultado']
    return JsonResponse(resposta)


@require_http_methods(['GET'])
def api_baixar(request):
    with _lock:
        resultado = _resultados.get(request.GET.get('r', '').strip())
    if not resultado:
        return HttpResponse('Resultado expirado. Rode a conferência de novo.', status=410)
    resposta = HttpResponse(resultado['conteudo'], content_type=config.MIME_XLSX)
    resposta['Content-Disposition'] = f'attachment; filename="{resultado["nome_arquivo"]}"'
    return resposta


URL_ROUTES = {
    'inspecionar/': api_inspecionar,   # POST JSON {workpaper, pasta_carteiras}
    'processar/': api_processar,       # POST form: caminhos, data-base, origem da carteira (+ arquivo opcional)
    'progresso/': api_progresso,       # GET ?job=<id>
    'baixar/': api_baixar,             # GET ?r=<id>
}
