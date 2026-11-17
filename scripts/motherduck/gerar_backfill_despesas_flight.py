#!/usr/bin/env python3
"""Gera um Flight seguro para recuperar valores declarados de despesas 2010–2016."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT.parent
TSE = PROJECT / "Carga TSE"
template = (TSE / "duckdb/03_flight_tse_template.py").read_text(encoding="utf-8")
normalizer = (ROOT / "scripts/normalizar_dados_tse.py").read_text(encoding="utf-8")
views = "\n".join(path.read_text(encoding="utf-8") for path in (
    ROOT / "sql/motherduck/01_views_analiticas.sql",
    ROOT / "sql/motherduck/03_views_propaganda.sql",
    TSE / "duckdb/04_views_custo_patrimonio.sql",
))
prefix = template[:template.index("STAGE_COLUMNS = {")]
source = prefix.replace("__NORMALIZER_SOURCE__", repr(normalizer))
source = source.replace("__MODEL_SQL__", repr(""))
source = source.replace("__VIEWS_SQL__", repr(views))
source += r'''

HISTORICAL_YEARS = (2010, 2012, 2014, 2016)
NORMALIZER_SOURCES = ("consulta_cand", "prestacao_de_contas_eleitorais_candidatos")

def qident(value):
    return '"' + value.replace('"', '""') + '"'

def qliteral(value):
    return "'" + str(value).replace("'", "''") + "'"

def main():
    started = time.monotonic()
    zip_root = Path("/tmp/tse_despesas_declaradas_zip")
    stage_root = Path("/tmp/tse_despesas_declaradas_stage")
    shutil.rmtree(zip_root, ignore_errors=True)
    shutil.rmtree(stage_root, ignore_errors=True)
    zip_root.mkdir(parents=True)
    stage_root.mkdir(parents=True)
    manifests = acquire_sources(zip_root, HISTORICAL_YEARS, set(NORMALIZER_SOURCES))

    namespace = {"__name__": "tse_normalizer", "__file__": "/tmp/normalizer.py"}
    exec(compile(NORMALIZER_SOURCE, "/tmp/normalizer.py", "exec"), namespace)
    namespace["YEARS"] = HISTORICAL_YEARS
    namespace["SOURCES"] = NORMALIZER_SOURCES
    sys.argv = ["normalizer.py", "--zip-dir", str(zip_root), "--output", str(stage_root)]
    namespace["main"]()

    con = duckdb.connect("md:")
    con.execute(f"USE {qident(DB)}")
    candidate_fields = "ano_eleicao cd_eleicao nr_turno cd_tipo_eleicao nm_tipo_eleicao sg_uf sg_ue nm_ue cd_cargo ds_cargo sq_candidato sq_candidato_tse nr_cpf_candidato nm_candidato nm_urna_candidato dt_nascimento ds_grau_instrucao ds_genero ds_cor_raca nr_partido sg_partido nm_partido ds_sit_tot_turno source_file nr_titulo_eleitoral_candidato nr_candidato".split()
    candidate_definitions = ", ".join(f"{qident(name)} VARCHAR" for name in candidate_fields)
    con.execute(f"CREATE TEMP TABLE stg_candidatura ({candidate_definitions})")
    con.execute(f"COPY stg_candidatura FROM {qliteral(stage_root / 'candidatura.csv')} (DELIMITER ';', HEADER FALSE, QUOTE '\"', ESCAPE '\"', NULL '')")
    fields = "ano_eleicao sq_candidato id_linha_origem ds_despesa ds_categoria_despesa vr_despesa_declarada vr_pago source_file".split()
    definitions = ", ".join(f"{qident(name)} VARCHAR" for name in fields)
    con.execute(f"CREATE TEMP TABLE stg_despesa ({definitions})")
    con.execute(f"COPY stg_despesa FROM {qliteral(stage_root / 'despesa_candidato.csv')} (DELIMITER ';', HEADER FALSE, QUOTE '\"', ESCAPE '\"', NULL '')")
    con.execute("""
        CREATE OR REPLACE TEMP MACRO texto_publicado(v) AS (
            CASE WHEN v IS NULL OR UPPER(TRIM(v)) IN ('','#NULO','#NULO#','#NE','-1','-3','-4','NÃO DIVULGÁVEL')
                 THEN NULL ELSE TRIM(v) END
        );
        CREATE OR REPLACE TEMP MACRO valor_brl(v) AS (
            CASE WHEN v IS NULL OR UPPER(TRIM(v)) IN ('','#NULO','#NULO#','#NE','-1','-3','-4','NÃO DIVULGÁVEL') THEN NULL
                 WHEN CONTAINS(TRIM(v), ',') THEN TRY_CAST(REPLACE(REPLACE(TRIM(v),'.',''),',','.') AS DECIMAL(14,2))
                 ELSE TRY_CAST(TRIM(v) AS DECIMAL(14,2)) END
        );
        CREATE OR REPLACE TEMP TABLE candidato_fonte AS
        SELECT DISTINCT TRY_CAST(ano_eleicao AS INTEGER) AS ano_eleicao,
               TRY_CAST(sq_candidato AS BIGINT) AS sq_fonte,
               TRY_CAST(sq_candidato_tse AS BIGINT) AS sq_tse,
               TRY_CAST(cd_cargo AS INTEGER) AS cd_cargo,
               texto_publicado(sg_ue) AS sg_ue,
               texto_publicado(nm_candidato) AS nm_candidato,
               texto_publicado(nm_urna_candidato) AS nm_urna_candidato
        FROM stg_candidatura WHERE TRY_CAST(ano_eleicao AS INTEGER) BETWEEN 2010 AND 2016;
        CREATE OR REPLACE TEMP TABLE mapa_candidato AS
        SELECT s.ano_eleicao,s.sq_fonte,MIN(c.sq_candidato) AS sq_candidato
        FROM candidato_fonte s
        JOIN public.candidatura c
          ON c.ano_eleicao=s.ano_eleicao AND c.sq_candidato_tse=s.sq_tse
        WHERE c.ano_eleicao BETWEEN 2010 AND 2016
        GROUP BY s.ano_eleicao,s.sq_fonte
        HAVING COUNT(DISTINCT c.sq_candidato)=1;
        CREATE OR REPLACE TEMP TABLE despesas_fonte AS
        WITH origem AS (
            SELECT TRY_CAST(e.ano_eleicao AS INTEGER) AS ano_eleicao,
                   m.sq_candidato,
                   texto_publicado(e.ds_despesa) AS ds_despesa,
                   texto_publicado(e.ds_categoria_despesa) AS ds_categoria_despesa,
                   valor_brl(e.vr_despesa_declarada) AS vr_despesa_declarada,
                   e.id_linha_origem
            FROM stg_despesa e JOIN mapa_candidato m
              ON m.ano_eleicao=TRY_CAST(e.ano_eleicao AS INTEGER)
             AND m.sq_fonte=TRY_CAST(e.sq_candidato AS BIGINT)
            WHERE TRY_CAST(e.ano_eleicao AS INTEGER) BETWEEN 2010 AND 2016
        ), origem_ordenada AS (
            SELECT *,ROW_NUMBER() OVER (
                PARTITION BY ano_eleicao,sq_candidato,ds_despesa,ds_categoria_despesa
                ORDER BY vr_despesa_declarada NULLS FIRST,id_linha_origem
            ) AS ordem
            FROM origem
        ), destino_ordenado AS (
            SELECT ano_eleicao,sq_candidato,id_despesa,ds_despesa,ds_categoria_despesa,
                   ROW_NUMBER() OVER (
                       PARTITION BY ano_eleicao,sq_candidato,ds_despesa,ds_categoria_despesa
                       ORDER BY id_despesa
                   ) AS ordem
            FROM public.despesas_pagas WHERE ano_eleicao BETWEEN 2010 AND 2016
        )
        SELECT d.ano_eleicao,d.sq_candidato,d.id_despesa,
               o.ds_despesa,o.ds_categoria_despesa,o.vr_despesa_declarada
        FROM origem_ordenada o JOIN destino_ordenado d
          ON o.ano_eleicao=d.ano_eleicao AND o.sq_candidato=d.sq_candidato
         AND o.ds_despesa IS NOT DISTINCT FROM d.ds_despesa
         AND o.ds_categoria_despesa IS NOT DISTINCT FROM d.ds_categoria_despesa
         AND o.ordem=d.ordem;
    """)

    mismatch = con.execute("""
        WITH source_groups AS (
            SELECT TRY_CAST(e.ano_eleicao AS INTEGER) AS ano_eleicao,m.sq_candidato,
                   texto_publicado(e.ds_despesa) AS ds_despesa,
                   texto_publicado(e.ds_categoria_despesa) AS ds_categoria_despesa,COUNT(*) AS n
            FROM stg_despesa e JOIN mapa_candidato m
              ON m.ano_eleicao=TRY_CAST(e.ano_eleicao AS INTEGER)
             AND m.sq_fonte=TRY_CAST(e.sq_candidato AS BIGINT)
            WHERE TRY_CAST(e.ano_eleicao AS INTEGER) BETWEEN 2010 AND 2016 GROUP BY 1,2,3,4
        ), target_groups AS (
            SELECT ano_eleicao,sq_candidato,ds_despesa,ds_categoria_despesa,COUNT(*) AS n
            FROM public.despesas_pagas WHERE ano_eleicao BETWEEN 2010 AND 2016 GROUP BY 1,2,3,4
        )
        SELECT COUNT(*) FROM source_groups s FULL JOIN target_groups d
          ON s.ano_eleicao=d.ano_eleicao AND s.sq_candidato=d.sq_candidato
         AND s.ds_despesa IS NOT DISTINCT FROM d.ds_despesa
         AND s.ds_categoria_despesa IS NOT DISTINCT FROM d.ds_categoria_despesa
        WHERE s.n IS DISTINCT FROM d.n
    """).fetchone()[0]
    unmapped = con.execute("""
        SELECT COUNT(*) FROM stg_despesa e LEFT JOIN mapa_candidato m
          ON m.ano_eleicao=TRY_CAST(e.ano_eleicao AS INTEGER)
         AND m.sq_fonte=TRY_CAST(e.sq_candidato AS BIGINT)
        WHERE TRY_CAST(e.ano_eleicao AS INTEGER) BETWEEN 2010 AND 2016 AND m.sq_candidato IS NULL
    """).fetchone()[0]
    if unmapped:
        raise RuntimeError(f"{unmapped} candidaturas financeiras não mapearam univocamente para o banco; nenhum valor foi aplicado")
    if mismatch:
        raise RuntimeError(f"Carga histórica não corresponde aos lançamentos publicados ({mismatch} divergências); nenhum valor foi aplicado")

    missing_amounts = con.execute("SELECT COUNT(*) FROM despesas_fonte WHERE vr_despesa_declarada IS NULL").fetchone()[0]
    if missing_amounts:
        print(f"Fonte sem valor publicado: {missing_amounts:,} lançamentos (sentinelas/ausentes mantidos como NULL)", flush=True)
    source_totals = con.execute("SELECT ano_eleicao,COUNT(*),COUNT(vr_despesa_declarada),SUM(vr_despesa_declarada) FROM despesas_fonte GROUP BY 1 ORDER BY 1").fetchall()
    preserved_before = con.execute("SELECT COUNT(*),SUM(HASH(ano_eleicao,sq_candidato,id_despesa,ds_despesa,ds_categoria_despesa,vr_pago,vr_despesa_declarada)) FROM public.despesas_pagas WHERE ano_eleicao < 2010 OR ano_eleicao >= 2018").fetchone()

    con.execute("BEGIN TRANSACTION")
    try:
        con.execute("ALTER TABLE public.despesas_pagas ADD COLUMN IF NOT EXISTS vr_despesa_declarada DECIMAL(14,2)")
        con.execute("""
            UPDATE public.despesas_pagas d SET vr_despesa_declarada=s.vr_despesa_declarada
            FROM despesas_fonte s
            WHERE d.ano_eleicao=s.ano_eleicao AND d.sq_candidato=s.sq_candidato AND d.id_despesa=s.id_despesa
        """)
        con.execute(VIEWS_SQL)
        preserved_after = con.execute("SELECT COUNT(*),SUM(HASH(ano_eleicao,sq_candidato,id_despesa,ds_despesa,ds_categoria_despesa,vr_pago,vr_despesa_declarada)) FROM public.despesas_pagas WHERE ano_eleicao < 2010 OR ano_eleicao >= 2018").fetchone()
        if preserved_before != preserved_after:
            raise RuntimeError("Os lançamentos de 2018 em diante mudaram; rollback")
        target_totals = con.execute("SELECT ano_eleicao,COUNT(*),COUNT(vr_despesa_declarada),SUM(vr_despesa_declarada) FROM public.despesas_pagas WHERE ano_eleicao BETWEEN 2010 AND 2016 GROUP BY 1 ORDER BY 1").fetchall()
        if source_totals != target_totals:
            raise RuntimeError(f"Totais de origem/destino não reconciliam: {source_totals} / {target_totals}; rollback")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise

    print("HISTORICAL_EXPENSE_BACKFILL=" + json.dumps({
        "database": DB, "years": HISTORICAL_YEARS, "sources": manifests,
        "rows_by_year": target_totals, "preserved_2018_plus": preserved_after,
        "elapsed_seconds": round(time.monotonic()-started, 1)
    }, ensure_ascii=False, default=str), flush=True)
    con.close()
    shutil.rmtree(zip_root, ignore_errors=True)
    shutil.rmtree(stage_root, ignore_errors=True)

if __name__ == "__main__":
    main()
'''

# Views vêm dos arquivos da branch e da cópia histórica que define a questão 1.
destination = ROOT / "scripts/motherduck/backfill_despesas_declaradas_flight.py"
destination.write_text(source, encoding="utf-8")
print(destination)
