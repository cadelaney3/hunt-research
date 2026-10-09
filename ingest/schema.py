"""Normalized CSV schema.

Every data source (PDF parser, hand entry, spreadsheet export) ends up as rows in
these CSVs under data/normalized/. The build step joins them into the JSON the
web app reads. Keys are strings; `units` fields are semicolon-separated lists.
"""

from __future__ import annotations

from dataclasses import dataclass

# Column -> type. "str", "int", "float", "list" (semicolon-separated).
# Columns listed in `required` must be non-empty on every row.


@dataclass(frozen=True)
class Table:
    name: str
    columns: dict[str, str]
    required: tuple[str, ...]
    key: tuple[str, ...]
    description: str


TABLES: dict[str, Table] = {
    t.name: t
    for t in [
        Table(
            name="units",
            columns={
                "state": "str",
                "species": "str",  # blank = same boundary for every species
                "unit": "str",
                "name": "str",
                "area_sq_mi": "float",
                "public_land_pct": "float",
                "notes": "str",
            },
            required=("state", "unit"),
            key=("state", "species", "unit"),
            description="Game management units: size and land ownership. Species-specific rows win over blank-species rows.",
        ),
        Table(
            name="hunts",
            columns={
                "state": "str",
                "species": "str",
                "hunt_code": "str",
                "license": "str",  # tag type, e.g. "Elk permit" vs "Elk B (antlerless)"; ranked separately
                "draw_system": "str",  # preference | bonus | random (how points affect odds) | general (no draw)
                "units": "list",
                "weapon": "str",  # rifle | archery | muzzleloader | any
                "season": "str",  # e.g. "1st rifle", "Oct 14-22"
                "sex": "str",  # male | female | either
                "notes": "str",
            },
            required=("state", "species", "hunt_code", "units"),
            key=("state", "hunt_code"),
            description="A drawable tag/hunt: the thing you apply for. Ranked rows.",
        ),
        Table(
            name="draw",
            columns={
                "state": "str",
                "year": "int",
                "hunt_code": "str",
                "residency": "str",  # R | NR
                "points": "int",  # preference/bonus point level of the applicants
                "applicants": "int",  # first-choice applicants at this point level
                "drawn": "int",  # of those, how many drew
                "quota": "int",  # total tags for the hunt that year (repeat per row ok)
            },
            required=("state", "year", "hunt_code", "residency", "points", "applicants", "drawn"),
            key=("state", "year", "hunt_code", "residency", "points"),
            description="Draw results by point level. One row per point level per residency.",
        ),
        Table(
            name="harvest",
            columns={
                "state": "str",
                "year": "int",
                "hunt_code": "str",
                "hunters": "int",
                "harvest": "int",
                "days": "float",  # total hunter-days, optional
            },
            required=("state", "year", "hunt_code", "hunters", "harvest"),
            key=("state", "year", "hunt_code"),
            description="Post-season harvest survey results.",
        ),
        Table(
            name="unit_harvest",
            columns={
                "state": "str",
                "species": "str",
                "year": "int",
                "unit": "str",
                "hunters": "int",  # blank = not estimated that year (not zero)
                "harvest": "int",  # this species, all sexes
                "days": "float",
                "males": "int",
                "females": "int",
                "young": "int",
                "mature_males": "int",  # e.g. elk 6+ points, deer 4+ points
                "classified_males": "int",  # males with an antler class recorded (denominator for mature %)
                "bow": "int",
                "rifle": "int",
            },
            required=("state", "species", "year", "unit", "harvest"),
            key=("state", "species", "year", "unit"),
            description="Harvest survey by unit/district, all hunters combined. Used when a hunt has no hunt-level harvest row.",
        ),
        Table(
            name="population",
            columns={
                "state": "str",
                "species": "str",
                "year": "int",
                "herd": "str",  # DAU / herd unit / hunt area name
                "units": "list",  # units the herd covers
                "population": "int",
                "males_per_100_females": "float",
                "latest_count": "int",  # most recent single count, when population is an average
                "latest_count_year": "int",
                "objective_low": "int",  # agency population goal range
                "objective_high": "int",
                "status": "str",  # at | above | below (vs objective)
                "notes": "str",
            },
            required=("state", "species", "year", "herd", "units"),
            key=("state", "species", "year", "herd"),
            description="Herd population estimates and sex ratios.",
        ),
        Table(
            name="quality",
            columns={
                "state": "str",
                "species": "str",
                "year": "int",
                "unit": "str",
                "pct_mature_males": "float",  # e.g. % of harvested bulls 6pt+, bucks 4pt+
                "avg_age": "float",  # mean age of harvested males
                "rating": "float",  # your own 1-5 rating from scouting/research
                "notes": "str",
            },
            required=("state", "species", "unit"),
            key=("state", "species", "year", "unit"),
            description="Trophy-quality indicators per unit. Any subset of metrics.",
        ),
    ]
}


def parse_value(kind: str, raw: str):
    raw = (raw or "").strip()
    if raw == "":
        return [] if kind == "list" else None
    if kind == "int":
        return int(float(raw.replace(",", "")))
    if kind == "float":
        return float(raw.replace(",", "").rstrip("%"))
    if kind == "list":
        return [p.strip() for p in raw.split(";") if p.strip()]
    return raw
