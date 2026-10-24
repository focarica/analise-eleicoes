"""Elegibilidade: a unidade é uma proposta válida para classificação posterior?

Esta classificação é de elegibilidade, não de tema. Não atribui Saúde, Educação,
Segurança Pública etc. Cada decisão registra a regra acionada e um motivo, para
permitir auditoria. Quando as evidências não bastam, a classe é ``AMBIGUO``.

Classes:
- PROPOSTA: ação, compromisso, iniciativa ou objetivo identificável.
- DIAGNOSTICO: descrição de problema ou situação atual.
- CONTEXTO: explicação, justificativa, apresentação geral ou valores.
- TITULO_ESTRUTURAL: título, subtítulo ou cabeçalho.
- FRAGMENTO_INVALIDO: texto incompleto ou extração defeituosa.
- AMBIGUO: evidências insuficientes para uma decisão confiável.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..normalizacao import is_titulo, termina_frase
from .regras import CONTEXTO, PRESCRITIVO, Indicios, analisar

PROPOSTA = "PROPOSTA"
DIAGNOSTICO = "DIAGNOSTICO"
CONTEXTO_ = "CONTEXTO"
TITULO_ESTRUTURAL = "TITULO_ESTRUTURAL"
FRAGMENTO_INVALIDO = "FRAGMENTO_INVALIDO"
AMBIGUO = "AMBIGUO"
CLASSES_ELEGIBILIDADE = (PROPOSTA, DIAGNOSTICO, CONTEXTO_, TITULO_ESTRUTURAL, FRAGMENTO_INVALIDO, AMBIGUO)
# Classes que merecem revisão ou recuperação do descarte.
CLASSES_RECUPERAVEIS = (PROPOSTA, AMBIGUO)

PALAVRAS_TRUNCAMENTO = {
    "e", "de", "a", "o", "os", "as", "do", "da", "dos", "das", "no", "na", "nos", "nas", "em", "um",
    "uma", "para", "com", "que", "por", "ao", "sobre", "entre", "pelo", "pela",
}
_DIAGNOSTICO_EXPLICITO = re.compile(
    r"\b(?:observar que|reconhecer que|constata|constatou|observa-se|percebe-se|verifica-se|"
    r"problema|déficit|carência|deficiência|persiste|persistem|há uma|há um|existe uma|existe um|"
    r"o quadro|a situação|diagnóstico)\b",
    re.IGNORECASE,
)
_CONTEXTO_APRESENTACAO = re.compile(
    r"\b(?:este (?:plano|programa|documento|projeto)|o presente|apresentamos|agradec\w+|"
    r"é um documento|sumário|introdução|metodologia|porque|pois|uma vez que|devido a|em razão)\b",
    re.IGNORECASE,
)
_INTENCAO_PREVISTA = re.compile(r"\b(?:previst[oa]s?|prevê|prevem)\b", re.IGNORECASE)
_VALORES = re.compile(
    r"^(?:nós |nosso |nossa |acreditamos|defendemos|afirmamos|entendemos|reafirmamos|somos|"
    r"sabemos|reconhecemos|valorizamos)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Elegibilidade:
    classe: str
    confianca: float
    regra: str
    motivo: str


def _palavras(texto: str) -> list[str]:
    return re.findall(r"[^\W\d_]+", texto.lower())


def classificar(
    texto: str,
    *,
    bloco_titulo: bool = False,
    versao: str = "v2",
    indicios: Indicios | None = None,
) -> Elegibilidade:
    """Classifica a elegibilidade de uma unidade textual."""
    t = texto.strip()
    if bloco_titulo:
        return Elegibilidade(TITULO_ESTRUTURAL, 0.95, "bloco_titulo", "bloco identificado como título ou cabeçalho")

    i = indicios or analisar(t, versao=versao)
    palavras = _palavras(t)

    if not t or not palavras:
        return Elegibilidade(FRAGMENTO_INVALIDO, 0.95, "sem_palavras", "unidade sem texto alfabético")
    if i.fragmento:
        return Elegibilidade(FRAGMENTO_INVALIDO, 0.85, "fragmento_sem_conteudo",
                             "poucas letras ou índice/tabela, sem conteúdo proposicional")
    if palavras and palavras[-1] in PALAVRAS_TRUNCAMENTO and not termina_frase(t) and len(palavras) >= 3:
        return Elegibilidade(FRAGMENTO_INVALIDO, 0.8, "texto_incompleto",
                             f"termina em '{palavras[-1]}' sem pontuação: frase provavelmente cortada")

    if is_titulo(t) and not (i.acoes or i.futuro_verbal or i.prescritivo) and len(palavras) <= 12:
        return Elegibilidade(TITULO_ESTRUTURAL, 0.8, "caixa_alta_ou_titulo", "caixa alta ou título sem verbo")

    acao = bool(i.acoes) or i.futuro_verbal or i.voz_passiva_futura
    if acao:
        if i.contexto >= 2 and not i.compromisso:
            return Elegibilidade(AMBIGUO, 0.5, "acao_com_forte_contexto",
                                 "ação identificada, mas com forte contexto diagnóstico")
        if i.compromisso and i.contexto == 0:
            return Elegibilidade(PROPOSTA, 0.9, "acao_com_compromisso", "ação com marcador de compromisso ou intenção")
        return Elegibilidade(PROPOSTA, 0.75, "acao_verbal", "verbo ou construção de ação identificada")

    if t.endswith("!") and not i.prescritivo:
        return Elegibilidade(AMBIGUO, 0.5, "frase_de_efeito", "frase de efeito sem ação identificável")

    if i.substantivo_de_acao:
        if i.contexto >= 1:
            return Elegibilidade(AMBIGUO, 0.45, "expressao_nominal_com_contexto",
                                 "expressão nominal de ação com contexto diagnóstico")
        if termina_frase(t) and len(palavras) >= 2:
            return Elegibilidade(PROPOSTA, 0.6, "expressao_nominal_de_acao",
                                 "expressão nominal de iniciativa (ex.: 'Incentivo ...')")
        return Elegibilidade(AMBIGUO, 0.45, "expressao_nominal_curta",
                             "expressão nominal curta sem pontuação: pode ser título")

    if _INTENCAO_PREVISTA.search(t):
        return Elegibilidade(AMBIGUO, 0.5, "intencao_prevista",
                             "medida prevista ou planejada, sem verbo de ação reconhecido")

    if i.prescritivo:
        if i.compromisso or re.search(r"\bcompromisso\b", t, re.IGNORECASE):
            return Elegibilidade(AMBIGUO, 0.5, "declaracao_geral_de_intencao",
                                 "declaração geral de compromisso ou intenção, sem ação identificada")
        return Elegibilidade(AMBIGUO, 0.4, "intencao_sem_acao", "indício de prescrição sem ação identificada")

    if _DIAGNOSTICO_EXPLICITO.search(t) or i.contexto >= 1:
        if i.valor:
            return Elegibilidade(CONTEXTO_, 0.6, "valores_com_contexto", "afirmação de valores com contexto")
        return Elegibilidade(DIAGNOSTICO, 0.75, "descricao_de_situacao",
                             "descrição de situação atual ou de problema, sem ação")

    if i.valor or _VALORES.search(t) or _CONTEXTO_APRESENTACAO.search(t):
        return Elegibilidade(CONTEXTO_, 0.7, "apresentacao_ou_justificativa",
                             "apresentação, justificativa ou afirmação de valores")

    return Elegibilidade(CONTEXTO_, 0.5, "descricao_sem_sinal", "descrição sem indício de ação ou intenção")
