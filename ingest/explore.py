"""Dump every table and the raw text from a PDF so we can see its structure
before writing a parser for it."""

from __future__ import annotations

import csv
from pathlib import Path

import pdfplumber


def explore(pdf_path: Path, out_root: Path, max_pages: int | None = None) -> Path:
    out = out_root / pdf_path.stem
    out.mkdir(parents=True, exist_ok=True)
    n_tables = 0
    with pdfplumber.open(pdf_path) as pdf:
        pages = pdf.pages[:max_pages] if max_pages else pdf.pages
        with (out / "text.txt").open("w") as text_out:
            for i, page in enumerate(pages, start=1):
                text_out.write(f"\n===== page {i} =====\n")
                text_out.write(page.extract_text(layout=True) or "")
                for k, table in enumerate(page.extract_tables(), start=1):
                    n_tables += 1
                    with (out / f"p{i:03d}_t{k}.csv").open("w", newline="") as f:
                        csv.writer(f).writerows(table)
        print(f"{pdf_path.name}: {len(pages)} pages, {n_tables} tables -> {out}")
    return out
