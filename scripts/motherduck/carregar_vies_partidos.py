#!/usr/bin/env python3
"""Viés político dos partidos a partir do survey de especialistas (Bolognesi et al.).

Fonte: data/referencias/harvard/df_experts.csv, Harvard Dataverse,
doi:10.7910/DVN/MFIXKW. Notas de 0 (extrema esquerda) a 10 (extrema direita) nas
ondas de julho de 2018 e de 2022. A escala publicada é multiplicada por 20 e
deslocada em 5 para ficar de -100 a +100: vies = (media - 5) * 20.

Renomeações herdam o valor do mesmo partido; fusões usam a média dos
componentes que têm valor. Sem valor é NULL, nunca 0.

Uso:
    python3 scripts/motherduck/carregar_vies_partidos.py --check
    MOTHERDUCK_TOKEN=<token de escrita> python3 scripts/motherduck/carregar_vies_partidos.py

O modo de escrita grava vies_onda_eleicao e vies_partido_onda, converte as
colunas de viés de partido e candidatura para DOUBLE, preenche as duas e grava
o CSV de auditoria em respostas/.
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import unicodedata
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from statistics import fmean

RAIZ = Path(__file__).resolve().parents[2]
REFERENCIA = RAIZ / "data" / "referencias"
AUDITORIA = RAIZ / "respostas" / "vies_partidos_auditoria.csv"
DATABASE = "BDR-TSE"

# Grafias do questionário que não são mudança de nome.
GRAFIA = {
    "PROGRESSISTAS": "PP",
    "PROGRE": "PP",
    "PODEMOS": "PODE",
    "SDD": "SOLIDARIEDADE",
    "CDD": "CIDADANIA",
    "REP": "REPUBLICANOS",
}

# Onda do artigo usada em cada eleição. 2024 usa a onda de 2022, dois anos
# antes: a interface precisa avisar que a onda foi estendida.
ONDA_POR_ELEICAO = {2018: 2018, 2020: 2018, 2022: 2022, 2024: 2022}
ONDA_ESTENDIDA = {2024: True}
ELEICOES_POR_ANO = {2018: [295, 297], 2020: [426], 2022: [544, 546], 2024: [619]}
CARGOS_POR_ELEICAO = {
    2018: [1, 3, 5, 6, 7, 8],
    2020: [11, 13],
    2022: [1, 3, 5, 6, 7, 8],
    2024: [11, 13],
}
OBSERVACAO = {
    2018: "presidente, governador, senador, deputados federal, estadual e distrital",
    2020: "prefeito e vereador",
    2022: "presidente, governador, senador, deputados federal, estadual e distrital",
    2024: "prefeito e vereador; onda 2022 estendida por dois anos",
}


def canonica(sigla: str) -> str:
    """Sigla sem acento, espaço nem pontuação: 'PC do B' e 'p_cdo_b' -> PCDOB."""
    s = unicodedata.normalize("NFKD", str(sigla)).encode("ascii", "ignore").decode().upper()
    return GRAFIA.get(re.sub(r"[^A-Z0-9]", "", s), re.sub(r"[^A-Z0-9]", "", s))


def duas_casas(x: float) -> float:
    """Arredonda meio para cima, como a Tabela 1 do artigo."""
    return float(Decimal(repr(x)).quantize(Decimal("0.01"), ROUND_HALF_UP))


def escala(media: float | None) -> float | None:
    return None if media is None else (media - 5) * 20


@dataclass(frozen=True)
class Fusao:
    ano: int
    resultado: str
    componentes: tuple[str, ...]


class Sucessao:
    """Renomeações e fusões de data/referencias/sucessao_partidos.csv."""

    def __init__(self, caminho: Path = REFERENCIA / "sucessao_partidos.csv"):
        self._pai: dict[str, str] = {}
        self.fusoes: list[Fusao] = []
        with open(caminho, encoding="utf-8", newline="") as f:
            for linha in csv.DictReader(f, delimiter=";"):
                resultado = canonica(linha["resultado"])
                if linha["tipo"] == "renomeacao":
                    self._unir(resultado, canonica(linha["origem"]))
                elif linha["tipo"] == "fusao":
                    partes = tuple(canonica(p) for p in linha["origem"].split("+"))
                    self.fusoes.append(Fusao(int(linha["ano"]), resultado, partes))
                else:
                    raise ValueError(f"tipo desconhecido: {linha['tipo']}")

    def _raiz(self, s: str) -> str:
        while self._pai.get(s, s) != s:
            s = self._pai[s]
        return s

    def _unir(self, a: str, b: str) -> None:
        ra, rb = self._raiz(a), self._raiz(b)
        if ra != rb:
            self._pai[rb] = ra

    def nomes(self, s: str) -> list[str]:
        grupo = {n for n in {*self._pai, *self._pai.values(), s} if self._raiz(n) == self._raiz(s)}
        return [s, *sorted(grupo - {s})]

    def fusoes_de(self, s: str) -> list[Fusao]:
        grupo = set(self.nomes(s))
        return sorted((f for f in self.fusoes if f.resultado in grupo), key=lambda f: f.ano, reverse=True)


@dataclass
class Fonte:
    nome: str
    referencia: int
    valores: dict[str, float]


def resolver(fonte: Fonte, suc: Sucessao, sigla: str, ano: int) -> tuple[float | None, str]:
    """Valor do partido `sigla` na eleição `ano` e a origem do número."""
    alvo = canonica(sigla)

    def proprio(s: str) -> tuple[float | None, str]:
        for nome in suc.nomes(s):
            if nome in fonte.valores:
                return fonte.valores[nome], ("direto" if nome == s else f"renomeado de {nome}")
        return None, ""

    def na_referencia(s: str) -> float | None:
        v, _ = proprio(s)
        if v is not None:
            return v
        for f in suc.fusoes_de(s):
            if f.ano <= fonte.referencia:
                v, _ = media_da_fusao(f)
                if v is not None:
                    return v
        return None

    def media_da_fusao(f: Fusao) -> tuple[float | None, str]:
        partes = [(c, na_referencia(c)) for c in f.componentes]
        com_valor = [(c, v) for c, v in partes if v is not None]
        if not com_valor:
            return None, ""
        rotulo = f"média de {' e '.join(c for c, _ in com_valor)} (fusão de {f.ano})"
        sem = [c for c, v in partes if v is None]
        if sem:
            rotulo += f"; sem valor: {', '.join(sem)}"
        return fmean(v for _, v in com_valor), rotulo

    for f in suc.fusoes_de(alvo):
        if fonte.referencia < f.ano <= ano:
            v, origem = media_da_fusao(f)
            if v is not None:
                return v, origem
    v, origem = proprio(alvo)
    if v is not None:
        return v, origem
    for f in suc.fusoes_de(alvo):
        if f.ano <= ano:
            v, origem = media_da_fusao(f)
            if v is not None:
                return v, origem
    return None, "sem valor"


def medias_artigo() -> dict[int, dict[str, float]]:
    """Média das notas por partido em cada onda, com duas casas (a precisão do artigo)."""
    with open(REFERENCIA / "harvard" / "df_experts.csv", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f, delimiter=";"))
    ondas: dict[int, dict[str, float]] = {}
    for onda in (2018, 2022):
        prefixo = f"ideol_{str(onda)[2:]}_"
        colunas = [c for c in rows[0] if c.startswith(prefixo)]
        selecionadas = [r for r in rows if r["id"].startswith(str(onda))]
        valores = {}
        for coluna in colunas:
            notas = [float(r[coluna]) for r in selecionadas if (r[coluna] or "").strip()]
            if notas:
                valores[canonica(coluna[len(prefixo):])] = duas_casas(fmean(notas))
        ondas[onda] = valores
    return ondas


def fonte_artigo(medias: dict[int, dict[str, float]], onda: int) -> Fonte:
    return Fonte(f"artigo, onda {onda}", onda, medias[onda])


def linhas_onda() -> list[tuple]:
    return [
        (ano, onda, ONDA_ESTENDIDA.get(ano, False), CARGOS_POR_ELEICAO[ano], ELEICOES_POR_ANO[ano], OBSERVACAO[ano])
        for ano, onda in sorted(ONDA_POR_ELEICAO.items())
    ]


def linhas_partidos(medias: dict[int, dict[str, float]], suc: Sucessao, partidos: list[tuple]) -> list[tuple]:
    linhas = []
    for ano, numero, sigla in partidos:
        onda = ONDA_POR_ELEICAO.get(ano)
        if onda is None:
            continue
        media, origem = resolver(fonte_artigo(medias, onda), suc, sigla, ano)
        vies = escala(media)
        linhas.append((ano, numero, sigla, onda,
                       None if media is None else round(media, 4),
                       None if vies is None else round(vies, 4),
                       origem))
    return linhas


def consultar_partidos(con) -> list[tuple]:
    return con.execute("""
        SELECT DISTINCT ano_eleicao, nr_partido, sg_partido
        FROM public.votacao_partido
        WHERE ano_eleicao BETWEEN 2018 AND 2024
          AND nr_partido IS NOT NULL AND sg_partido IS NOT NULL
        UNION
        SELECT DISTINCT ano_eleicao, nr_partido, sg_partido
        FROM public.candidatura
        WHERE ano_eleicao BETWEEN 2018 AND 2024
          AND nr_partido IS NOT NULL AND sg_partido IS NOT NULL
        ORDER BY 1, 2, 3
    """).fetchall()


def cobertura(con) -> list[tuple]:
    """Percentual dos votos válidos (nominais + legenda, 1º turno) por eleição."""
    return con.execute("""
        SELECT v.ano_eleicao,
               100.0 * SUM(COALESCE(v.qt_votos_nominais, 0) + COALESCE(v.qt_votos_legenda, 0))
                   FILTER (WHERE o.media IS NOT NULL)
               / SUM(COALESCE(v.qt_votos_nominais, 0) + COALESCE(v.qt_votos_legenda, 0)) AS cobertura
        FROM public.votacao_partido v
        JOIN public.vies_onda_eleicao r
          ON r.ano_eleicao = v.ano_eleicao AND list_contains(r.cargos, v.cd_cargo)
         AND list_contains(r.eleicoes, v.cd_eleicao)
        LEFT JOIN public.vies_partido_onda o
          ON o.ano_eleicao = v.ano_eleicao
         AND o.nr_partido = v.nr_partido
         AND o.sg_partido = v.sg_partido
        WHERE v.nr_turno = 1
        GROUP BY 1 ORDER BY 1
    """).fetchall()


DDL = """
CREATE OR REPLACE TABLE public.vies_onda_eleicao (
    ano_eleicao INTEGER PRIMARY KEY,
    onda SMALLINT NOT NULL,
    onda_estendida BOOLEAN NOT NULL,
    cargos INTEGER[] NOT NULL,
    eleicoes INTEGER[] NOT NULL,
    observacao VARCHAR
);
CREATE OR REPLACE TABLE public.vies_partido_onda (
    ano_eleicao INTEGER NOT NULL,
    nr_partido INTEGER NOT NULL,
    sg_partido VARCHAR NOT NULL,
    onda SMALLINT NOT NULL,
    media DOUBLE CHECK (media BETWEEN 0 AND 10),
    vies DOUBLE,
    origem VARCHAR NOT NULL,
    PRIMARY KEY (ano_eleicao, nr_partido, sg_partido)
);
ALTER TABLE public.partido ALTER COLUMN vies_politico TYPE DOUBLE;
ALTER TABLE public.candidatura ALTER COLUMN vies_politico_eleicao TYPE DOUBLE;
"""


def gravar(con, ondas: list[tuple], linhas: list[tuple]) -> list[tuple]:
    con.execute("BEGIN")
    try:
        con.execute(DDL)
        con.executemany("INSERT INTO public.vies_onda_eleicao VALUES (?, ?, ?, ?, ?, ?)", ondas)
        con.executemany("INSERT INTO public.vies_partido_onda VALUES (?, ?, ?, ?, ?, ?, ?)", linhas)

        # partido.vies_politico = eleição mais recente com valor para o número.
        con.execute("UPDATE public.partido SET vies_politico = NULL")
        con.execute("""
            UPDATE public.partido p
            SET vies_politico = (
                SELECT o.vies FROM public.vies_partido_onda o
                WHERE o.nr_partido = p.nr_partido AND o.media IS NOT NULL
                ORDER BY o.ano_eleicao DESC LIMIT 1
            )
        """)

        # candidatura.vies_politico_eleicao = valor do partido naquela eleição.
        con.execute("UPDATE public.candidatura SET vies_politico_eleicao = NULL "
                    "WHERE ano_eleicao BETWEEN 2018 AND 2024")
        con.execute("""
            UPDATE public.candidatura c
            SET vies_politico_eleicao = o.vies
            FROM public.vies_partido_onda o
            WHERE o.ano_eleicao = c.ano_eleicao
              AND o.nr_partido = c.nr_partido
              AND o.sg_partido = c.sg_partido
        """)

        resultado = cobertura(con)
        if {ano for ano, _ in resultado} != set(ONDA_POR_ELEICAO):
            raise ValueError("Cobertura incompleta: faltam eleições do escopo")
        for ano, valor in resultado:
            if valor is None or valor < 99.9:
                raise ValueError(f"cobertura de {ano} abaixo de 99,9%: {valor}")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise
    return resultado


def escrever_auditoria(linhas: list[tuple], caminho: Path = AUDITORIA) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with open(caminho, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["ano_eleicao", "nr_partido", "sg_partido", "onda", "media", "vies", "origem"])
        for linha in linhas:
            w.writerow(["" if v is None else v for v in linha])


# ───────── Verificação offline contra o artigo ─────────

def tabela1(medias: dict[int, dict[str, float]], suc: Sucessao) -> None:
    """Coluna 2022 = onda 2022; coluna 2018 = onda 2018 com as fusões até 2022."""
    onda18, onda22 = fonte_artigo(medias, 2018), fonte_artigo(medias, 2022)
    with open(REFERENCIA / "tabela1_artigo.csv", encoding="utf-8", newline="") as f:
        linhas = list(csv.DictReader(f, delimiter=";"))
    assert len(linhas) == 32, f"Tabela 1 com {len(linhas)} partidos"
    for linha in linhas:
        sigla = linha["partido"]
        v22, _ = resolver(onda22, suc, sigla, 2022)
        assert duas_casas(v22) == float(linha["media_2022"]), (sigla, v22, linha["media_2022"])
        v18, origem = resolver(onda18, suc, sigla, 2022)
        if linha["media_2018"]:
            assert v18 is not None and duas_casas(v18) == float(linha["media_2018"]), (sigla, v18, origem)
        else:
            assert v18 is None, (sigla, v18, origem)


def exemplos(medias: dict[int, dict[str, float]], suc: Sucessao) -> None:
    casos = [
        ("PRD", 2024, 8.16, 63.2, "média de PTB e PATRI (fusão de 2023)"),
        ("PODE", 2024, 7.93, 58.5, "média de PODE e PSC (fusão de 2023)"),
        ("SOLIDARIEDADE", 2024, 6.73, 34.6, "média de SOLIDARIEDADE e PROS (fusão de 2023)"),
        ("PSL", 2018, 8.11, 62.2, "direto"),
        ("PSL", 2020, 8.11, 62.2, "direto"),
        ("UNIÃO", 2022, 8.49, 69.8, "direto"),
        ("UNIÃO", 2024, 8.49, 69.8, "direto"),
        ("PC DO B", 2020, 4.60, None, "média de PCDOB e PPL (fusão de 2019)"),
        ("PODE", 2020, 7.10, None, "média de PODE e PHS (fusão de 2019)"),
        ("PATRIOTA", 2020, 8.08, None, "média de PATRI e PRP (fusão de 2019)"),
        ("REPUBLICANOS", 2020, 7.78, None, "renomeado de PRB"),
        ("PL", 2020, 7.78, None, "renomeado de PR"),
        ("MOBILIZA", 2024, 6.74, None, "renomeado de PMN"),
        ("AGIR", 2024, 7.55, None, "direto"),
        ("PT", 2024, 2.68, -46.4, "direto"),
    ]
    for sigla, ano, media, vies, trecho in casos:
        onda = ONDA_POR_ELEICAO[ano]
        v, origem = resolver(fonte_artigo(medias, onda), suc, sigla, ano)
        assert v is not None and duas_casas(v) == media, (sigla, ano, v, origem)
        if vies is not None:
            assert round(escala(v), 1) == vies, (sigla, ano, escala(v))
        assert trecho in origem, (sigla, ano, origem)
    for sigla, ano in [("UP", 2020), ("PCA1", 2018)]:
        v, origem = resolver(fonte_artigo(medias, ONDA_POR_ELEICAO[ano]), suc, sigla, ano)
        assert v is None and origem == "sem valor", (sigla, v, origem)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--check", action="store_true", help="só confere a Tabela 1 e os exemplos, sem banco")
    p.add_argument("--auditoria", type=Path, default=AUDITORIA, help="CSV de auditoria por partido/eleição")
    p.add_argument("--database", default=f"md:{DATABASE}?attach_mode=single",
                   help="conexão DuckDB; aponte para um arquivo local para ensaiar")
    a = p.parse_args(argv)

    medias = medias_artigo()
    suc = Sucessao()
    tabela1(medias, suc)
    exemplos(medias, suc)
    print("Tabela 1 e exemplos do artigo conferidos.")
    if a.check:
        return 0

    if not os.environ.get("MOTHERDUCK_TOKEN"):
        raise RuntimeError("Configure MOTHERDUCK_TOKEN com permissão de escrita em BDR-TSE")
    import duckdb

    con = duckdb.connect(a.database)
    linhas = linhas_partidos(medias, suc, consultar_partidos(con))
    resultado = gravar(con, linhas_onda(), linhas)
    escrever_auditoria(linhas, a.auditoria)
    con.close()

    print("Cobertura dos votos válidos por eleição:")
    for ano, valor in resultado:
        print(f"  {ano}: {float(valor):.2f}%")
    print(f"Auditoria: {a.auditoria}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
