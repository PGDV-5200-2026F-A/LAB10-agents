#!/usr/bin/env python3
"""
ANSUR data pipeline - Stage 2: statistical analysis.

Reads data/ansur.json (Stage 1 output) and writes data/ansur-stats.json:
  descriptive        - count, missing, mean, sd, min, q1, median, q3, max per feature
  by_gender          - the same descriptives split by gender
  covariance         - symmetric covariance matrix over the numeric features
  correlation        - symmetric Pearson correlation matrix (same pairs)
  top_correlations   - strongest |r| pairs, for the dashboard's ranking table
  histograms         - binned distributions for the features the charts use

Every statistic is computed on pairwise-complete observations and reports the
n it was computed on, so no number silently claims more samples than it has.
d3.quantile's type-7 (linear interpolation) definition is used for quartiles so
the Python and JavaScript sides agree exactly.

Determinism: fixed bin edges, stable sort orders, no randomness, fixed float
repr. Re-running produces byte-identical output.

Usage:  python3 -I tools/analyze.py
"""

from __future__ import annotations

import json
import math
import os
import statistics
import sys
from collections import OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA_PATH = os.path.join(ROOT, "data", "ansur.json")
STATS_PATH = os.path.join(ROOT, "data", "ansur-stats.json")

# Features that get a histogram in the dashboard.
HISTOGRAM_FEATURES = ["age", "height_cm", "weight_kg", "bmi", "stature_cm"]


def quantile(sorted_values, q):
    """Type-7 quantile (linear interpolation) - identical to d3.quantile."""
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    position = (len(sorted_values) - 1) * q
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return float(sorted_values[int(position)])
    weight = position - lower
    return sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight


def values_of(records, column):
    """Non-null values of a numeric column, in source order."""
    return [r[column] for r in records if r.get(column) is not None]


def describe(records, column):
    """Descriptive statistics for one numeric column."""
    values = sorted(values_of(records, column))
    count = len(values)
    total = len(records)
    if count == 0:
        return OrderedDict(
            (k, None) for k in ("count", "missing", "mean", "sd", "min", "q1", "median", "q3", "max")
        ) | {"count": 0, "missing": total}
    return OrderedDict(
        (
            ("count", count),
            ("missing", total - count),
            ("mean", round(statistics.fmean(values), 4)),
            ("sd", round(statistics.stdev(values) if count > 1 else 0.0, 4)),
            ("min", values[0]),
            ("q1", round(quantile(values, 0.25), 4)),
            ("median", round(quantile(values, 0.5), 4)),
            ("q3", round(quantile(values, 0.75), 4)),
            ("max", values[-1]),
        )
    )


def covariance_pair(rows, col_a, col_b):
    """
    Pearson covariance/correlation over rows where BOTH columns are present.

    Returns (covariance, correlation, n_pairs). Correlation is None when either
    column is constant within the paired subset.
    """
    pairs = [
        (r[col_a], r[col_b])
        for r in rows
        if r.get(col_a) is not None and r.get(col_b) is not None
    ]
    n = len(pairs)
    if n < 2:
        return None, None, n
    mean_x = statistics.fmean(p[0] for p in pairs)
    mean_y = statistics.fmean(p[1] for p in pairs)
    sxx = sum((x - mean_x) ** 2 for x, _ in pairs)
    syy = sum((y - mean_y) ** 2 for _, y in pairs)
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in pairs)
    cov = sxy / (n - 1)
    corr = sxy / math.sqrt(sxx * syy) if sxx > 0 and syy > 0 else None
    return cov, corr, n


def covariance_matrix(records, columns):
    """Symmetric covariance and correlation matrices with pairwise-complete n."""
    size = len(columns)
    cov = [[None] * size for _ in range(size)]
    corr = [[None] * size for _ in range(size)]
    counts = [[0] * size for _ in range(size)]
    for i in range(size):
        for j in range(i, size):
            c, r, n = covariance_pair(records, columns[i], columns[j])
            cov[i][j] = cov[j][i] = None if c is None else round(c, 4)
            corr[i][j] = corr[j][i] = None if r is None else round(r, 4)
            counts[i][j] = counts[j][i] = n
    return OrderedDict(
        (
            ("features", list(columns)),
            ("covariance", cov),
            ("correlation", corr),
            ("n", counts),
        )
    )


def histogram(values, bin_count=24):
    """Equal-width bins over the observed range, with a fixed edge rule."""
    if not values:
        return []
    lo = min(values)
    hi = max(values)
    if hi == lo:
        hi = lo + 1.0
    width = (hi - lo) / bin_count
    counts = [0] * bin_count
    for value in values:
        index = int((value - lo) / width)
        if index == bin_count:
            index = bin_count - 1
        counts[index] += 1
    return [
        OrderedDict(
            (
                ("x0", round(lo + i * width, 4)),
                ("x1", round(lo + (i + 1) * width, 4)),
                ("count", counts[i]),
            )
        )
        for i in range(bin_count)
    ]


def main():
    if not os.path.exists(DATA_PATH):
        sys.exit(f"missing Stage 1 output: {DATA_PATH} (run tools/build_data.py first)")
    with open(DATA_PATH, encoding="utf-8") as handle:
        payload = json.load(handle)

    records = payload["records"]
    meta = payload["metadata"]
    source_features = meta["numeric_features"]
    features = list(source_features) + list(meta["derived_features"])

    descriptive = OrderedDict((f, describe(records, f)) for f in features)

    by_gender = OrderedDict()
    for gender in sorted(meta["gender_counts"]):
        subset = [r for r in records if r.get("gender") == gender]
        by_gender[gender] = OrderedDict(
            (
                ("count", len(subset)),
                ("features", OrderedDict((f, describe(subset, f)) for f in features)),
            )
        )

    # The correlation/covariance matrix covers the SOURCE features only. The
    # derived columns (height_cm, weight_kg, ...) are deterministic rescalings
    # of source columns, so including them would flood the ranking with
    # trivial r=1.0 pairs and tell the reader nothing.
    matrices = covariance_matrix(records, source_features)

    pairs = []
    for i in range(len(source_features)):
        for j in range(i + 1, len(source_features)):
            c = matrices["correlation"][i][j]
            if c is None:
                continue
            pairs.append(
                OrderedDict(
                    (
                        ("a", source_features[i]),
                        ("b", source_features[j]),
                        ("correlation", c),
                        ("covariance", matrices["covariance"][i][j]),
                        ("n", matrices["n"][i][j]),
                    )
                )
            )
    pairs.sort(key=lambda p: (-abs(p["correlation"]), p["a"], p["b"]))

    histograms = OrderedDict()
    for feature in HISTOGRAM_FEATURES:
        histograms[feature] = OrderedDict(
            (
                ("bins", histogram(values_of(records, feature))),
                ("by_gender", OrderedDict(
                    (
                        gender,
                        histogram(values_of([r for r in records if r.get("gender") == gender], feature)),
                    )
                    for gender in sorted(meta["gender_counts"])
                )),
            )
        )

    stats = OrderedDict(
        (
            ("metadata", OrderedDict(
                (
                    ("model", meta["model"]),
                    ("generated_by", "tools/analyze.py"),
                    ("source", meta["source"]),
                    ("record_count", meta["record_count"]),
                    ("features", features),
                    ("matrix_features", list(source_features)),
                    ("units", meta["units"]),
                    ("labels", meta["labels"]),
                    ("gender_counts", meta["gender_counts"]),
                    ("missing_counts", meta["missing_counts"]),
                    ("note", "Pairwise-complete observations; n is reported with every statistic."),
                )
            )),
            ("descriptive", descriptive),
            ("by_gender", by_gender),
            ("covariance", matrices),
            ("top_correlations", pairs[:30]),
            ("histograms", histograms),
        )
    )

    os.makedirs(os.path.dirname(STATS_PATH), exist_ok=True)
    with open(STATS_PATH, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(stats, handle, indent=1, sort_keys=False)
        handle.write("\n")

    print(f"features analysed : {len(features)}")
    print(f"covariance matrix : {len(features)}x{len(features)}")
    print(f"top correlation   : {stats['top_correlations'][0]['a']} ~ "
          f"{stats['top_correlations'][0]['b']} r={stats['top_correlations'][0]['correlation']}")
    print(f"wrote             : {STATS_PATH}")


if __name__ == "__main__":
    main()
