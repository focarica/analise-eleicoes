"""Permite ``python3 -m scripts.propostas_governo.segmentacao``."""
import sys

from .pipeline import main

if __name__ == "__main__":
    sys.exit(main())
