"""Profile the ANSUR dataset: types, missingness, distributions, anomalies."""
import json
import numpy as np
import pandas as pd

PATH = "/home/ubuntu/PG5200/src/LAB09-agents/data/ansur-full.csv"

df = pd.read_csv(PATH)
report = {}
report["n_rows"] = len(df)
report["n_cols"] = df.shape[1]
report["columns"] = list(df.columns)
report["dtypes"] = {c: str(df[c].dtype) for c in df.columns}

# Missing per column
miss = df.isna().sum()
report["missing"] = {
    c: {"count": int(miss[c]), "pct": round(100 * miss[c] / len(df), 3)}
    for c in df.columns
}
# Also check raw-string empties
raw = pd.read_csv(PATH, dtype=str, keep_default_na=False)
report["empty_strings"] = {
    c: int((raw[c].str.strip() == "").sum()) for c in raw.columns
}

# Numeric summaries
num_cols = df.select_dtypes("number").columns.tolist()
stats = {}
for c in num_cols:
    s = df[c]
    stats[c] = {
        "min": float(s.min()), "max": float(s.max()),
        "mean": round(float(s.mean()), 2),
        "median": float(s.median()),
        "std": round(float(s.std()), 2),
        "skew": round(float(s.skew()), 3),
        "iqr_low": float(s.quantile(0.25) - 1.5 * (s.quantile(0.75) - s.quantile(0.25))),
        "iqr_high": float(s.quantile(0.75) + 1.5 * (s.quantile(0.75) - s.quantile(0.25))),
    }
report["numeric_stats"] = stats

# Out-of-IQR counts
for c in num_cols:
    lo, hi = stats[c]["iqr_low"], stats[c]["iqr_high"]
    report["numeric_stats"][c]["n_out_iqr"] = int(((df[c] < lo) | (df[c] > hi)).sum())

# gender value counts incl NaN
report["gender_counts"] = df["gender"].value_counts(dropna=False).to_dict()
# age distribution
report["age_counts"] = {int(k): int(v) for k, v in df["age"].value_counts(dropna=False).items() if pd.notna(k)}

# Correlation matrix for key columns
key = ["height", "weight", "span", "stature", "ear.breadth", "ear.length", "ear.protrusion",
       "foot.breadth", "foot.length", "hand.breadth", "hand.length", "hand.palm",
       "head.breadth", "head.length", "head.height", "head.circumference"]
report["corr_with_height"] = {c: round(float(df[c].corr(df["height"])), 3) for c in key}

print(json.dumps(report, indent=1))
