"""CLI: python -m ingest <command>"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from . import parsers
from .build import build, load_all
from .explore import explore
from .sample import generate
from .tables import write_table

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "normalized"
SAMPLE = ROOT / "data" / "sample"
OUT = ROOT / "web" / "public" / "data" / "hunts.json"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="ingest")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("explore", help="dump a PDF's tables/text to data/explore/ for inspection")
    p.add_argument("pdfs", nargs="+", type=Path)
    p.add_argument("--pages", type=int, help="only the first N pages")

    sub.add_parser("parsers", help="list registered parsers")

    p = sub.add_parser("parse", help="run a parser on PDFs, writing data/normalized/<table>.<pdf>.csv")
    p.add_argument("parser")
    p.add_argument("pdfs", nargs="+", type=Path)
    p.add_argument("--year", type=int, help="draw/report year (default: parser infers it)")

    p = sub.add_parser("validate", help="check normalized CSVs and report problems")
    p.add_argument("--sample", action="store_true", help="validate the sample dataset instead")

    p = sub.add_parser("build", help="join CSVs into the web app's hunts.json")
    p.add_argument("--sample", action="store_true", help="build from the sample dataset")

    sub.add_parser("sample", help="regenerate the fictional sample dataset")

    p = sub.add_parser("fetch-mt-land", help="download Montana FWP hunting district map PDFs to data/raw/mt/land/")
    p.add_argument("--delay", type=float, default=1.0, help="seconds between requests")

    args = ap.parse_args(argv)

    if args.cmd == "explore":
        for pdf in args.pdfs:
            explore(pdf, ROOT / "data" / "explore", args.pages)
    elif args.cmd == "parsers":
        for name, (_, desc) in sorted(parsers.load_all().items()):
            print(f"{name:28} {desc}")
    elif args.cmd == "parse":
        registry = parsers.load_all()
        if args.parser not in registry:
            print(f"unknown parser {args.parser!r}; see `python -m ingest parsers`", file=sys.stderr)
            return 1
        for pdf in args.pdfs:
            result = registry[args.parser][0](pdf, args.year)
            slug = re.sub(r"[^a-z0-9]+", "-", pdf.stem.lower()).strip("-")
            for table, rows in result.items():
                if not rows:
                    continue
                dest = DATA / f"{table}.{args.parser}.{slug}.csv"
                write_table(dest, table, rows)
                print(f"    {table}: {len(rows)} rows -> {dest.relative_to(ROOT)}")
    elif args.cmd == "validate":
        tables, problems = load_all(SAMPLE if args.sample else DATA)
        for name, rows in tables.items():
            print(f"{name:12} {len(rows):6} rows")
        for prob in problems:
            print("  !", prob)
        return 1 if problems else 0
    elif args.cmd == "build":
        src = SAMPLE if args.sample else DATA
        doc = build(src, OUT, "sample" if args.sample else "normalized")
        print(f"{len(doc['hunts'])} hunts -> {OUT.relative_to(ROOT)}")
        for w in doc["warnings"][:30]:
            print("  !", w)
        if len(doc["warnings"]) > 30:
            print(f"  ... {len(doc['warnings']) - 30} more warnings")
    elif args.cmd == "sample":
        generate(SAMPLE)
    elif args.cmd == "fetch-mt-land":
        from .fetch_mt_land import fetch

        fetch(DATA, ROOT / "data" / "raw" / "mt" / "land", args.delay)
    return 0


if __name__ == "__main__":
    sys.exit(main())
