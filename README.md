# Hunt Unit Ranker

Rank hunting units/tags for a species by draw odds, harvest success, population
and animal quality, using a table you can filter, sort and drill into.

```
data/raw/<state>/<species>/<year>/*.pdf    PDFs from state wildlife agencies
data/normalized/<table>[.<source>].csv     one clean schema, written by parsers or by hand
data/sample/                               fictional state "ZZ" dataset for trying things out
ingest/                                    Python: explore PDFs, parse, validate, build JSON
web/                                       React + TanStack Table app (reads web/public/data/hunts.json)
```

## Quick start

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m ingest build --sample     # or plain `build` once you have real data
cd web && npm install && npm run dev          # http://localhost:5173
```

## Data loaded so far

**Montana 2026 draw statistics** (`data/draw_statistics/`, parser `mt_draw`): 422 hunts
across elk (permits and B licenses), mule and whitetail deer permits, pronghorn
(licenses and B licenses), bighorn sheep, moose and mountain goat. Each tag
type is ranked separately (choose it under "Tag type").

```sh
.venv/bin/python -m ingest parse mt_draw data/draw_statistics/*.pdf   # summary reports are picked up automatically
.venv/bin/python -m ingest build
```

Checks: parsed rows sum exactly to each PDF's own district `TOTAL` lines (422/422).
FWP's summary report (ALS30401) counts slightly more first-choice applicants
than the detailed report for 53 hunts (usually <2%, successes match); the
detailed report is used because it has the per-point breakdown.

Montana's draw is a **bonus-point lottery** (points² + 1 chances). Per-level
observed rates are noisy, so odds come from a one-parameter model fitted to
each pool's total successes (see `drawOdds` in `web/src/scoring.ts`). On the
2026 data, points² + 1 fit far better than (p+1)², linear or flat weights.
Landowner-preference rows (724) are skipped.

Units are the first three digits of the hunt code (the hunting district).

**Montana 2021–2025 harvest estimates** (`data/harvest_statistics/`, parser `mt_harvest`):

```sh
.venv/bin/python -m ingest parse mt_harvest data/harvest_statistics/*.csv
```

The same parser also creates a **general-season hunt** (no draw, 100% odds) for
every current elk, mule deer and whitetail district: those with harvest in the
latest survey year, which skips district numbers retired after 2021. Moose,
sheep, goat and pronghorn are draw-only. A general hunt in a district that also
has a draw permit for that species is flagged "Permit district: check regs".
The data doesn't say what the general license allows there, and the district's
harvest and quality numbers include permit holders.

These are per hunting district, all hunters combined (general tags too), so
success compares districts rather than predicting a permit holder's odds. They
go in the `unit_harvest` table and are joined to hunts by district. A unit with
no exact match uses its sub-districts (411 → 411E + 411W). FWP estimates hunter
numbers only every other year per species (elk even years, deer odd years); a
0-hunter row with harvest is stored as unknown. Deer hunter counts are
district-wide deer hunters, so mule deer success = mule deer harvested per deer
hunter. Mature-male share (elk 6+ pts, deer 4+ pts among classified males)
feeds animal quality, and is skipped for antlerless/ewe tags. Special permit
areas with no matching district (elk 007, 394, 396, 399, 595, 698, 699, 799;
pronghorn 007, 485) have no harvest data and are scored as average on it.

**Montana hunting district maps** (`data/raw/mt/land/`, parser `mt_land`): area,
public land % and land cover per district, with separate maps for deer/elk,
antelope, moose, sheep and goat (boundaries differ by species).

```sh
.venv/bin/python -m ingest fetch-mt-land            # downloads only what's missing (~520 MB first time)
.venv/bin/python -m ingest parse mt_land data/raw/mt/land/*/*.pdf
```

The fetch command derives the district list from the loaded hunts, so rerun it
after adding new hunts. Maps exist for every district except the special
permit areas (007, 300, 394, 396, 399, 595, 698, 699, 799). The PDFs are
gitignored because they're large and can be downloaded again. Crowding uses
district hunters (all hunters, from the harvest survey) per square mile.

**Montana 2025 elk counts** (`data/population/`, parser `mt_elk_count`):

```sh
.venv/bin/python -m ingest parse mt_elk_count data/population/2025-elk-count.pdf
.venv/bin/python -m ingest fetch-mt-land    # picks up herd districts that have no hunt
```

Winter aerial counts per elk management unit, with the 3-year average (used as
population), latest count, FWP goal range and At/Above/Below status. Footnote
superscripts are glued onto numbers in the PDF text, so small-font characters
are dropped first. Sub-areas FWP already counts inside a district row (201,
202) are skipped. Split counts with no whole-district row (210 N/S, 311, 313/314,
319, 321) are merged into one herd. Density = count ÷ total area of the herd's
districts. Not surveyed: 100–124 and 170 (forest cover), 361, and the special
permit areas. Elk only so far.

Still missing for Montana: sex ratios, and population for deer, pronghorn,
moose, sheep and goat.

## Adding real data

1. Put PDFs in `data/raw/<state>/<species>/<year>/`.
2. See how a PDF is laid out:
   `python -m ingest explore data/raw/co/elk/2025/draw-recap.pdf`
   This writes every detected table as CSV, plus the page text, to `data/explore/<pdf>/`.
3. Write a parser: copy `ingest/parsers/_template.py` to e.g. `co_draw_recap.py`.
   Every state, and often every report type within a state, has its own layout.
4. Run it: `python -m ingest parse co_draw_recap <pdf> --year 2025`
   This writes `data/normalized/draw.<pdf-name>.csv`.
5. `python -m ingest validate`, then `python -m ingest build`, then reload the app.

Some data has no PDF (unit areas, public-land %, your own scouting ratings), so
type it directly into the CSVs. Files are read in name order and later files win
on duplicate keys, so a `draw.zz-manual.csv` can override parsed rows.

## Normalized tables (`ingest/schema.py`)

| table | one row per | key columns |
|---|---|---|
| `units` | unit | area_sq_mi, public_land_pct, notes |
| `hunts` | drawable tag (hunt code); the ranked row | license (tag type), draw_system (preference/bonus/random), units (`;`-separated), weapon, season, sex |
| `draw` | hunt × year × residency × point level | applicants, drawn, quota |
| `harvest` | hunt × year | hunters, harvest, days |
| `population` | herd × year | units it covers, population, males_per_100_females |
| `quality` | unit × year (blank year = every year) | pct_mature_males, avg_age, rating (1–5), notes |

Population is reported per herd/DAU, so it becomes a density (animals per sq mi
across the herd's units) and is then area-weighted onto each hunt.

## Scoring (`web/src/scoring.ts`)

The score (0–100) is a weighted average of six factors, each scaled 0–1:

- **Draw odds**: the first-choice probability at your residency and point count, averaged over the chosen years. Bonus and random draws use the lottery model above.
- **Harvest success**: percentile of harvest ÷ hunters.
- **Population**: percentile of density (75%) and of trend (25%).
- **Animal quality**: mean of the percentiles for % mature males, average age and males per 100 females, plus your rating rescaled from 1–5 to 0–1.
- **Low crowding**: inverse percentile of hunters per sq mi.
- **Public land**: the actual %.

A factor with no data for any hunt in scope is left out (greyed in the weights panel).
Percentiles are computed across every hunt for the chosen species and state (draw and
general, all tag types), so
filters hide rows without changing scores. If a hunt has no data for a factor
that other hunts do have, it counts as average (50th percentile) and the row is
marked `*`, so missing data never helps a hunt.
Weights, filters and settings are saved in the browser. The open hunt is kept
in the URL (`#hunt=<id>`) so you can bookmark it.
