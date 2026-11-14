# Model: d12-qwen-flash
"""One-shot CSV -> JSON converter for the ANSUR anthropometry dashboard.

Stdlib only (csv, json, pathlib). Run from the repo root:

    python3 -I scripts/csv_to_json.py

Behaviour (deterministic, faithful, no cleaning — per the plan in
viz_ansur_qwen.md):
  * Row order and column order from the CSV header are preserved exactly.
  * Original key names are kept, including dots (ear.breadth, ...).
  * `gender` stays a string; every other column is coerced to a JSON number,
    empty cells become null. `weight = 0` is KEPT as-is: the JSON stays raw
    and faithful, the sentinel exclusion happens in dashboard.js where it is
    visible and auditable in one place.
  * A provenance block is printed to stdout; it is pasted into the results
    README.md so the transformation is reproducible without re-running.
"""
import csv
import json
from pathlib import Path

# Resolve paths relative to the repo root (this script's parent's dir), so the
# output location does not depend on the caller's CWD.
REPO_ROOT = Path(__file__).resolve().parent.parent
IN_PATH = REPO_ROOT / "data" / "ansur-full.csv"
OUT_PATH = REPO_ROOT / "data" / "ansur-full.json"

# The only non-numeric column in this extract; everything else is numeric or empty.
STRING_COLUMNS = {"gender"}


def coerce(header, raw_row):
    """Convert one CSV row dict to a JSON-ready dict, preserving key order."""
    out = {}
    for key in header:
        value = raw_row[key]
        if key in STRING_COLUMNS:
            out[key] = value
        elif value == "":
            out[key] = None  # empty cell -> null (missingness preserved, not imputed)
        else:
            # ANSUR numerics are all integers in this extract, but parse as int
            # only when lossless so a future float column would still convert.
            as_float = float(value)
            out[key] = int(as_float) if as_float.is_integer() else as_float
    return out


def main():
    with IN_PATH.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        header = list(reader.fieldnames)
        rows = [coerce(header, raw) for raw in reader]

    # Default separators, ensure_ascii=False -> byte-stable flat JSON array.
    with OUT_PATH.open("w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False)

    # ---- provenance block (paste into README.md) ----
    print(f"input:  {IN_PATH}")
    print(f"output: {OUT_PATH}")
    print(f"rows={len(rows)}  columns={len(header)}")
    print("columns: " + ",".join(header))
    null_counts = {c: sum(1 for r in rows if r[c] is None) for c in header}
    zero_weight = sum(1 for r in rows if r["weight"] == 0)
    print("null counts:")
    for c in header:
        print(f"  {c}: {null_counts[c]}")
    print(f"weight==0: {zero_weight}")


if __name__ == "__main__":
    main()
