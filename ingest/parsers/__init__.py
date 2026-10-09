"""Parser registry.

A parser turns one PDF into rows for one or more normalized tables. Each state
(and often each report type within a state) needs its own parser because the
layouts differ. Workflow for a new PDF:

  1. python -m ingest explore data/raw/<state>/.../report.pdf
  2. look at data/explore/report/*.csv and text.txt to learn the layout
  3. copy _template.py to <state>_<report>.py and fill it in
  4. python -m ingest parse <state>_<report> data/raw/<state>/.../report.pdf --year 2025
"""

from __future__ import annotations

import importlib
import pkgutil
from pathlib import Path
from typing import Callable, Protocol

# A parser returns {table_name: [row dicts]} using the columns in schema.py.
ParseResult = dict[str, list[dict]]


class Parser(Protocol):
    def __call__(self, pdf_path: Path, year: int | None) -> ParseResult: ...


REGISTRY: dict[str, tuple[Parser, str]] = {}


def parser(name: str, description: str) -> Callable[[Parser], Parser]:
    def register(fn: Parser) -> Parser:
        REGISTRY[name] = (fn, description)
        return fn

    return register


def load_all() -> dict[str, tuple[Parser, str]]:
    for mod in pkgutil.iter_modules(__path__):
        if not mod.name.startswith("_"):
            importlib.import_module(f"{__name__}.{mod.name}")
    return REGISTRY
