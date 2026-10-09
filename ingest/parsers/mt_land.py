"""Montana FWP hunting district map PDFs (.../hdmaps/<group>/<group>hd<district>.pdf).

Each has the district name, a land cover table, an ownership table
(Private / Public / Reservation / Water / Total square miles) and a breakdown of
public ownership by agency. Fetch them with `python -m ingest fetch-mt-land`.
Rows are written per species, since deer/elk, antelope, moose, sheep and goat
districts have different boundaries.
"""

from __future__ import annotations

import re
from pathlib import Path

import pdfplumber

from . import ParseResult, parser

SPECIES = {
    "deerelk": ("elk", "mule deer", "whitetail deer"),
    "antelope": ("pronghorn",),
    "moose": ("moose",),
    "sheep": ("bighorn sheep",),
    "goat": ("mountain goat",),
}
NUM = r"([\d,]+(?:\.\d+)?)"
AGENCY_SHORT = {
    "US Forest Service": "USFS",
    "US Bureau of Land Management": "BLM",
    "Montana State Trust Lands": "State trust",
    "Montana Fish, Wildlife, and Parks": "FWP",
    "US Fish and Wildlife Service": "USFWS",
    "National Park Service": "NPS",
    "Montana Department of Natural Resources and Conservation": "DNRC",
    "US Bureau of Reclamation": "BOR",
    "US Army Corps of Engineers": "USACE",
}


@parser("mt_land", "Montana FWP hunting district map PDFs: area, public land %, land cover")
def parse(pdf_path: Path, year: int | None) -> ParseResult:
    m = re.match(r"^(deerelk|antelope|moose|sheep|goat)hd(\w+)\.pdf$", pdf_path.name)
    if not m:
        print(f"  skipping {pdf_path.name}: expected <group>hd<district>.pdf")
        return {}
    group, district = m[1], m[2]
    with pdfplumber.open(pdf_path) as pdf:
        text = "\n".join(page.extract_text() or "" for page in pdf.pages)

    own = {k: (_f(a), _f(p)) for k, a, p in re.findall(rf"^(Private|Public|Reservation|Water|Total) {NUM} {NUM}$", text, re.M)}
    # Newer maps drop the Total row and state the size on its own line.
    size = re.search(rf"Hunting District Size\s*:\s*{NUM}\s*Square Miles", text)
    total = own["Total"][0] if "Total" in own else _f(size[1]) if size else sum(a for a, _ in own.values()) or None
    if "Public" not in own or not total:
        print(f"  ! {pdf_path.name}: no ownership table found")
        return {}
    # Name sits between the title and "- Legal Description" (may wrap; absent on newer maps).
    name = re.search(r"Hunting District \S+\s*\n-?\s*(\S.*?)\s*-\s*Legal\s+Description", text, re.S)
    cover = re.findall(rf"^([A-Z][A-Za-z ,/]+?) {NUM} {NUM}$", text.split("Landcover", 1)[-1].split("Ownership", 1)[0], re.M)
    agencies = re.findall(rf"^([A-Z][A-Za-z ,.]+?) {NUM}$", text.split("Public Ownership", 1)[-1], re.M)

    top_cover = sorted(((float(p), c) for c, _, p in cover), reverse=True)[:3]
    top_public = sorted(((float(p), a) for a, p in agencies if a != "Water" and float(p) >= 1), reverse=True)[:4]
    notes = "; ".join(filter(None, [
        "Public: " + ", ".join(f"{AGENCY_SHORT.get(a, a)} {p:.0f}%" for p, a in top_public) if top_public else "",
        "Cover: " + ", ".join(f"{c.lower()} {p:.0f}%" for p, c in top_cover) if top_cover else "",
        f"Reservation {own['Reservation'][1]:.0f}%" if own.get("Reservation", (0, 0))[1] >= 1 else "",
    ]))
    rows = [
        {
            "state": "MT",
            "species": sp,
            "unit": district,
            "name": " ".join(name[1].split()) if name else None,
            "area_sq_mi": total,
            "public_land_pct": own["Public"][1],
            "notes": notes or None,
        }
        for sp in SPECIES[group]
    ]
    return {"units": rows}


def _f(s: str) -> float:
    return float(s.replace(",", ""))
