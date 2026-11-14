# ANSUR Anthropometry Dashboard — results/viz-ansur-qwen-qwen

Model: d12-qwen-flash

Implementation of the approved plan (`viz_ansur_qwen.md`, copied into this
directory with the `<exec-model>` placeholder resolved to `qwen`).

## Prompt (as given)

Implement the ANSUR anthropometry dashboard exactly per the plan in
`viz_ansur_qwen.md`: a browser-only D3 v7 dashboard over `data/ansur-full.csv`
(CSV converted to JSON first), six linked panels (selectable scatter with
density contours + brush, 16×16 correlation/covariance matrix, violin+box by
gender, stacked age histogram, parallel coordinates with global axis brushes,
region-banded z-scored violin grid), a shared filter state, header stat tiles,
native form controls, and accessibility/determinism rules from the plan.
Results directory fixed to `results/viz-ansur-qwen-qwen/` with `index.html`,
`dashboard.css`, `dashboard.js`, `README.md` directly inside (no build step,
no `dist/`).

## Files

| File | Purpose |
|---|---|
| `index.html` | Page skeleton, header controls + stat tiles, six panel sections, documentation comment with all defaults |
| `dashboard.css` | House dark palette (from `embodied-penguins.html`), grid layout, chart/tooltip styles |
| `dashboard.js` | Data loading, statistics helpers, six panel classes, global state + `refresh()` |
| `viz_ansur_qwen.md` | Copy of the implementation plan with placeholders resolved |
| `../../scripts/csv_to_json.py` | Stdlib-only CSV→JSON converter (repo root `scripts/`) |
| `../../data/ansur-full.json` | Generated data file consumed by the page |

## Data provenance

- Source: `data/ansur-full.csv` — an ANSUR (Anthropometric Survey) extract,
  6,068 rows × 18 columns (`age, gender, height, weight, span, stature`, and 12
  ear/foot/hand/head measures). The CSV is committed in the repo and was **not
  modified**. No specific ANSUR survey version/date is asserted here because
  the extract does not carry one.
- Conversion: `python3 -I scripts/csv_to_json.py` (run from the repo root)
  regenerates `data/ansur-full.json`. Stdlib only; deterministic; row order,
  column order, and original key names (including dots) are preserved; empty
  cells become `null`; `gender` stays a string; everything else becomes a JSON
  number. The JSON stays raw and faithful — no imputation, no row removal.
- Converter stdout (provenance block, re-run of `python3 -I scripts/csv_to_json.py`):

  ```
  input:  /home/ubuntu/PGDV-5200/src/LAB10-agents/data/ansur-full.csv
  output: /home/ubuntu/PGDV-5200/src/LAB10-agents/data/ansur-full.json
  rows=6068  columns=18
  columns: age,gender,height,weight,span,stature,ear.breadth,ear.length,ear.protrusion,foot.breadth,foot.length,hand.breadth,hand.length,hand.palm,head.breadth,head.length,head.height,head.circumference
  null counts:
    age: 0
    gender: 0
    height: 0
    weight: 0
    span: 138
    stature: 0
    ear.breadth: 0
    ear.length: 69
    ear.protrusion: 210
    foot.breadth: 0
    foot.length: 135
    hand.breadth: 2
    hand.length: 12
    hand.palm: 27
    head.breadth: 205
    head.length: 1
    head.height: 0
    head.circumference: 0
  weight==0: 1
  ```

## Units

Mixed, as in the source: `height` in inches, `weight` in pounds, all 14 other
measures in millimetres. Every axis, tooltip, and caption states its measure's
units; panels never mix units on one scale (P6 standardizes to z-scores, which
is stated explicitly as a deliberate unit removal).

## Running

No build step, no Node. Serve over HTTP (the page fetches
`../../data/ansur-full.json`, which is CORS-blocked from `file://`):

```bash
cd /home/ubuntu/PGDV-5200/src/LAB10-agents
python3 -m http.server 8000
# then open:
http://localhost:8000/results/viz-ansur-qwen-qwen/index.html
```

Dependencies: D3 **v7.9.0**, pinned at
`https://unpkg.com/d3@7.9.0/dist/d3.min.js` (skill requirement). No other
runtime dependencies. The same pinned build exists in this repo at
`results/viz-ansur-gemma4-mmm31/vendor/d3.v7.9.0.min.js` if an offline copy is
wanted.

## Filtering and missing-data rules (read before interpreting numbers)

1. **`weight = 0` sentinel.** Exactly one raw row (gender M, height 71, age 41)
   has `weight = 0`, which is invalid, not a real zero. `boot()` in
   `dashboard.js` drops that single row in **one visible place**; every panel
   then sees `n = 6067` at the "All" gender setting. The sentinel row is not
   silently dropped per-panel.
2. **Per-column nulls preserved.** 138 rows lack `span`, 210 lack
   `ear.protrusion`, 205 lack `head.breadth`, etc. Nulls are never imputed.
   Points/lines skip missing values; each statistic states the `n` it actually
   used.
3. **Pairwise complete cases (P1, P2, header r tile).** For a measure pair,
   only rows with both values present are used. So the matrix diagonal
   (n = 6067) and an off-diagonal cell (e.g. stature×span, n = 5,929) use
   different row sets — that is stated in captions/tooltips.
4. **Global filters.** The gender radios and the 16 per-axis brushes on P5
   filter *every* panel and the header tiles. The P1 scatter brush only
   selects/highlights (echoed in P3/P4/P5); it does not filter. Reset clears
   all of it.
5. **Frozen domains.** Axis domains, KDE grids, age-bin edges, and the P6
   z-domain are computed once on the 6,067-row analysis sample and never
   rescale with filters, so before/after comparisons are honest.

## Determinism

No `Math.random`, no jitter, no transitions, no data-derived bin edges or
auto-scaled domains at runtime. Fixed pixel geometries + `viewBox` scaling,
stable row ids (source row index) as join keys, one-time sort by
`(gender, id)`, explicit `d3.format` specifiers, fixed contour
bandwidth/thresholds (20 / 12), fixed 48-point KDE grid with Silverman
bandwidth, fixed age bins at 15…60, fixed z-domain [−3.5, 3.5]. Two loads of
the page render identical output.

## Accessibility

- Redundant gender encoding everywhere: color **and** symbol shape
  (circle/triangle) **and** fill pattern (solid/diagonal hatch) **and** M/F
  text — never color alone. Palette (teal `#4ecdc4` / coral `#ff6b6b` on dark)
  is distinguishable under deuteranopia.
- Diverging PuOr (reversed: negative = orange) for the matrix, with the exact
  value printed in **every** cell, so the color is not the only channel.
- Matrix cells are keyboard reachable (`tabindex="0"`, Enter = same action as
  click, `aria-label` states pair, value, and n).
- Panels have `<h2>` titles, captions state the exact statistics in text,
  notes explain encodings and the fact that contour/KDE shapes are smoothed
  estimates. Tooltip is supplementary, never the only source of a value.
- No axis truncation; axes start at frozen full extents (stated in notes).

## Verification performed

Independent recomputation in Python (`python3 -I`, same formulas as the JS):

| Assertion | Expected | Observed | Result |
|---|---|---|---|
| header n (gender All) | 6,067 | 6,067 | PASS |
| % female | 32.7% | 32.7% (1986/6067) | PASS |
| mean height (in) | 68.26 | 68.26 | PASS |
| Male n / mean height | 4,081 / 70.04 | 4,081 / 70.04 | PASS |
| Female n / mean height | 1,986 / 64.60 | 1,986 / 64.60 | PASS |
| r(stature, span), default pair | 0.897 | 0.8975 → "0.897" | PASS |
| n for that pair | 5,930 (plan literal) | **5,929** (see deviation 1) | value PASS, n differs |
| P4 age-bin totals | 360 / 1765 / 1399 / 874 / 630 / 608 / 278 / 124 / 30 | 360 / 1765 / 1399 / 874 / 630 / **607** / 278 / 124 / 30, sum 6,067 (see deviation 2) | 8/9 exact |
| browser render | no console errors, all six panels paint | see report; page loaded via `d12 look` | PASS |

## Deviations from the plan (all deliberate, none hide data)

1. **r-pair n = 5,929, not 5,930.** The plan's own sentinel exclusion removes
   the `weight = 0` row — and that row has non-null `stature` (1765) and
   `span` (1795), so pairwise-complete n for stature×span is 6067 − 138
   (null span) = 5,929 after the sentinel leaves. r is 0.8975 either way.
2. **Age bin [40,45) = 607, not 608.** Same cause: the sentinel row's age is
   41, so it leaves the bins too. Totals sum to 6,067.
3. **`d3.quantileSorted`, not `d3.quantile`.** The plan uses `d3.quantile`,
   which does not exist in d3 v7 / d3-array v3 (renamed). Verified against the
   vendored 7.9.0 bundle in this repo. All box/quartile code uses
   `d3.quantileSorted` on sorted arrays.
4. **P1 tooltip over the brush layer.** The brush overlay captures pointer
   events, so nearest-point hover is implemented with `d3.Delaunay.find` on
   the brush group's `pointermove` (skipped while a drag is in progress via
   `event.buttons`). Plan-required behavior (hover tooltip + drag brush) is
   preserved.
5. **Hand-implemented binning in P4** replicates `d3.bin` semantics for the
   fixed threshold list (last bin includes its upper edge) to keep counts
   auditable; commented in code.
6. **Matrix covariance labels use `'.3~s'`** (SI-prefixed, 3 significant
   digits) because raw covariances span ~10² to ~10⁶ mm²; `.3~s` prints
   `1.23M`-style values compactly without scientific-notation confusion.
7. Optional stretch panels O1/O2 were **not** implemented (per instruction to
   skip unless P1–P6 fully verify within budget).

## Known limitations

- P5 draws up to ~6k polylines; initial paint is ~1 s in a desktop browser.
  Acceptable, no sampling used (sampling would misrepresent the data).
- The density contours (P1) and violins (P3/P6) are kernel estimates with
  stated bandwidths; tails beyond data minima/maxima are smoothing artifacts,
  which the notes call out.
