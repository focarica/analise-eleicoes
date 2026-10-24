"""Normalização dos textos extraídos (``texto/*.txt``) para segmentação.

O texto original não é alterado. A saída fica em ``texto_normalizado/``.

Faz:
- substitui ligaduras tipográficas (ﬁ, ﬂ, ...) e caracteres invisíveis;
- junta linhas que pertencem ao mesmo parágrafo (quebras de layout), mantendo
  títulos, itens de lista e marcadores de página separados;
- remove hifenização de fim de linha quando a separação é artificial
  (``exercí-`` + ``cio`` -> ``exercício``). Quando a palavra à esquerda é um
  prefixo composto comum (``bem-``, ``auto-``), ou a palavra à direita é um
  segundo elemento comum (``estar``, ``social``), o hífen é mantido.

Cada joint de hifenização é registrado nas estatísticas para conferência.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

LIGATURAS = {
    "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi", "\ufb04": "ffl",
    "\ufb05": "st", "\ufb06": "st",
}
INVISIVEIS = re.compile("[\u00ad\u200b\u200c\u200d\ufeff]")
MARCADOR_PAGINA = re.compile(r"^=== PÁGINA \d+ ===$")
MARCADORES_FIXOS = {"[OCR]", "[página sem texto nativo]"}

PREFIXOS_COMPOSTOS = {
    "bem", "auto", "ex", "pré", "pós", "anti", "sub", "super", "micro", "macro", "multi",
    "inter", "intra", "extra", "neo", "vice", "mini", "ultra", "hiper", "semi", "contra",
    "pan", "co", "ante", "infra", "meta", "pró", "não",
}
SEGUNDOS_COMPOSTOS = {
    "estar", "social", "sociais", "pública", "públicas", "público", "públicos", "geral", "gerais",
    "chave", "humano", "humanos", "feira", "feiras", "americana", "brasileira", "paulista",
}

# Versão 2: marcadores de lista da fonte (áreas privadas) viram "•"; rodapés numéricos são removidos.
MARCADORES_PUA = {"\uf0fc", "\uf0a7", "\uf0b7", "\uf0d8", "\uf076", "\uf0a8", "\uf0e0", "\uf0a7"}
RODAPE = re.compile(r"^(?:\d{1,4}|[-–]\s*\d{1,4}\s*[-–]|p[áa]gina\s+\d{1,4}|\d{1,4}\s*/\s*\d{1,4})$", re.IGNORECASE)
VERSOES = ("v1", "v2")

TERMINAIS = (".", "!", "?", ":", ";", "…")
FECHAMENTOS = ('"', "”", "»", ")")
ITEM = re.compile(r"^(\d{1,3}[.)]|[a-zA-Z][.)]|[ivxlcdmIVXLCDM]{1,6}[.)]|[•●▪◦\-–—*·])\s+\S")


def is_marcador(linha: str) -> bool:
    return bool(MARCADOR_PAGINA.match(linha)) or linha in MARCADORES_FIXOS


def is_item(linha: str) -> bool:
    return bool(ITEM.match(linha))


def termina_frase(linha: str) -> bool:
    s = linha.rstrip()
    if not s:
        return False
    if s.endswith(TERMINAIS):
        return True
    if s.endswith(FECHAMENTOS) and len(s) > 1 and s[-2] in ".!?:;…":
        return True
    return False


def is_titulo(linha: str, proxima: str | None = None) -> bool:
    """Título ou subtítulo: caixa alta ou linha curta com palavras capitalizadas.

    Frases em caixa alta que terminam em pontuação de frase (ex.: "...!") são texto
    corrido, não títulos. Palavras que começam com parêntese ou dígito não contam
    na proporção de capitalização.
    """
    s = linha.strip()
    if not s:
        return False
    palavras = s.split()
    if len(palavras) > 15 or s.endswith((".", "!", "?", ";")):
        return False
    letras = [c for c in s if c.isalpha()]
    if len(letras) >= 3 and all(c.isupper() for c in letras) and len(s) <= 120:
        return True
    if len(s) > 70 or not s[0].isupper() or termina_frase(s):
        return False
    if proxima is not None and proxima and not proxima[0].isupper():
        return False
    palavras_alfa = [p for p in palavras if p[0].isalpha()]
    if not palavras_alfa:
        return False
    capitalizadas = sum(1 for p in palavras_alfa if p[0].isupper())
    return len(palavras_alfa) <= 10 and capitalizadas / len(palavras_alfa) >= 0.7


@dataclass
class EstatisticasNormalizacao:
    linhas_entrada: int = 0
    paragrafos: int = 0
    juncoes_linha: int = 0
    hifenizacoes_removidas: int = 0
    hifenizacoes_mantidas: int = 0
    ligaduras_substituidas: int = 0
    exemplos_hifenizacao: list[str] = field(default_factory=list)
    rodapes_removidos: int = 0
    marcadores_substituidos: int = 0
    rodapes_exemplos: list[str] = field(default_factory=list)

    def como_dict(self) -> dict:
        return {
            "linhas_entrada": self.linhas_entrada,
            "paragrafos": self.paragrafos,
            "juncoes_linha": self.juncoes_linha,
            "hifenizacoes_removidas": self.hifenizacoes_removidas,
            "hifenizacoes_mantidas": self.hifenizacoes_mantidas,
            "ligaduras_substituidas": self.ligaduras_substituidas,
            "rodapes_removidos": self.rodapes_removidos,
            "marcadores_substituidos": self.marcadores_substituidos,
        }


def _limpar(linha: str, est: EstatisticasNormalizacao) -> str:
    for lig, sub in LIGATURAS.items():
        if lig in linha:
            est.ligaduras_substituidas += linha.count(lig)
            linha = linha.replace(lig, sub)
    linha = INVISIVEIS.sub("", linha)
    linha = linha.replace("\u00a0", " ").replace("\t", " ")
    return re.sub(r" {2,}", " ", linha).strip()


def _juntar(atual: str, prox: str, est: EstatisticasNormalizacao) -> str:
    m = re.search(r"([^\W\d_]+)-$", atual)
    if m and prox[:1].islower():
        prefixo = m.group(1).lower()
        segunda = prox.split(" ", 1)[0].lower()
        if prefixo in PREFIXOS_COMPOSTOS or segunda in SEGUNDOS_COMPOSTOS:
            est.hifenizacoes_mantidas += 1
            return atual + prox  # mantém o hífen: "bem-" + "estar" -> "bem-estar"
        est.hifenizacoes_removidas += 1
        if len(est.exemplos_hifenizacao) < 50:
            est.exemplos_hifenizacao.append(f"{m.group(1)}-|{prox.split(' ', 1)[0]}")
        return atual[:-1] + prox  # "exercí-" + "cio" -> "exercício"
    est.juncoes_linha += 1
    return atual + " " + prox


def _deve_juntar(atual: str, prox: str) -> bool:
    if is_titulo(atual, prox) or is_titulo(prox):
        return False
    if is_item(prox) or is_marcador(prox):
        return False
    return True


def normalizar_texto(bruto: str, *, versao: str = "v1") -> tuple[str, EstatisticasNormalizacao]:
    """Normaliza o texto extraído. ``versao="v1"`` preserva o comportamento original."""
    if versao not in VERSOES:
        raise ValueError(f"versão de normalização desconhecida: {versao}")
    v2 = versao == "v2"
    est = EstatisticasNormalizacao()
    bruto = unicodedata.normalize("NFC", bruto).replace("\r\n", "\n").replace("\r", "\n")
    blocos: list[str] = []
    atual: str | None = None

    def descarregar() -> None:
        nonlocal atual
        if atual is not None:
            blocos.append(atual)
            est.paragrafos += 1
            atual = None

    for bruta in bruto.split("\n"):
        est.linhas_entrada += 1
        if v2 and any(c in bruta for c in MARCADORES_PUA):
            for c in MARCADORES_PUA:
                est.marcadores_substituidos += bruta.count(c)
                bruta = bruta.replace(c, "•")
        linha = _limpar(bruta, est)
        if v2 and RODAPE.match(linha):
            # Rodapé de página: não encerra o parágrafo em curso, para que a frase continue na página seguinte.
            est.rodapes_removidos += 1
            if len(est.rodapes_exemplos) < 20:
                est.rodapes_exemplos.append(linha)
            continue
        if not linha:
            descarregar()
            continue
        if is_marcador(linha):
            descarregar()
            blocos.append(linha)
            continue
        if atual is None:
            atual = linha
        elif _deve_juntar(atual, linha):
            atual = _juntar(atual, linha, est)
        else:
            descarregar()
            atual = linha
    descarregar()
    return "\n\n".join(blocos) + ("\n" if blocos else ""), est


def normalizar_arquivo(entrada: Path, saida: Path, *, versao: str = "v1") -> EstatisticasNormalizacao:
    texto, est = normalizar_texto(entrada.read_text(encoding="utf-8"), versao=versao)
    saida.parent.mkdir(parents=True, exist_ok=True)
    tmp = saida.with_name(saida.name + ".tmp")
    tmp.write_text(texto, encoding="utf-8")
    tmp.replace(saida)
    return est


def main(argv: list[str] | None = None) -> int:
    import argparse
    import sys

    from . import config
    from .manifesto import escrever_csv

    p = argparse.ArgumentParser(description="Normaliza os textos extraídos (texto/*.txt).")
    p.add_argument("--anos", nargs="+", type=int, default=list(config.ANOS))
    p.add_argument("--ufs", nargs="+", default=list(config.UFS))
    p.add_argument("--dir-dados", type=Path, default=config.DIR_DADOS_PADRAO)
    p.add_argument("--versao", choices=VERSOES, default="v1")
    args = p.parse_args(argv)

    base = args.dir_dados.resolve()
    pasta = "texto_normalizado" if args.versao == "v1" else f"texto_normalizado_{args.versao}"
    colunas = (
        "ano_eleicao", "uf", "arquivo", "linhas_entrada", "paragrafos", "juncoes_linha",
        "hifenizacoes_removidas", "hifenizacoes_mantidas", "ligaduras_substituidas",
        "rodapes_removidos", "marcadores_substituidos", "exemplos_hifenizacao",
    )
    linhas: list[dict] = []
    for ano in sorted(set(args.anos)):
        for uf in [u.upper() for u in args.ufs]:
            dir_texto = base / "propostas_governo" / str(ano) / uf / "texto"
            if not dir_texto.exists():
                continue
            for txt in sorted(dir_texto.glob("*.txt")):
                est = normalizar_arquivo(txt, dir_texto.parent / pasta / txt.name, versao=args.versao)
                linhas.append({
                    "ano_eleicao": ano, "uf": uf, "arquivo": txt.name,
                    **est.como_dict(), "exemplos_hifenizacao": " | ".join(est.exemplos_hifenizacao),
                })
    nome_csv = "normalizacao_estatisticas.csv" if args.versao == "v1" else f"normalizacao_estatisticas_{args.versao}.csv"
    escrever_csv(base / "propostas_governo" / nome_csv, linhas, colunas)
    total_h = sum(l["hifenizacoes_removidas"] for l in linhas)
    print(f"{len(linhas)} arquivo(s) normalizado(s); hifenizações removidas: {total_h}")
    print(f"estatísticas: {base / 'propostas_governo' / nome_csv}")
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main())
