#!/usr/bin/env python3
# Model: qwen3.8:27b
"""Convert the Palmer Penguins CSV (seaborn-data) to JSON.

Source:
    https://raw.githubusercontent.com/mwaskom/seaborn-data/master/penguins.csv
    (local copy: data/penguins.csv)

Behavior:
    - Keeps ALL rows (rows with any of the target fields are retained;
      missing values become JSON nulls and are dropped later in analysis).
    - Numeric fields are parsed to int/float; empty strings become null.
    - String fields (species, island, sex) are kept verbatim from the source.

Usage:
    python3 pen-gem/convert_data.py data/penguins.csv data/penguins.json
"""

import csv
import json
import sys

NUMERIC_FIELDS = [
    "bill_length_mm",
    "bill_depth_mm",
    "flipper_length_mm",
    "body_mass_g",
]
STRING_FIELDS = ["species", "island", "sex"]


def parse_value(field, raw):
    """Parse one CSV cell: numerics to int/float, blanks to None."""
    raw = (raw or "").strip()
    if raw == "":
        return None
    if field in NUMERIC_FIELDS:
        try:
            return int(raw)
        except ValueError:
            return float(raw)
    return raw


def convert(input_path, output_path):
    rows = []
    with open(input_path, newline="") as fh:
        reader = csv.DictReader(fh)
        for raw_row in reader:
            row = {}
            for field in STRING_FIELDS + NUMERIC_FIELDS:
                row[field] = parse_value(field, raw_row.get(field))
            rows.append(row)

    with open(output_path, "w") as out:
        json.dump(rows, out, indent=2)
        out.write("\n")

    n_missing = sum(
        1 for r in rows for f in NUMERIC_FIELDS if r[f] is None
    )
    print(f"Wrote {len(rows)} rows -> {output_path}")
    print(f"Null numeric values retained: {n_missing}")


if __name__ == "__main__":
    in_path = sys.argv[1] if len(sys.argv) > 1 else "data/penguins.csv"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "data/penguins.json"
    convert(in_path, out_path)
