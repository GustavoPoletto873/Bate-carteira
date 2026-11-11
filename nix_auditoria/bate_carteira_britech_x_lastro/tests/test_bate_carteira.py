"""Testes offline do Bate Carteira Britech x Lastro (sem rede, sem Drive, sem hub rodando).
Todos os dados são fictícios.

Rodar: python -m pytest hub/apps/nix_auditoria/bate_carteira_britech_x_lastro/tests -q
"""
import importlib
import importlib.util
import io
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

import pandas as pd
import pytest

_SERVICES = Path(__file__).resolve().parent.parent / 'services'
_PACOTE = '_hub_svc_nix_auditoria_bate_carteira_britech_x_lastro_testes'


def _svc(nome):
    """Carrega um módulo de services/ com nome exclusivo (mesmo padrão do views.py)."""
    if _PACOTE not in sys.modules:
        spec = importlib.util.spec_from_file_location(
            _PACOTE, _SERVICES / '__init__.py', submodule_search_locations=[str(_SERVICES)])
        modulo = importlib.util.module_from_spec(spec)
        sys.modules[_PACOTE] = modulo
        spec.loader.exec_module(modulo)
    return importlib.import_module(f'{_PACOTE}.{nome}')


CNPJ_FUNDO = '11222333000181'

BOLETIM = """BOLETIM DE SUBSCRIÇÃO DAS NOTAS COMERCIAIS
BOLETIM DE SUBSCRIÇÃO DA 2ª (SEGUNDA) EMISSÃO DE NOTAS COMERCIAIS, EM SÉRIE ÚNICA, DA ALFA FOMENTO LTDA
Emissão, pela ALFA FOMENTO LTDA, inscrita no CNPJ/MF sob o nº 44.555.666/0001-77, com sede na Rua X,
de 500.000 notas comerciais, com valor nominal unitário de R$ 1,00, vencimento em 15 DE MARÇO DE 2029,
parcelada em 1 parcela. Razão Social FUNDO TESTE FIDC CNPJ: 11.222.333/0001-81
NOTAS COMERCIAIS SUBSCRITAS QUANTIDADE PREÇO UNITÁRIO VALOR EM R$ 500.000 R$ 1,00 500.000,55
São Paulo, 20 de março de 2026"""

TERMO = """CONDIÇÕES NEGOCIAIS DO INSTRUMENTO PARTICULAR
CONTRATANTE/EMISSORA Nome ALFA FOMENTO LTDA CNPJ 44.555.666/0001-77
DADOS DO ATIVO Natureza do Ativo Nota Comercial Série Única Emissão SEGUNDA
Data de Emissão 10 de março de 2026 Data de Vencimento 15 DE MARÇO DE 2029"""

TERMO_CRI = """3.6. Data de Emissão dos CRI. A data de emissão dos CRI será 17 de março de 2026 ("Data de Emissão").
3.8. Prazo: 1.835 dias corridos contados da Data de Emissão, vencendo-se, portanto, em 26 de março de 2031
("Data de Vencimento dos CRI"). Código IF 26X1234567"""

BOLETA_HTML = """<html><body><table>
<tr><td>Emissor (Nome do Emissor)</td><td>BETA SECURITIZADORA S.A.</td></tr>
<tr><td>Código Sinacor (Código do Emissor):</td><td></td></tr>
<tr><td>Data de Aquisição (Data de Compra)</td><td>09/04/2026 00:00:00</td></tr>
<tr><td>Valor Atual do Ativo</td><td>2.000.000,00</td></tr>
</table></body></html>"""


# ---------------------------------------------------------------- textos

def test_datas_em_varios_formatos():
    t = _svc('textos')
    achadas = [d for _, _, d in t.achar_datas(t.normalizar('10/06/2026, 11 DE JUNHO DE 2029 e 26-mar-2031'))]
    assert achadas == [date(2026, 6, 10), date(2029, 6, 11), date(2031, 3, 26)]
    assert t.para_data('10-jun-2029') == date(2029, 6, 10)
    assert t.para_data('2026-06-30') == date(2026, 6, 30)
    assert t.para_data('-') is None


def test_valores_brasileiros_e_nome_essencial():
    t = _svc('textos')
    valores = [v for _, _, v in t.achar_valores(t.normalizar('R$ 1.453.004,29 e 2005653,00 e 1,00278124 e 17,47%'))]
    assert Decimal('1453004.29') in valores and Decimal('2005653.00') in valores
    assert Decimal('1.00') not in valores  # PU com 8 casas não vira R$ 1,00
    assert t.para_decimal(72035386.6) == Decimal('72035386.60')
    assert t.nome_essencial('CRÉDITO ESTRATÉGICO ASSESSORIA LTDA') == 'credito estrategico assessoria'
    assert t.numero_emissao_britech('NC_ALFA 2E   Vcto: 15032029 > IPCA') == 2
    assert t.codigo_britech('26X1234567   Vcto: 26032031 > 100% CDI') == '26x1234567'


# ---------------------------------------------------------------- documentos

def test_boletim_extrai_vencimento_valor_e_emissor():
    d = _svc('documentos').analisar('12345_BS_ALFA.pdf', '', BOLETIM, tipo='PDF')
    assert [a.valor for a in d.datas_vencimento] == [date(2029, 3, 15)]
    assert d.datas_emissao == []
    assert Decimal('500000.55') in [a.valor for a in d.valores]
    assert d.emissores_citados[0].valor == 'ALFA FOMENTO LTDA'
    assert d.numeros_emissao == {2}
    assert d.grupo == '12345'
    assert CNPJ_FUNDO in d.cnpjs


def test_data_de_outro_rotulo_nao_vira_emissao():
    d = _svc('documentos').analisar('termo_cri.pdf', '', TERMO_CRI, tipo='PDF')
    assert [a.valor for a in d.datas_emissao] == [date(2026, 3, 17)]
    assert [a.valor for a in d.datas_vencimento] == [date(2031, 3, 26)]
    assert 'vencendo-se' in d.datas_vencimento[0].trecho


def test_boleta_html_e_pdf_escaneado():
    doc = _svc('documentos')
    texto = doc.ler_texto('OCABoleta_1.htm', BOLETA_HTML.encode('cp1252'))[0]
    d = doc.analisar('OCABoleta_1.htm', '', texto, tipo='HTML')
    assert d.emissores_citados[0].valor == 'BETA SECURITIZADORA S.A'  # pontuação das pontas é removida
    assert Decimal('2000000.00') in [a.valor for a in d.valores_rotulados]
    vazio = doc.analisar('scan.pdf', '', '   ', tipo='PDF')
    assert 'escaneado' in vazio.erro


# ---------------------------------------------------------------- carteira Britech

def _xlsx(df: pd.DataFrame, **kwargs) -> bytes:
    buffer = io.BytesIO()
    df.to_excel(buffer, index=False, **kwargs)
    return buffer.getvalue()


def _carteira_formatada() -> pd.DataFrame:
    return pd.DataFrame({
        'Data Base': ['30-jun-2026'] * 5, 'Carteira': [999] * 5,
        'Cód': [None, 111.0, 222.0, 333.0, None],
        'Ativo': ['FUNDO X SENIOR', 'NC_ALFA 2E   Vcto: 15032029 > IPCA + 10%', 'NC_GAMA_1E   Vcto: 01012030',
                  '26X1234567   Vcto: 26032031 > 100% CDI', 'Taxa de Gestão'],
        'Emissor': ['GESTORA Y', 'ALFA FOMENTO LTDA', 'GAMA PARTICIPACOES', 'BETA SECURITIZADORA S.A.', None],
        'Vlr. Aquisição': [100.0, 500000.55, 1000.0, 2000000.0, None],
        'Vlr. Presente': [110.0, 510000.0, 1010.0, 2010000.0, -50.0],
        'Dt. Aquisição': [None, '20-mar-2026', '01-abr-2026', '09-abr-2026', None],
        'Dt. Emissão': [None, '10-mar-2026', '01-dez-2025', '17-mar-2026', '30-jun-2026'],
        'Dt. Vencimento': [None, '14-mar-2029', '01-jan-2030', '26-mar-2031', '07-jul-2026'],
        'e-Financeira': ['FIDC', 'Nota Comercial', 'Nota Comercial', 'CRI', 'Valores a Liquidar'],
    })


def test_le_carteira_formatada_pelo_hub():
    posicoes = _svc('britech').ler_arquivo(_xlsx(_carteira_formatada()), '999_x_BRITECH.xlsx')
    assert [p.emissor for p in posicoes] == ['ALFA FOMENTO LTDA', 'GAMA PARTICIPACOES', 'BETA SECURITIZADORA S.A.']
    alfa = posicoes[0]
    assert alfa.codigo == '111' and alfa.valor_aplicado == Decimal('500000.55')
    assert alfa.data_emissao == date(2026, 3, 10) and alfa.data_vencimento == date(2029, 3, 14)


def test_le_exportacao_do_pas_com_cabecalho_no_meio():
    df = pd.DataFrame([['Carteira: FUNDO TESTE', None, None, None, None], [None] * 5,
                       ['Título', 'Emissor', 'VL Aplic.', 'Dt. Emissão', 'Dt. Vencto'],
                       ['NC ALFA', 'ALFA FOMENTO LTDA', '500.000,55', '10/03/2026', '14/03/2029']])
    posicoes = _svc('britech').ler_arquivo(_xlsx(df, header=False), 'export_pas.xlsx')
    assert len(posicoes) == 1 and posicoes[0].valor_aplicado == Decimal('500000.55')
    assert posicoes[0].data_vencimento == date(2029, 3, 14)


def test_carteira_sem_colunas_da_erro_amigavel():
    with pytest.raises(ValueError, match='não tem as colunas esperadas'):
        _svc('britech').ler_arquivo(_xlsx(pd.DataFrame({'a': [1]})), 'errada.xlsx')


def test_api_sem_credencial_pede_para_a_ti(monkeypatch):
    cfg = _svc('config')
    monkeypatch.setattr(cfg, 'BRITECH_USUARIO', '')
    monkeypatch.setattr(cfg, 'BRITECH_SENHA', '')
    with pytest.raises(ValueError, match='Peça para a TI'):
        _svc('britech').buscar_api('999', date(2026, 6, 30))


# ---------------------------------------------------------------- workpaper

def _workpaper_bytes() -> bytes:
    from openpyxl import Workbook
    wb = Workbook()
    resumo = wb.active
    resumo.title = 'Resumo_BateLastro'
    resumo['A1'] = 'RESULTADOS MATCHING - FUNDO TESTE FIDC - 30/06/2026'
    ws = wb.create_sheet('WP_Termo')
    ws['A1'] = 'DADOS TERMO'
    ws.append([])
    ws.append(['ID_BASE', 'STATUS', 'BASE_NUMERO_DOC', 'BASE_NOME_SACADO', 'BASE_NOME_CEDENTE', 'BASE_NOME_FUNDO',
               'BASE_CNPJ_FUNDO', 'BASE_VALOR_NOMINAL', 'BASE_VALOR_AQUISICAO', 'BASE_DATA_EMISSAO',
               'BASE_DATA_VENCIMENTO', 'BASE_DATA_AQUISICAO', 'BASE_TIPO_RECEBIVEL'])
    ws.append([1, 'P', '111', '-', '-', 'FUNDO TESTE FIDC', '11.222.333/0001-81', 510000.0, 500000.55,
               '10/03/2026', '14/03/2029', '20/03/2026', 'NC_ALFA 2E   Vcto: 15032029'])
    ws.append([2, 'P', '333', '-', '-', 'FUNDO TESTE FIDC', '11.222.333/0001-81', 2010000.0, 2000000.0,
               '17/03/2026', '26/03/2031', None, '26X1234567   Vcto: 26032031'])
    ws.append([3, 'P', '444', '-', '-', 'FUNDO TESTE FIDC', '11.222.333/0001-81', 9.0, 9999.99,
               '01/01/2026', '01/01/2027', None, 'ITEM SÓ NO WP'])
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def test_le_wp_termo():
    wp = _svc('workpaper').ler_workpaper(_workpaper_bytes(), f'WP_FUNDO TESTE_{CNPJ_FUNDO}.xlsm')
    assert wp.cnpj == CNPJ_FUNDO and wp.fundo == 'FUNDO TESTE FIDC'
    assert wp.data_base == date(2026, 6, 30)
    assert len(wp.linhas) == 3 and wp.linhas[0].valor_aquisicao == Decimal('500000.55')


def test_workpaper_sem_aba_termo_da_erro_amigavel():
    from openpyxl import Workbook
    buffer = io.BytesIO()
    Workbook().save(buffer)
    with pytest.raises(ValueError, match='não tem a aba WP_Termo'):
        _svc('workpaper').ler_workpaper(buffer.getvalue(), 'WP_x.xlsm')


# ---------------------------------------------------------------- conferência

def _documentos():
    doc = _svc('documentos')
    boleta = doc.ler_texto('OCABoleta_1.htm', BOLETA_HTML.encode('cp1252'))[0]
    return [doc.analisar('12345_BS_ALFA.pdf', '', BOLETIM, tipo='PDF'),
            doc.analisar('99999_12345_Term_ALFA.pdf', '', TERMO, tipo='PDF'),
            doc.analisar('Tela_Cetip.pdf', '', TERMO_CRI, tipo='PDF'),
            doc.analisar('OCABoleta_1.htm', '', boleta, tipo='HTML')]


def test_conferencia_aponta_vencimento_divergente_e_item_so_no_wp():
    posicoes = _svc('britech').ler_arquivo(_xlsx(_carteira_formatada()), 'c.xlsx')
    wp = _svc('workpaper').ler_workpaper(_workpaper_bytes(), f'WP_T_{CNPJ_FUNDO}.xlsm')
    r = _svc('conciliacao').conferir(posicoes, wp.linhas, _documentos(), CNPJ_FUNDO)
    por_emissor = {ln['emissor']: ln for ln in r['linhas']}

    alfa = por_emissor['ALFA FOMENTO LTDA']['campos']
    assert alfa['valor']['status'] == 'Confere'
    assert alfa['emissao']['status'] == 'Confere'          # termo do mesmo grupo (12345)
    assert alfa['vencimento']['status'] == 'Diverge'       # Britech 14/03/2029, documentos 15/03/2029
    assert alfa['vencimento']['documentos'] == '15/03/2029'
    assert alfa['emissor']['status'] == 'Confere'
    assert alfa['vencimento']['wp_status'] == 'Confere'    # o WP copia a Britech
    assert por_emissor['ALFA FOMENTO LTDA']['situacao'] == 'Divergente'

    beta = por_emissor['BETA SECURITIZADORA S.A.']
    assert beta['situacao'] == 'OK'                        # boleta (valor) + tela com o código do ativo (datas)
    assert beta['campos']['vencimento']['fontes'] == ['Tela_Cetip.pdf']

    assert por_emissor['GAMA PARTICIPACOES']['situacao'] == 'Sem documentos'
    so_wp = [ln for ln in r['linhas'] if ln['situacao'] == 'Só no WP']
    assert len(so_wp) == 1 and so_wp[0]['codigo'] == '444'
    assert r['contagem'] == {'Divergente': 1, 'OK': 1, 'Sem documentos': 1, 'Só no WP': 1}


def test_valor_dentro_da_tolerancia_confere_com_nota():
    britech = _svc('britech')
    df = _carteira_formatada()
    df.loc[3, 'Vlr. Aquisição'] = 1999999.99
    posicoes = britech.ler_arquivo(_xlsx(df), 'c.xlsx')
    r = _svc('conciliacao').conferir(posicoes, [], _documentos(), CNPJ_FUNDO)
    beta = next(ln for ln in r['linhas'] if ln['emissor'].startswith('BETA'))
    assert beta['campos']['valor']['status'] == 'Confere'
    assert 'diferença de R$ 0,01' in beta['campos']['valor']['nota']


# ---------------------------------------------------------------- fluxo completo (pastas temporárias)

def _preparar_pastas(tmp_path):
    (tmp_path / 'lastro').mkdir()
    (tmp_path / 'lastro' / '12345_BS_ALFA.txt').write_text(BOLETIM, encoding='utf-8')
    (tmp_path / 'lastro' / '99999_12345_Term_ALFA.txt').write_text(TERMO, encoding='utf-8')
    (tmp_path / 'lastro' / 'OCABoleta_1.htm').write_bytes(BOLETA_HTML.encode('cp1252'))
    (tmp_path / 'lastro' / 'foto.png').write_bytes(b'png')
    (tmp_path / 'lastro' / '_log_pipeline.txt').write_text('log', encoding='utf-8')
    wp = tmp_path / f'WP_FUNDO TESTE_{CNPJ_FUNDO}.xlsm'
    wp.write_bytes(_workpaper_bytes())
    pasta_carteiras = tmp_path / 'FORMATADA' / '30.06.2026'
    pasta_carteiras.mkdir(parents=True)
    (pasta_carteiras / f'999_{CNPJ_FUNDO}_30.06.2026_BRITECH.xlsx').write_bytes(_xlsx(_carteira_formatada()))
    return wp


def test_fluxo_completo_gera_excel(tmp_path, monkeypatch):
    cfg = _svc('config')
    monkeypatch.setattr(cfg, 'RAIZES_PERMITIDAS', [tmp_path])
    monkeypatch.setattr(cfg, 'PASTA_CARTEIRAS_BRITECH_PADRAO', str(tmp_path / 'FORMATADA'))
    wp = _preparar_pastas(tmp_path)
    proc = _svc('processamento')

    info = proc.inspecionar(str(wp))
    assert info['id_carteira'] == '999' and info['arquivo_britech_sugerido'].endswith('_BRITECH.xlsx')

    saida = proc.executar({'workpaper': str(wp), 'pasta_lastro': str(tmp_path / 'lastro'), 'origem': 'arquivo'})
    r = saida['resultado']
    assert r['resumo']['documentos_lidos'] == 3
    assert [i['nome'] for i in r['ignorados']] == ['foto.png']
    assert r['resumo']['contagem']['Divergente'] == 1
    abas = pd.read_excel(io.BytesIO(saida['excel']), sheet_name=None)
    assert list(abas) == ['Conciliação', 'Evidências', 'Documentos', 'Parâmetros']
    assert saida['nome_arquivo'] == f'Bate_Carteira_Lastro_{CNPJ_FUNDO}_20260630.xlsx'


def test_caminho_fora_do_drive_e_pasta_inexistente(tmp_path, monkeypatch):
    cfg = _svc('config')
    proc = _svc('processamento')
    monkeypatch.setattr(cfg, 'RAIZES_PERMITIDAS', [tmp_path / 'drive'])
    with pytest.raises(ValueError, match='precisa estar no Drive'):
        proc.caminho_permitido(str(tmp_path / 'outro' / 'x.xlsm'), 'arquivo', 'do workpaper')
    (tmp_path / 'drive').mkdir()
    with pytest.raises(ValueError, match='Pasta não encontrada'):
        proc.caminho_permitido(str(tmp_path / 'drive' / 'nao_existe'), 'pasta', 'da pasta de lastro')
