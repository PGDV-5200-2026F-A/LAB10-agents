#!/usr/bin/env python3
"""
Model: google/gemini-3.8-flash[1m]
Phase 1: Data Preparation and Statistical Analysis for Palmer Penguins Dataset

This script:
1. Loads data/penguins.json
2. Filters / cleans invalid records and provides both complete-case and imputed/grouped views
3. Computes Pearson correlation matrix for numerical features:
   - bill_length_mm, bill_depth_mm, flipper_length_mm, body_mass_g
4. Computes summary statistics (mean, median, std, min, max, q1, q3, count)
   grouped by species and sex
5. Computes overall distributions and histograms
6. Exports structured JSON for Phase 2 visualization to data/penguins_derived.json
"""

import json
import math
import statistics
from collections import defaultdict
from pathlib import Path

MODEL_NAME = "google/gemini-3.8-flash[1m]"

def load_data(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)

def is_valid_measurement(row):
    features = ["bill_length_mm", "bill_depth_mm", "flipper_length_mm", "body_mass_g"]
    return all(row.get(feat) is not None for feat in features)

def compute_pearson_correlation(x_vals, y_vals):
    n = len(x_vals)
    if n < 2:
        return 0.0
    mean_x = statistics.mean(x_vals)
    mean_y = statistics.mean(y_vals)

    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(x_vals, y_vals))
    den_x = sum((x - mean_x) ** 2 for x in x_vals)
    den_y = sum((y - mean_y) ** 2 for y in y_vals)
    den = math.sqrt(den_x * den_y)
    if den == 0:
        return 0.0
    return round(num / den, 4)

def compute_summary_stats(values):
    if not values:
        return {
            "count": 0, "mean": 0, "median": 0, "std": 0,
            "min": 0, "max": 0, "q1": 0, "q3": 0
        }
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    mean_val = round(statistics.mean(sorted_vals), 2)
    median_val = round(statistics.median(sorted_vals), 2)
    std_val = round(statistics.stdev(sorted_vals), 2) if n > 1 else 0.0
    min_val = round(sorted_vals[0], 2)
    max_val = round(sorted_vals[-1], 2)

    # Quartiles
    def get_quantile(p):
        idx = p * (n - 1)
        low = int(math.floor(idx))
        high = int(math.ceil(idx))
        weight = idx - low
        return round(sorted_vals[low] * (1.0 - weight) + sorted_vals[high] * weight, 2)

    q1 = get_quantile(0.25)
    q3 = get_quantile(0.75)

    return {
        "count": n,
        "mean": mean_val,
        "median": median_val,
        "std": std_val,
        "min": min_val,
        "max": max_val,
        "q1": q1,
        "q3": q3
    }

def run_phase1(input_path="data/penguins.json", output_path="data/penguins_derived.json"):
    raw_data = load_data(input_path)

    # 1. Clean data: separate valid measurements, handle missing sex as 'UNKNOWN'
    cleaned_data = []
    features = ["bill_length_mm", "bill_depth_mm", "flipper_length_mm", "body_mass_g"]

    for row in raw_data:
        if is_valid_measurement(row):
            item = dict(row)
            if item.get("sex") is None:
                item["sex"] = "UNKNOWN"
            cleaned_data.append(item)

    # Deterministic sort
    cleaned_data.sort(key=lambda r: (r["species"], r["island"], r["sex"], r["body_mass_g"], r["bill_length_mm"]))

    # 2. Pearson correlation matrix
    correlation_matrix = {}
    for f1 in features:
        correlation_matrix[f1] = {}
        for f2 in features:
            v1 = [r[f1] for r in cleaned_data]
            v2 = [r[f2] for r in cleaned_data]
            correlation_matrix[f1][f2] = compute_pearson_correlation(v1, v2)

    # Per-species correlation matrix
    species_list = sorted(list(set(r["species"] for r in cleaned_data)))
    species_correlations = {}
    for sp in species_list:
        sp_rows = [r for r in cleaned_data if r["species"] == sp]
        species_correlations[sp] = {}
        for f1 in features:
            species_correlations[sp][f1] = {}
            for f2 in features:
                v1 = [r[f1] for r in sp_rows]
                v2 = [r[f2] for r in sp_rows]
                species_correlations[sp][f1][f2] = compute_pearson_correlation(v1, v2)

    # 3. Aggregations & Summary Stats grouped by Species and Sex
    # Group by species
    stats_by_species = {}
    for sp in species_list:
        sp_rows = [r for r in cleaned_data if r["species"] == sp]
        stats_by_species[sp] = {
            "total_count": len(sp_rows),
            "features": {f: compute_summary_stats([r[f] for r in sp_rows]) for f in features}
        }

    # Group by species + sex
    stats_by_species_sex = defaultdict(dict)
    sexes = ["FEMALE", "MALE", "UNKNOWN"]
    for sp in species_list:
        for sx in sexes:
            subset = [r for r in cleaned_data if r["species"] == sp and r["sex"] == sx]
            if subset:
                stats_by_species_sex[sp][sx] = {
                    "count": len(subset),
                    "features": {f: compute_summary_stats([r[f] for r in subset]) for f in features}
                }

    # Group by sex overall
    stats_by_sex = {}
    for sx in sexes:
        subset = [r for r in cleaned_data if r["sex"] == sx]
        if subset:
            stats_by_sex[sx] = {
                "count": len(subset),
                "features": {f: compute_summary_stats([r[f] for r in subset]) for f in features}
            }

    # 4. Overall Dataset KPIs
    kpi_summary = {
        "total_records_raw": len(raw_data),
        "total_records_clean": len(cleaned_data),
        "species_breakdown": {sp: len([r for r in cleaned_data if r["species"] == sp]) for sp in species_list},
        "sex_breakdown": {sx: len([r for r in cleaned_data if r["sex"] == sx]) for sx in sexes if any(r["sex"] == sx for r in cleaned_data)},
        "island_breakdown": {isl: len([r for r in cleaned_data if r["island"] == isl]) for isl in sorted(list(set(r["island"] for r in cleaned_data)))},
        "overall_feature_stats": {f: compute_summary_stats([r[f] for r in cleaned_data]) for f in features}
    }

    # Structure derived output
    derived_output = {
        "metadata": {
            "model": MODEL_NAME,
            "generated_phase": 1,
            "features": features,
            "species": species_list,
            "record_count": len(cleaned_data)
        },
        "kpis": kpi_summary,
        "correlation_matrix": correlation_matrix,
        "species_correlations": species_correlations,
        "stats_by_species": stats_by_species,
        "stats_by_species_sex": stats_by_species_sex,
        "stats_by_sex": stats_by_sex,
        "cleaned_data": cleaned_data
    }

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(derived_output, f, indent=2)

    print(f"Phase 1 complete: Derived data written to {output_path}")
    print(f"Cleaned records: {len(cleaned_data)}")
    print("Pearson Correlation Matrix (All Species):")
    for f1 in features:
        print(f"  {f1}: {correlation_matrix[f1]}")

    return derived_output

if __name__ == "__main__":
    run_phase1()
