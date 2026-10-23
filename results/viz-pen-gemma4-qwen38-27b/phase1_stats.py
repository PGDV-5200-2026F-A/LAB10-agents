#!/usr/bin/env python3
# Model: qwen3.8:27b
"""Phase 1: statistical analysis of the Palmer Penguins dataset.

Reads data/penguins.json and writes pen-gem/derived.json containing:
  - `correlation`: 4x4 Pearson correlation matrix (pairwise complete
    observations) over the continuous features,
  - `by_species`:  mean / median / sample-std / n per feature, per species,
  - `by_sex`:      mean / median / sample-std / n per feature, per sex,
  - `by_species_sex`: same stats for each species x sex combination.

Conventions (recorded so results are reproducible):
  - std is the SAMPLE standard deviation (ddof=1),
  - nulls are dropped per-feature (pairwise complete observations),
  - values are rounded to 4 decimal places for stable file output.

Usage:
    python3 pen-gem/phase1_stats.py [input.json] [output.json]
"""

import json
import math
import statistics
import sys

FEATURES = [
    "bill_length_mm",
    "bill_depth_mm",
    "flipper_length_mm",
    "body_mass_g",
]


def load_rows(path):
    with open(path) as fh:
        rows = json.load(fh)
    # Keep only rows that carry at least one target field (defensive; the
    # standard dataset has no such rows).
    target = set(FEATURES)
    return [
        r for r in rows
        if isinstance(r, dict) and any(k in r and r[k] is not None for k in target)
    ]


def numeric_pairs(rows, fa, fb):
    """Pairwise complete (fa, fb) value pairs."""
    return [
        (r[fa], r[fb]) for r in rows
        if r.get(fa) is not None and r.get(fb) is not None
    ]


def pearson(rows, fa, fb):
    """Pearson r with pairwise complete observations; None if undefined."""
    pairs = numeric_pairs(rows, fa, fb)
    n = len(pairs)
    if n < 2:
        return None
    mean_x = sum(x for x, _ in pairs) / n
    mean_y = sum(y for _, y in pairs) / n
    cov = sum((x - mean_x) * (y - mean_y) for x, y in pairs)
    var_x = sum((x - mean_x) ** 2 for x, _ in pairs)
    var_y = sum((y - mean_y) ** 2 for _, y in pairs)
    if var_x == 0 or var_y == 0:
        return None
    return cov / math.sqrt(var_x * var_y)


def summarize(rows, feature):
    """mean / median / sample-std / n for one feature (nulls dropped)."""
    values = [r[feature] for r in rows if r.get(feature) is not None]
    if not values:
        return None
    return {
        "n": len(values),
        "mean": round(sum(values) / len(values), 4),
        "median": round(statistics.median(values), 4),
        # sample standard deviation (ddof=1); None when n < 2
        "std": round(statistics.stdev(values), 4) if len(values) > 1 else None,
    }


def group_stats(rows, key_fn):
    """Summary stats per group; group order is the sorted key order."""
    groups = {}
    for r in rows:
        key = key_fn(r)
        if key is None:
            continue
        groups.setdefault(key, []).append(r)
    out = {}
    for key in sorted(groups):
        out[key] = {f: summarize(groups[key], f) for f in FEATURES}
    out = {k: {f: s for f, s in feats.items() if s is not None}
           for k, feats in out.items()}
    return out


def main():
    in_path = sys.argv[1] if len(sys.argv) > 1 else "data/penguins.json"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "pen-gem/derived.json"
    rows = load_rows(in_path)

    features = FEATURES
    matrix = [
        [
            (round(pearson(rows, fa, fb), 4) if pearson(rows, fa, fb) is not None else None)
            for fb in features
        ]
        for fa in features
    ]

    derived = {
        "meta": {
            "source_csv": "https://raw.githubusercontent.com/mwaskom/seaborn-data/master/penguins.csv",
            "source_rows": len(rows),
            "features": features,
            "std_ddof": 1,
            "missing_policy": "pairwise complete observations",
            "generated_by": "pen-gem/phase1_stats.py",
        },
        "correlation": {"features": features, "matrix": matrix},
        "by_species": group_stats(rows, lambda r: r.get("species")),
        "by_sex": group_stats(rows, lambda r: r.get("sex")),
        "by_species_sex": group_stats(
            rows, lambda r: f"{r['species']}|{r['sex']}"
            if r.get("species") and r.get("sex") else None
        ),
    }

    with open(out_path, "w") as fh:
        json.dump(derived, fh, indent=2)
        fh.write("\n")
    print(f"Wrote {out_path}")

    # Sanity check: print the correlation matrix to stdout.
    header = ["", *features]
    for fa, row_vals in zip(features, matrix):
        print("\t".join([fa] + [f"{v:.4f}" for v in row_vals]))
    print("\n(header row: " + "\t".join(header) + ")")


if __name__ == "__main__":
    main()
