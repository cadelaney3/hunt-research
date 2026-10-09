"""Download Montana FWP hunting district map PDFs (area, land cover, ownership).

URL pattern: .../gisresources/hdmaps/<group>/<group>hd<district>.pdf
Districts come from the loaded hunts and population herds, per map
group, since deer/elk, antelope, moose, sheep and goat districts have different
boundaries. Files already on disk are skipped, requests are spaced out, and a
404 falls back to sub-districts seen in the harvest data (411 -> 411E, 411W).
"""

from __future__ import annotations

import time
import urllib.error
import urllib.request
from pathlib import Path

from .build import load_all

BASE = "https://fwp.mt.gov/binaries/content/assets/fwp/gisresources/hdmaps"
GROUPS = {
    "deerelk": ("elk", "mule deer", "whitetail deer"),
    "antelope": ("pronghorn",),
    "moose": ("moose",),
    "sheep": ("bighorn sheep",),
    "goat": ("mountain goat",),
}
SPECIES_GROUP = {sp: g for g, sps in GROUPS.items() for sp in sps}
HEADERS = {"User-Agent": "hunt-research/0.1 (personal hunt planning)"}


def districts_by_group(data_dir: Path) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    tables, _ = load_all(data_dir)
    wanted: dict[str, set[str]] = {g: set() for g in GROUPS}
    harvest_units: dict[str, set[str]] = {g: set() for g in GROUPS}
    for h in tables["hunts"]:
        if h["state"] == "MT" and h["species"] in SPECIES_GROUP:
            wanted[SPECIES_GROUP[h["species"]]].update(h["units"])
    # Herds spread over several districts need every district's area for density.
    for pop in tables["population"]:
        if pop["state"] == "MT" and pop["species"] in SPECIES_GROUP:
            wanted[SPECIES_GROUP[pop["species"]]].update(pop["units"])
    for uh in tables["unit_harvest"]:
        if uh["state"] == "MT" and uh["species"] in SPECIES_GROUP:
            harvest_units[SPECIES_GROUP[uh["species"]]].add(uh["unit"])
    return wanted, harvest_units


def fetch(data_dir: Path, out_root: Path, delay: float = 1.0) -> None:
    wanted, harvest_units = districts_by_group(data_dir)
    missing: list[str] = []
    downloaded = skipped = 0
    for group, units in wanted.items():
        out = out_root / group
        out.mkdir(parents=True, exist_ok=True)
        for unit in sorted(units):
            candidates = [unit] + sorted(u for u in harvest_units[group] if u != unit and u.startswith(unit) and u[len(unit):].isalpha())
            got = False
            for i, district in enumerate(candidates):
                dest = out / f"{group}hd{district}.pdf"
                if dest.exists():
                    skipped += 1
                    got = True
                    if i == 0:
                        break
                    continue
                status = _download(f"{BASE}/{group}/{group}hd{district}.pdf", dest)
                time.sleep(delay)
                if status == 200:
                    downloaded += 1
                    got = True
                    if i == 0:
                        break  # whole district found; no need for sub-districts
                elif i == 0 and len(candidates) == 1:
                    break
            if not got:
                missing.append(f"{group}/{unit}")
        print(f"  {group}: {len(units)} districts")
    print(f"downloaded {downloaded}, already had {skipped}, not found {len(missing)}")
    if missing:
        print("  not found:", ", ".join(missing))


def _download(url: str, dest: Path) -> int:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as r:
            body = r.read()
        if not body.startswith(b"%PDF"):
            print(f"  ! {url}: not a PDF")
            return 0
        dest.write_bytes(body)
        return 200
    except urllib.error.HTTPError as e:
        return e.code
    except urllib.error.URLError as e:
        print(f"  ! {url}: {e.reason}")
        return 0
