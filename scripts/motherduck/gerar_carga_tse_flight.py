#!/usr/bin/env python3
"""Sincroniza o Flight autocontido com o normalizador e os SQLs versionados."""
from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FLIGHT = ROOT / "scripts/motherduck/carga_tse_motherduck_flight.py"


def main() -> None:
    source = FLIGHT.read_text(encoding="utf-8")
    ast.parse(source)
    values = {
        "NORMALIZER_SOURCE": (ROOT / "scripts/normalizar_dados_tse.py").read_text(encoding="utf-8"),
        "MODEL_SQL": (ROOT / "sql/motherduck/02_carga_modelo.sql").read_text(encoding="utf-8"),
        "VIEWS_SQL": (ROOT / "sql/motherduck/01_views_analiticas.sql").read_text(encoding="utf-8")
        + "\n"
        + (ROOT / "sql/motherduck/03_views_propaganda.sql").read_text(encoding="utf-8"),
    }
    for name, value in values.items():
        pattern = rf"^{name} = .*?$"
        source, count = re.subn(pattern, lambda _: f"{name} = {value!r}", source, count=1, flags=re.MULTILINE)
        if count != 1:
            raise RuntimeError(f"Não encontrei exatamente uma definição de {name} no Flight")
    ast.parse(source)
    FLIGHT.write_text(source, encoding="utf-8")
    print(f"Flight sincronizado: {FLIGHT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
