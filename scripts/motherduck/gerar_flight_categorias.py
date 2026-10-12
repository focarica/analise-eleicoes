#!/usr/bin/env python3
"""Gera o Flight autocontido de recuperação de categorias e views Q9.

Uso: python scripts/motherduck/gerar_flight_categorias.py --output /tmp/categorias_flight.py
O Flight gerado aplica a atualização no BDR-TSE usando a autenticação do runtime.
Dependências do Flight: duckdb==1.5.6 e requests==2.34.2.
"""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("/tmp/tse_categorias_flight.py"))
    args = parser.parse_args()
    source = (ROOT / "scripts/motherduck/preencher_categorias_despesas.py").read_text()
    normalizer = (ROOT / "scripts/normalizar_dados_tse.py").read_text()
    views = (ROOT / "sql/motherduck/03_views_propaganda.sql").read_text()
    bootstrap = (
        'ROOT = Path("/tmp/tse_categorias_runtime")\n'
        '(ROOT / "scripts").mkdir(parents=True, exist_ok=True)\n'
        '(ROOT / "sql/motherduck").mkdir(parents=True, exist_ok=True)\n'
        f'(ROOT / "scripts/normalizar_dados_tse.py").write_text({normalizer!r})\n'
        f'(ROOT / "sql/motherduck/03_views_propaganda.sql").write_text({views!r})'
    )
    source = source.replace("ROOT = Path(__file__).resolve().parents[2]", bootstrap)
    source = source.replace('if __name__ == "__main__":\n    main()',
                            'if __name__ == "__main__":\n    sys.argv = ["categorias", "--apply"]\n    main()')
    compile(source, str(args.output), "exec")
    args.output.write_text(source)
    print(args.output)


if __name__ == "__main__":
    main()
