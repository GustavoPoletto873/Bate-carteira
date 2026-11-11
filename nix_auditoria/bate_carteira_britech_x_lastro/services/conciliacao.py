"""Conferência campo a campo: carteira Britech x WP_Termo x documentos de lastro e termo.

Para cada título da carteira, os documentos são ligados à posição em três níveis:
- direto: o documento traz o VL Aplic. da posição (até a tolerância);
- mesma operação: mesmo número de operação no nome do arquivo de um documento direto, ou o
  código do ativo (ex.: código CETIP), ou o nome do emissor + o mesmo número de emissão;
- mesmo emissor: só o nome do emissor (usado quando os níveis acima não trazem a informação).
"""
from dataclasses import dataclass, field
from decimal import Decimal

from . import config
from .textos import (codigo_britech, fmt_data, fmt_valor, nome_essencial, numero_emissao_britech,
                     so_digitos)

CONFERE, DIVERGE, VERIFICAR, NAO_LOCALIZADO, SEM_WP = 'Confere', 'Diverge', 'Verificar', 'Não localizado', '—'
OK, DIVERGENTE, A_VERIFICAR, SEM_DOCUMENTOS, SO_WP = 'OK', 'Divergente', 'Verificar', 'Sem documentos', 'Só no WP'
DIRETO, MESMA_OP, MESMO_EMISSOR = 'direto', 'mesma operação', 'mesmo emissor'
CAMPOS = (('valor', 'VL Aplic.'), ('emissao', 'Dt. Emissão'), ('vencimento', 'Dt. Vencimento'),
          ('emissor', 'Emissor'))


def _tolerancia() -> Decimal:
    return Decimal(str(config.TOLERANCIA_VALOR))


@dataclass
class Campo:
    status: str = NAO_LOCALIZADO
    britech: str = ''
    documentos: str = ''
    fontes: list = field(default_factory=list)
    nota: str = ''
    wp: str = ''
    wp_status: str = SEM_WP

    def como_dict(self) -> dict:
        return {'status': self.status, 'britech': self.britech, 'documentos': self.documentos,
                'fontes': self.fontes, 'nota': self.nota, 'wp': self.wp, 'wp_status': self.wp_status}


def _unicos(itens) -> list:
    vistos, saida = set(), []
    for i in itens:
        if i and i not in vistos:
            vistos.add(i)
            saida.append(i)
    return saida


# ---------------------------------------------------------------- vínculos documento x posição

def _emissor_no_doc(doc, chave: str):
    """Achado do nome do emissor no documento (nome completo ou as duas primeiras palavras)."""
    if not chave:
        return None
    achado = doc.achar(chave)
    tokens = chave.split()
    if achado is None and len(tokens) >= 3:
        achado = doc.achar(' '.join(tokens[:2]))
    return achado


def vincular(pos, docs: list) -> dict:
    tol = _tolerancia()
    chave_emissor = nome_essencial(pos.emissor)
    codigo = codigo_britech(pos.ativo)
    num_emissao = numero_emissao_britech(pos.ativo)

    diretos = [d for d in docs if any(abs(a.valor - pos.valor_aplicado) <= tol for a in d.valores)]
    grupos = {d.grupo for d in diretos if d.grupo}
    mesma_op, mesmo_emissor = [], []
    for d in docs:
        if d in diretos or not d.tem_texto:
            continue
        cita_emissor = _emissor_no_doc(d, chave_emissor) is not None
        if (d.grupo and d.grupo in grupos) or (codigo and d.contem(codigo)) or \
                (cita_emissor and num_emissao is not None and num_emissao in d.numeros_emissao):
            mesma_op.append(d)
        elif cita_emissor:
            mesmo_emissor.append(d)
    return {DIRETO: diretos, MESMA_OP: mesma_op, MESMO_EMISSOR: mesmo_emissor,
            'chave_emissor': chave_emissor}


def _nivel(doc, vinc) -> str:
    for nivel in (DIRETO, MESMA_OP, MESMO_EMISSOR):
        if doc in vinc[nivel]:
            return nivel
    return ''


# ---------------------------------------------------------------- avaliação de cada campo

def _avaliar_valor(pos, vinc, evid: list) -> Campo:
    tol = _tolerancia()
    alvo = pos.valor_aplicado
    c = Campo(britech=fmt_valor(alvo))
    if vinc[DIRETO]:
        achados, diferencas = [], set()
        for d in vinc[DIRETO]:
            for a in d.valores:
                if abs(a.valor - alvo) <= tol:
                    achados.append(fmt_valor(a.valor))
                    diferencas.add(abs(a.valor - alvo))
                    evid.append(('valor', fmt_valor(a.valor), True, d.nome, d.trecho(a.inicio, a.fim), DIRETO))
                    break
        c.status, c.documentos, c.fontes = CONFERE, ' | '.join(_unicos(achados)), [d.nome for d in vinc[DIRETO]]
        maior = max(diferencas) if diferencas else Decimal('0')
        if maior > 0:
            c.nota = f'diferença de R$ {fmt_valor(maior)} (dentro da tolerância de R$ {fmt_valor(tol)})'
        return c
    # sem documento com o valor: algum documento da mesma operação traz um valor parecido (erro de digitação)?
    parecidos = []
    for d in vinc[MESMA_OP]:
        for a in d.valores_rotulados:
            if alvo > 0 and Decimal('0.5') <= a.valor / alvo <= Decimal('2'):
                parecidos.append((d, a))
    if parecidos:
        for d, a in parecidos:
            evid.append(('valor', fmt_valor(a.valor), False, d.nome, a.trecho, MESMA_OP))
        c.status = DIVERGE
        c.documentos = ' | '.join(_unicos(fmt_valor(a.valor) for _, a in parecidos))
        c.fontes = _unicos(d.nome for d, _ in parecidos)
        c.nota = 'nenhum documento traz o VL Aplic. da Britech; documentos da mesma operação trazem outro valor'
        return c
    c.nota = ('há documentos do emissor, mas nenhum traz este valor' if (vinc[MESMA_OP] or vinc[MESMO_EMISSOR])
              else 'nenhum documento da pasta traz este valor nem cita o emissor')
    return c


def _avaliar_data(campo: str, alvo, vinc, evid: list) -> Campo:
    atributo = 'datas_emissao' if campo == 'emissao' else 'datas_vencimento'
    rotulo = 'emissão' if campo == 'emissao' else 'vencimento'
    c = Campo(britech=fmt_data(alvo))
    principais = vinc[DIRETO] + vinc[MESMA_OP]
    achados = [(d, a, _nivel(d, vinc)) for d in principais for a in getattr(d, atributo)]
    so_emissor = False
    if not achados:
        achados = [(d, a, MESMO_EMISSOR) for d in vinc[MESMO_EMISSOR] for a in getattr(d, atributo)]
        so_emissor = bool(achados)
    if not achados:
        sem_rotulo = [(d, a) for d in principais for a in d.datas if alvo and a.valor == alvo]
        if sem_rotulo:
            d, a = sem_rotulo[0]
            evid.append((campo, fmt_data(a.valor), True, d.nome, d.trecho(a.inicio, a.fim), _nivel(d, vinc)))
            c.status, c.documentos = VERIFICAR, fmt_data(alvo)
            c.fontes = _unicos(d.nome for d, _ in sem_rotulo)
            c.nota = f'a data aparece no documento, mas sem o rótulo de data de {rotulo}'
        else:
            c.nota = f'nenhum documento ligado à posição traz a data de {rotulo}'
        return c
    for d, a, nivel in achados:
        evid.append((campo, fmt_data(a.valor), a.valor == alvo, d.nome, a.trecho, nivel))
    iguais = [x for x in achados if x[1].valor == alvo]
    diferentes = [x for x in achados if x[1].valor != alvo]
    c.documentos = ' | '.join(_unicos(fmt_data(a.valor) for _, a, _ in achados))
    c.fontes = _unicos(d.nome for d, _, _ in achados)
    if alvo is None:
        c.status, c.nota = VERIFICAR, f'a Britech não tem data de {rotulo}; veja a data dos documentos'
    elif iguais and not diferentes:
        c.status = CONFERE
        if so_emissor:
            c.nota = 'confirmado só por documento do mesmo emissor (sem o valor da posição)'
    elif iguais:
        c.status = VERIFICAR
        outras = ', '.join(_unicos(f'{fmt_data(a.valor)} ({d.nome})' for d, a, _ in diferentes))
        c.nota = f'documentos não concordam entre si; também aparece: {outras}'
    else:
        c.status = VERIFICAR if so_emissor else DIVERGE
        c.nota = (f'documentos do mesmo emissor trazem outra data de {rotulo}' if so_emissor
                  else f'a data de {rotulo} da Britech não aparece nos documentos da posição')
    return c


def _avaliar_emissor(pos, vinc, evid: list) -> Campo:
    c = Campo(britech=pos.emissor)
    chave = vinc['chave_emissor']
    principais = vinc[DIRETO] + vinc[MESMA_OP]
    if principais:
        com_nome = []
        for d in principais:
            achado = _emissor_no_doc(d, chave)
            if achado:
                com_nome.append(d)
                evid.append(('emissor', pos.emissor, True, d.nome, achado.trecho, _nivel(d, vinc)))
        if com_nome:
            c.status, c.documentos, c.fontes = CONFERE, pos.emissor, [d.nome for d in com_nome]
            return c
        citados = [(d, a) for d in principais for a in d.emissores_citados]
        for d, a in citados:
            evid.append(('emissor', a.valor, False, d.nome, a.trecho, _nivel(d, vinc)))
        c.documentos = ' | '.join(_unicos(a.valor for _, a in citados))
        c.fontes = _unicos(d.nome for d, _ in citados) or [d.nome for d in principais]
        c.status = DIVERGE if citados else VERIFICAR
        c.nota = ('os documentos da posição citam outro emissor' if citados
                  else 'os documentos da posição não citam o nome do emissor')
        return c
    if vinc[MESMO_EMISSOR]:
        for d in vinc[MESMO_EMISSOR][:5]:
            achado = _emissor_no_doc(d, chave)
            evid.append(('emissor', pos.emissor, True, d.nome, achado.trecho if achado else '', MESMO_EMISSOR))
        c.status, c.documentos = VERIFICAR, pos.emissor
        c.fontes = [d.nome for d in vinc[MESMO_EMISSOR]]
        c.nota = 'o nome aparece nos documentos, mas nenhum deles traz o valor ou o código desta posição'
        return c
    c.nota = 'o emissor não aparece em nenhum documento da pasta'
    return c


# ---------------------------------------------------------------- workpaper

def casar_wp(posicoes: list, linhas_wp: list) -> dict:
    """{índice da posição: LinhaWP}. Por valor + código, depois só valor, depois código + datas."""
    tol = _tolerancia()
    usados, casados = set(), {}

    def tentar(regra):
        for i, p in enumerate(posicoes):
            if i in casados:
                continue
            for j, w in enumerate(linhas_wp):
                if j not in usados and regra(p, w):
                    casados[i] = w
                    usados.add(j)
                    break

    mesmo_valor = lambda p, w: w.valor_aquisicao is not None and abs(w.valor_aquisicao - p.valor_aplicado) <= tol  # noqa: E731
    mesmo_codigo = lambda p, w: bool(so_digitos(p.codigo)) and so_digitos(p.codigo) == so_digitos(w.numero_doc)  # noqa: E731
    tentar(lambda p, w: mesmo_valor(p, w) and mesmo_codigo(p, w))
    tentar(mesmo_valor)
    tentar(lambda p, w: mesmo_codigo(p, w) and w.data_emissao == p.data_emissao
           and w.data_vencimento == p.data_vencimento)
    return casados, [w for j, w in enumerate(linhas_wp) if j not in usados]


def _comparar_wp(campos: dict, pos, w) -> None:
    tol = _tolerancia()
    pares = (('valor', w.valor_aquisicao, fmt_valor(w.valor_aquisicao),
              w.valor_aquisicao is not None and abs(w.valor_aquisicao - pos.valor_aplicado) <= tol),
             ('emissao', w.data_emissao, fmt_data(w.data_emissao), w.data_emissao == pos.data_emissao),
             ('vencimento', w.data_vencimento, fmt_data(w.data_vencimento), w.data_vencimento == pos.data_vencimento))
    for nome, bruto, texto, igual in pares:
        campos[nome].wp = texto
        campos[nome].wp_status = CONFERE if igual else (NAO_LOCALIZADO if bruto is None else DIVERGE)


# ---------------------------------------------------------------- conferência completa

def _situacao(campos: dict, no_wp: bool) -> str:
    status_docs = [c.status for c in campos.values()]
    status_wp = [c.wp_status for c in campos.values() if no_wp]
    if DIVERGE in status_docs or DIVERGE in status_wp:
        return DIVERGENTE
    if all(s == NAO_LOCALIZADO for s in status_docs):
        return SEM_DOCUMENTOS
    if any(s in (VERIFICAR, NAO_LOCALIZADO) for s in status_docs + status_wp):
        return A_VERIFICAR
    return OK


def conferir(posicoes: list, linhas_wp: list, docs: list, cnpj_fundo: str = '') -> dict:
    casados, wp_sobrando = casar_wp(posicoes, linhas_wp)
    linhas, vinculos_por_doc = [], {}
    for i, pos in enumerate(posicoes):
        vinc = vincular(pos, docs)
        evid = []
        campos = {'valor': _avaliar_valor(pos, vinc, evid),
                  'emissao': _avaliar_data('emissao', pos.data_emissao, vinc, evid),
                  'vencimento': _avaliar_data('vencimento', pos.data_vencimento, vinc, evid),
                  'emissor': _avaliar_emissor(pos, vinc, evid)}
        w = casados.get(i)
        if w is not None:
            _comparar_wp(campos, pos, w)
        rotulo = f'{pos.ativo or pos.emissor} — R$ {fmt_valor(pos.valor_aplicado)}'
        for nivel in (DIRETO, MESMA_OP):
            for d in vinc[nivel]:
                vinculos_por_doc.setdefault(d.nome, []).append(f'{rotulo} ({nivel})')
        linhas.append({
            'id': i + 1, 'ativo': pos.ativo, 'emissor': pos.emissor, 'codigo': pos.codigo,
            'valor_aplicado': fmt_valor(pos.valor_aplicado), 'data_aquisicao': fmt_data(pos.data_aquisicao),
            'no_wp': w is not None, 'wp_linha': w.linha_excel if w is not None else None,
            'situacao': _situacao(campos, w is not None),
            'campos': {k: c.como_dict() for k, c in campos.items()},
            'docs_diretos': len(vinc[DIRETO]), 'docs_mesma_operacao': len(vinc[MESMA_OP]),
            'evidencias': [{'campo': c, 'valor': v, 'confere': ok, 'documento': doc, 'trecho': t, 'nivel': n}
                           for c, v, ok, doc, t, n in evid],
        })
    for w in wp_sobrando:
        campos = {k: Campo(status=SEM_WP, nota='') for k, _ in CAMPOS}
        campos['valor'].wp, campos['emissao'].wp = fmt_valor(w.valor_aquisicao), fmt_data(w.data_emissao)
        campos['vencimento'].wp = fmt_data(w.data_vencimento)
        for c in campos.values():
            c.wp_status = DIVERGE
        campos['valor'].nota = 'linha do WP_Termo sem posição correspondente na carteira Britech'
        linhas.append({
            'id': len(linhas) + 1, 'ativo': w.tipo_recebivel, 'emissor': w.nome_cedente or w.nome_sacado,
            'codigo': w.numero_doc, 'valor_aplicado': '', 'data_aquisicao': fmt_data(w.data_aquisicao),
            'no_wp': True, 'wp_linha': w.linha_excel, 'situacao': SO_WP,
            'campos': {k: c.como_dict() for k, c in campos.items()},
            'docs_diretos': 0, 'docs_mesma_operacao': 0, 'evidencias': []})

    inventario = []
    for d in docs:
        inventario.append({
            'nome': d.nome, 'tipo': d.tipo,
            'paginas': (f'{d.paginas_lidas} de {d.paginas_total}' if d.paginas_total > d.paginas_lidas
                        else str(d.paginas_lidas or '')),
            'vinculos': vinculos_por_doc.get(d.nome, []),
            'cita_cnpj_fundo': bool(cnpj_fundo) and cnpj_fundo in d.cnpjs,
            'observacao': '; '.join(x for x in (
                d.erro, d.aviso, '' if (d.erro or vinculos_por_doc.get(d.nome)) else 'não ligado a nenhuma posição') if x),
        })

    contagem = {}
    for linha in linhas:
        contagem[linha['situacao']] = contagem.get(linha['situacao'], 0) + 1
    return {'linhas': linhas, 'documentos': inventario, 'contagem': contagem}
