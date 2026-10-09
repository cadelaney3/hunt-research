"""Montana FWP drawing statistics.

Reads a "<year> <License> Detailed Bonus Point Drawing Statistics.pdf" (first-choice
applicants and successes per residency and bonus-point level) and, when it sits
next to it, the matching "<year> <License> Drawing Statistics Report.pdf"
(ALS30401) for the quota.

Montana's draw is a bonus-point lottery: each applicant gets points² + 1 chances,
so odds rise with points but nobody is guaranteed. Landowner-preference rows are
skipped (separate pool, few applicants).
"""

from __future__ import annotations

import re
from pathlib import Path

import pdfplumber

from . import ParseResult, parser

STATE = "MT"

DETAIL_LINE = re.compile(
    r"^(?P<label>.*?)\s+(?P<res>RESIDENT LANDOWNER|NONRESIDENT LANDOWNER|RESIDENT|NONRESIDENT)"
    r"\s+(?P<points>\d+)\s+(?P<apps>\d+)\s+(?P<succ>\d+)\s+[\d.]+$"
)
DISTRICT = re.compile(r"\b(\d{3}-\d{2})\b")
# ALS30401 rows: district label, then 23 numeric columns (UNL = unlimited).
SUMMARY_LINE = re.compile(r"^(?P<label>\d{3}-\d{2}.*?)\s+(?P<nums>(?:(?:\d+|UNL)\s+){22}(?:\d+|UNL))$")

# Item description prefix -> (species, license label, sex)
LICENSES = {
    "ELK PERMIT": ("elk", "Elk permit", None),
    "ELK B LICENSE": ("elk", "Elk B (antlerless)", "female"),
    "DEER PERMIT": (None, "Deer permit", None),  # species from MULE / WT suffix
    "ANTELOPE LICENSE": ("pronghorn", "Antelope license", None),
    "ANTELOPE B LICENSE": ("pronghorn", "Antelope B (doe/fawn)", "female"),
    "BIGHORN SHEEP LICENSE": ("bighorn sheep", "Bighorn sheep license", None),
    "MOOSE LICENSE": ("moose", "Moose license", None),
    "MOUNTAIN GOAT LICENSE": ("mountain goat", "Mountain goat license", None),
}
# Suffixes that are part of the license identity (kept in the hunt code).
QUALIFIERS = {
    "MULE": ("mule deer", None, None),
    "WT": ("whitetail deer", None, None),
    "ADULT EWE": (None, "Bighorn sheep (ewe)", "female"),
    "ANTLERLESS": (None, "Moose (antlerless)", "female"),
}


@parser("mt_draw", "Montana FWP detailed bonus point drawing statistics (+ matching summary report for quotas)")
def parse(pdf_path: Path, year: int | None) -> ParseResult:
    if "Detailed Bonus Point" not in pdf_path.name:
        return {}  # summary reports are read alongside their detailed report
    year = year or _year_from_name(pdf_path)
    hunts: dict[str, dict] = {}
    draw: list[dict] = []
    skipped_landowner = 0

    for line in _lines(pdf_path):
        m = DETAIL_LINE.match(line)
        if not m:
            continue
        if "LANDOWNER" in m["res"]:
            skipped_landowner += 1
            continue
        hunt = _hunt_from_label(m["label"])
        hunts.setdefault(hunt["hunt_code"], hunt)
        draw.append(
            {
                "state": STATE,
                "year": year,
                "hunt_code": hunt["hunt_code"],
                "residency": "R" if m["res"] == "RESIDENT" else "NR",
                "points": int(m["points"]),
                "applicants": int(m["apps"]),
                "drawn": int(m["succ"]),
            }
        )

    quotas = _summary_quotas(pdf_path)
    for row in draw:
        district = DISTRICT.search(row["hunt_code"])[1]
        q = quotas.get((district, _qualifier(row["hunt_code"])))
        row["quota"] = q if isinstance(q, int) else None
        hunt = hunts[row["hunt_code"]]
        if q == "UNL" and "Unlimited quota" not in (hunt["notes"] or ""):
            hunt["notes"] = _join(hunt["notes"], "Unlimited quota")

    print(f"  {pdf_path.name}: {len(hunts)} hunts, {len(draw)} draw rows, "
          f"{skipped_landowner} landowner rows skipped, quotas for {len(quotas)} districts")
    return {"hunts": list(hunts.values()), "draw": draw}


def _hunt_from_label(label: str) -> dict:
    district = DISTRICT.search(label)
    if not district:
        raise ValueError(f"no district code in {label!r}")
    item = label[: district.start()].strip()
    rest = label[district.end():].strip()
    species, license_, sex = LICENSES[item]

    qualifier = next((q for q in QUALIFIERS if re.search(rf"\b{q}\b", rest)), None)
    if qualifier:
        q_species, q_license, q_sex = QUALIFIERS[qualifier]
        species, license_, sex = q_species or species, q_license or license_, q_sex or sex
        rest = re.sub(rf"\b{qualifier}\b", "", rest).strip()

    notes = []
    if "ARCHERY ONLY" in rest:
        notes.append("Archery only")
    if re.search(r"first (choice )?(and )?only", rest, re.I):
        notes.append("First choice only")

    code = f"{item} {district[1]}" + (f" {qualifier}" if qualifier else "")
    return {
        "state": STATE,
        "species": species,
        "license": license_,
        "draw_system": "bonus",
        "hunt_code": code,
        "units": [district[1][:3]],
        "weapon": "archery" if "ARCHERY ONLY" in rest else "any",
        "season": None,
        "sex": sex,
        "notes": "; ".join(notes) or None,
    }


def _summary_quotas(detail_pdf: Path) -> dict[tuple[str, str | None], int | str]:
    """{(district, qualifier): quota or 'UNL'} from the sibling ALS30401 summary report."""
    name = detail_pdf.name.replace("Detailed Bonus Point Drawing Statistics", "Drawing Statistics Report")
    summary = detail_pdf.with_name(name)
    if summary == detail_pdf or not summary.exists():
        print(f"  (no summary report {summary.name!r}; quotas left blank)")
        return {}
    out = {}
    for line in _lines(summary):
        m = SUMMARY_LINE.match(line.strip())
        if not m:
            continue
        district = DISTRICT.search(m["label"])[1]
        quota = m["nums"].split()[0]
        out[(district, _qualifier(m["label"]))] = "UNL" if quota == "UNL" else int(quota)
    return out


def _qualifier(label: str) -> str | None:
    return next((q for q in QUALIFIERS if re.search(rf"\b{q}\b", label)), None)


def _lines(pdf_path: Path):
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            yield from (page.extract_text() or "").splitlines()


def _year_from_name(path: Path) -> int:
    m = re.search(r"\b(20\d{2})\b", path.name)
    if not m:
        raise ValueError(f"can't infer year from {path.name!r}; pass --year")
    return int(m[1])


def _join(a: str | None, b: str) -> str:
    return f"{a}; {b}" if a else b
