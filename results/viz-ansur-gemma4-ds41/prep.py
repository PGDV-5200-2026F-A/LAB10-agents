#!/usr/bin/env python3
"""
prep.py — ANSUR data ingestion / transformation for the ansur dashboard.

Model signature: deepseek-v4.1-flash

Pipeline role (viz_ansur.md, Stage 1): convert `data/ansur-full.csv` into a
standardized JSON structure that the front-end dashboard can load without a
build step or a network fetch.

Outputs (always written next to this script, in `ansur/`):

  data.js       `window.ANSUR = {...}` — the full dataset as an array of records,
                embedded so `index.html` can be opened directly from file://.
  summary.json  Descriptive statistics + the covariance/correlation matrices,
                computed here independently of the browser. This file is the
                reference artifact for viz_ansur.md's "Statistical Check":
                the dashboard recomputes these quantities client-side (so they
                can react to filters), and the two must agree.

Usage (from the repository root):

    python3 ansur/prep.py

Only the Python standard library is used, so the conversion is reproducible
without installing anything.

Data-handling notes (documented per .claude/agents/visualize.md):
  * The source CSV is never modified; all work happens on parsed copies.
  * Missing values in the source are the empty string. They are preserved as
    JSON `null` — nothing is imputed, because the dashboard must be able to
    report how many measurements it is actually summarizing.
  * Covariance/correlation use pairwise-complete observations (each cell is
    computed from the rows where both variables are present). Row-wise deletion
    would have discarded ~11% of rows for a mostly-unrelated reason.
"""

import csv
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
CSV_PATH = os.path.join(REPO_ROOT, "data", "ansur-full.csv")
DATA_JS_PATH = os.path.join(HERE, "data.js")
SUMMARY_PATH = os.path.join(HERE, "summary.json")

# Non-numeric column: kept as a string category in the JSON records.
CATEGORICAL_COLUMNS = ["gender"]

# Units differ between the two halves of the ANSUR measurement sheet. The
# "height"/"weight" columns are the imperial pair (inches/pounds); every other
# body measurement is metric (millimetres). Getting this wrong would mislabel
# every axis, so it is recorded here and shipped in summary.json.
UNITS = {
    "age": "years",
    "height": "in",
    "weight": "lb",
    "span": "mm",
    "stature": "mm",
    "ear.breadth": "mm",
    "ear.length": "mm",
    "ear.protrusion": "mm",
    "foot.breadth": "mm",
    "foot.length": "mm",
    "hand.breadth": "mm",
    "hand.length": "mm",
    "hand.palm": "mm",
    "head.breadth": "mm",
    "head.length": "mm",
    "head.height": "mm",
    "head.circumference": "mm",
}

# A recorded weight of 0 lb is impossible; it is a missing value that was coded
# as zero rather than left blank. Detected rather than assumed, so the count in
# summary.json is derived from the data (see `data_quality` below).
IMPLAUSIBLE = {"weight": lambda v: v is not None and v <= 0}

# Rounding used for every value written to summary.json, so repeated runs
# produce byte-identical files.
PRECISION = 6


def load_csv(path):
    """Read the source CSV into (column_names, rows). Raises on malformed input."""
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.reader(handle)
        header = next(reader)
        rows = [row for row in reader if row]

    for line_number, row in enumerate(rows, start=2):
        if len(row) != len(header):
            raise ValueError(
                f"{path}:{line_number}: expected {len(header)} fields, got {len(row)}"
            )
    return header, rows


def build_records(header, rows):
    """
    Turn raw CSV rows into typed records.

    Numeric columns become floats (or None when the field is empty); categorical
    columns keep their string value. Source row order is preserved: it is already
    deterministic, and the dashboard does its own sorting before binding marks.
    """
    numeric_columns = [c for c in header if c not in CATEGORICAL_COLUMNS]
    records = []
    for row in rows:
        record = {}
        for column, raw in zip(header, row):
            value = raw.strip()
            if column in CATEGORICAL_COLUMNS:
                record[column] = value
            else:
                record[column] = float(value) if value != "" else None
        records.append(record)
    return numeric_columns, records


def apply_plausibility(records):
    """
    Recode physically impossible values as missing (None), in place.

    Only `weight <= 0` currently trips this rule. Keeping the impossible value
    would skew the weight distribution and every covariance weight takes part in,
    so it is treated as the missing value it actually is — and the count is
    reported in summary.json rather than silently dropped.
    """
    findings = {}
    for column, is_implausible in IMPLAUSIBLE.items():
        hits = [i for i, record in enumerate(records) if is_implausible(record[column])]
        for index in hits:
            records[index][column] = None
        findings[column] = {
            "rule": "value <= 0 treated as missing",
            "rows_recoded": len(hits),
            "row_indices": hits,
        }
    return findings


def quantile(sorted_values, p):
    """Linear-interpolation quantile (the same definition d3.quantile uses)."""
    if not sorted_values:
        return None
    position = (len(sorted_values) - 1) * p
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return sorted_values[int(position)]
    weight = position - lower
    return sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight


def describe(values):
    """Descriptive statistics for one numeric column (missing values excluded)."""
    present = sorted(v for v in values if v is not None)
    n = len(present)
    if n == 0:
        return {"n": 0, "missing": len(values)}

    mean = sum(present) / n
    # Sample variance (n-1), matching d3.deviation and the covariance below.
    variance = sum((v - mean) ** 2 for v in present) / (n - 1) if n > 1 else 0.0
    return {
        "n": n,
        "missing": len(values) - n,
        "min": round(present[0], PRECISION),
        "q1": round(quantile(present, 0.25), PRECISION),
        "median": round(quantile(present, 0.50), PRECISION),
        "q3": round(quantile(present, 0.75), PRECISION),
        "max": round(present[-1], PRECISION),
        "mean": round(mean, PRECISION),
        "std": round(math.sqrt(variance), PRECISION),
    }


def pairwise_covariance(xs, ys):
    """
    Covariance of two columns over the rows where both are present.

    Returns (covariance, n_pairs). Sample covariance (n-1 denominator).
    """
    pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
    n = len(pairs)
    if n < 2:
        return None, n
    mean_x = sum(x for x, _ in pairs) / n
    mean_y = sum(y for _, y in pairs) / n
    cov = sum((x - mean_x) * (y - mean_y) for x, y in pairs) / (n - 1)
    return cov, n


def covariance_matrices(numeric_columns, records):
    """
    Covariance and correlation matrices over `numeric_columns`.

    The correlation matrix is the covariance matrix normalized by each column's
    standard deviation; it is what the dashboard's heatmap should show, since
    raw covariances mix incompatible units (mm, kg, years).
    """
    series = {c: [r[c] for r in records] for c in numeric_columns}

    covariance, pair_counts = [], []
    for a in numeric_columns:
        cov_row, count_row = [], []
        for b in numeric_columns:
            if a == b:
                stats = describe(series[a])
                # Diagonal = variance of the available cases for this column.
                variance = (stats.get("std", 0.0)) ** 2
                cov, n = variance, stats.get("n", 0)
            else:
                cov, n = pairwise_covariance(series[a], series[b])
            cov_row.append(None if cov is None else round(cov, PRECISION))
            count_row.append(n)
        covariance.append(cov_row)
        pair_counts.append(count_row)

    # Pearson correlation derived from the same pairwise covariance values, so
    # the two matrices can never disagree.
    std = {c: describe(series[c]).get("std", 0.0) for c in numeric_columns}
    correlation = []
    for i, a in enumerate(numeric_columns):
        row = []
        for j, b in enumerate(numeric_columns):
            cov = covariance[i][j]
            denominator = std[a] * std[b]
            if cov is None or denominator == 0:
                row.append(None)
            else:
                row.append(round(cov / denominator, PRECISION))
        correlation.append(row)

    return covariance, correlation, pair_counts


def main():
    header, rows = load_csv(CSV_PATH)
    numeric_columns, records = build_records(header, rows)
    plausibility = apply_plausibility(records)

    # Rows that are identical across every measured column: exact duplicates
    # would double-count a subject in every distribution plot.
    signatures = [tuple(record[c] for c in header) for record in records]
    duplicate_rows = len(signatures) - len(set(signatures))

    gender_counts = {}
    for record in records:
        gender_counts[record["gender"]] = gender_counts.get(record["gender"], 0) + 1

    columns = {
        column: describe([r[column] for r in records])
        if column in numeric_columns
        else {"type": "categorical", "levels": sorted(gender_counts), "counts": gender_counts}
        for column in header
    }

    covariance, correlation, pair_counts = covariance_matrices(numeric_columns, records)

    # --- data.js: the dataset itself, embedded for file:// loading -------------
    payload = {
        "source": "data/ansur-full.csv",
        "columns": header,
        "numeric_columns": numeric_columns,
        "categorical_columns": CATEGORICAL_COLUMNS,
        "row_count": len(records),
        "records": records,
    }
    with open(DATA_JS_PATH, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(
            "/*\n"
            " * data.js — ANSUR dataset for the ansur dashboard (PGDV5200 LAB09)\n"
            " * Model signature: deepseek-v4.1-flash\n"
            " *\n"
            " * GENERATED FILE — do not edit by hand. Regenerate with:\n"
            " *     python3 ansur/prep.py\n"
            " *\n"
            f" * {len(records)} records x {len(header)} columns from `data/ansur-full.csv`.\n"
            " * Missing measurements are preserved as null (nothing is imputed).\n"
            " */\n"
            "window.ANSUR = "
        )
        json.dump(payload, handle, separators=(",", ":"), ensure_ascii=False)
        handle.write(";\n")

    # --- summary.json: independently computed statistics for verification ------
    summary = {
        "source": "data/ansur-full.csv",
        "row_count": len(records),
        "column_count": len(header),
        "columns": header,
        "numeric_columns": numeric_columns,
        "categorical_columns": CATEGORICAL_COLUMNS,
        "gender_counts": gender_counts,
        "units": {c: UNITS.get(c, "unknown") for c in numeric_columns},
        "data_quality": {
            "missing_by_column": {
                c: columns[c]["missing"] for c in numeric_columns
            },
            "total_missing_cells": sum(columns[c]["missing"] for c in numeric_columns),
            "implausible_values": plausibility,
            "duplicate_rows": duplicate_rows,
            "units_note": (
                "height is in inches and weight in pounds; all other body "
                "measurements are in millimetres. Do not plot raw values from "
                "different unit groups on one shared axis."
            ),
        },
        "descriptive": {c: columns[c] for c in numeric_columns},
        "covariance": {"columns": numeric_columns, "matrix": covariance},
        "correlation": {"columns": numeric_columns, "matrix": correlation},
        "pairwise_counts": {"columns": numeric_columns, "matrix": pair_counts},
        "notes": {
            "missing_values": "Preserved as null; no imputation is performed.",
            "covariance": "Sample covariance (n-1) over pairwise-complete observations.",
            "correlation": "Pearson r, derived from the covariance matrix above.",
            "units": "Mixed: age in years, stature/span/circumference in mm, weight in kg.",
        },
    }
    with open(SUMMARY_PATH, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(summary, handle, indent=1, sort_keys=False, ensure_ascii=False)
        handle.write("\n")

    # --- Console report (the numbers quoted in the dashboard's header) --------
    print(f"read   {CSV_PATH}")
    print(f"wrote  {DATA_JS_PATH}  ({os.path.getsize(DATA_JS_PATH) / 1e6:.2f} MB)")
    print(f"wrote  {SUMMARY_PATH}")
    print(f"rows={len(records)} columns={len(header)} genders={gender_counts}")
    print(f"duplicate rows={duplicate_rows} implausible={plausibility}")
    for column in numeric_columns:
        stats = columns[column]
        print(
            f"  {column:<20} n={stats['n']:<5} missing={stats['missing']:<4} "
            f"mean={stats['mean']:<10} std={stats['std']:<10} "
            f"min={stats['min']:<8} max={stats['max']}"
        )


if __name__ == "__main__":
    main()