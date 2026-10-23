# ANSUR II Dashboard — Implementation Summary

Model: `deepseek/deepseek-v4.1-flash-1017`

## Deliverable

- `dist/ansur-dashboard.html` — one self-contained, offline-capable page (751 KB):
  inline CSS, pinned D3 v7.9.0 with its license header, and `data/ansur-full.csv`
  embedded in `<script type="text/csv">`, parsed with `d3.csvParse`. No build step,
  no CDN, no network access; opens directly from `file://`.

## Structure

- Header: title, model name, source citation, units/missingness caveats.
- Sticky control bar: gender All/Men/Women (`aria-pressed`) and a measure
  `<select>` driving cards 6 and 9.
- Responsive card grid with the 11 planned charts:
  1. missing values by column (sorted bars)
  2. height × weight scatter (colour + circle/triangle by gender, zero-weight annotation)
  3. stature × arm span (shared square scale, true 45° `span = stature` line)
  4. foot length × stature, by gender
  5. box small-multiples: height, weight, stature (independent axes, units)
  6. selectable box plot by gender (1.5×IQR whiskers, outliers, n in subtitle)
  7. male–female difference in medians, 14 mm measures, zero baseline
  8. height histogram, 1-inch shared bins, overlaid genders, median rules
  9. selectable histogram, identical bins across gender panels
  10. Pearson-r heatmap, 14 mm measures + age, anatomical order, annotated cells
  11. covariance heatmap with Pearson-r toggle, same geometry
- Footer: methods, assumptions, ANSUR II citation, D3 license, and an accessible
  summary table (statistics for all records by measure) inside `<details>`.
- Every chart has a fixed `viewBox`, `role="img"`, a dynamic aria-label, and a
  visually hidden text summary; gender is encoded by shape as well as colour
  (circles/triangles, solid/hatched bars, separate histogram panels).

## Data decisions

- Empty CSV fields → `null` (never zero); the single 0 lb weight is treated as
  missing and annotated in the scatter.
- Derived `weight_kg` and BMI; no imputation.
- Pairwise-complete correlations/covariances with per-pair n in cell tooltips;
  listwise-complete scatter pairs.
- Height (in) and raw weight (lb) are not part of the covariance matrix; age is
  shown in the correlation matrix but omitted from covariance (years × mm is not
  interpretable) and drawn as gray cells with a legend note.
- Three heights (86, 87, 94 in) conflict with the same records' stature
  (~70–72 in); they are retained, flagged in the height-histogram subtitle and
  footer, and visible as outliers rather than silently dropped.
- Quartiles use R-7 (`d3.quantileSorted`); histogram bin thresholds are shared
  across genders and fixed across filters; no randomness or transitions.

## Verification performed

No Node and no headless-browser testing were used, per instruction. The page was
reviewed by reading the code and sources, plus static checks:

- Embedded CSV intact: header + 6,068 rows, all rows 18 columns.
- D3 v7.9.0 license header preserved; JS delimiters balanced and strings
  terminated; no runtime fetch, randomness, or transitions; no external resources.
- 11 cards, 11 SVG/role/summary triples; unique IDs; every JS-referenced ID exists.
- Independent Python spot-checks of the data: n=6,068 (4,082 men / 1,986 women),
  span missing 138, stature–span n=5,930, r≈0.898; height–weight r≈0.662;
  foot–stature r≈0.716 (men) / 0.722 (women).

Browser rendering itself was not executed; this is the one unverified surface.
