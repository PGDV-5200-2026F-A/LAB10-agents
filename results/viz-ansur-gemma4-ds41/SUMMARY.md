# ANSUR Dashboard — Implementation Summary

Model signature: deepseek-v4.1-flash

Implementation of `viz_ansur.md`: an interactive D3 dashboard over `data/ansur-full.csv`
(6,068 records × 18 columns), delivered in `ansur/`.

Open **`ansur/index.html`** directly in a browser. There is no build step and no data
server; the only network request is the pinned D3 CDN script.

---

## 1. Deliverables

| File | Role | Author |
| --- | --- | --- |
| `ansur/index.html` | Dashboard shell; all defaults documented in a header comment | `visualize` agent |
| `ansur/ansur.css` | Styling, CVD-safe palette, responsive rules | `visualize` agent |
| `ansur/ansur.js` | Statistics + D3 rendering (client-side, reacts to filters) | `visualize` agent, with two fixes by the orchestrator |
| `ansur/README.md` | How to run, statistical methods, data-quality notes, citations | `visualize` agent |
| `ansur/prep.py` | **Stage 1** — CSV→JSON conversion + reference statistics | Orchestrator |
| `ansur/data.js` | **Generated** — the dataset as `window.ANSUR`, for `file://` loading | `prep.py` |
| `ansur/summary.json` | **Generated** — reference statistics for verifying the JS | `prep.py` |

Pipeline mirrors the plan's three stages: ingestion/transformation (`prep.py`) →
statistical analysis (client-side `analyze()`, cross-checked against `summary.json`) →
visualization/dashboarding (`index.html` + `ansur.js`).

### Regenerating the data

```bash
python3 ansur/prep.py        # Python 3 standard library only
```

Produces byte-identical output across runs (verified). The dashboard does not need
rebuilding afterwards; it reads `data.js` at load time.

---

## 2. What is implemented

All plot types requested by the plan:

- **Scatter** — two selectable features, one point per person, gender encoded by colour
  **and** shape (circle = Male, triangle = Female), plus a least-squares trend line.
  Point sampling is a deterministic stride (never random); the count and stride are
  printed on the page.
- **Covariance / correlation matrix** — square heatmap over all 17 numeric columns,
  defaulting to the **correlation** matrix (unit-free, therefore comparable across the
  mixed-unit columns) with a toggle to raw covariance. Selected cell's `r`, covariance,
  pairwise `n`, and a strength rating appear in a detail panel.
- **Box**, **violin**, and **histogram (bar)** distributions for the selected feature,
  split by gender where meaningful.

Linked interactions: gender filter (applies to every view and KPI), feature select
(drives distributions + scatter x), scatter-y select, matrix scale toggle, and
click-a-matrix-cell to load that pair into the scatter. Controls are native,
keyboard-reachable inputs with real `<label>` associations.

---

## 3. Bugs found and fixed in the agent's output

### 3.1 Fatal syntax error in `ansur.js`

Two `.on("mouseover", (event => this.showTooltip(event, …` calls — the box plot
(`ansur.js:467`) and the violin (`ansur.js:566`) — were each missing the `)` that closes
the `.on(` call. The other three `.on("mouseover"` handlers use the unwrapped
`(event, d) => …` form and were correctly balanced.

A `SyntaxError` means the **entire script fails to parse**: the page would have rendered
completely blank, with no error message and not even the boot-time fallback handler
running. Both were patched; the file now passes a delimiter-balance check.

### 3.2 Diverging colour scale had no neutral midpoint

`matrixColor` used `d3.interpolateRgbBasis([NEG, MID, POS])`. A B-spline never reaches
its middle control point, so `r = 0` rendered as muddy grey `#c8bac8` and the intended
near-white `#f7f7f7` never appeared anywhere on the scale:

| r | t | before (`interpolateRgbBasis`) | after (`piecewise`) |
| --- | --- | --- | --- |
| −1 | 0.00 | `#2166ac` | `#2166ac` |
| 0 | 0.50 | `#c8bac8` ← wrong | `#f7f7f7` |
| +1 | 1.00 | `#b2182b` | `#b2182b` |

This contradicted the README's own description ("blue → near-white → red") and the
screen-reader text in `index.html` ("near-zero values are light grey"). Replaced with
`d3.piecewise(d3.interpolateRgb, [NEG, MID, POS])`, which lands exactly on `#f7f7f7`
at `r = 0` and leaves both endpoints unchanged.

---

## 4. Verification

### 4.1 Passed

- **Covariance independently confirmed.** Recomputed five cells plus a variance diagonal
  through a separate code path (raw-sums formula, fresh CSV parse): all matched
  `summary.json` exactly, including pairwise row counts — e.g. stature↔span
  `8826.603527` over n = 5930, height↔weight `85.968701` over n = 6067. The correlations
  the agent cited (`r = 0.66212` height×weight, `0.961355` height×stature) were confirmed
  against `summary.json`.
- **`data.js` contract.** Parses in Python; 6,068 records, 18 keys each, genders
  `{M: 4082, F: 1986}`, 800 nulls in the expected columns, row 1496 `weight` is `null`.
- **Statistics logic.** `describe` / `pairwiseStats` / `analyze` in `ansur.js` were read
  line by line and match `prep.py`: pairwise-complete covariance, `n−1` denominator,
  `d3.quantile` linear interpolation, and Pearson `r` derived from the same covariance
  matrix so the two views cannot disagree.
- **Structure.** Delimiter balance balanced; every local `src`/`href` resolves to an
  existing file; D3 pinned to `7.9.0`; no `Math.random`, `d3-random`, transitions, or
  durations; model-signature comment present in all four files; LF endings throughout;
  no data values from `summary.json` hard-coded into the UI.
- **Reproducibility.** `prep.py` re-run yields a byte-identical `summary.json`.

### 4.2 Not verified

**The page was never executed.** This environment has no JavaScript runtime — no `node`,
`deno`, `bun`, `quickjs`, `d8`, and no Python JS bridge — and no browser. Syntax and logic
were checked statically, and the statistics against an independently computed reference,
but the following remain unconfirmed by execution and are worth a look in a browser:

- the actual in-browser rendering of any chart;
- the KDE/violin path output;
- the covariance-view colour scaling under real numbers.

Suggested spot-check: the default scatter should show **r ≈ 0.662** and `n = 6067`; the
KPI row should show 6,068 records / 4,082 Male / 1,986 Female / 800 missing cells; and
toggling to Covariance should leave the diagonal neutral grey rather than colour-scaled.

---

## 5. Data quality

Surfaced in the UI and the README rather than hidden. Nothing is imputed anywhere.

- **Mixed units.** `height` is in **inches**, `weight` in **pounds**, `age` in years, and
  the other 15 body measurements in **millimetres**. Confirmed from the data itself —
  the mean BMI is only plausible (26.2) under the lb/in formula. Every axis states its own
  unit, no shared axis mixes unit groups, and the matrix defaults to the unit-free
  correlation scale. Raw covariance is available but mixes incompatible units, so its
  cells are colour + tooltip only and its diagonal (a variance, orders of magnitude
  larger) is excluded from the colour scale.
- **800 missing cells**, spread across `span` (138), `ear.protrusion` (210),
  `head.breadth` (205), `foot.length` (135), `ear.length` (69), `hand.palm` (27),
  `hand.length` (12), `hand.breadth` (2), `head.length` (1). Preserved as `null`; each
  statistic excludes the nulls it cannot use and reports the `n` it actually summarised.
- **One implausible value** — a recorded `weight` of 0 lb (source row 1496).
  `prep.py` recodes it to `null`; it is not "fixed" further and no value is invented.
- **Zero duplicate rows.**

---

## 6. Dependencies and citations

- **D3.js v7.9.0** (pinned) — https://d3js.org — loaded from
  `https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js`. To work fully offline, download
  it next to `index.html` and point the `<script src>` at the local copy.
- **ANSUR** dataset — `data/ansur-full.csv`.
- Colour palette derived from Paul Tol's "bright" qualitative scheme.
- Built with this repository's `d3` skill and `visualize` agent guidelines.