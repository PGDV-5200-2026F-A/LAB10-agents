#!/usr/bin/env python3
"""
Compute statistics for penguins data and generate SVG files.
Run with: python3 compute_stats.py
"""

import json
import math
from collections import defaultdict

# Load data
with open('../data/penguins.json') as f:
    data = json.load(f)

# Filter valid data
valid_data = [
    d for d in data
    if d.get('species') and
    isinstance(d.get('bill_length_mm'), (int, float)) and
    isinstance(d.get('bill_depth_mm'), (int, float)) and
    isinstance(d.get('flipper_length_mm'), (int, float)) and
    isinstance(d.get('body_mass_g'), (int, float))
]

# Sort deterministically
species_order = ['Adelie', 'Chinstrap', 'Gentoo']
valid_data.sort(key=lambda d: (
    species_order.index(d['species']) if d['species'] in species_order else 999,
    d['bill_length_mm'],
    d['bill_depth_mm'],
    d['flipper_length_mm'],
    d['body_mass_g']
))

print(f"Total records: {len(valid_data)}")

# Group by species
by_species = defaultdict(list)
for d in valid_data:
    by_species[d['species']].append(d)

# Species counts
species_counts = {s: len(by_species[s]) for s in species_order if s in by_species}
print(f"Species counts: {species_counts}")

# Numerical variables
vars = ['bill_length_mm', 'bill_depth_mm', 'flipper_length_mm', 'body_mass_g']
var_labels = {
    'bill_length_mm': 'Bill Length (mm)',
    'bill_depth_mm': 'Bill Depth (mm)',
    'flipper_length_mm': 'Flipper Length (mm)',
    'body_mass_g': 'Body Mass (g)'
}

# Compute statistics per species
species_stats = {}
for species in species_order:
    if species not in by_species:
        continue
    vals = by_species[species]
    species_stats[species] = {}
    for v in vars:
        values = [d[v] for d in vals]
        species_stats[species][v] = {
            'mean': sum(values) / len(values),
            'std': math.sqrt(sum((x - sum(values)/len(values))**2 for x in values) / (len(values) - 1)) if len(values) > 1 else 0,
            'min': min(values),
            'max': max(values),
            'count': len(values)
        }

# Print species stats
for species in species_order:
    if species in species_stats:
        print(f"\n{species}:")
        for v in vars:
            s = species_stats[species][v]
            print(f"  {v}: mean={s['mean']:.2f}, std={s['std']:.2f}, min={s['min']}, max={s['max']}, n={s['count']}")

# Overall stats for histograms
overall_stats = {}
for v in vars:
    values = [d[v] for d in valid_data]
    overall_stats[v] = {
        'mean': sum(values) / len(values),
        'min': min(values),
        'max': max(values),
        'count': len(values)
    }
    print(f"\nOverall {v}: mean={overall_stats[v]['mean']:.2f}, min={overall_stats[v]['min']}, max={overall_stats[v]['max']}, n={overall_stats[v]['count']}")

# Correlation matrix
def correlation(x, y):
    n = len(x)
    if n == 0:
        return 0
    mx = sum(x) / n
    my = sum(y) / n
    num = sum((x[i] - mx) * (y[i] - my) for i in range(n))
    den_x = sum((x[i] - mx)**2 for i in range(n))
    den_y = sum((y[i] - my)**2 for i in range(n))
    if den_x == 0 or den_y == 0:
        return 0
    return num / math.sqrt(den_x * den_y)

corr_matrix = {}
for i, v1 in enumerate(vars):
    for j, v2 in enumerate(vars):
        x_vals = [d[v1] for d in valid_data]
        y_vals = [d[v2] for d in valid_data]
        corr_matrix[(v1, v2)] = correlation(x_vals, y_vals)

print("\nCorrelation matrix:")
for v1 in vars:
    row = []
    for v2 in vars:
        row.append(f"{corr_matrix[(v1, v2)]:.3f}")
    print(f"  {v1}: {', '.join(row)}")

# Box plot stats for body mass by species
def quantile(sorted_arr, q):
    if not sorted_arr:
        return 0
    pos = (len(sorted_arr) - 1) * q
    base = int(pos)
    rest = pos - base
    if base + 1 < len(sorted_arr):
        return sorted_arr[base] + rest * (sorted_arr[base + 1] - sorted_arr[base])
    return sorted_arr[base]

box_stats = {}
for species in species_order:
    if species not in by_species:
        continue
    values = sorted([d['body_mass_g'] for d in by_species[species]])
    q1 = quantile(values, 0.25)
    median = quantile(values, 0.5)
    q3 = quantile(values, 0.75)
    iqr = q3 - q1
    lower_whisker = max(values[0], q1 - 1.5 * iqr)
    upper_whisker = min(values[-1], q3 + 1.5 * iqr)
    outliers = [v for v in values if v < lower_whisker or v > upper_whisker]
    box_stats[species] = {
        'q1': q1, 'median': median, 'q3': q3,
        'lower_whisker': lower_whisker, 'upper_whisker': upper_whisker,
        'outliers': outliers, 'min': values[0], 'max': values[-1],
        'count': len(values)
    }
    print(f"\n{species} body mass box plot:")
    print(f"  Q1={q1:.1f}, Median={median:.1f}, Q3={q3:.1f}")
    print(f"  Lower whisker={lower_whisker:.1f}, Upper whisker={upper_whisker:.1f}")
    print(f"  Outliers: {outliers}")

# Save stats for SVG generation
stats_output = {
    'species_counts': species_counts,
    'species_stats': species_stats,
    'overall_stats': overall_stats,
    'corr_matrix': {f"{k[0]},{k[1]}": v for k, v in corr_matrix.items()},
    'box_stats': box_stats,
    'species_order': species_order,
    'vars': vars,
    'var_labels': var_labels
}

with open('computed_stats.json', 'w') as f:
    json.dump(stats_output, f, indent=2)

print("\nStats saved to computed_stats.json")