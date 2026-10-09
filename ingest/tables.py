"""Read, validate and write normalized CSVs."""

from __future__ import annotations

import csv
from pathlib import Path

from .schema import TABLES, Table, parse_value


class ValidationError(Exception):
    pass


def table_files(data_dir: Path, table: str) -> list[Path]:
    """`draw.csv` plus any `draw.<source>.csv`, sorted so later sources override earlier.

    Parser output goes to `<table>.<source>.csv`; hand-entered fixes can go in
    `<table>.zz-manual.csv` (or any name sorting last) to override parsed rows.
    """
    base = data_dir / f"{table}.csv"
    extra = sorted(data_dir.glob(f"{table}.*.csv"))
    return ([base] if base.exists() else []) + extra


def read_table(data_dir: Path, name: str) -> tuple[list[dict], list[str]]:
    """Returns (rows, problems). Rows with problems are skipped. Later files win on key."""
    table = TABLES[name]
    by_key: dict[tuple, dict] = {}
    problems: list[str] = []
    for path in table_files(data_dir, name):
        with path.open(newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            unknown = set(reader.fieldnames or []) - set(table.columns)
            if unknown:
                problems.append(f"{path.name}: unknown columns {sorted(unknown)} ignored")
            for lineno, raw in enumerate(reader, start=2):
                where = f"{path.name}:{lineno}"
                try:
                    row = _coerce(table, raw)
                except (ValueError, ValidationError) as e:
                    problems.append(f"{where}: {e}")
                    continue
                by_key[tuple(_key_part(row[k]) for k in table.key)] = row
    return list(by_key.values()), problems


def _key_part(v):
    return tuple(v) if isinstance(v, list) else v


def _coerce(table: Table, raw: dict) -> dict:
    row = {}
    for col, kind in table.columns.items():
        try:
            row[col] = parse_value(kind, raw.get(col) or "")
        except ValueError:
            raise ValidationError(f"{col}={raw.get(col)!r} is not a valid {kind}")
    missing = [c for c in table.required if row[c] in (None, [], "")]
    if missing:
        raise ValidationError(f"missing required {missing}")
    if table.name == "draw":
        if row["residency"] not in ("R", "NR"):
            raise ValidationError(f"residency must be R or NR, got {row['residency']!r}")
        if row["drawn"] > row["applicants"]:
            raise ValidationError(f"drawn ({row['drawn']}) > applicants ({row['applicants']})")
    if table.name == "harvest" and row["hunters"] is not None and row["harvest"] > row["hunters"]:
        raise ValidationError(f"harvest ({row['harvest']}) > hunters ({row['hunters']})")
    if table.name == "hunts" and row["draw_system"] not in (None, "preference", "bonus", "random", "general"):
        raise ValidationError(f"draw_system must be preference, bonus, random or general, got {row['draw_system']!r}")
    for col in ("state", "species", "weapon", "sex", "draw_system"):
        if col in row and isinstance(row[col], str):
            row[col] = row[col].upper() if col == "state" else row[col].lower()
    return row


def write_table(path: Path, name: str, rows: list[dict]) -> None:
    table = TABLES[name]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(table.columns), extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(
                {
                    c: ";".join(v) if isinstance(v, list) else ("" if v is None else v)
                    for c, v in ((c, r.get(c)) for c in table.columns)
                }
            )
