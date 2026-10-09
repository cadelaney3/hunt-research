"""Join normalized tables into the single JSON document the web app loads."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from .schema import TABLES
from .tables import read_table


def load_all(data_dir: Path) -> tuple[dict[str, list[dict]], list[str]]:
    tables, problems = {}, []
    for name in TABLES:
        rows, p = read_table(data_dir, name)
        tables[name] = rows
        problems += p
    return tables, problems


def build(data_dir: Path, out: Path, source_label: str) -> dict:
    t, warnings = load_all(data_dir)

    units_exact = {(u["state"], u["species"], u["unit"]): u for u in t["units"]}

    def unit_info(state: str, species: str | None, unit: str) -> dict | None:
        return units_exact.get((state, species, unit)) or units_exact.get((state, None, unit))

    # Population is reported per herd; spread it over the herd's units as a density.
    # unit_pop[(state, species, unit)][year] = {density, ratio}
    unit_pop: dict[tuple, dict[int, dict]] = defaultdict(dict)
    for p in t["population"]:
        area = sum((unit_info(p["state"], p["species"], u) or {}).get("area_sq_mi") or 0 for u in p["units"])
        if p["population"] is not None and not area:
            warnings.append(
                f"population {p['state']} {p['species']} {p['herd']} {p['year']}: "
                f"no unit areas for {p['units']}, density unknown"
            )
        for u in p["units"]:
            unit_pop[(p["state"], p["species"], u)][p["year"]] = {
                "density": p["population"] / area if p["population"] is not None and area else None,
                "ratio": p["males_per_100_females"],
                "herd": p["herd"],
                "info": {
                    "herd": p["herd"],
                    "units": p["units"],
                    "population": p["population"],
                    "area_sq_mi": round(area, 1) if area else None,
                    "latest_count": p["latest_count"],
                    "latest_count_year": p["latest_count_year"],
                    "objective_low": p["objective_low"],
                    "objective_high": p["objective_high"],
                    "status": p["status"],
                    "notes": p["notes"],
                },
            }

    # Quality rows without a year apply to every year (e.g. your own rating).
    unit_quality: dict[tuple, dict] = defaultdict(dict)
    for q in t["quality"]:
        unit_quality[(q["state"], q["species"], q["unit"])][q["year"]] = q

    draw_by: dict[tuple, dict[int, list]] = defaultdict(lambda: defaultdict(list))
    for d in t["draw"]:
        draw_by[(d["state"], d["hunt_code"])][d["year"]].append(d)
    harvest_by = {(h["state"], h["hunt_code"], h["year"]): h for h in t["harvest"]}

    # District-level harvest (all hunters), used when a hunt has no hunt-level row.
    unit_harvest: dict[tuple, dict[int, dict]] = defaultdict(dict)
    for uh in t["unit_harvest"]:
        unit_harvest[(uh["state"], uh["species"], uh["unit"])][uh["year"]] = uh
    harvest_units_of: dict[tuple, list[str]] = {}

    def harvest_units(st: str, sp: str, unit: str) -> list[str]:
        """The unit itself, else its sub-districts (411 -> 411E, 411W)."""
        key = (st, sp, unit)
        if key not in harvest_units_of:
            if key in unit_harvest:
                harvest_units_of[key] = [unit]
            else:
                harvest_units_of[key] = sorted(
                    u for (s2, sp2, u) in unit_harvest if s2 == st and sp2 == sp and u[:len(unit)] == unit
                    and u[len(unit):].isalpha()
                )
        return harvest_units_of[key]

    no_harvest: dict[str, set[str]] = defaultdict(set)

    # Male draw permits per district, to flag general hunts that share a district
    # with a limited permit (general license may be antlerless/archery-only there).
    permits_in: dict[tuple, list[str]] = defaultdict(list)
    for h in t["hunts"]:
        if h["draw_system"] != "general" and h["sex"] != "female":
            for u in h["units"]:
                permits_in[(h["state"], h["species"], u)].append(h["hunt_code"])

    hunts_out = []
    missing_units: set[tuple[str, str]] = set()
    for h in t["hunts"]:
        st, sp, code = h["state"], h["species"], h["hunt_code"]
        unit_rows = []
        for u in h["units"]:
            info = unit_info(st, sp, u) or _combine_subunits(
                [unit_info(st, sp, hu) for hu in harvest_units(st, sp, u) if hu != u]
            )
            if not info:
                missing_units.add((st, u))
            unit_rows.append(
                {
                    "unit": u,
                    "name": (info or {}).get("name"),
                    "area_sq_mi": (info or {}).get("area_sq_mi"),
                    "public_land_pct": (info or {}).get("public_land_pct"),
                    "notes": (info or {}).get("notes"),
                }
            )
        area = sum(r["area_sq_mi"] or 0 for r in unit_rows) or None
        public = _weighted([(r["public_land_pct"], r["area_sq_mi"]) for r in unit_rows])

        h_units = [hu for u in h["units"] for hu in harvest_units(st, sp, u)]
        if t["unit_harvest"] and not h_units:
            no_harvest[f"{st} {sp}"].update(h["units"])

        years = set(draw_by[(st, code)])
        years |= {y for (s, c, y) in harvest_by if s == st and c == code}
        for hu in h_units:
            years |= set(unit_harvest[(st, sp, hu)])
        for u in h["units"]:
            years |= set(unit_pop[(st, sp, u)])
            years |= {y for y in unit_quality[(st, sp, u)] if y is not None}

        year_rows = []
        for y in sorted(years):
            draws = draw_by[(st, code)].get(y, [])
            hv = harvest_by.get((st, code, y))
            uh = _sum_unit_harvest([unit_harvest[(st, sp, hu)].get(y) for hu in h_units]) if not hv else None
            pops = [(unit_pop[(st, sp, r["unit"])].get(y), r["area_sq_mi"]) for r in unit_rows]
            quals = [_quality_for(unit_quality[(st, sp, r["unit"])], y) for r in unit_rows]
            year_rows.append(
                {
                    "year": y,
                    "quota": max((d["quota"] or 0 for d in draws), default=None) or None,
                    "draw": {
                        res: sorted(
                            (
                                {"points": d["points"], "applicants": d["applicants"], "drawn": d["drawn"]}
                                for d in draws
                                if d["residency"] == res
                            ),
                            key=lambda r: r["points"],
                        )
                        for res in ("R", "NR")
                    },
                    "hunters": hv["hunters"] if hv else uh and uh["hunters"],
                    "harvest": hv["harvest"] if hv else uh and uh["harvest"],
                    "days": hv["days"] if hv else uh and uh["days"],
                    "harvest_source": "hunt" if hv else ("district" if uh else None),
                    "harvest_units": h_units if uh else [],
                    "males": uh and uh["males"],
                    "females": uh and uh["females"],
                    "bow": uh and uh["bow"],
                    "rifle": uh and uh["rifle"],
                    "pop_density": _weighted([(p and p["density"], a) for p, a in pops]),
                    "males_per_100_females": _weighted([(p and p["ratio"], a) for p, a in pops]),
                    "herds": sorted({p["herd"] for p, _ in pops if p}),
                    "herd_info": list({p["herd"]: p["info"] for p, _ in pops if p}.values()),
                    # Your quality rows win; otherwise share of classified males that were mature.
                    "pct_mature_males": _mean([q.get("pct_mature_males") for q in quals])
                    if any(q.get("pct_mature_males") is not None for q in quals)
                    else uh and uh["classified_males"] and 100 * uh["mature_males"] / uh["classified_males"],
                    "mature_males": uh and uh["mature_males"],
                    "classified_males": uh and uh["classified_males"],
                    "avg_age": _mean([q.get("avg_age") for q in quals]),
                    "rating": _mean([q.get("rating") for q in quals]),
                }
            )

        hunts_out.append(
            {
                "id": f"{st}-{code}",
                "state": st,
                "species": sp,
                "hunt_code": code,
                "license": h["license"] or sp,
                "draw_system": h["draw_system"] or "preference",
                "units": h["units"],
                "weapon": h["weapon"],
                "season": h["season"],
                "sex": h["sex"],
                "notes": h["notes"],
                "area_sq_mi": area,
                "public_land_pct": public,
                "unit_info": unit_rows,
                "permit_overlap": sorted({c for u in h["units"] for c in permits_in[(st, sp, u)]})
                if h["draw_system"] == "general" else [],
                "quality_notes": [
                    q["notes"]
                    for r in unit_rows
                    for q in unit_quality[(st, sp, r["unit"])].values()
                    if q.get("notes")
                ],
                "years": year_rows,
            }
        )

    for group, us in no_harvest.items():
        warnings.append(f"{group}: no harvest district matches unit(s) {', '.join(sorted(us))} (special permit areas?)")

    if missing_units:
        by_state: dict[str, list[str]] = defaultdict(list)
        for st, u in sorted(missing_units):
            by_state[st].append(u)
        for st, us in by_state.items():
            warnings.append(
                f"{st}: {len(us)} units have no row in units.csv (area and public land unknown): "
                + ", ".join(us[:12]) + (" ..." if len(us) > 12 else "")
            )

    doc = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": source_label,
        "hunts": hunts_out,
        "warnings": warnings,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, separators=(",", ":")))
    return doc


def _combine_subunits(rows: list[dict | None]) -> dict | None:
    """411E + 411W -> one unit: summed area, area-weighted public land."""
    rows = [r for r in rows if r and r.get("area_sq_mi")]
    if not rows:
        return None
    area = sum(r["area_sq_mi"] for r in rows)
    return {
        "name": " + ".join(r["name"] or r["unit"] for r in rows),
        "area_sq_mi": area,
        "public_land_pct": _weighted([(r["public_land_pct"], r["area_sq_mi"]) for r in rows]),
        "notes": " | ".join(f"{r['unit']}: {r['notes']}" for r in rows if r.get("notes")) or None,
    }


def _sum_unit_harvest(rows: list[dict | None]) -> dict | None:
    """Combine district rows for one year. Hunters stay unknown if any district lacks them."""
    rows = [r for r in rows if r]
    if not rows:
        return None

    def total(col, strict=False):
        vals = [r[col] for r in rows]
        if strict and any(v is None for v in vals):
            return None
        vals = [v for v in vals if v is not None]
        return sum(vals) if vals else None

    return {
        "hunters": total("hunters", strict=True),
        "harvest": total("harvest"),
        "days": total("days", strict=True),
        **{c: total(c) for c in ("males", "females", "bow", "rifle", "mature_males", "classified_males")},
    }


def _quality_for(by_year: dict, year: int) -> dict:
    """That year's row, with missing fields filled from the year-less row."""
    merged = dict(by_year.get(None) or {})
    for k, v in (by_year.get(year) or {}).items():
        if v is not None:
            merged[k] = v
    return merged


def _mean(vals):
    vals = [v for v in vals if v is not None]
    return sum(vals) / len(vals) if vals else None


def _weighted(pairs):
    """Area-weighted mean; falls back to a plain mean when areas are unknown."""
    pairs = [(v, w) for v, w in pairs if v is not None]
    if not pairs:
        return None
    total = sum(w or 0 for _, w in pairs)
    if not total:
        return _mean([v for v, _ in pairs])
    return sum(v * (w or 0) for v, w in pairs) / total
