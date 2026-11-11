"""Orquestra a conferência: valida os caminhos, lê workpaper, carteira Britech e documentos,
confere e monta o Excel. Sem request/HttpResponse aqui (isso é do views.py)."""
import io
import os
from datetime import datetime
from pathlib import Path

from . import britech, conciliacao, config, documentos, workpaper
from .textos import fmt_data, para_data


# ---------------------------------------------------------------- caminhos digitados na tela

def caminho_permitido(texto: str, tipo: str, rotulo: str) -> Path:
    """Valida um caminho vindo da tela. tipo: 'arquivo' ou 'pasta'. Levanta ValueError com mensagem clara."""
    texto = (texto or '').strip().strip('"').strip("'").strip()
    if not texto:
        raise ValueError(f'Informe o caminho {rotulo}.')
    caminho = Path(os.path.abspath(texto))
    dentro = any(os.path.normcase(str(caminho)).startswith(os.path.normcase(os.path.abspath(str(r))))
                 for r in config.RAIZES_PERMITIDAS)
    if not dentro:
        raizes = ', '.join(str(r) for r in config.RAIZES_PERMITIDAS)
        raise ValueError(f'O caminho {rotulo} precisa estar no Drive ({raizes}).')
    if tipo == 'pasta' and not caminho.is_dir():
        raise ValueError(f'Pasta não encontrada: {caminho}. Confira o caminho {rotulo} '
                         f'e se o Drive (G:) está conectado.')
    if tipo == 'arquivo' and not caminho.is_file():
        raise ValueError(f'Arquivo não encontrado: {caminho}. Confira o caminho {rotulo} '
                         f'e se o Drive (G:) está conectado.')
    return caminho


def inspecionar(caminho_wp: str, pasta_carteiras: str = '') -> dict:
    """Lê o workpaper e sugere a carteira Britech já baixada (para preencher a tela)."""
    wp_path = caminho_permitido(caminho_wp, 'arquivo', 'do workpaper')
    wp = workpaper.ler_workpaper(wp_path.read_bytes(), wp_path.name)
    resumo = wp.resumo()
    sugestao, id_carteira = '', ''
    try:
        pasta = caminho_permitido(pasta_carteiras or config.PASTA_CARTEIRAS_BRITECH_PADRAO, 'pasta',
                                  'das carteiras Britech')
        achado = britech.localizar_arquivo(pasta, wp.cnpj, wp.data_base)
        if achado:
            sugestao, id_carteira = str(achado), britech.id_do_nome(achado)
    except ValueError:
        pass
    resumo.update({'arquivo_britech_sugerido': sugestao, 'id_carteira': id_carteira})
    return resumo


# ---------------------------------------------------------------- execução completa

def executar(parametros: dict, arquivo_enviado: tuple = None, progresso=None, usuario: str = '') -> dict:
    """parametros: workpaper, pasta_lastro, data_base (aaaa-mm-dd), origem ('arquivo' | 'api'),
    arquivo_britech (caminho), pasta_carteiras, id_carteira. arquivo_enviado: (nome, bytes) ou None.
    Devolve {'resultado': dict para a tela, 'excel': bytes, 'nome_arquivo': str}."""
    def passo(atual, total, texto):
        if progresso:
            progresso(atual, total, texto)

    passo(0, 1, 'Lendo o workpaper')
    wp_path = caminho_permitido(parametros.get('workpaper'), 'arquivo', 'do workpaper')
    pasta_lastro = caminho_permitido(parametros.get('pasta_lastro'), 'pasta', 'da pasta de lastro e termo')
    wp = workpaper.ler_workpaper(wp_path.read_bytes(), wp_path.name)
    data_base = para_data(parametros.get('data_base')) or wp.data_base
    if not data_base:
        raise ValueError('Informe a data-base (não consegui descobrir pelo workpaper).')

    passo(0, 1, 'Buscando a carteira Britech')
    origem = parametros.get('origem') or 'arquivo'
    avisos = []
    if origem == 'api':
        id_carteira = (parametros.get('id_carteira') or '').strip()
        if not id_carteira:
            achado = britech.localizar_arquivo(Path(config.PASTA_CARTEIRAS_BRITECH_PADRAO), wp.cnpj, data_base)
            id_carteira = britech.id_do_nome(achado) if achado else ''
        if not id_carteira:
            try:
                id_carteira = britech.id_carteira_monday(wp.cnpj)
            except Exception as exc:  # Monday fora do ar: segue com a mensagem pedindo o ID
                avisos.append(f'Não consegui consultar o Monday para achar o ID da carteira ({str(exc)[:100]}).')
        posicoes = britech.buscar_api(id_carteira, data_base)
        fonte_britech = f'API Britech ({config.BRITECH_URL_ADM}) — carteira {id_carteira} em {fmt_data(data_base)}'
    elif arquivo_enviado:
        nome, conteudo = arquivo_enviado
        posicoes = britech.ler_arquivo(conteudo, nome)
        fonte_britech = f'Arquivo enviado: {nome}'
    else:
        caminho = (parametros.get('arquivo_britech') or '').strip()
        if not caminho:
            pasta = caminho_permitido(parametros.get('pasta_carteiras') or config.PASTA_CARTEIRAS_BRITECH_PADRAO,
                                      'pasta', 'das carteiras Britech')
            achado = britech.localizar_arquivo(pasta, wp.cnpj, data_base)
            if not achado:
                raise ValueError(f'Não achei a carteira Britech do CNPJ {wp.cnpj} em {fmt_data(data_base)} '
                                 f'na pasta {pasta}. Informe o arquivo, envie a exportação do PAS ou use a API.')
            caminho = str(achado)
        arquivo = caminho_permitido(caminho, 'arquivo', 'da carteira Britech')
        posicoes = britech.ler_arquivo(arquivo.read_bytes(), arquivo.name)
        fonte_britech = f'Arquivo: {arquivo}'

    docs, ignorados = documentos.ler_pasta(pasta_lastro, progresso=lambda a, t, x: passo(a, t, x))
    if not docs:
        avisos.append('A pasta de lastro e termo não tem documentos legíveis (PDF, HTML, DOCX ou TXT).')

    passo(1, 1, 'Conferindo')
    conferencia = conciliacao.conferir(posicoes, wp.linhas, docs, wp.cnpj)
    sem_texto = [d for d in docs if d.erro]
    resumo = {
        'fundo': wp.fundo, 'cnpj': wp.cnpj, 'data_base': fmt_data(data_base), 'fonte_britech': fonte_britech,
        'workpaper': str(wp_path), 'pasta_lastro': str(pasta_lastro), 'posicoes_britech': len(posicoes),
        'linhas_wp_termo': len(wp.linhas), 'documentos_lidos': len(docs) - len(sem_texto),
        'documentos_sem_texto': len(sem_texto), 'arquivos_ignorados': len(ignorados),
        'contagem': conferencia['contagem'], 'gerado_em': datetime.now().strftime('%d/%m/%Y %H:%M'),
        'usuario': usuario, 'tolerancia': config.TOLERANCIA_VALOR,
    }
    resultado = {'resumo': resumo, 'linhas': conferencia['linhas'], 'documentos': conferencia['documentos'],
                 'ignorados': [{'nome': n, 'motivo': m} for n, m in ignorados], 'avisos': avisos}
    nome = f'Bate_Carteira_Lastro_{wp.cnpj or "fundo"}_{data_base:%Y%m%d}.xlsx'
    return {'resultado': resultado, 'excel': gerar_excel(resultado), 'nome_arquivo': nome}


# ---------------------------------------------------------------- Excel

_CORES = {'Confere': 'C6EFCE', 'OK': 'C6EFCE', 'Diverge': 'FFC7CE', 'Divergente': 'FFC7CE', 'Só no WP': 'FFC7CE',
          'Verificar': 'FFEB9C', 'Não localizado': 'EDEDED', 'Sem documentos': 'EDEDED'}


def _aba(wb, titulo: str, cabecalho: list, linhas: list, larguras: dict = None, colunas_status=()):
    from openpyxl.styles import Alignment, Font, PatternFill
    ws = wb.create_sheet(titulo)
    ws.append(cabecalho)
    for c in ws[1]:
        c.font = Font(bold=True, color='FFFFFF')
        c.fill = PatternFill('solid', fgColor='1F4E78')
        c.alignment = Alignment(wrap_text=True, vertical='center')
    for linha in linhas:
        ws.append(linha)
    indices = [cabecalho.index(c) + 1 for c in colunas_status if c in cabecalho]
    for row in ws.iter_rows(min_row=2):
        for idx in indices:
            cel = row[idx - 1]
            cor = _CORES.get(str(cel.value or ''))
            if cor:
                cel.fill = PatternFill('solid', fgColor=cor)
    for i, nome in enumerate(cabecalho, 1):
        letra = ws.cell(row=1, column=i).column_letter
        ws.column_dimensions[letra].width = (larguras or {}).get(nome, min(max(len(nome) + 2, 12), 40))
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions
    return ws


def gerar_excel(resultado: dict) -> bytes:
    from openpyxl import Workbook
    wb = Workbook()
    wb.remove(wb.active)
    r = resultado['resumo']

    cab = ['Situação', 'Ativo', 'Emissor (Britech)', 'Cód. Britech', 'Dt. Aquisição',
           'VL Aplic. Britech', 'VL Aplic. WP', 'VL Aplic. WP x Britech', 'VL Aplic. documentos', 'VL Aplic. docs',
           'Dt. Emissão Britech', 'Dt. Emissão WP', 'Dt. Emissão WP x Britech', 'Dt. Emissão documentos',
           'Dt. Emissão docs',
           'Dt. Vencimento Britech', 'Dt. Vencimento WP', 'Dt. Vencimento WP x Britech', 'Dt. Vencimento documentos',
           'Dt. Vencimento docs',
           'Emissor nos documentos', 'Emissor docs', 'No WP_Termo', 'Linha WP', 'Documentos usados', 'Observações']
    linhas = []
    for ln in resultado['linhas']:
        c = ln['campos']
        fontes = []
        for campo in c.values():
            fontes.extend(campo['fontes'])
        notas = [f'{rot}: {c[k]["nota"]}' for k, rot in conciliacao.CAMPOS if c[k]['nota']]
        linhas.append([
            ln['situacao'], ln['ativo'], ln['emissor'], ln['codigo'], ln['data_aquisicao'],
            c['valor']['britech'], c['valor']['wp'], c['valor']['wp_status'], c['valor']['documentos'],
            c['valor']['status'],
            c['emissao']['britech'], c['emissao']['wp'], c['emissao']['wp_status'], c['emissao']['documentos'],
            c['emissao']['status'],
            c['vencimento']['britech'], c['vencimento']['wp'], c['vencimento']['wp_status'],
            c['vencimento']['documentos'], c['vencimento']['status'],
            c['emissor']['documentos'], c['emissor']['status'], 'Sim' if ln['no_wp'] else 'Não',
            ln['wp_linha'] or '', ' | '.join(conciliacao._unicos(fontes)), '\n'.join(notas)])
    status = ['Situação', 'VL Aplic. WP x Britech', 'VL Aplic. docs', 'Dt. Emissão WP x Britech', 'Dt. Emissão docs',
              'Dt. Vencimento WP x Britech', 'Dt. Vencimento docs', 'Emissor docs']
    _aba(wb, 'Conciliação', cab, linhas, {'Ativo': 45, 'Emissor (Britech)': 36, 'Documentos usados': 60,
                                          'Observações': 70, 'Emissor nos documentos': 36}, status)

    evid = []
    for ln in resultado['linhas']:
        for e in ln['evidencias']:
            rotulo = dict(conciliacao.CAMPOS).get(e['campo'], e['campo'])
            evid.append([ln['ativo'], ln['valor_aplicado'], rotulo, e['valor'], 'Confere' if e['confere'] else 'Diverge',
                         e['nivel'], e['documento'], e['trecho']])
    _aba(wb, 'Evidências', ['Ativo', 'VL Aplic. Britech', 'Campo', 'Encontrado no documento', 'x Britech',
                            'Ligação com a posição', 'Documento', 'Trecho do documento'], evid,
         {'Ativo': 45, 'Documento': 55, 'Trecho do documento': 110}, ['x Britech'])

    docs = [[d['nome'], d['tipo'], d['paginas'], 'Sim' if d['cita_cnpj_fundo'] else 'Não',
             '\n'.join(d['vinculos']), d['observacao']] for d in resultado['documentos']]
    docs += [[i['nome'], '', '', '', '', i['motivo']] for i in resultado['ignorados']]
    _aba(wb, 'Documentos', ['Arquivo', 'Tipo', 'Páginas lidas', 'Cita o CNPJ do fundo', 'Ligado a', 'Observação'],
         docs, {'Arquivo': 60, 'Ligado a': 70, 'Observação': 50})

    params = [['Fundo', r['fundo']], ['CNPJ', r['cnpj']], ['Data-base', r['data_base']],
              ['Carteira Britech', r['fonte_britech']], ['Workpaper', r['workpaper']],
              ['Pasta de lastro e termo', r['pasta_lastro']], ['Posições da Britech conferidas', r['posicoes_britech']],
              ['Linhas na WP_Termo', r['linhas_wp_termo']], ['Documentos lidos', r['documentos_lidos']],
              ['Documentos sem texto', r['documentos_sem_texto']], ['Arquivos não lidos', r['arquivos_ignorados']],
              ['Tolerância de valor (R$)', r['tolerancia']], ['Gerado em', r['gerado_em']],
              ['Gerado por', r['usuario']]]
    params += [['Aviso', a] for a in resultado['avisos']]
    _aba(wb, 'Parâmetros', ['Item', 'Valor'], params, {'Item': 32, 'Valor': 110})

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
