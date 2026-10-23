<!-- Model: deepseek/deepseek-v4.1-flash-1017 -->

# ANSUR II Dashboard — Implementation Plan

## Context
`data/ansur-full.csv` (6,068 rows × 18 cols, ANSUR II anthropometry) has no existing visualization. The goal is a single-page HTML/JS dashboard that answers: how are body measurements distributed, how do they differ by gender and age, how are they related, and how do they co-vary. The result is one self-contained, offline-capable page.

## Data facts (verified)
- 6,068 rows; `gender` M=4,082 / F=1,986; age 17–58 (integer, heaped).
- Missing: span 138, ear.protrusion 210, head.breadth 205, foot.length 135, ear.length 69, hand.palm 27, hand.length 12, hand.breadth 2, head.length 1.
- Units: `height` in **inches** (56–94); `weight` in **pounds** (one `0` = missing); all other lengths mm.
- Correlations: height–stature 0.961, stature–span 0.897, stature–weight 0.683, age–stature 0.04.

## Deliverables
1. `ansur_ds41.md` — this plan.
2. `dist/ansur-dashboard.html` — one self-contained page: inline CSS, inline D3 v7.9.0 (pinned, license header kept), CSV embedded in `<script type="text/csv">` and parsed with `d3.csvParse` (avoids `file://` fetch/CORS; works offline).
3. No build step; no SVG/PNG export.

## Layout
Header (title, model name, source citation, unit/missingness caveats) → control bar (gender: All/M/F with `aria-pressed`; variable `<select>`) → responsive CSS grid of 11 cards → footer (methods, assumptions, accessible data table in `<details>`).
Each card: `<section>` + question-as-`<h2>` + `<svg role="img">` + visually hidden text summary. Fixed `viewBox`, no transitions/animations, no jitter/`Math.random`.

## Charts
| # | Chart | Variables / encoding | Question |
|---|---|---|---|
| 1 | Missing-data bars | count per column, sorted | what can be trusted? |
| 2 | Scatter | height (in) × weight (lb), color+shape by gender; exclude 0-weight row, annotate | size relationship & dimorphism |
| 3 | Scatter | stature × span (mm), complete cases n=5,930, 45° reference line | reach vs height; missingness |
| 4 | Scatter | foot.length × stature, by gender | allometry / proportions |
| 5 | Box small-multiples | height, weight, stature by gender, independent axes, units labeled | central tendency & spread |
| 6 | Box plot (selectable) | chosen mm variable by gender, 1.5×IQR whiskers, outliers, n in subtitle | spread for any measure |
| 7 | Diverging horizontal bars | male–female % difference in median, mm vars only, zero baseline | most dimorphic traits |
| 8 | Histogram | height, 1-inch shared bins, overlaid by gender, median rules | distribution overlap |
| 9 | Histogram (selectable) | same bins across genders | shape for any measure |
| 10 | Correlation heatmap | 14 mm vars + age, fixed anatomical order, diverging color-blind-safe scale, values annotated | co-variation |
| 11 | Heatmap toggle | same geometry, covariance vs Pearson r | covariance structure |

## Preprocessing (in JS, on a derived copy)
- Empty string → `null` (never 0); numeric coercion; unexpected gender → filtered + noted.
- Derived: `weight_kg = lb × 0.45359237`, `BMI = 703 × lb / in²`.
- Exclude `height` (in) and raw `weight` (lb) from the covariance matrix — mixed units and height≈stature redundancy would distort it; documented.
- Pairwise-complete correlation/covariance with per-pair n; listwise complete cases for scatters; no imputation.
- Quartiles via `d3.quantile` (R-7); shared explicit bin domains/thresholds per variable.

## Implementation notes
- D3 modules: `csvParse`, `group`, `rollup`, `quantile`, `bin`, `scaleLinear`, `scaleBand`, `scaleSequential(d3.interpolateRdBu)` reversed.
- Scatter marks: circles (M) / triangles (F), opacity ~0.45, ~6k marks acceptable.
- Okabe–Ito palette: M `#0072B2`, F `#D55E00`; shape redundancy so color is not the only channel; 12–14 px labels; bars start at 0; scatter axes padded, never truncated.
- Covariance computed once into matrices; heatmap reuses geometry; NaN cells gray with legend note.
- JS wrapped in small reusable chart functions (axis/scales/placement helpers), no framework.
- Cite ANSUR II source and D3 license in the footer.

## Risks
- Pairwise-deleted covariance may be non-PSD → flag, prefer r for inference.
- Zero weight and overplotting distort impressions → exclude/annotate, opacity only.
- Integer age heaping → integer bin edges.
- ~700 KB single file is expected; no CDN fallback, to keep offline determinism.

## Verification
1. Open `dist/ansur-dashboard.html` via `file://` and via `python3 -m http.server`; confirm no console errors and all 11 cards render offline.
2. Spot-check against verified stats: n=6,068; M/F split; stature means 1756/1629 mm; height–stature r≈0.96; span missing n=138.
3. Toggle All/M/F and the variable selector — all charts update; totals in subtitles match.
4. Confirm determinism: reload twice, chart geometry identical; no animation.
5. Accessibility pass: keyboard focus reaches controls, charts have `role="img"` + `aria-label`, gender distinguished by shape as well as color.
