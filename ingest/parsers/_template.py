"""Template for a state-specific parser. Copy to <state>_<report>.py (no leading
underscore, or it won't be registered) and adapt.

Run `python -m ingest explore <pdf>` first and look at the CSVs it writes: the
table rows below come from the same pdfplumber extraction.
"""

from __future__ import annotations

from pathlib import Path

import pdfplumber

from . import ParseResult, parser


@parser("xx_draw_recap", "XX draw recap: applicants and successes by point level")
def parse(pdf_path: Path, year: int | None) -> ParseResult:
    rows = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for cells in table:
                    # Skip headers / blank lines; identify data rows by shape.
                    if not cells or not (cells[0] or "").strip()[:1].isalpha():
                        continue
                    hunt_code, residency, points, applicants, drawn = cells[:5]
                    rows.append(
                        {
                            "state": "XX",
                            "year": year,
                            "hunt_code": hunt_code.strip(),
                            "residency": "R" if residency.startswith("R") else "NR",
                            "points": points,
                            "applicants": applicants,
                            "drawn": drawn,
                        }
                    )
    return {"draw": rows}
