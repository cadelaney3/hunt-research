"""Generate a fictional dataset (state "ZZ") so the app can be built and tried
before real PDFs are parsed. None of these numbers describe a real unit."""

from __future__ import annotations

import random
from pathlib import Path

from .tables import write_table

STATE = "ZZ"
YEARS = range(2021, 2026)

SPECIES = {
    # weapon/season, quota multiplier, base success
    "elk": [("archery", "archery", 1.4, 0.13), ("rifle", "1st rifle", 0.6, 0.38),
            ("rifle", "2nd rifle", 1.0, 0.27), ("rifle", "3rd rifle", 1.0, 0.22),
            ("muzzleloader", "muzzleloader", 0.4, 0.24)],
    "mule deer": [("archery", "archery", 0.8, 0.22), ("rifle", "2nd rifle", 0.9, 0.48),
                  ("rifle", "3rd rifle", 1.0, 0.55), ("muzzleloader", "muzzleloader", 0.3, 0.42)],
}
SPECIES_CODE = {"elk": "E", "mule deer": "D"}


def generate(out_dir: Path, seed: int = 7) -> None:
    rng = random.Random(seed)
    units, hunts, draw, harvest, population, quality = [], [], [], [], [], []

    unit_ids = [str(n) for n in sorted(rng.sample(range(1, 90), 28))]
    traits = {}
    for u in unit_ids:
        q = rng.random()  # latent trophy quality
        traits[u] = {
            "q": q,
            "density": rng.uniform(0.6, 1.4),  # relative animal density
            "area": round(rng.uniform(180, 950)),
            "public": round(rng.uniform(15, 95)),
        }
        units.append({
            "state": STATE, "unit": u, "name": f"Sample Unit {u}",
            "area_sq_mi": traits[u]["area"], "public_land_pct": traits[u]["public"],
            "notes": rng.choice(["", "", "Mostly timbered north slopes",
                                 "Road closures after 1st season", "Private ranches in lower elevations",
                                 "Wilderness access only on east side"]),
        })

    # Herds span 1-3 neighboring units.
    herds, i = [], 0
    while i < len(unit_ids):
        size = rng.choice([1, 2, 2, 3])
        herds.append(unit_ids[i:i + size])
        i += size

    for species, seasons in SPECIES.items():
        sc = SPECIES_CODE[species]
        base_density = 2.4 if species == "elk" else 3.8
        max_pts = 20 if species == "elk" else 12

        for h_i, herd_units in enumerate(herds):
            area = sum(traits[u]["area"] for u in herd_units)
            dens = sum(traits[u]["density"] for u in herd_units) / len(herd_units)
            q = sum(traits[u]["q"] for u in herd_units) / len(herd_units)
            for y_i, y in enumerate(YEARS):
                trend = 1 + (dens - 1) * 0.04 * y_i + rng.uniform(-0.05, 0.05)
                population.append({
                    "state": STATE, "species": species, "year": y, "herd": f"{sc}-H{h_i + 1}",
                    "units": herd_units,
                    "population": round(area * base_density * dens * trend / 10) * 10,
                    "males_per_100_females": round(14 + q * 26 + rng.uniform(-3, 3), 1),
                })

        for u in unit_ids:
            t = traits[u]
            for y in YEARS:
                quality.append({
                    "state": STATE, "species": species, "year": y, "unit": u,
                    "pct_mature_males": round(max(3, 8 + t["q"] * 55 + rng.uniform(-6, 6)), 1),
                    "avg_age": round(2.2 + t["q"] * 3.2 + rng.uniform(-0.4, 0.4), 1),
                })
            if rng.random() < 0.35:
                quality.append({
                    "state": STATE, "species": species, "year": None, "unit": u,
                    "rating": rng.randint(2, 5),
                    "notes": rng.choice(["Glassed good bulls/bucks on scouting trip",
                                         "Heavy pressure near trailheads", "Friend drew in 2023, saw lots of animals",
                                         "Steep, hard to pack out"]),
                })

            for weapon, season, quota_mult, base_success in seasons:
                code = f"{sc}{'M'}{int(u):03d}{season[:1].upper()}{weapon[:1].upper()}"
                hunts.append({
                    "state": STATE, "species": species, "hunt_code": code, "units": [u],
                    "weapon": weapon, "season": season, "sex": "male",
                })
                # Better units are more popular and more tightly limited.
                popularity = 0.4 + t["q"] ** 1.5 * 3.5 + (t["public"] / 100) * 0.6
                quota_base = t["area"] / 20 * quota_mult * (1.3 - t["q"] * 0.8)
                for y in YEARS:
                    quota = max(5, round(quota_base * rng.uniform(0.9, 1.1)))
                    for res, share, pop_mult in (("R", 0.8, 1.0), ("NR", 0.2, 0.7)):
                        _draw_rows(rng, draw, code, y, res, round(quota * share),
                                   popularity * pop_mult, max_pts, quota)
                    success = base_success * (0.55 + t["density"] * 0.45) * (0.85 + t["q"] * 0.3)
                    hunters = round(quota * rng.uniform(0.85, 0.97))
                    harvest.append({
                        "state": STATE, "year": y, "hunt_code": code, "hunters": hunters,
                        "harvest": min(hunters, round(hunters * min(0.9, success * rng.uniform(0.85, 1.15)))),
                        "days": round(hunters * rng.uniform(3.5, 5.5)),
                    })

    for name, rows in [("units", units), ("hunts", hunts), ("draw", draw),
                       ("harvest", harvest), ("population", population), ("quality", quality)]:
        write_table(out_dir / f"{name}.csv", name, rows)
    print(f"sample data: {len(hunts)} hunts, {len(unit_ids)} units -> {out_dir}")


def _draw_rows(rng, out, code, year, res, tags, demand, max_pts, quota):
    """Preference-point draw: tags go to the highest point levels first."""
    levels = []
    for p in range(max_pts + 1):
        # Applicants scale with tags and demand; popular hunts have long point tails.
        decay = min(0.85, 0.68 + 0.03 * demand)
        n = round(max(tags, 4) * 0.35 * demand ** 1.8 * decay ** p * rng.uniform(0.85, 1.15))
        levels.append([p, max(0, n), 0])
    remaining = tags
    for lvl in reversed(levels):
        take = min(lvl[1], remaining)
        lvl[2] = take
        remaining -= take
    for p, applicants, drawn in levels:
        if applicants:
            out.append({"state": STATE, "year": year, "hunt_code": code, "residency": res,
                        "points": p, "applicants": applicants, "drawn": drawn, "quota": quota})
