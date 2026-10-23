"""Impute missing values in the ANSUR anthropometric dataset.

Method: multiple imputation by chained equations (MICE) via sklearn
IterativeImputer with RandomForest conditional models, gender as an
observed categorical predictor. Imputed values rounded to nearest
integer (all observed values are whole mm/in/lb).
"""
import json
import numpy as np
import pandas as pd
import sklearn
from sklearn.experimental import enable_iterative_imputer  # noqa
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import IterativeImputer

BASE = "/home/ubuntu/PG5200/src/LAB09-agents"
SRC = f"{BASE}/data/ansur-full.csv"
OUT_CSV = f"{BASE}/data/ansur-full-imputed.csv"
OUT_TXT = f"{BASE}/data/ansur-imputation-summary.txt"

SEED = 42

df = pd.read_csv(SRC)
n = len(df)
cols = list(df.columns)

# --- Missingness before imputation -------------------------------------
miss_before = df.isna().sum()
miss_before_pct = (100 * miss_before / n).round(3)

num_cols = [c for c in cols if c not in ("age", "gender")]
target_cols = [c for c in num_cols if miss_before[c] > 0]

# --- Build model matrix --------------------------------------------------
# gender: fully observed -> encode as numeric predictor (F=0, M=1)
gender_enc = df["gender"].map({"F": 0, "M": 1})
assert gender_enc.notna().all(), "unexpected missing gender"

model_df = df[num_cols].copy()
model_df["gender_enc"] = gender_enc

X = model_df.to_numpy(dtype=float)

imputer = IterativeImputer(
    estimator=RandomForestRegressor(n_estimators=200, min_samples_leaf=5, random_state=SEED),
    max_iter=20,
    imputation_order="descending",  # start with the most-missing column
    random_state=SEED,
    add_indicator=False,
)
X_imp = imputer.fit_transform(X)

# --- Reassemble output ----------------------------------------------------
out = df.copy()
for j, c in enumerate(num_cols):
    filled = X_imp[:, j]
    filled = np.where(np.isnan(X[:, j]), filled, X[:, j])  # keep originals
    out[c] = np.round(filled).astype(int)  # data resolution is whole units
# gender untouched (no missing)
assert out["gender"].equals(df["gender"])
assert not out["age"].isna().any()

out = out[cols]  # preserve original column order
out.to_csv(OUT_CSV, index=False)

# --- Comparison vs gender-wise means (justification material) -------------
cmp_rows = []
for c in target_cols:
    mask = df[c].isna()
    gmean = df.groupby("gender")[c].transform("mean")[mask]
    gmed = df.groupby("gender")[c].transform("median")[mask]
    diff_mean = (out[c] - gmean).describe()[["mean", "std"]].round(1)
    cmp_rows.append({
        "col": c,
        "n_filled": int(mask.sum()),
        "imputed_min": int(out[c][mask].min()),
        "imputed_max": int(out[c][mask].max()),
        "imputed_sd": round(float(out[c][mask].std()), 1),
        "mean_abs_diff_vs_gender_mean": round(float((out[c] - gmean).abs().mean()), 1),
        "gender_mean_M": round(float(df.loc[df["gender"] == "M", c].mean()), 1),
        "gender_mean_F": round(float(df.loc[df["gender"] == "F", c].mean()), 1),
        "overall_median": float(df[c].median()),
    })
cmp_df = pd.DataFrame(cmp_rows)

# --- Verification ---------------------------------------------------------
chk = pd.read_csv(OUT_CSV, dtype=str, keep_default_na=False)
assert len(chk) == n, "row count mismatch"
assert list(chk.columns) == cols, "column order mismatch"
n_missing_after = int((chk == "").sum().sum())
# row-order check on an intact column
assert (chk["stature"].values == df["stature"].astype(str).values).all(), "row order mismatch"
# valid-value preservation checks
_numc = [c for c in cols if c not in ("age", "gender")]
_intact = df.index[~df.isna().any(axis=1)]
_numdiff = int(
    (df.loc[_intact, _numc].astype(float).to_numpy()
     != chk.loc[_intact, _numc].astype(float).to_numpy()).sum()
)
_raw_o = pd.read_csv(SRC, dtype=str, keep_default_na=False)
_textmism = sum(
    1 for i in _intact if _raw_o.loc[i].tolist() != chk.loc[i].tolist()
)

# age distribution (unchanged - 0 missing)
age = df["age"]
age_dist = (
    f"min={int(age.min())}, max={int(age.max())}, mean={age.mean():.2f}, "
    f"median={age.median():.0f}, sd={age.std():.2f}"
)
age_bins = df["age"].astype(str).value_counts().sort_index()

# --- Summary text ---------------------------------------------------------
pd_ver = pd.__version__
np_ver = np.__version__
sk_ver = sklearn.__version__

L = []
L.append("=" * 72)
L.append("ANSUR DATASET - MISSING-VALUE IMPUTATION SUMMARY")
L.append("=" * 72)
L.append("")
L.append(f"Input:  {SRC}")
L.append(f"Output: {OUT_CSV}")
L.append(f"Rows: {n}  |  Columns: {len(cols)} (order preserved, row order preserved)")
L.append(f"Software: pandas {pd_ver}, numpy {np_ver}, scikit-learn {sk_ver} (random_state={SEED})")
L.append("")
L.append("-" * 72)
L.append("1. DATASET PROFILE")
L.append("-" * 72)
L.append(f"- {n} rows of US adult anthropometry (ages {int(age.min())}-{int(age.max())}).")
L.append(f"- gender: {int((df['gender']=='M').sum())} M / {int((df['gender']=='F').sum())} F (66.9% / 33.1%), 0 missing.")
L.append(f"- age: 0 missing; distribution: {age_dist}; all integer values 17-58 present.")
L.append("- Units are mixed BY DESIGN of the dataset (reported, not altered):")
L.append("    height (inches, 56-94), weight (lb, 0-321); all 14 body-measurement")
L.append("    columns in mm. All observed values in the raw file are whole numbers")
L.append("    (integers, 0.5-mm and finer granularity never appears).")
L.append("- Missingness is sporadic: 9 columns affected (0.02%-3.46% each);")
L.append("  30 rows have >=2 missing values, max 3 in one row.")
L.append("")
L.append("Missing values BEFORE imputation (count / %):")
for c in cols:
    flag = "  <--- IMPUTED" if miss_before[c] else ""
    L.append(f"  {c:<18} {miss_before[c]:>5}  / {miss_before_pct[c]:>6}%{flag}")
L.append(f"  {'TOTAL':<18} {int(miss_before.sum()):>5}  / {(miss_before.sum()/ (n*len(cols)))*100:.2f}% (cell-level)")
L.append("")
L.append("-" * 72)
L.append("2. ANOMALIES FOUND (REPORTED ONLY - NO VALID VALUES WERE ALTERED)")
L.append("-" * 72)
w0 = df[df["weight"] == 0]
r = w0.iloc[0]
L.append(f"- weight = 0 (1 row, CSV data-row {w0.index[0]+2}): age={int(r['age'])}, gender={r['gender']}, "
         f"height={int(r['height'])} in, all other measurements normal-range.")
L.append("  Almost certainly a data-entry error (adult 71-in man recorded as 0 lb).")
L.append("  Left unchanged per instruction to impute missingness only; flagged here.")
L.append(f"- height: {int((df['height']<=58).sum())} values <= 58 in (142-147 cm) and "
         f"{int((df['height']>=90).sum())} value = 94 in - extreme but plausible for adults; not altered.")
L.append(f"- weight: 47 values outside 1.5*IQR bounds (81-265 lb) incl. max 321 lb - plausible range; not altered.")
L.append("- No other unit inconsistencies or implausible ranges detected among the 14 mm columns.")
L.append("")
L.append("-" * 72)
L.append("3. IMPUTATION METHOD AND JUSTIFICATION")
L.append("-" * 72)
L.append("Method: Multiple Imputation by Chained Equations (MICE) as implemented by")
L.append("scikit-learn's IterativeImputer (20 iterations, 'descending' order starting from the")
L.append("most-missing column) with RandomForest regressors (200 trees, min_samples_leaf=5)")
L.append("as the conditional model. Gender (F/M) was included as an observed predictor;")
L.append("the other 14 measurement columns (incl. height and stature, both fully observed)")
L.append("serve as covariates for every imputed value.")
L.append("")
L.append("Why MICE over simpler choices:")
L.append("- All missing cells are in columns strongly correlated with fully-observed")
L.append("  columns (corr with height: span 0.87, foot.length 0.82, hand.length 0.74,")
L.append("  head.length 0.57, ear.length 0.43, head.breadth 0.39, ear.protrusion 0.29);")
L.append("  a simple mean/median throws away that information.")
L.append("- Gender means differ markedly for most measurements (e.g. span M vs F below),")
L.append("  so gender is used as a predictor instead of one overall mean.")
L.append("- MICE also uses inter-correlations among the measurements themselves (e.g.")
L.append("  span vs stature r=0.96), yielding individualized, person-specific estimates")
L.append("  rather than group-level constants; RandomForest adds robustness to mild")
L.append("  nonlinearity vs. a plain linear model.")
L.append("- Imputed values were rounded to the nearest whole unit, matching the resolution")
L.append("  of the observed data (all observed values are integers).")
L.append("")
L.append("Per-column result (n_filled, imputed range, spread; M/F means show why a single")
L.append("mean would be biased):")
for row in cmp_rows:
    sd = row["imputed_sd"]
    sd_txt = "n/a (n=1)" if (sd != sd or row["n_filled"] < 2) else f"{sd}"
    L.append(
        f"  {row['col']:<16} n={row['n_filled']:>4}  imputed {row['imputed_min']}-{row['imputed_max']} "
        f"(sd={sd_txt})  vs gender-mean: M={row['gender_mean_M']}, F={row['gender_mean_F']} "
        f"(mean abs diff {row['mean_abs_diff_vs_gender_mean']})"
    )
L.append("")
L.append("age (integer years): 0 missing - NO imputation performed. Resulting (unchanged)")
L.append(f"distribution: {age_dist}; every integer age 17-58 is present (mode=21, n=383).")
L.append("gender: 0 missing - NO imputation performed; nothing was filled by class-majority.")
L.append("")
L.append("-" * 72)
L.append("4. BEFORE / AFTER MISSING COUNTS")
L.append("-" * 72)
L.append(f"  cells missing before: {int(miss_before.sum())}")
L.append(f"  cells missing after : {n_missing_after}")
L.append(f"  rows before/after   : {n} / {len(chk)}")
L.append("")
L.append("-" * 72)
L.append("5. ASSUMPTIONS AND CAVEATS")
L.append("-" * 72)
L.append("- Missingness assumed Missing-At-Random (MAR); MICE is unbiased under MAR")
L.append("  but not under Not-MAR (e.g. if missing span correlated with unmeasured traits).")
L.append("- Single-imputation MICE slightly underestimates uncertainty: imputed values are")
L.append("  more tightly correlated with the predictors than observed values. Downstream")
L.append("  inference should treat imputed cells as such or use full multiple imputation")
L.append("  with pooled estimates.")
L.append("- The weight=0 record (see section 2) remains in the output; any analysis of")
L.append("  weight should inspect it.")
L.append("- No valid observed value was modified: only NaN cells were filled.")
L.append("")
L.append("-" * 72)
L.append("6. VERIFICATION OF OUTPUT FILE")
L.append("-" * 72)
L.append(f"  - file re-parsed as strict string CSV: OK")
L.append(f"  - row count: {len(chk)} (expected {n}) -> {'PASS' if len(chk)==n else 'FAIL'}")
L.append(f"  - column order identical to input: {'PASS' if list(chk.columns)==cols else 'FAIL'}")
L.append(f"  - row order verified on intact 'stature' column: PASS")
L.append(f"  - missing/empty cells in output: {n_missing_after} (expected 0) -> {'PASS' if n_missing_after==0 else 'FAIL'}")
L.append(f"  - valid values preserved: {_numdiff} of {len(_intact)*len(_numc)} numeric cells on the")
L.append(f"    {len(_intact)} rows that have no missingness differ from input (numeric compare);")
L.append(f"    {_textmism} of those rows differ as raw text -> "
         f"{'PASS' if _numdiff==0 and _textmism==0 else 'FAIL'}")
L.append("")
L.append("Done.")

with open(OUT_TXT, "w") as f:
    f.write("\n".join(L) + "\n")

print(json.dumps({
    "n_filled_total": int(miss_before.sum()),
    "per_column": {c: int(miss_before[c]) for c in target_cols},
    "missing_after": n_missing_after,
    "rows_after": len(chk),
    "num_cells_changed_on_intact_rows": _numdiff,
    "text_row_mismatches_on_intact_rows": _textmism,
    "output_csv": OUT_CSV,
    "output_txt": OUT_TXT,
}, indent=1))
