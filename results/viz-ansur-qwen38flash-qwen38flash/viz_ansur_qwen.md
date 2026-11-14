<!-- Model: d12-qwen-flash -->
# ANSUR Anthropometry Dashboard — Implementation Plan

Model: d12-qwen-flash
Plan file: `./viz_ansur_qwen.md` (repo root; copy into the results dir at implementation time)

## Context

Build a single-page, fully interactive **D3 v7 dashboard** for `data/ansur-full.csv` (ANSUR U.S. Army anthropometric survey extract). Requested content: scatter plots, covariance/correlation exploration, box/bar/violin distributions, and "fancy" extras. Two product decisions are already fixed by the user and must be baked in:

1. **Gender is a first-class encoding everywhere** (M/F) plus a **global toggle (All / Male / Female)** that re-filters every panel.
2. **Full D3 dashboard with cross-chart interactivity**: brushing the scatter (or a parallel-coordinates axis) selects linked points in the other views.

The plan includes a CSV→JSON conversion step, but **the conversion is NOT performed now** — it is step 1 of the implementation.

Executed by the `visualize` agent (`/.claude/agents/visualize.md`, tools Read/Write/Edit/Glob/Grep/Bash).

### Dataset Summary (verified via direct inspection)

Read-only verification run: `python3 -I` over `data/ansur-full.csv`.

- **6068 rows × 18 columns**, no exact duplicate rows.
- `gender`: `M` = 4082, `F` = 1986, 0 missing. (Only non-numeric column.)
- **Units are mixed and must be labelled honestly**: `age` = years, `height` = **inches**, `weight` = **lbs**, all other 14 measures = **mm**.
- 16 numeric measurement columns: `height, weight, span, stature, ear.breadth, ear.length, ear.protrusion, foot.breadth, foot.length, hand.breadth, hand.length, hand.palm, head.breadth, head.length, head.height, head.circumference` (+ `age` = 17 numeric total).
- Missing values (empty CSV cells → `null` in JSON), per column:

| column | missing | range | mean |
|---|---|---|---|
| age | 0 | 17–58 | 29.76 |
| height | 0 | 56–94 | 68.26 |
| weight | 0 | **0.0**–321 | 174.75 |
| span | 138 | 1323–2121 | 1762.74 |
| stature | 0 | 1409–1993 | 1714.41 |
| ear.breadth | 0 | 25–46 | 35.13 |
| ear.length | 69 | 46–81 | 62.64 |
| ear.protrusion | 210 | 13–34 | 22.27 |
| foot.breadth | 0 | 77–126 | 98.87 |
| foot.length | 135 | 198–318 | 262.68 |
| hand.breadth | 2 | 67–105 | 84.96 |
| hand.length | 12 | 145–239 | 189.33 |
| hand.palm | 27 | 88–140 | 113.86 |
| head.breadth | 205 | 131–180 | 152.20 |
| head.length | 1 | 168–225 | 196.34 |
| head.height | 0 | 206–295 | 249.14 |
| head.circumference | 0 | 500–635 | 570.04 |

- **`weight == 0` sentinel: exactly 1 row** (`gender=M, height=71, age=41, weight=0`). Treat as invalid, drop from every panel, document the count. No other zeros in any measure column.
- Complete cases across all 16 measures: **5300** (M 3552 / F 1747) → listwise deletion is wasteful; use **pairwise complete cases** per pair.
- Sanity correlations (all rows, pairwise complete) — these are the **expected values the built dashboard must reproduce**:
  - `r(height, stature) = 0.961` (n=6068)
  - `r(span, stature) = 0.897` (n=5930)
  - `r(height, span) = 0.870` (n=5930)
  - `r(span, foot.length) = 0.861` (n=5799)
  - `r(hand.length, hand.palm) = 0.854` (n=6029)
  - `r(height, weight) = 0.660` (n=6068)
  - Weakest: `r(ear.protrusion, head.circumference) = 0.128`
- Age 5-year bin counts for `[15,20,…,60]`: 360, 1765, 1399, 874, 630, 608, 274+4=278, 124, 30.
- Expected stat-tile values **after** the `weight > 0` filter: `n = 6067`, `%female = 32.7%`, `mean height = 68.26 in` (M 70.04, F 64.60), `mean stature = 1714.4 mm`, M 4081 / F 1986.

**Analytical note to surface in captions, not hide:** `height` (in) and `stature` (mm) are the same physical quantity in different units — their 0.961 correlation is unit redundancy, not a finding. Most measures load positively on overall body size (`stature`/`span`), which is why the correlation heatmap looks mostly warm; state that in the heatmap caption.

### Key Constraints

- **d3 skill** (`/.claude/skills/d3/SKILL.md`) governs: browser-only, **NO Node**, **no headless testing** (review by reading), pin **d3@7.9.0** via `https://unpkg.com/d3@7.9.0/dist/d3.min.js`, deterministic output (fixed sort orders, no `Math.random()`, no transitions driving state), fixed `width`/`height`/`margin`, model name in an HTML comment at the top, missing-input defaults documented in comments near the top of the HTML.
- Load the **global `dataviz` skill** (palette/tooltip rules) *and* the project `d3` skill at implementation time. If `dataviz` is not installed in this checkout, fall back to the house palette and tooltip pattern below.
- **d3@7.9.0 API reality (verified against the vendored 7.9.0 bundle in `results/viz-ansur-gemma4-mmm31/vendor/`):** `d3.correlation` **does not exist** → Pearson must be hand-written; `d3.contourHex` / `d3-hexbin` are **not in core d3** → use core `d3.contourDensity` (present) for density, or hand-rolled hexagon binning; do **not** add plugin CDNs. Present and usable: `d3.bin`, `d3.contourDensity`, `d3.polygonArea`, `d3.scaleDiverging`, `d3.interpolatePuOr`, `d3.interpolateRdBu`, `d3.brush`, `d3.brushX`, `d3.brushY`, `d3.quantile`, `d3.deviation`, `d3.group`, `d3.rollup`, `d3.symbol`.
- 16 measures → a 16×16 SPLOM is too big. Covariance exploration = **one 16×16 correlation/covariance heatmap + one large selectable scatter**, driven by click.
- `data/` holds data only; all code lives in `scripts/` and in the results dir. Never run an interpreter with its CWD inside a directory containing untrusted files; run the converter with `python3 -I`.
- `file://` + `fetch` is blocked by browser CORS for local JSON, so the app must be opened through a static server (see Verification). `results/viz-ansur-gemma4-ds41/` sidesteps this with an embedded `data.js`; we deliberately do **not** do that — the JSON stays the single source of truth.

## Architecture & File Structure

```
LAB10-agents/
├── viz_ansur_qwen.md                      # this plan
├── scripts/
│   └── csv_to_json.py                     # NEW: one-shot CSV -> JSON converter (stdlib only)
├── data/
│   ├── ansur-full.csv                     # source (unchanged, never edited)
│   └── ansur-full.json                    # GENERATED by scripts/csv_to_json.py
└── results/
    └── viz-ansur-qwen-flash-qwen/  # qwen = slug of the implementing agent's model
        ├── index.html                     # shell: header, controls, stat tiles, 6 <section> panels, tooltip
        ├── dashboard.css                  # dark theme custom props, CSS grid, chart styles, a11y
        ├── dashboard.js                   # load -> derive -> Panel classes -> wire interactivity
        └── README.md                      # provenance, run steps, cleaning/filter notes, citations
```

- `qwen` is unknown when this plan is written; the implementing agent replaces the placeholder with its own model slug (e.g. `results/viz-ansur-qwen-flash-d12-qwen-flash/`).
- Data path **from `index.html`'s actual location**: `../../data/ansur-full.json`.
- HTML top-of-file comments must state: model name, d3 version, data path, row counts before/after filtering, and every default (`xVar=stature`, `yVar=span`, `gender=All`, KDE grid 48 points, contour `bandwidth=20`/`thresholds=12`, age thresholds 15…60, density overlay ON).

## Data Loading & Preprocessing

### Step 1 (planned, not run now): CSV → JSON — `scripts/csv_to_json.py`

Python 3 stdlib only (`csv`, `json`, `pathlib`). Run from repo root:

```bash
python3 -I scripts/csv_to_json.py          # -I: isolated mode; script lives in scripts/, never in data/
```

Behaviour (deterministic, faithful, no cleaning):
1. Read `data/ansur-full.csv` with `csv.DictReader`, preserving **column order and row order**.
2. Keep the original key names exactly as in the header, including the dots (`ear.breadth`, `head.circumference`, …) — no renaming, no flattening.
3. Type coercion: `gender` stays a string; every other column becomes a JSON **number**, and an empty cell becomes **`null`**. `weight = 0` is **kept as-is** (raw JSON stays faithful; sentinel filtering happens in JS so the exclusion is visible and auditable in one place).
4. `json.dump(rows, fh, ensure_ascii=False)` with default separators → flat array of 6068 objects (~0.8 MB).
5. Print a provenance block to stdout: input path, row count, column list, per-column `null` counts, count of `weight == 0`. Paste that output into `README.md` so the transformation is reproducible without re-running.

Exact output shape:

```json
[
  {"age":42,"gender":"F","height":67,"weight":158,"span":1739,"stature":1671,
   "ear.breadth":32,"ear.length":57,"ear.protrusion":17,"foot.breadth":92,
   "foot.length":238,"hand.breadth":75,"hand.length":181,"hand.palm":112,
   "head.breadth":143,"head.length":197,"head.height":232,"head.circumference":553},
  {"age":27,"gender":"M","height":73,"weight":160,"span":1879,"stature":1835, ... },
  {"age":31,"gender":"F","height":62,"weight":118,"span":null,"stature":1585, ... }
]
```

### Step 2: JS pipeline (`dashboard.js`, top of file, before any rendering)

1. `d3.json("../../data/ansur-full.json")` inside `window.addEventListener("DOMContentLoaded", …)`; on rejection, render a visible `<p class="load-error">` naming the path and the "serve over http" requirement instead of failing silently.
2. **Stable ids**: `rows.forEach((r, i) => { r.id = i; })` — `id` = 0-based source row index; it is the join key for every cross-chart selection, so selection survives re-sorting and re-filtering.
3. **Constants** at the top of the file:
   - `MEASURES` (16, in CSV column order) with a `LABELS` map (human names + units) and a `UNITS` map (`in`, `lbs`, `mm`).
   - `REGIONS = { overall: [height, weight, stature, span], ear: […3], hand: […3], foot: […2], head: […4] }` — 16 total, used by the body-region violin grid and the parallel-coordinates axis order.
   - `GENDER = { M: {label:'Male', color:'var(--accent) #4ecdc4', symbol:d3.symbolCircle}, F: {label:'Female', color:'var(--accent2) #ff6b6b', symbol:d3.symbolTriangle} }`.
4. **Sentinel exclusion** (single function, heavily commented):
   `const ANALYSIS_ROWS = rows.filter(r => r.weight === null || r.weight > 0);` — comment: *1 row has `weight = 0.0` (gender M, height 71, age 41), an invalid sentinel; excluded from all panels; n drops 6068 → 6067; header shows both numbers.*
5. **Deterministic sort** of the analysis array once: `[...ANALYSIS_ROWS].sort((a,b) => a.gender < b.gender ? -1 : a.gender > b.gender ? 1 : a.id - b.id)`. All later binds use this order.
6. **Per-measure metadata** computed once from the *pre-filter* analysis rows and frozen for the whole session:
   `extent`, `mean`, `sd`, `q1/median/q3/iqr` — used as **fixed axis domains** (so toggling gender or brushing never rescales an axis, which keeps comparisons honest) and as KDE/parallel-coordinate reference values.
7. **Derived fields**: `genderLabel` ('Male'/'Female') for tooltips/legends; nothing else is materialised — z-scores are computed on demand inside the stats helpers.

### Step 3: global filter/selection state (single source of truth)

```js
const state = {
  gender: 'ALL',            // 'ALL' | 'M' | 'F'
  xVar: 'stature',          // big scatter X
  yVar: 'span',             // big scatter Y
  densityOverlay: true,     // d3.contourDensity on/off
  matrixMetric: 'r',        // 'r' | 'cov' for the heatmap
  scatterBrush: null,       // [[x0,y0],[x1,y1]] in data space, or null
  pcBrushes: new Map(),     // measure -> [lo,hi] in data units (parallel coords axes)
  pinnedIds: new Set()      // clicked points (radar stretch panel / tooltips)
};
```

Derived each time `refresh()` runs:
- `rowsFiltered` = `ANALYSIS_ROWS` → gender predicate → every `pcBrushes` range predicate.
- `idsBrushed` = ids in `rowsFiltered` whose `(xVar, yVar)` falls inside `scatterBrush` (empty Set if no brush).
- `rowsActive` = `idsBrushed.size ? subset : rowsFiltered` — panels that aggregate (violins, histogram, heatmap) use `rowsFiltered` for the light background geometry and, where a comparison is meaningful, draw the brushed subset as a labelled overlay. **Never** silently re-aggregate away brushed-out data without saying so.

`refresh()` (debounced is unnecessary — no transitions) recomputes those three values and calls `panel.update(rowsFiltered, idsBrushed)` on each of the 6 registered panels plus the stat tiles. Controls are HTML-native so they are keyboard-reachable: `<select>` for X/Y, a segmented group of `<input type="radio" name="gender">` (All/Male/Female, `All` checked by default), a checkbox for the density overlay, a radio pair for `r`/`cov`, and a "Reset all filters" button that clears `scatterBrush` (`.call(brush.move, null)`), `pcBrushes`, and `pinnedIds` and re-renders.

## Dashboard Layout

Dark theme from the house palette (`embodied-penguins.html`):

```css
:root{ --bg:#0a0e14; --fg:#e8eef5; --muted:#6b7c8c; --card:#131a24;
       --border:#233040; --accent:#4ecdc4; --accent2:#ff6b6b; }
```

`--accent` (teal) = Male, `--accent2` (coral) = Female — a red/green-CVD-safe-ish pair on dark; **never color alone**: gender also drives symbol shape (circle/triangle), violin fill vs. diagonal-hatch pattern, and always a written `M`/`F` label.

CSS Grid wireframe (desktop ≥1200 px; `@media (max-width: 1000px)` collapses to a single column stack in the same reading order):

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ HEADER  ANSUR Anthropometry Dashboard    [All ●] [Male] [Female]  [Reset]    │
│ tiles: n=6067 │ %female 32.7% │ mean height 68.26 in │ r(X,Y)=0.897 (n=5930) │
├───────────────────────────────────────┬──────────────────────────────────────┤
│ P1 BIG SCATTER  (720x460)             │ P2 CORRELATION MATRIX 16x16 (460x460)│
│  X: [select] Y: [select]              │  r | cov  toggle                     │
│  [x] density contours                 │  values printed in every cell        │
│  drag = brush select                  │  click cell -> loads pair into P1    │
├───────────────────────────────────────┼──────────────────────────────────────┤
│ P3 VIOLIN + BOX of current Y (420x300)│ P4 AGE HISTOGRAM, stacked M/F (300x260)│
│  two KDE violins per slot + boxplots  │  fixed 5-year bins, counts on bars   │
├───────────────────────────────────────┴──────────────────────────────────────┤
│ P5 PARALLEL COORDINATES, 16 axes (1160x380)  — d3.brushY per axis = global    │
│    filter; brushed lines highlighted; each axis shows live brushed n          │
├──────────────────────────────────────────────────────────────────────────────┤
│ P6 BODY-REGION Z-SCORED VIOLIN GRID (1160x300) — 5 region bands x 16 cols,   │
│    M/F pair per measure, z = (x-mean)/sd on rowsFiltered                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

6 chart panels (within the 6–8 budget). Shared `<div id="tooltip" class="tooltip">` styled with the d3 skill's `.visible` pattern.

## Per-Panel Specs

### P1 — Big selectable scatter (core view)

- **Transform**: `rowsFiltered`, pairwise complete on `state.xVar`/`state.yVar` (`x !== null && y !== null`), fixed domains from frozen per-measure extents, **zero baseline not forced** (these are body measures; forcing 0 would crush the signal — instead both axes span the full `d3.extent` of the current measure, and the axis note states the domain).
- **Marks**: one `d3.symbol().type(GENDER[g].symbol).size(48)` `<path>` per row (shape ≠ color redundancy), `fill` = gender color, `fill-opacity 0.55`, no stroke; **no jitter, no `Math.random()`** — over-plotting is communicated by opacity plus the contour overlay instead.
- **Density overlay**: `d3.contourDensity().x(…).y(…).size([w,h]).bandwidth(20).thresholds(12)` on the current subset; draw as stroked `<path>`s (`stroke: var(--muted)`, no fill) with a caption naming the bandwidth and stating that contours are a smoothed estimate, not observed points. Toggle checkbox (default on). Do **not** use `d3.contourHex`/`d3-hexbin` (not in core 7.9.0).
- **Brush**: `d3.brush().extent([[0,0],[w,h]])` → on `end`, convert pixel selection to **data-space** bounds and store in `state.scatterBrush` (data-space survives filter changes without re-snapping). Selection dims all other marks (`.dimmed` → `opacity .12`) and is echoed in P3/P4/P5.
- **Axes**: `d3.axisBottom/Left` with `d3.format('.0f')` (or `.3~s` for weight/height decimals), axis labels always include units, e.g. `Stature (mm)`, `Arm span (mm)`, `Weight (lbs)`.
- **Caption line under the title**: `n = <complete-pair-count> of <rowsFiltered.length> (pairwise complete: nulls in X or Y dropped)`.
- **Tooltip**: `gender`, `id`, and every non-null measure of that person (grouped lines) — tooltips are supplementary, never the only place a value exists.

### P2 — 16×16 correlation / covariance matrix (covariance exploration)

- **Transform**: for each ordered pair `(a,b)` over `MEASURES`, Pearson `r` **and** covariance `cov` over **pairwise complete cases** of `rowsFiltered`; cache as a flat `Map('a|b' -> {r, cov, n})`. `r(a,b) === r(b,a)`; diagonal `r = 1`, `cov = variance(a)`. Recompute only when `gender`/`pcBrushes` change (not on scatter brush — the matrix describes the filtered population, and its caption says so).
- **Marks**: 16×16 `rect`s in a `d3.scaleBand` grid, cell side ~24 px, row/column labels at 11 px, rotated 45° on top.
- **Color**: `d3.scaleDiverging(d3.interpolatePuOr).domain([1, 0, -1])` for `r` (purple–cream–orange, safe for both red-green and blue-yellow CVD; range reversed so negative = orange). For `cov`, `d3.scaleSequential` on `[-maxAbsCov, maxAbsCov]` recomputed from the current matrix — with an explicit caption warning that **covariance is scale-dependent**: cells mix `in·lbs`, `mm²`, and `in·mm`, so only same-unit cells are comparable, and color is read against the current legend gradient (legend drawn under the matrix).
- **Non-color channel**: every cell prints its value with `d3.format('.2f')` (`r`: 0.87, `cov`: e.g. 4123.7); text color flips to `#0a0e14` on light fills and `#e8eef5` on dark fills (contrast-checked against the fill's luminance, not hardcoded).
- **Interaction**: hover → tooltip `height (in) × weight (lbs): r = 0.660, cov = 141.1, n = 6067` plus row/column highlight bands; **click a cell → `state.xVar`/`state.yVar` = that pair, `refresh()`, P1 re-renders, page scrolls P1 into view**; diagonal click → set `yVar` = that measure. Cells get `tabindex="0"`, an `aria-label` with the pair and value, and respond to `Enter` — the matrix is usable without a mouse.

### P3 — Violin + box for the scatter's Y measure, by gender

- **Transform**: `rowsFiltered` values of `state.yVar` (nulls dropped), split by `d3.group` on `gender`. KDE on a **fixed 48-point grid over the frozen full-sample extent** of that measure (so violins under different filters are directly comparable); Gaussian kernel with Silverman bandwidth `0.9 * Math.min(sd, iqr/1.34) * Math.pow(n, -1/5)`, computed by hand (`d3.scaleLinear` for both axes, `d3.area().curve(d3.curveBasis)` for each half, `d3.polygonArea` used only to report the violin's normalized mass if needed).
- **Layout**: Male violin on the left of each slot, Female on the right (side-by-side, not mirrored onto one axis — mirroring two groups implies a comparison axis that reads as a difference). Shared y-axis, x hidden (violin width is density, and the axis label says `density (arbitrary units)`).
- **Overlay**: box-and-whisker inside each violin — box `q1..q3` (white stroke), median line thick, whiskers to `d3.max`/`d3.min` within `1.5 * iqr`, outliers as small circles; `mean` as a diamond marker. Values (`n`, median, IQR) printed as compact text at the top of the panel, not hover-only.
- **Accessibility**: Female violins additionally use an SVG diagonal `<pattern>` fill (`id="fill-female-hatch"`, stable id) so the two groups differ in texture as well as hue.
- **Brush echo**: if `idsBrushed` is non-empty, draw a thin inner violin/box for the brushed subset in `--fg` outline with a text label `brushed n = …`.

### P4 — Age distribution (bars)

- **Transform**: `d3.bin().domain([15, 60]).thresholds([15,20,25,30,35,40,45,50,55,60])` on `age`, **stacked** by gender (`d3.stack` over a per-bin `{M, F}` object; bin edges fixed in code, not derived, so the histogram is stable across filters).
- **Marks**: vertical bars, `M` segment `--accent`, `F` segment `--accent2` with hatch; y = count with full domain `[0, max bin count]` (no truncation); total count printed above each bar and segment counts inside when they fit.
- Expected values to eyeball on first load (gender = All): 360, 1765, 1399, 874, 630, 608, 278, 124, 30.

### P5 — Parallel coordinates over the 16 measures (fancy #1, filters everything)

- **Transform**: one polyline per row of `rowsFiltered` (6067 paths), axis order = `REGIONS` concatenation (`overall | ear | hand | foot | head`) so related measures sit together; each axis gets its own `d3.scaleLinear().domain(frozenExtent[measure]).range([innerH, 0])` — **independent per-axis domains, never normalized**, since z-normalizing hides unit differences (normalization only appears, explicitly labelled, in P6).
- **Marks**: `d3.line()` into a single `<path>` per row, `stroke` = gender color at `stroke-opacity: 0.18`, `stroke-width: 1`; brushed rows re-drawn on top at `stroke-opacity: 0.85`. If path count degrades interaction, switch this panel to a `<canvas>` painted with the same scales and the same data (documented in a comment, no sampling — drawing a subsample would misrepresent the distribution).
- **Interaction**: `d3.brushY()` attached to each axis group; on `end`, store `[lo, hi]` in **data units** in `state.pcBrushes`, then `refresh()` — this is a *global* filter, so P1/P2/P3/P4/P6 and the header tiles all recompute. Each axis label carries a live `n = …` under it showing how many rows survive the brushes, so the effect of each filter is visible without hovering.
- **Caption**: `axes are independent per-measure scales (original units); vertical position is meaningless across axes`.

### P6 — Body-region z-scored violin grid (fancy #2, small multiples per region)

- **Transform**: for every measure in `REGIONS` order, standardize `rowsFiltered` values by that measure's **current-filtered-sample** mean/sd (`z = (x - mean)/sd`, guarded `sd > 0`), then KDE (same helper as P3) per gender on a **common z-domain `[-3.5, 3.5]`** with a shared y-axis.
- **Marks**: 16 columns, 5 region bands separated by vertical rules with band labels (`OVERALL`, `EAR`, `HAND`, `FOOT`, `HEAD`); per column a Male violin and a Female hatch violin side by side, box/median inside; zero reference line at `z = 0`.
- **Purpose stated in the caption**: this is the one panel where units are deliberately removed, which makes size-independent shape differences (e.g. ear vs. hand proportions) comparable; the y-axis is labelled `z-score (within-measure, computed on current filter)` so no reader mistakes it for millimetres.

### Optional stretch panels (implement only after P1–P6 verify; each is self-contained)

- **O1 PCA biplot (client-side, deterministic)**: power iteration on the current 16×16 **correlation** matrix — start vector `Array(16).fill(1)`, exactly 200 iterations, deflate the leading eigenvector to get PC2, fixed sign convention (flip so the largest-|loading| entry is positive). Draw PC1/PC2 loadings as arrows from the origin plus a scatter of per-row scores (`loadings · z-scored row`). Caption must state that PC scores require complete cases (the 5300-row subset) and list the explained-variance share of each retained component. No `d3` eigen solver exists in core, and no random restarts are allowed.
- **O2 Radar / polar profile of one pinned person**: click a point in P1 → `pinnedIds.add(id)`; a compact polar chart (16 spokes, one per measure, `d3.scaleLinear` per spoke over its frozen extent, `d3.lineRadial` + `d3.curveLinearClosed`) comparing that person against the filtered-sample median (second closed path). Include the numeric table below it — a radar chart alone is a poor value-reading device.

## Stats Computed in JS (no Python at render time)

All in a small `stats.js`-style section at the top of `dashboard.js` (plain functions, no classes), each documented with its formula:

- `mean = d3.mean`, `deviation = d3.deviation` (present in 7.9.0), `q = a => d3.quantile(a.slice().sort(d3.ascending), q)` — **must sort first**, `d3.quantile` assumes sorted input.
- `pearson(xs, ys)`: hand-written, because **`d3.correlation` does not exist in d3@7.9.0** (verified by grepping the vendored 7.9.0 bundle). Two-pass centred form: `sxy / Math.sqrt(sxx * syy)`; return `null` if `n < 3` or either variance is 0.
- `covariance(xs, ys)`: `sxy / (n - 1)` (sample covariance; state `n-1` in the comment).
- `pairwise(xs, ys)` helper that zips and drops pairs where either value is `null` — the only place missingness is handled for the matrix and scatter, so the policy is one line to audit.
- `kde(values, gridExtent, nGrid = 48)` + `silvermanBandwidth(values)`.
- `boxStats(values)` → `{min, q1, median, q3, max, iqr, whiskerLow, whiskerHigh, outliers[]}`.
- `zScores(values)` guarded for `sd === 0`.
- No `d3.regression`, no external stats library; everything reproducible by reading the file.

## Interactivity & Event Flow

1. Control change (radio/select/checkbox) → mutate `state` → `refresh()`.
2. Scatter `brush.end` → data-space rect into `state.scatterBrush` → `refresh()` (selection only, not a filter — aggregates keep showing the full filtered set with a labelled brushed overlay).
3. Parallel-coordinate `brushY.end` → `state.pcBrushes` → `refresh()` (a real filter: every panel and the header tiles recompute).
4. Heatmap cell click → set `xVar`/`yVar` → `refresh()`; P1's `<select>` elements are updated to match so the DOM never disagrees with `state`.
5. `Reset all filters` → clear brushes, `pinnedIds`, set `gender='ALL'`, `refresh()`.
6. Panels never talk to each other directly; they only read `(rowsFiltered, idsBrushed)`. Every panel exposes `render()` + `update(rowsFiltered, idsBrushed)` and is pushed into a `panels[]` array — this is the only wiring, which keeps the cross-chart behaviour reviewable by reading the code.
7. Keyboard/screen-reader fallback: all controls are native form elements; heatmap cells and parallel-coordinate axis labels are focusable with `aria-label`s; brush-only affordances are backed by the Reset button and the selects, and **no statistic exists only inside a tooltip**.
8. No transitions anywhere that carry state; re-render is immediate and identical for identical `state`.

## Accessibility & Honesty Rules

- **No axis truncation**: every quantitative axis domain is the frozen `d3.extent` of the measure (or a fixed bin/range declared in code: `[-3.5, 3.5]` for z, `[15, 60]` for age). Counts start at 0. If a domain is padded, the padding is stated in the caption.
- Gender is always redundant-coded: color + shape/pattern + written `M`/`F` label. Legend text reads `Male (teal, circle)` / `Female (coral, triangle)`.
- Diverging matrix colors are `PuOr` (CVD-robust), the numeric value is printed in every cell, and a legend gradient is drawn under the matrix with tick labels.
- Text: `--fg #e8eef5` on `--bg #0a0e14` for primary text; `--muted #6b7c8c` only for secondary captions (contrast ≥ 4.5:1 against `--bg`); minimum font sizes 12 px ticks, 14 px axis labels, 15 px body, 20 px panel titles.
- Every panel states its own `n` after null/sentinel filtering, plus a one-line note on *why* the count is what it is (pairwise complete cases, `weight = 0` exclusion).
- Mixed units are never mixed on one axis; the only cross-unit panel (P6) is z-standardised and labelled as such.
- Correlation ≠ causation is not claimed anywhere; the `height`/`stature` unit redundancy and the overall-size dominance of the matrix are called out in the heatmap caption.
- Density contours, violins and KDE bandwidths are described as smoothed estimates with their parameters visible.

## Determinism

- Rows carry stable `id`s and are sorted once by `(gender, id)`; all `Object`/`Map` iterations over measures iterate over the fixed `MEASURES`/`REGIONS` arrays, never over key insertion order of data.
- No `Math.random()`, no jitter, no force layouts, no transitions; fixed `width`/`height`/`margin`/`viewBox` per panel; explicit `d3.format` specifiers only (`'.0f'`, `'.1f'`, `'.2f'`, `'~s'`), never locale-dependent formatting.
- Stable, derived SVG ids only (`clip-p1`, `fill-female-hatch`, `grad-matrix`).
- D3 pinned to `https://unpkg.com/d3@7.9.0/dist/d3.min.js`; if the environment is offline, note in the HTML comments that `results/viz-ansur-gemma4-mmm31/vendor/d3.v7.9.0.min.js` is the same pinned build and may be copied locally.
- `python3 -I scripts/csv_to_json.py` is byte-stable: same input → same JSON, and the script's stdout provenance block is checked into `README.md`.

## Verification (no headless browser, no Node)

1. **Convert** (implementation step 1): `cd /home/ubuntu/PGDV-5200/src/LAB10-agents && python3 -I scripts/csv_to_json.py`; expect stdout `rows=6068`, `weight==0: 1`, and the null counts table matching the table in this plan. `python3 -c` a quick check that `data/ansur-full.json` parses, has length 6068, and that row 0 equals the first CSV row.
2. **Serve** from the repo root (required — `fetch` of a local file over `file://` is CORS-blocked): `python3 -m http.server 8000`, then open `http://localhost:8000/results/viz-ansur-qwen-flash-qwen/index.html`. Note in `README.md` that the fetch path `../../data/ansur-full.json` is relative to **`index.html`'s location**, so moving the page one level up silently breaks the load — the on-page load-error message names both.
3. **Screenshot with the d12 `look PAGE` tool** in this environment (the only browser available; there is no headless test harness), and re-read `index.html`, `dashboard.css`, `dashboard.js` line by line afterwards — the d3 skill explicitly requires review-by-reading.
4. **Numeric assertions against this plan** (values verified above):
   - Header at `All`: `n = 6067`, `%female = 32.7%`, `mean height = 68.26 in`.
   - Toggle `Male`: `n = 4081`, `%female = 0.0%`, `mean height = 70.04 in`; toggle `Female`: `n = 1986`, `mean height = 64.60 in`.
   - P2 diagonal = `1.00`, matrix symmetric, `r(height, stature) = 0.96`, `r(hand.length, hand.palm) = 0.85`, `r(ear.protrusion, head.circumference) = 0.13`.
   - P4 bar totals match 360/1765/1399/874/630/608/278/124/30 (sum 6067 after the sentinel row leaves the age bins; re-derive with the filter applied).
   - P1 default pair (`stature`, `span`) shows `n = 5930` and caption `r = 0.897` in the 4th tile.
5. **Interaction checks**: click a heatmap cell → selects update and the scatter's axes/labels change; scatter brush → other panels show the brushed `n`; one parallel-coordinate axis brush → header tile `n` drops and all panels re-render; Reset restores the initial state exactly (compare two screenshots).
6. **Determinism check**: load the page twice and compare the screenshots — identical mark geometry, no layout shift, no random positions.
7. **Responsive check**: narrow the viewport (<1000 px) — panels stack in reading order, SVGs scale via `viewBox`, controls stay reachable.

## Execution Steps (for the implementing agent)

1. Load skills: read `/.claude/skills/d3/SKILL.md` and the global `dataviz` skill (palette + tooltip rules).
2. Run the CSV→JSON converter `scripts/csv_to_json.py` with `python3 -I`; paste its stdout provenance block into the results-dir `README.md`.
3. Spot-check the first rows of `data/ansur-full.json` with Read.
4. Write `index.html`: top-of-file comment block (model name, d3@7.9.0 pin, data path, defaults, filter notes), header + stat tiles, radio/select/checkbox controls, 6 `<section>` panels, tooltip div, script/style links.
5. Write `dashboard.css`: house dark custom properties, CSS grid + 1000 px media query, `.tooltip`/`.visible`, `.dimmed`, `.selected`, hatch pattern styles, font sizes.
6. Write `dashboard.js` in this order: constants → stats helpers → `d3.json` load + derive → `Panel` base class → `ScatterPanel`, `MatrixPanel`, `ViolinPanel`, `HistogramPanel`, `ParallelCoordinatesPanel`, `RegionViolinGrid` → `state` + `refresh()` wiring → instantiation. Keep load/transform/analysis/render separated and comment the *why* (pairwise complete cases, sentinel drop, frozen domains, manual Pearson because d3 lacks it).
7. Add `README.md` in the results dir: model name at top, prompt, dataset provenance (`data/ansur-full.csv`, ANSUR U.S. Army anthropometric survey extract — cite the repo copy, do **not** invent a survey version/date), dependency (d3@7.9.0, pinned URL), run instructions (`python3 -m http.server 8000` from repo root + the URL), filtering/cleaning notes (`weight = 0` row, per-column nulls, pairwise complete cases), determinism statement, and the `python3 -I scripts/csv_to_json.py` regeneration command.
8. Verify per the Verification section (serve, screenshot with the PAGE tool, numeric assertions, interaction and determinism checks), then re-read all three files and fix by reading.
9. Optional stretch panels O1/O2 only if P1–P6 all verify.

### Explicitly out of scope

- 16×16 SPLOM (unreadable at this size — the heatmap + big scatter replaces it).
- Imputation of nulls (the repo already has `results/clean-ansur-qwen38-27b/ansur-full-imputed.csv`; this dashboard shows the raw survey with honest per-panel `n`).
- Hexbin panels (would need the non-core `d3-hex-contour`/`d3-hexbin` plugins; `d3.contourDensity` covers density).
- Canvas/WebGL acceleration beyond the documented P5 fallback, `file://`-embedded `data.js`, animation, and any Node tooling.
