"""Regras determinísticas: sinais textuais e estruturais de cada trecho candidato.

Nenhuma decisão final é tomada aqui. As funções devolvem indícios (``Indicios``),
que a camada semântica usa para classificar os trechos.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..normalizacao import termina_frase

# Verbos de ação em forma de infinitivo. Indicam iniciativas que o governo pode executar.
VERBOS_ACAO = frozenset("""
ampliar construir criar implantar implementar garantir investir reduzir promover fortalecer
universalizar instituir estabelecer melhorar expandir modernizar reformar realizar desenvolver
combater apoiar incentivar estimular fomentar valorizar aumentar eliminar revisar recuperar
digitalizar contratar nomear concluir entregar reabrir financiar fiscalizar regulamentar pagar
reajustar qualificar capacitar instalar descentralizar oferecer disponibilizar fornecer planejar
coordenar integrar priorizar retomar extinguir enfrentar assegurar tornar dobrar legalizar manter
reforçar fazer dar levar reestruturar pavimentar urbanizar proteger preservar conservar prevenir
tratar atender cuidar abrir ofertar equipar informatizar municipalizar aprimorar aperfeiçoar
unificar simplificar desburocratizar avançar consolidar redistribuir conceder zerar acabar
""".split())

# Marcadores de intenção ou compromisso em primeira pessoa do plural, ou explícitos.
MARCADORES_COMPROMISSO = re.compile(
    r"\b(vamos|iremos|pretendemos|propomos|queremos|devemos|precisamos|buscaremos|"
    r"nosso compromisso|nossa meta|nosso objetivo|nosso objetivo é|nossa proposta|"
    r"o objetivo é|a meta é|meta de|objetivo de)\b",
    re.IGNORECASE,
)
FUTURO_PRIMEIRA_PESSOA = re.compile(r"\b\w+(?:aremos|eremos|iremos)\b", re.IGNORECASE)

# Indícios de diagnóstico, contextualização ou descrição (não são propostas).
CONTEXTO = [
    re.compile(p, re.IGNORECASE) for p in (
        r"\bhoje\b", r"\batualmente\b", r"\bnos últimos\b", r"\bao longo (?:d[oa]s?|d[eo])\b",
        r"\bhistoricamente\b", r"\bsegundo\b", r"\bpesquisas?\b", r"\bdados\b", r"\bindicadores?\b",
        r"\d+(?:[,.]\d+)?\s?%", r"\b(?:desde|entre|de) (?:19|20)\d{2}\b",
        r"\bvivemos\b", r"\benfrentamos\b", r"\bfoi\b", r"\bforam\b", r"\bhouve\b", r"\btem sido\b",
        r"\btêm sido\b", r"\bcrise\b", r"\bpandemia\b", r"\bdesemprego\b", r"\bem 20\d\d\b",
        # pretérito imperfeito/perfeito: descrevem a situação anterior
        r"\b(?:tinha|tinham|havia|eram|era|estava|estavam|apresentava|apresentavam|registrava|"
        r"registravam|cresceu|cresceram|caiu|caíram|aumentou|aumentaram|diminuiu|diminuíram|"
        r"teve|tiveram|chegou|chegaram|atingiu|atingiram|passou|passaram|ficou|ficaram|"
        r"possuía|possuíam|tinha sido|vinha|vinham|já vinha)\b",
        # concessivas e de contraste: introduzem diagnóstico ou ressalva
        r"^(?:apesar|embora|por outro lado|contudo|entretanto|no entanto|todavia)\b",
    )
]
# Expressões de valor: afirmam posição, não ação.
VALORES = re.compile(
    r"^(?:nós |nosso |nossa |acreditamos|defendemos|afirmamos|entendemos|reafirmamos|somos|"
    r"sabemos|reconhecemos|valorizamos)\b",
    re.IGNORECASE,
)
# Conectores de continuação: a frase retoma a proposta anterior.
CONECTORES = re.compile(
    r"^(?:para isso|para tanto|além disso|assim|dessa|desse|dessas|desses|essa|esse|essas|esses|"
    r"este|esta|estes|estas|isso|com isso|nesse|nessa|nesses|nessas|neste|nesta|tal|tais|também|"
    r"ainda|ademais|com essa|com esse|com esses|com essas|nele|nela)\b",
    re.IGNORECASE,
)
_TOKEN = re.compile(r"[^\W\d_]+(?:-[^\W\d_]+)*", re.UNICODE)
_GERUNDIO = re.compile(r"(?:ando|endo|indo)$", re.IGNORECASE)


@dataclass(frozen=True)
class Indicios:
    acoes: tuple[str, ...]
    compromisso: bool
    contexto: int
    valor: bool
    conector: bool
    gerundio: bool
    objeto_coordenado: bool
    partes_coordenadas: tuple[tuple[int, int], tuple[int, int]] | None
    # Sinais adicionais de ação, usados quando não há verbo do léxico.
    infinitivo_inicial: bool = False
    voz_passiva_futura: bool = False
    substantivo_de_acao: bool = False
    fragmento: bool = False
    futuro_verbal: bool = False
    prescritivo: bool = False
    cabecalho: bool = False


def _tokens(texto: str) -> list[tuple[str, int, int]]:
    return [(m.group(0), m.start(), m.end()) for m in _TOKEN.finditer(texto)]


def partes_coordenadas(texto: str) -> tuple[tuple[int, int], tuple[int, int]] | None:
    """Duas ações independentes coordenadas, sem objeto compartilhado.

    Ex.: "Construir escolas e ampliar hospitais" -> ("Construir escolas", "ampliar hospitais").
    Exige que o primeiro verbo esteja no início e tenha objeto antes do "e". Assim,
    "Ampliar e melhorar o atendimento" (um único objeto compartilhado) não é dividida.
    """
    tokens = _tokens(texto)
    if len(tokens) < 4 or tokens[0][0].lower() not in VERBOS_ACAO:
        return None
    for k in range(2, len(tokens)):
        palavra, inicio, _ = tokens[k]
        if palavra.lower() in VERBOS_ACAO and tokens[k - 1][0].lower() == "e":
            # Tokens entre o verbo inicial (índice 0) e o "e" (índice k-1): precisa haver objeto.
            if k - 1 >= 2:
                ini_e = tokens[k - 1][1]
                parte1 = texto[:ini_e].rstrip(" ,")
                parte2 = texto[inicio:].rstrip()
                if parte1.strip() and parte2.strip():
                    return (0, len(parte1)), (inicio, len(texto[:inicio]) + len(parte2))
            return None
    return None


def objeto_coordenado(texto: str) -> bool:
    """Verbo inicial com objeto imediato coordenado ("e") e oração reduzida depois da vírgula.

    Ex.: "Investir em educação e saúde, garantindo ..." -> True.
    Só o objeto antes da primeira vírgula conta; "Desenvolver ações ..., que garantam ..."
    não é objeto coordenado.
    """
    primeiro = _primeiro_termo(texto)
    if primeiro is None or primeiro.lower() not in VERBOS_ACAO and not _INFINITIVO.match(primeiro.lower()):
        return False
    if not _GERUNDIO_OU_ORACAO.search(texto):
        return False
    antes_da_virgula = re.split(r"[,;]", texto, maxsplit=1)[0]
    objeto = [t.lower() for t, _, _ in _tokens(antes_da_virgula)][1:]
    return "e" in objeto[1:] and len(objeto) >= 3


# Infinitivos que não indicam ação do governo (verbos modais, copulativos, existenciais).
_INFINITIVO_NAO_ACAO = frozenset("""
ser ter estar haver dever poder querer existir parecer acontecer ocorrer sofrer viver morrer
nascer lugar popular similar regular celular pilar altar militar familiar particular exemplar
mar bar sugar precisar saber conhecer entender compreender perceber sentir pensar acreditar
reconhecer aprender refletir discutir debater ouvir lembrar notar observar seguir continuar
""".split())
_INFINITIVO = re.compile(r"^[a-zà-úç]{3,}(?:ar|er|ir)$")
# Futuro verbal (3ª pessoa e 1ª do plural): "Exigiremos", "dobrará". Exclui modais e haver/ter.
FUTURO_VERBAL = re.compile(
    r"\b(?!(?:terá|terão|haverá|haverão|poderá|poderão|deverá|deverão)\b)"
    r"[^\W\d_]{3,}(?:aremos|eremos|iremos|ará|arão|erá|erão|irá|irão)\b",
    re.IGNORECASE,
)
# Indícios de intenção ou prescrição: a unidade fala do que será feito, mesmo sem verbo do léxico.
PRESCRITIVO = re.compile(
    r"\b(?:deve|devem|deveremos|deveria|precisa|precisam|precisamos|necessári[oa]s?|preciso|"
    r"será|serão|terá|terão|haverá|pretende|pretendem|pretendemos|propõe|propomos|proposta|"
    r"compromisso|objetivo|meta|quer|querem|buscam|buscamos|buscará|vai|vão|irá|irão|"
    r"apresentaremos|cumpriremos|assumimos|assumiremos)\b",
    re.IGNORECASE,
)
_CABECALHO_DOIS_PONTOS = re.compile(r":\s*$")
_MARCADORES_INFINITIVO = frozenset("""
vamos iremos pretendemos propomos queremos devemos precisamos buscaremos necessário necessária
preciso compromisso objetivo meta meta desafio
""".split())
_PASSIVA_FUTURA = re.compile(r"\b(?:ser[áã]o?|ser[áa]|serão|será)\s+(?:\w+\s+)?\w+(?:ad[oa]s?|id[oa]s?|ed[oa]s?)\b",
                             re.IGNORECASE)
SUBSTANTIVOS_DE_ACAO = frozenset("""
criação ampliação construção implantação implementação expansão modernização reforma melhoria
fortalecimento garantia valorização universalização investimento reestruturação revitalização
reabertura contratação qualificação capacitação redução eliminação recuperação apoio incentivo
promoção fomento estímulo combate reforço criar
""".split())


_PREFIXO_LISTA = re.compile(r"^(?:\d{1,3}[.)]\s+|[a-zA-Z][.)]\s+|[•●▪◦\-–—*·]\s*)?")
_GERUNDIO_OU_ORACAO = re.compile(r"\b\w+(?:ando|endo|indo)\b|\bque\s+\w+", re.IGNORECASE)


def _primeiro_termo(texto: str) -> str | None:
    """Primeira palavra depois de numeração, letra ou marcador de lista."""
    m = re.match(_PREFIXO_LISTA.pattern + r"([^\W\d_]+)", texto.strip(), re.UNICODE)
    return m.group(1) if m else None


def _infinitivo_inicial(texto: str) -> str | None:
    """Primeiro termo da unidade é um infinitivo (ex.: 'Trabalhar', '1. Ampliar', 'c. Potencializar')."""
    palavra = _primeiro_termo(texto)
    if palavra is None:
        return None
    p = palavra.lower()
    return palavra if _INFINITIVO.match(p) and p not in _INFINITIVO_NAO_ACAO else None


_PARTICULAS = {"de", "a", "o", "os", "as", "é", "e", "do", "da", "no", "na", "em", "para", "que", "se", "um", "uma"}


# Versão 2: expressões de intenção que antecedem uma ação ("é importante retomar", "seguir trabalhando").
_MARCADORES_V2 = frozenset("""
importante importantes fundamental fundamentais essencial essenciais prioritário prioritária
prioritários prioritárias prevê prevista previsto pretende
""".split())
_MARCADORES_GERUNDIO_V2 = frozenset({"seguir", "continuar", "continua", "seguem", "continuam"})


def _acao_apos_marcador(tokens: list[str], versao: str = "v1") -> str | None:
    """Verbo de ação (do léxico ou infinitivo genérico) logo após marcador de compromisso."""
    marcadores = _MARCADORES_INFINITIVO | (_MARCADORES_V2 if versao == "v2" else frozenset())
    for k, t in enumerate(tokens):
        if t in marcadores:
            for u in tokens[k + 1:k + 4]:
                if u in _PARTICULAS:
                    continue
                if u in VERBOS_ACAO:
                    return u
                if _INFINITIVO.match(u) and u not in _INFINITIVO_NAO_ACAO:
                    return u
                break
        if versao == "v2" and t in _MARCADORES_GERUNDIO_V2:
            for u in tokens[k + 1:k + 3]:
                if u in _PARTICULAS:
                    continue
                if _GERUNDIO.search(u) and len(u) > 5:
                    return u
                break
    return None


def _fragmento(texto: str) -> bool:
    """Trecho sem conteúdo proposicional: poucas letras, sem palavra com três letras, ou índice (pontilhado)."""
    letras = sum(1 for c in texto if c.isalpha())
    palavras = [p for p in re.findall(r"[^\W\d_]+", texto) if len(p) >= 3]
    if letras < 12 or not palavras:
        return True
    return texto.count(".") >= 8 and texto.count(".") > len(palavras)


def _cabecalho(texto: str) -> bool:
    """Rótulo curto de seção ou de lista: poucas palavras, sem verbo finito, termina em ':' ou sem pontuação."""
    palavras = texto.split()
    if len(palavras) > 6:
        return False
    if _CABECALHO_DOIS_PONTOS.search(texto):
        return True
    return not termina_frase(texto) and not any(p.lower() in {"é", "são", "foi", "foram", "tem", "têm", "há"} for p in palavras)


def analisar(texto: str, *, tipo: str = "frase", anterior: str = "", versao: str = "v1") -> Indicios:
    tokens = [t.lower() for t, _, _ in _tokens(texto)]
    # Evidência de ação só conta no início da unidade ou logo após marcador de compromisso.
    # Infinitivos incorporados ("é preciso conhecer", "para aprimorar") não são ação do governo.
    inicial = _infinitivo_inicial(texto)
    apos_marcador = _acao_apos_marcador(tokens, versao)
    infin = inicial is not None or apos_marcador is not None
    if inicial is not None:
        acoes = (inicial.lower(),)
    elif apos_marcador is not None:
        acoes = (apos_marcador,)
    else:
        acoes = ()
    compromisso = bool(MARCADORES_COMPROMISSO.search(texto) or FUTURO_PRIMEIRA_PESSOA.search(texto))
    contexto = sum(1 for p in CONTEXTO if p.search(texto))
    valor = bool(VALORES.search(texto.strip()))
    conector = bool(CONECTORES.search(texto.strip()))
    gerundio = any(_GERUNDIO.search(t) and len(t) > 5 for t in tokens)
    primeiro = tokens[0] if tokens else ""
    return Indicios(
        acoes=acoes,
        compromisso=compromisso,
        contexto=contexto,
        valor=valor,
        conector=conector,
        gerundio=gerundio,
        objeto_coordenado=objeto_coordenado(texto),
        partes_coordenadas=partes_coordenadas(texto),
        infinitivo_inicial=infin,
        voz_passiva_futura=bool(_PASSIVA_FUTURA.search(texto)),
        substantivo_de_acao=primeiro in SUBSTANTIVOS_DE_ACAO,
        fragmento=_fragmento(texto),
        futuro_verbal=bool(FUTURO_VERBAL.search(texto)),
        prescritivo=bool(PRESCRITIVO.search(texto)),
        cabecalho=_cabecalho(texto),
    )
