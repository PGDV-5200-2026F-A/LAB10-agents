# Palmer Penguins Dashboard (pen-gem)

Interactive D3 dashboard built to the plan in `../viz_pen.gemma4.md`
(two-phase: Python statistics first, then D3 views).

Model used to generate these files: **qwen3.8:27b**

## Files

| Path | Purpose |
| --- | --- |
| `../data/penguins.csv` | Source data (mwaskom/seaborn-data, fetched raw CSV) |
| `../data/penguins.json` | JSON conversion of the CSV (all 344 rows; blanks -> `null`) |
| `convert_data.py` | CSV -> JSON conversion script |
| `phase1_stats.py` | Phase 1: Pearson correlation matrix + grouped summary stats |
| `derived.json` | Phase 1 output consumed by the dashboard |
| `index.html` | Dashboard markup (data, panel structure, a11y descriptions) |
| `css/dashboard.css` | Style rules (Okabe-Ito palette, tooltip pattern) |
| `js/dashboard.js` | All chart logic (classes: Scatter, Histogram, BoxPlot, FeatureBar, Heatmap) |

## Run

```sh
cd /home/ubuntu/PGDV5200/src/LAB09-agents
# (re)generate data + Phase 1 outputs:
python3 pen-gem/convert_data.py data/penguins.csv data/penguins.json
python3 pen-gem/phase1_stats.py data/penguins.json pen-gem/derived.json
# serve over HTTP (the browser fetches two JSON files, so file:// will not work):
python3 -m http.server 8000
# open http://localhost:8000/pen-gem/index.html
```

D3 is loaded from a CDN, pinned to **d3@7.9.0** (no local node_modules in this lab).

## Data handling (documented transformations)

- Source: `https://raw.githubusercontent.com/mwaskom/seaborn-data/master/penguins.csv`
  (Palmer Penguins; mwaskom, 2021; 344 rows, 3 species).
- `convert_data.py` keeps every row; missing values become JSON `null`
  (2 nulls in each of the 4 numeric fields; `sex` is null for 11 rows).
- Analysis uses **pairwise complete observations** per feature.
- `std` in `derived.json` is the **sample** standard deviation (ddof = 1).
- Values in `derived.json` are rounded to 4 decimal places for stable diffs.

## Views

1. **Scatter** — body mass (g) vs flipper length (mm); species = color
   (Okabe-Ito), sex = shape (circle female / triangle male / square unknown);
   hover + keyboard-focus tooltips; fixed full-dataset axis domains.
2. **Distributions** — grouped histogram (2 mm bins) and box plots
   (median, IQR, Tukey whiskers 1.5 x IQR, outliers) of bill length by species.
3. **KPI + bars** — Phase 1 means (+/- sample std, n) per species and sex;
   four small-multiple bar charts (one per measurement), male = dark, female = light.
4. **Correlation heatmap** — 4x4 Pearson matrix, RdBu diverging color,
   values labeled; recomputed for the active filter (with no filter it equals
   the Phase 1 `derived.json` matrix).

Filters (species / sex buttons) are wired across all views.

## Determinism (per the d3 skill)

- No `Math.random()`, no transitions, fixed sizes, deterministic sort order
  before data binding, explicit group order, `d3.format` for numbers.
- D3 pinned to 7.9.0.

## Verification done in this lab (no JS runtime / browser available)

- Phase 1 script runs; correlation matrix printed and plausible
  (flipper vs body mass r = 0.871; bill length vs flipper r = 0.656;
  bill depth negatively correlated, as expected).
- `derived.json` validated with Python (structure, symmetry, diagonal = 1).
- HTML/JS/CSS reviewed statically (balanced tags, correct relative data
  paths, only files that exist are referenced).
- **Not possible here:** end-to-end browser verification (rendering, hover,
  filter clicks).

==============================================

# PENGUIN DATASET - DATA DASHBOARD

- Model: gemma4:e4b
- Assistant: Claude Code v2.1.293 with high effort and plan mode
- Prompt: @"visualize (agent)" create a plan for a dashboard for data/penguins.json with scatter plots, box and bar plots, covariances, and other fancy visualizations.
- Running time: 10 minutes
========================================================================
- Model: qwen3.8:27b
- Assistant: Claude Code v2.1.293 with high effort and auto mode
- Prompt: @"visualize (agent)" implement ./viz_pen.md using d3 skill, put result in gem-pen/
- Running time: 87 minutes
- Tokens: 685.8k input, 58.1k output, 1.9m cache read
