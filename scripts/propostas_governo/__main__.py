"""Permite ``python3 -m scripts.propostas_governo``."""
from __future__ import annotations

import sys

from .coletor import main

if __name__ == "__main__":
    sys.exit(main())
