"""Montana FWP harvest estimates (fwpHarvestEstimatesReport<Species>.csv).

One row per license year × hunting district × residency. We keep the SUM
(all-residency) rows for real districts and skip regional/statewide rollups
(Reg_1, 3XX, State).

FWP estimates hunter numbers only every other year per species (elk in even
years, deer in odd years, ...). Those years report Hunters = 0 alongside real
harvest, so 0 hunters with harvest is stored as blank (unknown), not zero.

Deer hunters are district-wide deer hunters, repeated on the md / wt rows, so
mule deer success = mule deer harvested per deer hunter (a lower bound for a
mule deer permit holder, but comparable across districts).
"""

from __future__ import annotations

import csv
import re
from pathlib import Path

from . import ParseResult, parser

STATE = "MT"

# file suffix -> [(species, deer-species column value or None)]
FILES = {
    "Elk": [("elk", None)],
    "Deer": [("mule deer", "md"), ("whitetail deer", "wt")],
    "Antelope": [("pronghorn", None)],
    "Moose": [("moose", None)],
    "Sheep": [("bighorn sheep", None)],
    "Goats": [("mountain goat", None)],
}
# column name in the CSV -> our column (first match wins)
MALES = ("Bulls", "Bucks", "Rams", "Billies")
FEMALES = ("Cows", "Does", "Ewes", "Nannies")
YOUNG = ("Calves", "Fawns", "Lambs", "Kids")
MATURE = {"elk": "6 or More Points", "mule deer": "4 or More Points", "whitetail deer": "4 or More Points"}
CLASSES = {
    "elk": ("Spike Bull Elk", "Less than 6 Points", "6 or More Points"),
    "mule deer": ("Less than 4 Points", "4 or More Points"),
    "whitetail deer": ("Less than 4 Points", "4 or More Points"),
}
DISTRICT = re.compile(r"^\d{3}[A-Z]*$")  # 380, 411E, 520NW; not 3XX / Reg_3 / State


@parser("mt_harvest", "Montana FWP harvest estimates CSVs (fwpHarvestEstimatesReport<Species>.csv)")
def parse(path: Path, year: int | None) -> ParseResult:
    m = re.search(r"fwpHarvestEstimatesReport(\w+)\.csv$", path.name)
    if not m or m[1] not in FILES:
        print(f"  skipping {path.name}: not a recognised FWP harvest export")
        return {}
    with path.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    header = [h.strip() for h in rows[0]]
    records = [dict(zip(header, r)) for r in rows[1:] if r]  # zip drops the trailing empty column

    out, unknown_hunters, rollups = [], 0, set()
    for species, deer_code in FILES[m[1]]:
        for r in records:
            if r["Residency"] != "SUM" or (deer_code and r.get("Deer Species") != deer_code):
                continue
            if year and int(r["License Year"]) != year:
                continue
            unit = r["Hunting District"]
            if not DISTRICT.match(unit):
                rollups.add(unit)
                continue
            num = lambda *cols: next((int(r[c]) for c in cols if r.get(c) not in (None, "")), None)
            harvest, hunters = num("Total Harvest"), num("Hunters")
            if hunters == 0:
                hunters = None  # not estimated this year
                unknown_hunters += 1
            classes = CLASSES.get(species)
            out.append({
                "state": STATE,
                "species": species,
                "year": int(r["License Year"]),
                "unit": unit,
                "hunters": hunters,
                "harvest": harvest,
                "days": num("Days") or None,
                "males": num(*MALES),
                "females": num(*FEMALES),
                "young": num(*YOUNG),
                "mature_males": num(MATURE[species]) if species in MATURE else None,
                "classified_males": sum(num(c) or 0 for c in classes) if classes else None,
                "bow": num("Bow"),
                "rifle": num("Rifle"),
            })
    hunts = _general_hunts(out)
    print(f"  {path.name}: {len(out)} district-years, {unknown_hunters} without a hunter estimate, "
          f"{len(hunts)} general-season hunts, skipped rollups {sorted(rollups)}")
    return {"unit_harvest": out, "hunts": hunts}


# Species Montana sells a general (over-the-counter) license for. Moose, sheep,
# goat and pronghorn are draw-only, and their draw hunts come from mt_draw.
GENERAL = {"elk": "Elk general", "mule deer": "Deer general", "whitetail deer": "Deer general"}


def _general_hunts(rows: list[dict]) -> list[dict]:
    """One general-season hunt per district with harvest of that species.

    Sub-districts roll up to their district (411E + 411W -> 411), and retired
    district numbers (absent from the latest survey year) are skipped. The build step
    joins harvest, land and herd data back by district. Whether the general
    license is valid for males in a given district (vs permit-only) isn't in
    this data, so the note says to check the regulations.
    """
    # Only districts that still exist: reported in the species' latest survey year
    # (Montana renumbered districts after 2021; old numbers stop appearing).
    latest = {sp: max((r["year"] for r in rows if r["species"] == sp), default=None) for sp in GENERAL}
    current = {(r["species"], r["unit"][:3]) for r in rows if r["species"] in GENERAL and r["year"] == latest[r["species"]]}
    harvested: dict[tuple[str, str], int] = {}
    for r in rows:
        if r["species"] in GENERAL and (r["species"], r["unit"][:3]) in current:
            key = (r["species"], r["unit"][:3])
            harvested[key] = harvested.get(key, 0) + (r["harvest"] or 0)
    return [
        {
            "state": STATE,
            "species": species,
            "license": GENERAL[species],
            "draw_system": "general",
            "hunt_code": f"{GENERAL[species].upper()} {district}" + (" MULE" if species == "mule deer" else " WT" if species == "whitetail deer" else ""),
            "units": [district],
            "weapon": "any",
            "season": None,
            "sex": None,
            "notes": "General license, no draw. Check regulations for legal animals in this district.",
        }
        for (species, district), total in sorted(harvested.items())
        if total > 0
    ]
