#!/usr/bin/env python3
"""
ANSUR data pipeline - Stage 1: ingestion & transformation.

Reads data/ansur-full.csv and emits data/ansur.json:
  metadata  - row counts, feature lists, units (detected from the data), missing counts
  records   - typed rows, source order preserved, missing values kept as null

Missing values are never imputed here - they stay null so every downstream
statistic can state the sample it was computed on. Derived metric columns
(height_cm, weight_kg, bmi, stature_cm, span_cm) are added because the source
file mixes imperial and millimetre units.

Determinism: no randomness, no locale-dependent formatting, stable source
order, fixed float repr. Re-running produces byte-identical output.

Usage:  python3 -I tools/build_data.py
"""

from __future__ import annotations

import csv
import json
import math
import os
import statistics
import sys
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CSV_PATH = os.path.join(ROOT, "data", "ansur-full.csv")
JSON_PATH = os.path.join(ROOT, "data", "ansur.json")

MODEL_NAME = "minimax/minimax-m3.1-flash:free[1m]"

CATEGORICAL = ["gender"]

LABELS = {
    "age": "Age",
    "gender": "Gender",
    "height": "Height",
    "weight": "Weight",
    "span": "Arm span",
    "stature": "Stature",
    "ear.breadth": "Ear breadth",
    "ear.length": "Ear length",
    "ear.protrusion": "Ear protrusion",
    "foot.breadth": "Foot breadth",
    "foot.length": "Foot length",
    "hand.breadth": "Hand breadth",
    "hand.length": "Hand length",
    "hand.palm": "Hand palm length",
    "head.breadth": "Head breadth",
    "head.length": "Head length",
    "head.height": "Head height",
    "head.circumference": "Head circumference",
    "height_cm": "Height (cm)",
    "weight_kg": "Weight (kg)",
    "bmi": "BMI",
    "stature_cm": "Stature (cm)",
    "span_cm": "Arm span (cm)",
}

# Body measurements that the source file stores in millimetres.
MM_COLUMNS = [
    "span",
    "stature",
    "ear.breadth",
    "ear.length",
    "ear.protrusion",
    "foot.breadth",
    "foot.length",
    "hand.breadth",
    "hand.length",
    "hand.palm",
    "head.breadth",
    "head.length",
    "head.height",
    "head.circumference",
]

DERIVED_COLUMNS = ["height_cm", "weight_kg", "bmi", "stature_cm", "span_cm"]

INCH_TO_CM = 2.54
POUND_TO_KG = 0.45359237


def is_blank(raw: str) -> bool:
    """True when a cell carries no usable value."""
    if raw is None:
        return True
    text = raw.strip()
    if text == "":
        return True
    return text.lower() in {"na", "n/a", "nan", "null", "none", "?", "-"}


def parse_number(raw: str):
    """Parse a numeric cell; return None for blanks/unparseable values."""
    if is_blank(raw):
        return None
    try:
        value = float(raw.strip())
    except ValueError:
        return None
    if math.isnan(value) or math.isinf(value):
        return None
    if value.is_integer() and abs(value) < 1e15:
        return int(value)
    return round(value, 6)


def unit_for(column: str, height_unit: str, weight_unit: str) -> str:
    """Display unit for a column, filled in once the units are detected."""
    if column in MM_COLUMNS:
        return "mm"
    if column == "height":
        return height_unit
    if column == "weight":
        return weight_unit
    if column == "age":
        return "years"
    if column in ("height_cm", "stature_cm", "span_cm"):
        return "cm"
    if column == "weight_kg":
        return "kg"
    if column == "bmi":
        return "kg/m2"
    return "source units"


def load_rows(path: str):
    """Read the CSV into typed records, preserving source order."""
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        fieldnames = list(reader.fieldnames or [])
        records = []
        for row in reader:
            record = OrderedDict()
            for field in fieldnames:
                if field in CATEGORICAL:
                    text = (row.get(field) or "").strip()
                    record[field] = text if text else None
                else:
                    record[field] = parse_number(row.get(field) or "")
            records.append(record)
    return fieldnames, records


def detect_units(records):
    """
    Infer the unit of the height/weight columns from the data itself.

    The source file mixes systems: stature and the body measurements are in
    millimetres, while height and weight turn out to be in inches and pounds.
    Rather than assume, each hypothesis is scored against the data:

      height  - compared with stature (mm) row by row; the hypothesis with the
                lower median absolute error wins.
      weight  - scored by BMI plausibility; a candidate whose median BMI falls
                far outside a sane band is rejected.

    Returns (height_unit, weight_unit, evidence) so the reasoning is auditable.
    """
    evidence = {}

    height_pairs = [
        (r["height"], r["stature"] / 10.0)
        for r in records
        if r["height"] is not None and r["stature"] is not None
    ]
    candidates = {"cm": 1.0, "in": INCH_TO_CM}
    height_errors = {}
    for name, factor in candidates.items():
        errors = [abs(h * factor - s) for h, s in height_pairs]
        height_errors[name] = round(statistics.median(errors), 3)
    height_unit = min(height_errors, key=lambda k: (height_errors[k], k))
    evidence["height_candidates_median_abs_err_cm"] = height_errors
    evidence["height_unit"] = height_unit

    bmi_candidates = {"kg": 1.0, "lb": POUND_TO_KG}
    bmi_summary = {}
    for name, factor in bmi_candidates.items():
        bmis = []
        for r in records:
            if r["weight"] is None or r["height"] is None:
                continue
            height_cm = r["height"] * candidates[height_unit]
            bmis.append((r["weight"] * factor) / ((height_cm / 100.0) ** 2))
        if not bmis:
            continue
        bmis.sort()
        bmi_summary[name] = {
            "median": round(statistics.median(bmis), 2),
            "p05": round(bmis[int(0.05 * (len(bmis) - 1))], 2),
            "p95": round(bmis[int(0.95 * (len(bmis) - 1))], 2),
        }
    plausible = {
        name: summary
        for name, summary in bmi_summary.items()
        if 12 <= summary["median"] <= 50 and 10 <= summary["p05"] <= 50
    }
    weight_unit = (
        min(plausible, key=lambda k: abs(plausible[k]["median"] - 22.0))
        if plausible
        else "kg"
    )
    evidence["bmi_by_candidate"] = bmi_summary
    evidence["weight_unit"] = weight_unit

    evidence["stature_median_mm"] = statistics.median(
        [r["stature"] for r in records if r["stature"] is not None]
    )
    evidence["head_circumference_median_mm"] = statistics.median(
        [r["head.circumference"] for r in records if r["head.circumference"] is not None]
    )
    evidence["height_median_raw"] = statistics.median(
        [r["height"] for r in records if r["height"] is not None]
    )
    evidence["weight_median_raw"] = statistics.median(
        [r["weight"] for r in records if r["weight"] is not None]
    )
    return height_unit, weight_unit, evidence


def add_derived(records, height_unit, weight_unit):
    """Add metric-space columns derived from the detected units."""
    height_factor = INCH_TO_CM if height_unit == "in" else 1.0
    weight_factor = POUND_TO_KG if weight_unit == "lb" else 1.0
    for record in records:
        height_cm = None
        if record["height"] is not None:
            height_cm = record["height"] * height_factor
            record["height_cm"] = round(height_cm, 2)
        weight_kg = None
        if record["weight"] is not None:
            weight_kg = record["weight"] * weight_factor
            record["weight_kg"] = round(weight_kg, 2)
        record["bmi"] = (
            round(weight_kg / ((height_cm / 100.0) ** 2), 2)
            if height_cm and weight_kg
            else None
        )
        record["stature_cm"] = (
            round(record["stature"] / 10.0, 2) if record["stature"] is not None else None
        )
        record["span_cm"] = (
            round(record["span"] / 10.0, 2) if record["span"] is not None else None
        )


def build_payload():
    fieldnames, records = load_rows(CSV_PATH)
    numeric_columns = [f for f in fieldnames if f not in CATEGORICAL]
    height_unit, weight_unit, unit_evidence = detect_units(records)
    add_derived(records, height_unit, weight_unit)

    genders = Counter(r["gender"] for r in records if r["gender"])
    missing_counts = {f: sum(1 for r in records if r[f] is None) for f in fieldnames}
    complete_rows = sum(
        1 for r in records if all(r[f] is not None for f in numeric_columns)
    )

    payload = OrderedDict()
    payload["metadata"] = OrderedDict(
        (
            ("title", "ANSUR anthropometric survey"),
            ("source", "data/ansur-full.csv"),
            ("model", MODEL_NAME),
            ("generated_by", "tools/build_data.py"),
            ("record_count", len(records)),
            ("complete_record_count", complete_rows),
            ("feature_count", len(numeric_columns)),
            ("categorical_features", list(CATEGORICAL)),
            ("numeric_features", numeric_columns),
            ("derived_features", list(DERIVED_COLUMNS)),
            ("labels", OrderedDict((k, LABELS.get(k, k)) for k in list(fieldnames) + DERIVED_COLUMNS)),
            ("units", OrderedDict(
                (c, unit_for(c, height_unit, weight_unit))
                for c in list(numeric_columns) + DERIVED_COLUMNS
            )),
            ("detected_units", OrderedDict((("height", height_unit), ("weight", weight_unit)))),
            ("unit_evidence", unit_evidence),
            ("missing_counts", OrderedDict((k, missing_counts[k]) for k in fieldnames)),
            ("gender_counts", OrderedDict((g, genders[g]) for g in sorted(genders))),
        )
    )
    payload["records"] = records
    return payload


def main():
    if not os.path.exists(CSV_PATH):
        sys.exit(f"missing source file: {CSV_PATH}")
    payload = build_payload()
    os.makedirs(os.path.dirname(JSON_PATH), exist_ok=True)
    with open(JSON_PATH, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, indent=1, sort_keys=False)
        handle.write("\n")
    meta = payload["metadata"]
    print(f"records          : {meta['record_count']}")
    print(f"complete records : {meta['complete_record_count']}")
    print(f"numeric features : {meta['feature_count']}")
    print(f"gender counts    : {dict(meta['gender_counts'])}")
    print(f"units detected   : height={meta['detected_units']['height']}, weight={meta['detected_units']['weight']}")
    print(f"wrote            : {JSON_PATH}")


if __name__ == "__main__":
    main()
