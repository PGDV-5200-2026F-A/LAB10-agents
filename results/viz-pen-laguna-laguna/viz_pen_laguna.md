# Penguin Dashboard Visualization Plan

Model: poolside/laguna-s-2.1:free

## Context

The user wants a dashboard visualization for `data/penguins.json` (the Palmer Penguins dataset) featuring scatter plots, box plots, bar plots, covariance/correlation heatmaps, and other fancy visualizations. The **visualize agent** (`/.claude/agents/visualize.md`) will execute this plan using its tools: Read, Write, Edit, Glob, Grep (no Bash — all work is static file creation).

### Dataset Summary (verified via direct inspection)

- **333 records**, no null/missing values
- **Fields**: `species` (Adelie 146, Gentoo 119, Chinstrap 68), `bill_length_mm` (32.1–59.6), `bill_depth_mm` (13.1–21.5), `flipper_length_mm` (172–231), `body_mass_g` (2700–6300), `sex` (0=female 165, 1=male 168)
- This is the cleaned Palmer Penguins dataset

### Key Constraints

- visualize agent has **no Bash** — cannot run Python or shell. All data processing + stats must be computed client-side in JavaScript.
- **d3 skill** (`/.claude/skills/d3/SKILL.md`) must be loaded before writing viz code. Key rules: pin d3@7.9.0, sort data deterministically, no randomness, no animations, fixed dimensions, separate `dist/*.html|css|js` files, model name in comments.
- **dataviz skill** should also be loaded for color palette guidance.

## Architecture & File Structure

```
dist/
  dashboard.html          # Main dashboard page, loads D3 v7.9.0 from CDN, references dashboard.css + dashboard.js
  dashboard.css           # All dashboard layout + chart styling (CSS Grid)
  dashboard.js            # All JS: data loading, preprocessing, stats computation, chart rendering
```

- `dashboard.html`: minimal shell — `<head>` with meta tags, title, `<link rel="stylesheet" href="dashboard.css">`, D3 script `<script src="https://unpkg.com/d3@7.9.0/dist/d3.min.js"></script>`, then `<body>` with a header + grid of `<section>` chart containers, then `<script src="dashboard.js"></script>`. Include `<div id="tooltip">` element for shared tooltip.
- Data path from `dist/dashboard.html`: `../data/penguins.json` (relative to project root's `data/` dir).

## Data Loading & Preprocessing (dashboard.js)

The visualize agent should first Read `data/penguins.json` to inspect the raw data and verify its structure.

### JS pipeline (in dashboard.js):

1. **Load**: `d3.json("../data/penguins.json")` inside `window.addEventListener("DOMContentLoaded", ...)`.
2. **Type coercion**: Convert all numeric fields to `Number`, `sex` to integer, keep `species` as string.
3. **Derived fields**:
   - `sex_label`: map `sex` 0→"Female", 1→"Male" (for display in tooltips/legends).
4. **Missing value check**: Filter/log any records with `null` in critical fields (none found in current data, but guard against it).
5. **Precompute summary statistics** needed by multiple charts:
   - Per-species mean for each numerical variable (for bar plots).
   - Quartiles (Q1, median, Q3) per species per variable (for box plots).
   - Pearson correlation matrix of 4 numerical variables (for heatmap).
   - All computed in pure JavaScript (no external stats library beyond D3).

## Dashboard Layout (CSS Grid)

A single page with a CSS Grid layout:

```
┌────────────────────────────────────┐
│  Header: "Palmer Penguins Dashboard" │
├──────────┬──────────┬──────────────┤
│ Scatter  │ Boxplot  │ Bar Plot     │  (3-column top row: 1+2+1)
│          │ Panel (4 │ Count        │       box plots for 2
│          │  vars)   │              │       selected vars
├──────────┴──────────┴──────────────┤
│ Correlation Heatmap                  │  (full-width row)
├──────────┬─────────────────┬────────┤
│ Violin   │ Small Multiples │ ...    │  (flexible bottom row)
└──────────┴─────────────────┴────────┘
```

- Responsive: `@media (max-width: 900px)` → single column stack.
- Shared tooltip div (`position: absolute; opacity: 0`) with `.visible` class toggled on hover.

## Visualization Specifications

### 1. Scatter Plot (single large chart)

**Mapping**:
- X: `bill_length_mm` → x-scale linear (30–60)
- Y: `flipper_length_mm` → y-scale linear (165–235)
- Color: `species` → categorical (Adelie=#1f77b4 blue, Gentoo=#2ca02c green, Chinstrap=#ff7f0e orange) — color-blind-friendly
- Radius: small fixed (5px), or encode `body_mass_g` as radius (proportional, scaled)
- Tooltip on hover: species, bill_length, flipper_length, body_mass, sex

**Interactions**:
- Hover → tooltip (using `.tooltip.visible` pattern from d3 skill).
- Click a point → highlight all points of same species (using `.selected` class pattern).
- Reset highlight by clicking background.

**Dimensions**: ~500×400px (responsive to grid cell).

### 2. Box Plots (panel of 4, one per numerical variable)

**Mapping**:
- Each sub-chart: X-axis = species (Adelie, Gentoo, Chinstrap), Y-axis = measurement value.
- Draw box from Q1 to Q3, median line, whiskers to min/max within 1.5×IQR, circles for outliers.
- Color boxes by species (same palette as scatter plot).

**Layout**: 2×2 grid within the panel container (4 small box plots: bill_length, bill_depth, flipper_length, body_mass).

**Stats computation**: In JS, per species per variable compute min, Q1 (d3.quantile), median, Q3, max, IQR for whiskers.

**Dimensions**: each box plot ~150×120px.

### 3. Bar Plots (two charts)

**Chart A — Count by Species**:
- X: species (categorical), Y: count.
- Simple vertical bar chart, bars colored by species palette.

**Chart B — Mean Measurements by Species (grouped)**:
- X: species, Y: mean value, 4 groups (one per numerical variable).
- Since scales differ (body_mass ~4200 vs bill_depth ~17), use **4 small bar charts** (one per variable) side by side, each showing mean of that variable by species. Avoids normalization issues.
- Color bars by species.

**Dimensions**: count chart ~180px wide; 4 small bars ~90px each.

### 4. Correlation / Covariance Heatmap

**Computation**:
- 4×4 matrix of Pearson correlation coefficients for: bill_length_mm, bill_depth_mm, flipper_length_mm, body_mass_g.
- Pearson r = Σ((xi−x̄)(yi−ȳ)) / √(Σ(xi−x̄)² · Σ(yi−ȳ)²).
- Compute full matrix in JS, symmetrize, diagonal = 1.0.

**Visualization**:
- 4×4 grid of cells. X and Y axes labeled with variable names.
- Color: diverging scale — blue (negative) → white/zero → red (positive). Use `d3.scaleDiverging()`.
- Cell labels: correlation values rounded to 2 decimals (e.g., "0.87").
- Hover → highlight row + column, show tooltip with variable pair and r value.

**Dimensions**: ~300×300px.

### 5. Fancy Visualizations

**Option A — Violin Plots (distribution + density)**:
- Mirror a kernel density estimate (KDE) for each species.
- KDE computed in JS: Gaussian kernel, fixed bandwidth (Silverman's rule-of-thumb), evaluated on a grid of ~30 points.
- Two violins side by side (e.g., bill_length and body_mass by species).
- Overlay median marker.

**Option B — Small Multiples Scatter Plot (faceted by species)**:
- 3 panels (one per species), each showing bill_length vs flipper_length scatter.
- Shared axis scales across panels for comparability.
- Title on each panel = species name.

**Recommendation**: Implement both (violin + small multiples).

**Dimensions**: violin ~400×200px; small multiples 3× ~150×120px each.

## Shared Components

### Color Palette
- Categorical (species): Adelie=#1f77b4 (blue), Gentoo=#ff7f0e (orange), Chinstrap=#2ca02c (green) — from d3 category10, color-blind-friendly.
- Diverging (correlation): d3.interpolateRdBu or custom blue-white-red.
- Text: #222 on light bg.

### Reusable Chart Class Pattern
Following the d3 skill's guidance to "wrap graphs and plots into classes":
- A base `Chart` class: handles margin convention, SVG creation, scale helpers.
- Subclasses: `ScatterPlot`, `BoxPlot`, `BarPlot`, `Heatmap`, `ViolinPlot`, `SmallMultiples`.
- Each class constructor takes `(containerSelector, data, options)`.

### Tooltip
Single shared `<div id="tooltip" class="tooltip">` (not per-chart). Show/hide via `.classed("visible", true/false)`. Position with `event.pageX/pageY`.

### Axis Formatting
- Use `d3.format(".1f")` for decimal values, `d3.format("~s")` for large numbers (body_mass).
- Axis labels: full variable names (e.g., "Bill Length (mm)").

## Determinism Considerations

- **Sort data**: before binding to marks, sort by `(species, bill_length_mm, flipper_length_mm)`.
- **No randomness**: KDE grid is computed deterministically; no jitter or random placement.
- **No animations**: no transitions; elements appear statically.
- **Fixed dimensions**: hardcoded width/height/margin per chart (responsive only via CSS grid, not D3 reflow).
- **Pin D3**: load `https://unpkg.com/d3@7.9.0/dist/d3.min.js`.
- **Number formatting**: use explicit `d3.format` strings, never locale defaults.

## Verification

1. **Open `dist/dashboard.html` in a browser** — check that:
   - Header renders.
   - All 6 chart sections appear in the grid.
   - Data loads from `../data/penguins.json` (check browser dev tools Network tab for 200 status on penguins.json).
2. **Scatter plot**: 333 circles visible, 3 colors, tooltips appear on hover, click highlights species.
3. **Box plots**: 4 panels, each with 3 boxes, whiskers and median lines visible.
4. **Bar plots**: count chart shows [146, 119, 68] (Adelie, Gentoo, Chinstrap), mean charts show correct species ordering.
5. **Heatmap**: 4×4 grid, color gradient blue→red, values on cells, diagonal = 1.00.
6. **Violin plots**: mirrored density shapes visible, median line inside.
7. **Small multiples**: 3 panels, each with scatter of correct species subset, shared axis ranges.
8. **Determinism**: reload page twice — verify pixel-identical rendering (no layout shifts, no random positions).

## Execution Steps (for visualize agent)

1. **Load skills**: `d3` and `dataviz` skills (read their guidelines).
2. **Read** `data/penguins.json` to verify structure.
3. **Create** `dist/dashboard.html` — shell with header, grid sections, script/style includes.
4. **Create** `dist/dashboard.css` — grid layout, responsive media query, shared styles, species colors.
5. **Create** `dist/dashboard.js` — in order:
   a. Wait for DOMContentLoaded.
   b. Load data via `d3.json("../data/penguins.json")`.
   c. Preprocess: type coercion, derived fields, missing-value guard.
   d. Define shared constants (color scales, dimensions).
   e. Define `Chart` base class + helper utilities (quantile, correlation).
   f. Define `ScatterPlot` class — render scatter chart.
   g. Define `BoxPlot` class — render 4 small box plots in 2×2 panel.
   h. Define `BarPlot` class — render count chart + 4 mean-by-species small bars.
   i. Define `Heatmap` class — compute + render correlation matrix.
   j. Define `ViolinPlot` class — compute KDE + render mirrored violins.
   k. Define `SmallMultiples` class — render 3 faceted scatter plots.
   l. Instantiate all charts, pass data.
6. **Create** `README.md` in project root — data source citation (Palmer Penguins), D3 v7.9.0 dependency, run instructions (open dist/dashboard.html in any modern browser), preprocessing notes, reproducibility statement. Include model name at top.
7. **Verify** by reviewing the three files for consistency, then open in browser to check rendering.
