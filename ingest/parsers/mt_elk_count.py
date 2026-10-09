"""Montana FWP annual elk count report ("<year>-elk-count.pdf").

One table row per elk management unit / hunting district group: most recent
aerial count, its year, the multi-year average, the population goal range and
status (At / Above / Below goal). Footnote markers are superscripts glued onto
numbers in the text layer ("2,3069" = 2,306 + footnote 9), so characters below
the body font size are dropped before reading the table.

Herd handling:
- "Region N Total", "STATE TOTAL", no-count rows ("Survey not conducted",
  "Counted with 411") are skipped.
- A named sub-area of a district that also has its own whole-district row
  (201 North Hills under 201) is already inside that count: skipped.
- Pieces of a district with no whole row (319 S + 319 NE, 210 N + 210 S/211/...)
  are merged with every row that shares a district, so each district maps to
  exactly one herd.
Population = the average count (FWP's own basis for goal status).
"""

from __future__ import annotations

import re
import string
from pathlib import Path

import pdfplumber

from . import ParseResult, parser

DISTRICT = re.compile(r"\b(\d{3})(?:\s?(?:N|S|E|W|NE|NW|SE|SW))?\b")
INT = re.compile(r"^[\d,]+$")


@parser("mt_elk_count", "Montana FWP annual elk count report (population, goal range, status)")
def parse(pdf_path: Path, year: int | None) -> ParseResult:
    year = year or int(re.search(r"(20\d{2})", pdf_path.name)[1])
    raw = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            body = page.filter(lambda o: o.get("object_type") != "char" or o["size"] >= 7)
            for table in body.extract_tables():
                for cells in table:
                    row = _row(cells)
                    if row:
                        raw.append(row)

    # Drop named sub-areas already counted in a whole-district row.
    whole = {tuple(r["units"]) for r in raw if not r["partial"] and not r["subname"]}
    kept = [r for r in raw if not (r["subname"] and tuple(r["units"]) in whole)]
    skipped_sub = len(raw) - len(kept)

    # Merge rows that share a district (union-find over districts).
    parent: dict[str, str] = {}

    def find(u):
        parent.setdefault(u, u)
        while parent[u] != u:
            parent[u] = parent[parent[u]]
            u = parent[u]
        return u

    for r in kept:
        for u in r["units"][1:]:
            parent[find(u)] = find(r["units"][0])
    groups: dict[str, list[dict]] = {}
    for r in kept:
        groups.setdefault(find(r["units"][0]), []).append(r)

    out = []
    for rows in groups.values():
        units = sorted({u for r in rows for u in r["units"]})
        avg = sum(r["avg"] for r in rows)
        lo = sum(r["lo"] for r in rows)
        hi = sum(r["hi"] for r in rows)
        names = sorted({r["emu"] for r in rows if r["emu"]})
        out.append({
            "state": "MT",
            "species": "elk",
            "year": year,
            "herd": f"{' / '.join(string.capwords(n.lower()) for n in names) or 'HD'} ({', '.join(units)})",
            "units": units,
            "population": avg,
            "latest_count": sum(r["latest"] for r in rows),
            "latest_count_year": max(r["latest_year"] for r in rows),
            "objective_low": lo,
            "objective_high": hi,
            "status": ("below" if avg < lo else "above" if avg > hi else "at") if len(rows) > 1 else rows[0]["status"],
            "notes": "Combined: " + "; ".join(r["label"] for r in rows) if len(rows) > 1 else None,
        })
    print(f"  {pdf_path.name}: {len(raw)} count rows, {skipped_sub} sub-areas inside a district count skipped, "
          f"{len(out)} herds covering {sum(len(o['units']) for o in out)} districts")
    return {"population": out}


def _row(cells: list) -> dict | None:
    cells = [(c or "").replace("\n", " ").strip() for c in cells] + [""] * 7
    label, emu, latest, yr, avg, goal, status = cells[:7]
    if not INT.match(latest) or not INT.match(avg) or not re.match(r"^[\d,]+-[\d,]+$", goal):
        return None  # header, totals without districts, or no-count rows
    if label.upper().startswith(("REGION", "STATE")):
        return None
    units = [m[1] for m in DISTRICT.finditer(label)]
    if not units:
        return None
    partial = bool(re.search(r"\d{3}\s?(N|S|E|W|NE|NW|SE|SW)\b", label))
    subname = re.sub(r"[\d,\s]+(?:\s?(?:N|S|E|W|NE|NW|SE|SW)\b)?", " ", label).strip(" ,()")
    lo, hi = (_int(x) for x in goal.split("-"))
    return {
        "label": label,
        "emu": emu,
        "units": units,
        "partial": partial,
        "subname": bool(re.search(r"[a-z]", subname)),  # e.g. "North Hills", "(Gold-Belmont)"
        "latest": _int(latest),
        "latest_year": max(int(y) for y in re.findall(r"20\d{2}", yr)),
        "avg": _int(avg),
        "lo": lo,
        "hi": hi,
        "status": status.lower() or None,
    }


def _int(s: str) -> int:
    return int(s.replace(",", ""))
