#!/usr/bin/env python3
"""Importa os CSVs UTF-8 gerados por normalizar_dados_tse.py para stg_tse."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import shlex
import subprocess
from urllib.parse import unquote, urlparse

import normalizar_dados_tse as normalizador

# A tabela no banco tem sufixo _lote, ao contrário do arquivo gerado.
TABLE_MAP = {name: name for name in normalizador.STAGES}
TABLE_MAP["cobertura_despesa_paga"] = "cobertura_despesa_paga_lote"

# Nunca truncar estruturas persistentes de identidade (mapas) entre execuções.
TRUNCATE_TABLES = tuple(TABLE_MAP.values())


def connection_env() -> dict[str, str]:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("Defina DATABASE_URL no ambiente ou no arquivo .env carregado.")
    parsed = urlparse(url)
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname:
        raise SystemExit("DATABASE_URL deve ser uma URL postgresql:// válida.")
    env = os.environ.copy()
    env.update({
        "PGHOST": parsed.hostname,
        "PGPORT": str(parsed.port or 5432),
        "PGUSER": unquote(parsed.username or ""),
        "PGPASSWORD": unquote(parsed.password or ""),
        "PGDATABASE": unquote(parsed.path.lstrip("/")),
        "PGSSLMODE": "require" if parsed.query and "sslmode=require" in parsed.query else "prefer",
    })
    if not env["PGUSER"] or not env["PGDATABASE"]:
        raise SystemExit("DATABASE_URL precisa informar usuário e nome do banco.")
    return env


def psql_literal_path(path: Path) -> str:
    value = str(path.resolve())
    if any(char in value for char in "\r\n"):
        raise SystemExit(f"Caminho contém quebra de linha, não aceito em COPY: {value!r}")
    # psql \copy usa a gramática de string do psql/libpq; quote por shell também
    # protege espaços e barras invertidas no caminho local.
    return shlex.quote(value)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("data/staging"),
                        help="Pasta dos CSVs gerados pelo normalizador (padrão: data/staging)")
    args = parser.parse_args()
    root = args.input.resolve()
    missing = [name for name in normalizador.STAGES if not (root / f"{name}.csv").is_file()]
    if missing:
        raise SystemExit("CSV(s) ausente(s): " + ", ".join(missing))

    statements = ["\\set ON_ERROR_STOP on", "BEGIN;"]
    tables = ", ".join(f"stg_tse.{table}" for table in TRUNCATE_TABLES)
    statements.append(f"TRUNCATE TABLE {tables};")
    for file_table, columns in normalizador.STAGES.items():
        db_table = TABLE_MAP[file_table]
        column_list = ", ".join(columns)
        csv_path = psql_literal_path(root / f"{file_table}.csv")
        statements.append(
            f"\\copy stg_tse.{db_table} ({column_list}) FROM {csv_path} "
            "WITH (FORMAT csv, DELIMITER ';', QUOTE '\"', ENCODING 'UTF8')"
        )
    statements.append("COMMIT;")
    subprocess.run(
        ["psql", "-X", "-v", "ON_ERROR_STOP=1"],
        input="\n".join(statements) + "\n",
        text=True,
        env=connection_env(),
        check=True,
    )


if __name__ == "__main__":
    main()
