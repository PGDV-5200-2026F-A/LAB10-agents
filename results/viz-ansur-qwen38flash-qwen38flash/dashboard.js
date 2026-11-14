// Model: d12-qwen-flash
/*
  ANSUR Anthropometry Dashboard — dashboard.js
  d3 v7.9.0 (pinned in index.html). Browser-only, no Node, deterministic:
  no Math.random, no transitions carrying state, fixed sizes/domains,
  stable SVG ids, explicit d3.format specifiers only.

  Structure (per plan viz_ansur_qwen.md):
    constants -> stats helpers -> tooltip helpers -> Panel base class ->
    6 panel classes -> load/derive + state + refresh() wiring -> boot.

  Stats notes (deviations from the plan text, both verified against the
  vendored d3@7.9.0 bundle in results/viz-ansur-gemma4-mmm31/vendor/):
   - d3.correlation does NOT exist in d3 v7, so pearson() is hand-written.
   - the plan says "d3.quantile"; in d3 v7 (d3-array v3) that was renamed to
     d3.quantileSorted -> we use d3.quantileSorted (input must be sorted).
   - covariance cells print with d3.format('.3~s') instead of '.2f' so full
     values fit in 26 px cells; tooltips carry full precision.
*/

'use strict';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const DATA_PATH = '../../data/ansur-full.json'; // relative to index.html

// 16 measurement columns, in CSV column order (age and gender handled apart).
const MEASURES = [
  'height', 'weight', 'span', 'stature',
  'ear.breadth', 'ear.length', 'ear.protrusion',
  'hand.breadth', 'hand.length', 'hand.palm',
  'foot.breadth', 'foot.length',
  'head.breadth', 'head.length', 'head.height', 'head.circumference'
];

// Mixed units are labelled honestly and never mixed on one axis.
const UNITS = {
  height: 'in', weight: 'lbs', span: 'mm', stature: 'mm',
  'ear.breadth': 'mm', 'ear.length': 'mm', 'ear.protrusion': 'mm',
  'hand.breadth': 'mm', 'hand.length': 'mm', 'hand.palm': 'mm',
  'foot.breadth': 'mm', 'foot.length': 'mm',
  'head.breadth': 'mm', 'head.length': 'mm', 'head.height': 'mm',
  'head.circumference': 'mm'
};

const NICE = {}; // 'head.circumference' -> 'Head circumference'
for (const m of MEASURES) {
  NICE[m] = m.replace(/\./g, ' ').replace(/^\w/, c => c.toUpperCase());
}
const axisLabel = m => `${NICE[m]} (${UNITS[m]})`;

// Body regions: drives P5 axis order and the P6 band layout. 16 total.
const REGIONS = [
  ['OVERALL', ['height', 'weight', 'stature', 'span']],
  ['EAR',     ['ear.breadth', 'ear.length', 'ear.protrusion']],
  ['HAND',    ['hand.breadth', 'hand.length', 'hand.palm']],
  ['FOOT',    ['foot.breadth', 'foot.length']],
  ['HEAD',    ['head.breadth', 'head.length', 'head.height', 'head.circumference']]
];
const REGION_MEASURES = REGIONS.flatMap(r => r[1]);

// Fixed defaults documented in index.html.
const AGE_EDGES = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60]; // never data-derived
const KDE_GRID = 48;            // fixed KDE grid resolution
const Z_DOMAIN = [-3.5, 3.5];   // fixed z domain for P6
const CONTOUR_BANDWIDTH = 20;
const CONTOUR_THRESHOLDS = 12;

const COLORS = { bg: '#0a0e14', fg: '#e8eef5', muted: '#6b7c8c',
                 accent: '#4ecdc4', accent2: '#ff6b6b', card: '#131a24',
                 border: '#233040' };

const GENDER = {
  M: { label: 'Male',   color: COLORS.accent,  symbol: d3.symbolCircle },
  F: { label: 'Female', color: COLORS.accent2, symbol: d3.symbolTriangle }
};
const GENDER_KEYS = ['M', 'F']; // fixed iteration order (determinism)

/* ------------------------------------------------------------------ */
/* Stats helpers (plain functions, formulas in comments)               */
/* ------------------------------------------------------------------ */

// Zip two measure columns over rows, dropping pairs where either is null.
// THIS IS THE ONLY place missingness is handled for the scatter/matrix,
// so the pairwise-complete-cases policy is one line to audit.
function pairwise(rows, a, b) {
  const xs = [], ys = [];
  for (const r of rows) {
    if (r[a] !== null && r[b] !== null) { xs.push(r[a]); ys.push(r[b]); }
  }
  return [xs, ys];
}

// Two-pass centred Pearson r = sxy / sqrt(sxx * syy).
// Hand-written because d3.correlation does not exist in d3@7.9.0.
// Returns null if n < 3 or either variance is 0.
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

// Sample covariance = sxy / (n - 1)  (note: n-1 denominator).
function covariance(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxy = 0;
  for (let i = 0; i < n; i++) sxy += (xs[i] - mx) * (ys[i] - my);
  return sxy / (n - 1);
}

// Quantiles: d3.quantileSorted REQUIRES sorted input (the plan wrote
// "d3.quantile", which was renamed to quantileSorted in d3-array v3 / d3 v7).
function quantilesSorted(sorted) {
  return {
    q1: d3.quantileSorted(sorted, 0.25),
    median: d3.quantileSorted(sorted, 0.5),
    q3: d3.quantileSorted(sorted, 0.75)
  };
}

// Tukey box statistics: whiskers reach the most extreme data point within
// 1.5 * IQR of the box; everything beyond is an outlier.
function boxStats(values) {
  const s = values.slice().sort(d3.ascending);
  const { q1, median, q3 } = quantilesSorted(s);
  const iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr, hiFence = q3 + 1.5 * iqr;
  let whiskerLow = null, whiskerHigh = null;
  const outliers = [];
  for (const v of s) {
    if (v < loFence || v > hiFence) outliers.push(v);
    else {
      if (whiskerLow === null) whiskerLow = v;
      whiskerHigh = v;
    }
  }
  return {
    min: s[0], max: s[s.length - 1], q1, median, q3, iqr,
    whiskerLow, whiskerHigh, outliers, mean: d3.mean(s)
  };
}

// Silverman's rule of thumb: h = 0.9 * min(sd, IQR/1.34) * n^(-1/5).
function silvermanBandwidth(values) {
  const n = values.length;
  const sorted = values.slice().sort(d3.ascending);
  const sd = d3.deviation(values) || 0;
  const { q1, q3 } = quantilesSorted(sorted);
  const spread = Math.min(sd, (q3 - q1) / 1.34) || sd;
  if (!(spread > 0)) return 1; // degenerate (constant) column: avoid /0
  return 0.9 * spread * Math.pow(n, -1 / 5);
}

// Hand-rolled Gaussian KDE on a FIXED, equally spaced grid of nGrid points
// spanning extent. f(x) = (1 / (n*h)) * sum_i phi((x - x_i)/h).
// Fixed grid -> violins under different filters share the same x positions
// and stay directly comparable.
function kde(values, extent, nGrid = KDE_GRID) {
  const n = values.length;
  if (n === 0) return [];
  const h = silvermanBandwidth(values);
  const norm = 1 / (n * h * Math.sqrt(2 * Math.PI));
  const out = [];
  for (let i = 0; i < nGrid; i++) {
    const x = extent[0] + (extent[1] - extent[0]) * i / (nGrid - 1);
    let s = 0;
    for (const v of values) {
      const u = (x - v) / h;
      s += Math.exp(-0.5 * u * u);
    }
    out.push({ x, y: s * norm });
  }
  return out;
}

// z = (x - mean) / sd, guarded for sd === 0 (returns all zeros).
function zValues(values) {
  const mean = d3.mean(values);
  const sd = d3.deviation(values) || 0;
  if (sd === 0) return values.map(() => 0);
  return values.map(v => (v - mean) / sd);
}

// Choose dark or light text for a cell fill by relative luminance of the
// fill itself (contrast-checked, not hardcoded per color).
function contrastText(fill) {
  const c = d3.color(fill);
  const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  return lum > 0.55 ? COLORS.bg : COLORS.fg;
}

/* ------------------------------------------------------------------ */
/* Shared tooltip (d3 skill pattern: .visible class, pointer-events:   */
/* none, pageX/pageY positioning). No statistic exists only here.      */
/* ------------------------------------------------------------------ */

const tip = d3.select('#tooltip');
function showTip(html, event) {
  tip.classed('visible', true)
     .html(html)
     .style('left', (event.pageX + 12) + 'px')
     .style('top', (event.pageY - 12) + 'px');
}
function hideTip() { tip.classed('visible', false); }

/* ------------------------------------------------------------------ */
/* Panel base class                                                    */
/* ------------------------------------------------------------------ */

class Panel {
  constructor(containerId, width, height, margin) {
    this.container = d3.select(containerId);
    this.width = width; this.height = height; this.margin = margin;
    this.innerW = width - margin.left - margin.right;
    this.innerH = height - margin.top - margin.bottom;
    this.svg = this.container.append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', width).attr('height', height)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('role', 'img');
    this.g = this.svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);
  }
  // Every panel implements update(rowsFiltered, idsBrushed).
  update() {}
  // Panels with brushes implement resetBrushes().
  resetBrushes() {}
}

/* ------------------------------------------------------------------ */
/* P1 — big selectable scatter                                         */
/* ------------------------------------------------------------------ */

class ScatterPanel extends Panel {
  constructor(containerId) {
    super(containerId, 720, 460, { top: 16, right: 18, bottom: 56, left: 68 });
    this.x = d3.scaleLinear().range([0, this.innerW]);
    this.y = d3.scaleLinear().range([0, this.innerH]);
    this.gContour = this.g.append('g');           // contours BELOW points
    this.gPts = this.g.append('g');
    this.gxAxis = this.g.append('g').attr('class', 'axis')
      .attr('transform', `translate(0,${this.innerH})`);
    this.gyAxis = this.g.append('g').attr('class', 'axis');
    this.xlabel = this.g.append('text').attr('class', 'axis-label')
      .attr('x', this.innerW / 2).attr('y', this.innerH + 42)
      .attr('text-anchor', 'middle');
    this.ylabel = this.g.append('text').attr('class', 'axis-label')
      .attr('transform', `translate(${-52},${this.innerH / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle');

    // Brush on top of marks: to keep hover tooltips working over the brush
    // overlay we identify the nearest point with a d3.Delaunay lookup in the
    // pointermove handler instead of per-mark mouseover.
    this.brush = d3.brush().extent([[0, 0], [this.innerW, this.innerH]])
      .on('end', event => this.brushEnded(event));
    this.gBrush = this.g.append('g').attr('class', 'brush').call(this.brush);

    this.gBrush
      .on('pointermove.tip', event => this.hover(event))
      .on('pointerleave.tip', hideTip);

    // Two symbol shapes only (circle/triangle), one path each, deterministic.
    this.symPath = {
      M: d3.symbol().type(d3.symbolCircle).size(48)(),
      F: d3.symbol().type(d3.symbolTriangle).size(48)()
    };
  }

  brushEnded(event) {
    if (!event.sourceEvent) return; // ignore programmatic moves (Reset)
    const sel = event.selection;
    if (!sel) {
      state.scatterBrush = null;
    } else {
      // Store the selection in DATA space, not pixels: it then survives
      // gender/PC-brush filter changes without re-snapping.
      const [[px0, py0], [px1, py1]] = sel;
      state.scatterBrush = {
        xVar: state.xVar, yVar: state.yVar,
        x: [this.x.invert(px0), this.x.invert(px1)],
        y: [this.y.invert(py1), this.y.invert(py0)] // y pixels run top-down
      };
    }
    refresh();
  }

  hover(event) {
    if (event.buttons !== 0 || !this.delaunay) return; // skip while brushing
    const [mx, my] = d3.pointer(event, this.g.node());
    const i = this.delaunay.find(mx, my);
    if (i === undefined || i < 0) return;
    const r = this.hoverRows[i];
    const dx = this.x(r[state.xVar]) - mx, dy = this.y(r[state.yVar]) - my;
    if (dx * dx + dy * dy > 20 * 20) { hideTip(); return; }
    const g = GENDER[r.gender];
    let lines = '';
    for (const [region, ms] of REGIONS) {
      const parts = [];
      for (const m of ms) if (r[m] !== null) parts.push(`${NICE[m]} ${r[m]} ${UNITS[m]}`);
      lines += `<br><em>${region}</em>: ${parts.join(' · ') || '—'}`;
    }
    showTip(`<span class="${r.gender === 'F' ? 'tt-f' : ''}"><b>${g.label} · id ${r.id}</b></span>` +
      `<br>age ${r.age} y · height ${r.height} in · weight ${r.weight === 0 ? '—' : r.weight} lbs${lines}`, event);
  }

  update(rowsFiltered, idsBrushed) {
    const xv = state.xVar, yv = state.yVar;

    // A brush drawn against a previous measure pair no longer means anything;
    // clear its pixels (data-space state is also ignored in computeIdsBrushed).
    if (state.scatterBrush &&
        (state.scatterBrush.xVar !== xv || state.scatterBrush.yVar !== yv)) {
      this.gBrush.call(this.brush.move, null);
    }

    // Pairwise complete cases on the selected pair.
    const rows = rowsFiltered.filter(r => r[xv] !== null && r[yv] !== null);
    this.hoverRows = rows;

    // Frozen full-sample (analysis-rows) domains: toggling gender or brushing
    // never rescales an axis, so comparisons across filters stay honest.
    this.x.domain(META[xv].extent);
    this.y.domain(META[yv].extent);
    this.gxAxis.call(d3.axisBottom(this.x).tickFormat(d3.format('.0f')));
    this.gyAxis.call(d3.axisLeft(this.y).tickFormat(d3.format('.0f')));
    this.xlabel.text(axisLabel(xv));
    this.ylabel.text(axisLabel(yv));

    // Points: one symbol path per row; shape ≠ color redundancy (a11y).
    // No jitter, no randomness — over-plotting is handled by opacity + contours.
    const hasBrush = idsBrushed.size > 0;
    this.gPts.selectAll('path').data(rows, r => r.id).join(
      enter => enter.append('path')
        .attr('class', 'pt')
        .attr('stroke', 'none')
    )
      .attr('d', r => this.symPath[r.gender])
      .attr('transform', r => `translate(${this.x(r[xv])},${this.y(r[yv])})`)
      .attr('fill', r => GENDER[r.gender].color)
      .attr('class', r => 'pt' + (hasBrush && !idsBrushed.has(r.id) ? ' dimmed' : ''));
    // (.join() already removes exiting points for rows that dropped out of
    //  the filter; no extra exit handling needed.)

    // Density contours: smoothed estimate, parameters stated in caption.
    this.gContour.selectAll('*').remove();
    if (state.densityOverlay && rows.length > 1) {
      const contours = d3.contourDensity()
        .x(r => this.x(r[xv]))
        .y(r => this.y(r[yv]))
        .size([this.innerW, this.innerH])
        .bandwidth(CONTOUR_BANDWIDTH)
        .thresholds(CONTOUR_THRESHOLDS)(rows);
      this.gContour.selectAll('path').data(contours).join('path')
        .attr('class', 'contour')
        .attr('d', d3.geoPath());
    }

    this.delaunay = rows.length
      ? d3.Delaunay.from(rows, r => this.x(r[xv]), r => this.y(r[yv]))
      : null;

    d3.select('#p1-caption').text(
      `X = ${axisLabel(xv)}, Y = ${axisLabel(yv)} · n = ${rows.length} of ${rowsFiltered.length} rows ` +
      `(pairwise complete: nulls in X or Y dropped; axes span the frozen full-sample extents ` +
      `${META[xv].extent[0]}–${META[xv].extent[1]} and ${META[yv].extent[0]}–${META[yv].extent[1]})`
    );
  }

  resetBrushes() { this.gBrush.call(this.brush.move, null); }
}

/* ------------------------------------------------------------------ */
/* P2 — 16x16 correlation / covariance matrix                          */
/* ------------------------------------------------------------------ */

class MatrixPanel extends Panel {
  constructor(containerId) {
    const cell = 26; // 16 cells
    super(containerId, 100 + 16 * cell + 14, 92 + 16 * cell + 96,
          { top: 92, right: 14, bottom: 96, left: 100 });
    this.cell = cell;
    this.xBand = d3.scaleBand().domain(MEASURES).range([0, this.innerW]);
    this.yBand = d3.scaleBand().domain(MEASURES).range([0, this.innerH]);

    this.gBands = this.g.append('g'); // hover/focus row/col highlight
    this.gCells = this.g.append('g');
    this.gLegend = this.svg.append('g')
      .attr('transform', `translate(${this.margin.left},${this.height - 62})`);

    // Static row/column labels, rotated 45° on top, plain on the left.
    this.g.selectAll('.col-label').data(MEASURES).join('text')
      .attr('class', 'cell-label')
      .attr('transform', m => `translate(${this.xBand(m) + this.xBand.bandwidth() / 2 + 3},-8) rotate(-45)`)
      .attr('text-anchor', 'start')
      .text(m => m);
    this.g.selectAll('.row-label').data(MEASURES).join('text')
      .attr('class', 'cell-label')
      .attr('x', -8).attr('y', m => this.yBand(m) + this.yBand.bandwidth() / 2 + 3)
      .attr('text-anchor', 'end')
      .text(m => m);

    this.matrix = null;
    this.lastKey = null;

    this.grad = this.svg.append('defs').append('linearGradient')
      .attr('id', 'grad-matrix')
      .attr('x1', '0%').attr('x2', '100%');
  }

  filterKey() {
    // Matrix describes the gender/PC-filtered population; the scatter brush
    // deliberately does NOT change it (caption says so), so the cache key
    // only includes those two inputs.
    const pc = [...state.pcBrushes.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)
      .map(([m, [lo, hi]]) => `${m}:${d3.format('.4~f')(lo)}-${d3.format('.4~f')(hi)}`);
    return state.gender + '|' + pc.join('|');
  }

  computeMatrix(rows) {
    const key = this.filterKey();
    if (this.matrix && key === this.lastKey) return;
    this.matrix = new Map();
    this.maxAbsCov = 0;
    for (let i = 0; i < MEASURES.length; i++) {
      for (let j = i; j < MEASURES.length; j++) {
        const a = MEASURES[i], b = MEASURES[j];
        const [xs, ys] = pairwise(rows, a, b);
        const entry = { r: pearson(xs, ys), cov: covariance(xs, ys), n: xs.length };
        this.matrix.set(`${a}|${b}`, entry);
        this.matrix.set(`${b}|${a}`, entry); // r(a,b) === r(b,a); symmetric
        if (entry.cov !== null) this.maxAbsCov = Math.max(this.maxAbsCov, Math.abs(entry.cov));
      }
    }
    this.lastKey = key;
  }

  colorScale() {
    if (state.matrixMetric === 'r') {
      // PuOr, range reversed so negative = orange (CVD-robust diverging).
      return d3.scaleDiverging(d3.interpolatePuOr).domain([1, 0, -1]).clamp(true);
    }
    // Covariance is scale-dependent: sequential diverging over
    // [-maxAbsCov, maxAbsCov] recomputed from the CURRENT matrix.
    return d3.scaleSequential(d3.interpolatePuOr).domain([this.maxAbsCov, -this.maxAbsCov]).clamp(true);
  }

  update(rowsFiltered) {
    this.computeMatrix(rowsFiltered);
    const color = this.colorScale();
    const fmtVal = state.matrixMetric === 'r' ? d3.format('.2f') : d3.format('.3~s');

    const cellData = [];
    for (const a of MEASURES) for (const b of MEASURES) cellData.push([a, b]);

    const self = this;
    const cells = this.gCells.selectAll('rect.matrix-cell').data(cellData, d => d[0] + '|' + d[1])
      .join(enter => enter.append('rect')
        .attr('class', 'matrix-cell')
        .attr('tabindex', 0)
        .on('mouseover focus', function (event, d) { self.hoverCell(event, d, this); })
        .on('mouseout blur', () => { hideTip(); this.gBands.selectAll('*').remove(); })
        .on('click', (event, d) => this.pick(d))
        .on('keydown', (event, d) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.pick(d); }
        }))
      .attr('x', d => this.xBand(d[0]))
      .attr('y', d => this.yBand(d[1]))
      .attr('width', this.xBand.bandwidth())
      .attr('height', this.yBand.bandwidth());

    cells.each(function (d) {
      const e = self.matrix.get(d[0] + '|' + d[1]);
      const v = state.matrixMetric === 'r' ? e.r : e.cov;
      const fill = v === null ? COLORS.border : color(v);
      d3.select(this).attr('fill', fill)
        .attr('aria-label', `${NICE[d[0]]} (${UNITS[d[0]]}) vs ${NICE[d[1]]} (${UNITS[d[1]]}): ` +
          `r = ${e.r === null ? 'n/a' : e.r.toFixed(3)}, covariance = ` +
          `${e.cov === null ? 'n/a' : e.cov.toFixed(1)}, n = ${e.n}. Press Enter to plot this pair.`);
    });

    // Numeric value in EVERY cell (color is never the only channel).
    const texts = this.gCells.selectAll('text.cell-value').data(cellData, d => d[0] + '|' + d[1])
      .join(enter => enter.append('text')
        .attr('class', 'cell-value')
        .attr('text-anchor', 'middle'));
    texts
      .attr('x', d => this.xBand(d[0]) + this.xBand.bandwidth() / 2)
      .attr('y', d => this.yBand(d[1]) + this.yBand.bandwidth() / 2 + 3.5)
      .each(function (d) {
        const e = self.matrix.get(d[0] + '|' + d[1]);
        const v = state.matrixMetric === 'r' ? e.r : e.cov;
        d3.select(this)
          .text(v === null ? '–' : fmtVal(v))
          .attr('fill', v === null ? COLORS.muted : contrastText(color(v)));
      });

    this.drawLegend(color);

    const n = rowsFiltered.length;
    let cap = `16 × 16 over ${n} filtered rows (gender + axis-brush filter only — the scatter brush does not ` +
      `change this matrix). Cells use pairwise complete cases, so per-pair n varies (shown on hover); ` +
      `diagonal: r = 1.00 / variance in native units. Units: height in inches, weight in lbs, all else mm.`;
    if (state.matrixMetric === 'cov') {
      cap += ` Warning: covariance is scale-dependent — cells mix in·lbs, mm², in·mm, ` +
             `so only same-unit cells are comparable; read color against the gradient below.`;
    } else {
      cap += ` Most measures load positively on overall body size (stature/span), which is why the ` +
             `matrix looks mostly warm; height (in) vs stature (mm) at r ≈ 0.96 is unit redundancy, not a finding.`;
    }
    d3.select('#p2-caption').text(cap);
  }

  drawLegend(color) {
    this.gLegend.selectAll('*').remove();
    // Sample the current scale into the gradient.
    const stops = d3.range(0, 1.0001, 0.1);
    this.grad.selectAll('stop').data(stops).join('stop')
      .attr('offset', t => `${t * 100}%`)
      .attr('stop-color', t => color(color.domain()[0] + t * (color.domain()[1] - color.domain()[0])));
    const W = 260;
    this.gLegend.append('rect')
      .attr('width', W).attr('height', 12)
      .attr('fill', 'url(#grad-matrix)').attr('stroke', COLORS.border);
    const [d0, d1] = color.domain();
    const fmt = state.matrixMetric === 'r' ? d3.format('.2f') : d3.format('.3~s');
    const xs = [0, 0.5, 1];
    this.gLegend.selectAll('text.lg').data(xs).join('text')
      .attr('class', 'tick-sub')
      .attr('x', t => t * W).attr('y', 28)
      .attr('text-anchor', t => t === 0 ? 'start' : t === 1 ? 'end' : 'middle')
      .text(t => fmt(d0 + t * (d1 - d0)));
    this.gLegend.append('text').attr('class', 'tick-sub')
      .attr('x', W + 14).attr('y', 12)
      .text(state.matrixMetric === 'r' ? 'Pearson r' : 'covariance (mixed units)');
  }

  hoverCell(event, [a, b], node) {
    this.gBands.selectAll('*').remove();
    this.gBands.append('rect').attr('class', 'matrix-band')
      .attr('x', this.xBand(a)).attr('y', 0)
      .attr('width', this.xBand.bandwidth()).attr('height', this.innerH);
    this.gBands.append('rect').attr('class', 'matrix-band')
      .attr('x', 0).attr('y', this.yBand(b))
      .attr('width', this.innerW).attr('height', this.yBand.bandwidth());
    const e = this.matrix.get(a + '|' + b);
    // Keyboard focus fires a FocusEvent without page coordinates; anchor the
    // tooltip to the focused cell's bounding box in that case.
    let pos = event;
    if (event.pageX === undefined) {
      const rect = node.getBoundingClientRect();
      pos = {
        pageX: rect.left + rect.width / 2 + window.scrollX,
        pageY: rect.top + window.scrollY
      };
    }
    showTip(`<b>${axisLabel(a)} × ${axisLabel(b)}</b>` +
      `<br>r = ${e.r === null ? 'n/a' : e.r.toFixed(3)}` +
      `<br>cov = ${e.cov === null ? 'n/a' : e.cov.toFixed(1)} ${UNITS[a]}·${UNITS[b]}` +
      `<br>n = ${e.n} (pairwise complete)`, pos);
  }

  pick([a, b]) {
    // Click a cell -> load the pair into P1. Diagonal click -> set Y only.
    if (a === b) state.yVar = a;
    else { state.xVar = a; state.yVar = b; }
    // Keep DOM selects in sync with state — the DOM must never disagree.
    d3.select('#x-var').property('value', state.xVar);
    d3.select('#y-var').property('value', state.yVar);
    refresh();
    document.getElementById('p1').scrollIntoView();
  }
}

/* ------------------------------------------------------------------ */
/* P3 — violin + box for the scatter's Y measure, by gender            */
/* ------------------------------------------------------------------ */

function violinArea(kdeData, valueScale, halfWidthScale, cx) {
  // Single closed area between mirrored halves, smoothed (curveBasis).
  return d3.area()
    .curve(d3.curveBasis)
    .x(p => valueScale(p.x))
    .y0(p => cx - halfWidthScale(p.y))
    .y1(p => cx + halfWidthScale(p.y))(kdeData);
}

function drawBox(g, stats, cx, vs, half) {
  const bw = Math.min(12, half * 0.5);
  const grp = g.append('g').attr('class', 'box');
  grp.append('line').attr('x1', cx).attr('x2', cx)
    .attr('y1', vs(stats.whiskerHigh)).attr('y2', vs(stats.whiskerLow))
    .attr('stroke', COLORS.fg).attr('stroke-width', 1);
  for (const w of [stats.whiskerLow, stats.whiskerHigh]) {
    grp.append('line').attr('x1', cx - bw / 2).attr('x2', cx + bw / 2)
      .attr('y1', vs(w)).attr('y2', vs(w))
      .attr('stroke', COLORS.fg).attr('stroke-width', 1);
  }
  grp.append('rect')
    .attr('x', cx - bw / 2).attr('width', bw)
    .attr('y', vs(stats.q3)).attr('height', Math.max(1, vs(stats.q1) - vs(stats.q3)))
    .attr('fill', 'none').attr('stroke', COLORS.fg).attr('stroke-width', 1.2);
  grp.append('line').attr('x1', cx - bw / 2).attr('x2', cx + bw / 2)
    .attr('y1', vs(stats.median)).attr('y2', vs(stats.median))
    .attr('stroke', COLORS.fg).attr('stroke-width', 2.5);
  // mean = diamond
  const my = vs(stats.mean), s = 4;
  grp.append('polygon')
    .attr('points', `${cx},${my - s} ${cx + s},${my} ${cx},${my + s} ${cx - s},${my}`)
    .attr('fill', COLORS.fg).attr('stroke', 'none');
  for (const o of stats.outliers) {
    grp.append('circle').attr('cx', cx).attr('cy', vs(o)).attr('r', 2)
      .attr('fill', 'none').attr('stroke', COLORS.muted).attr('stroke-width', 1);
  }
}

class ViolinPanel extends Panel {
  constructor(containerId) {
    super(containerId, 420, 300, { top: 44, right: 20, bottom: 34, left: 64 });
    this.vs = d3.scaleLinear().range([this.innerH, 0]);
    this.gViolins = this.g.append('g');
    this.gxAxis = this.g.append('g').attr('class', 'axis')
      .attr('transform', `translate(0,${this.innerH})`);
    this.gyAxis = this.g.append('g').attr('class', 'axis');
    this.ylabel = this.g.append('text').attr('class', 'axis-label')
      .attr('transform', `translate(${-48},${this.innerH / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle');
  }

  update(rowsFiltered, idsBrushed) {
    const m = state.yVar;
    this.gViolins.selectAll('*').remove();

    // Values per gender (nulls dropped; the count dropped is reported).
    const byGender = new Map();
    let nullCount = 0;
    for (const r of rowsFiltered) {
      if (r[m] === null) { nullCount++; continue; }
      if (!byGender.has(r.gender)) byGender.set(r.gender, []);
      byGender.get(r.gender).push(r[m]);
    }
    const shown = GENDER_KEYS.filter(g => byGender.has(g));

    // Fixed 48-point grid over the frozen FULL-SAMPLE extent of this measure
    // so violins under different filters are directly comparable.
    const extent = META[m].extent;
    this.vs.domain(extent);
    this.gyAxis.call(d3.axisLeft(this.vs).tickFormat(d3.format('.0f')));
    this.ylabel.text(axisLabel(m));
    this.gxAxis.call(d3.axisBottom(d3.scaleLinear().domain(extent).range([0, this.innerW]))
      .ticks(0)); // x hidden: horizontal width is density, not a value scale

    const kdes = new Map();
    let densMax = 0;
    for (const g of shown) {
      const k = kde(byGender.get(g), extent);
      kdes.set(g, k);
      densMax = Math.max(densMax, d3.max(k, p => p.y));
    }

    const nSlots = Math.max(1, shown.length);
    const slotW = this.innerW / 2;
    const halfMax = slotW * 0.40;
    const densScale = d3.scaleLinear().domain([0, densMax || 1]).range([0, halfMax]);

    shown.forEach((g, gi) => {
      const cx = nSlots === 1 ? this.innerW / 2 : slotW * gi + slotW / 2;
      const vals = byGender.get(g);
      // Female violins also get the diagonal hatch pattern: texture, not
      // only hue, distinguishes the groups (a11y: never color alone).
      const fill = g === 'F' ? 'url(#fill-female-hatch)' : GENDER[g].color;
      this.gViolins.append('path')
        .attr('class', `violin-${g.toLowerCase()}`)
        .attr('d', violinArea(kdes.get(g), this.vs, densScale, cx))
        .attr('fill', fill).attr('fill-opacity', g === 'M' ? 0.5 : 1)
        .attr('stroke', GENDER[g].color).attr('stroke-width', 1.2);
      drawBox(this.gViolins, boxStats(vals), cx, this.vs, halfMax);
      this.gViolins.append('text').attr('class', 'violin-label')
        .attr('x', cx).attr('y', this.innerH + 22).attr('text-anchor', 'middle')
        .attr('fill', GENDER[g].color)
        .text(`${GENDER[g].label} (${g}, n = ${vals.length})`);
      const bs = boxStats(vals);
      const fmt1 = d3.format('.1f');
      this.gViolins.append('text').attr('class', 'violin-stats')
        .attr('x', cx).attr('y', -26).attr('text-anchor', 'middle')
        .text(`${g}: median ${fmt1(bs.median)} · IQR ${fmt1(bs.iqr)} · mean ${fmt1(bs.mean)}`);

      // Brush echo: thin outline violin of the P1-brushed subset, labelled.
      if (idsBrushed.size > 0) {
        const bvals = [];
        for (const r of rowsFiltered) {
          if (r.gender === g && idsBrushed.has(r.id) && r[m] !== null) bvals.push(r[m]);
        }
        if (bvals.length > 1) {
          this.gViolins.append('path').attr('class', 'brush-echo')
            .attr('d', violinArea(kde(bvals, extent), this.vs, densScale, cx));
          this.gViolins.append('text').attr('class', 'violin-stats')
            .attr('x', cx).attr('y', -12).attr('text-anchor', 'middle')
            .attr('fill', COLORS.fg)
            .text(`brushed n = ${bvals.length}`);
        }
      }
    });

    d3.select('#p3-caption').text(
      `Measure: ${axisLabel(m)} (P1's current Y) · ${nullCount} row(s) dropped for null ${m} · ` +
      `violins use a fixed ${KDE_GRID}-point grid over the frozen extent ${extent[0]}–${extent[1]}; ` +
      `width = density (arbitrary units)`
    );
  }
}

/* ------------------------------------------------------------------ */
/* P4 — stacked age histogram                                          */
/* ------------------------------------------------------------------ */

class HistogramPanel extends Panel {
  constructor(containerId) {
    super(containerId, 300, 260, { top: 26, right: 10, bottom: 40, left: 42 });
    this.xBand = d3.scaleBand().domain(d3.range(AGE_EDGES.length - 1)).range([0, this.innerW]).padding(0.18);
    this.yScale = d3.scaleLinear().range([this.innerH, 0]);
    this.gBars = this.g.append('g');
    this.gEcho = this.g.append('g');
    this.gxAxis = this.g.append('g').attr('class', 'axis')
      .attr('transform', `translate(0,${this.innerH})`);
    this.gyAxis = this.g.append('g').attr('class', 'axis');
    this.g.append('text').attr('class', 'axis-label')
      .attr('x', this.innerW / 2).attr('y', this.innerH + 34).attr('text-anchor', 'middle')
      .text('age (years)');
    this.g.append('text').attr('class', 'axis-label')
      .attr('transform', `translate(${-30},${this.innerH / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle').text('count');
  }

  update(rowsFiltered, idsBrushed) {
    // Bin edges fixed in code (never data-derived). Semantics are the d3.bin
    // rule: [edge_i, edge_i+1), last bin includes the right edge (age 60).
    // We implement it directly to avoid d3.bin's degenerate empty edge bins
    // when thresholds coincide with the domain endpoints.
    const nBins = AGE_EDGES.length - 1;
    const counts = Array.from({ length: nBins }, () => ({ M: 0, F: 0, brushed: 0 }));
    let excluded = 0;
    for (const r of rowsFiltered) {
      const a = r.age;
      if (a === null || a < AGE_EDGES[0] || a > AGE_EDGES[nBins]) { excluded++; continue; }
      let i = Math.floor((a - AGE_EDGES[0]) / 5);
      if (i === nBins) i = nBins - 1; // age exactly 60 lands in the last bin
      counts[i][r.gender]++;
      if (idsBrushed.has(r.id)) counts[i].brushed++;
    }

    // y domain [0, max bin total] — counts start at 0, no truncation.
    const maxTotal = Math.max(1, d3.max(counts, c => c.M + c.F));
    this.yScale.domain([0, maxTotal]);
    this.gyAxis.call(d3.axisLeft(this.yScale).ticks(5).tickFormat(d3.format('d')));
    this.gxAxis.call(d3.axisBottom(this.xBand).tickFormat(i => `${AGE_EDGES[i]}–${AGE_EDGES[i + 1]}`));

    const fmtD = d3.format('d');
    this.gBars.selectAll('*').remove();
    counts.forEach((c, i) => {
      const x = this.xBand(i), w = this.xBand.bandwidth();
      const hM = this.innerH - this.yScale(c.M);
      const hF = this.yScale(c.M) - this.yScale(c.M + c.F);
      if (c.M > 0) this.gBars.append('rect')
        .attr('x', x).attr('y', this.yScale(c.M)).attr('width', w).attr('height', hM)
        .attr('fill', COLORS.accent);
      if (c.F > 0) this.gBars.append('rect')
        .attr('x', x).attr('y', this.yScale(c.M + c.F)).attr('width', w).attr('height', hF)
        .attr('fill', 'url(#fill-female-hatch)')
        .attr('stroke', COLORS.accent2).attr('stroke-width', 0.8);
      // totals above every bar; segment counts inside when they fit
      this.gBars.append('text').attr('class', 'bar-total')
        .attr('x', x + w / 2).attr('y', this.yScale(c.M + c.F) - 4)
        .attr('text-anchor', 'middle').text(fmtD(c.M + c.F));
      // segment counts inside when they fit; text color chosen per segment
      // fill (dark text on solid teal, light text over the open hatch)
      if (hM >= 13) this.gBars.append('text').attr('class', 'bar-seg')
        .attr('x', x + w / 2).attr('y', this.yScale(c.M) - 3)
        .attr('fill', COLORS.bg)
        .attr('text-anchor', 'middle').text('M ' + fmtD(c.M));
      if (hF >= 13) this.gBars.append('text').attr('class', 'bar-seg')
        .attr('x', x + w / 2).attr('y', this.yScale(c.M + c.F) + 11)
        .attr('fill', COLORS.fg)
        .attr('text-anchor', 'middle').text('F ' + fmtD(c.F));
    });

    // Brush echo: outlined segments for the P1-brushed subset per bin.
    this.gEcho.selectAll('*').remove();
    if (idsBrushed.size > 0) {
      counts.forEach((c, i) => {
        if (c.brushed === 0) return;
        this.gEcho.append('rect')
          .attr('x', this.xBand(i)).attr('width', this.xBand.bandwidth())
          .attr('y', this.yScale(c.brushed))
          .attr('height', this.innerH - this.yScale(c.brushed))
          .attr('fill', 'none').attr('stroke', COLORS.fg)
          .attr('stroke-width', 1.2).attr('stroke-dasharray', '3 2');
      });
    }

    d3.select('#p4-caption').text(
      `n = ${d3.sum(counts, c => c.M + c.F)} of ${rowsFiltered.length} filtered rows · ` +
      `fixed 5-year bins 15–60 (${excluded} row(s) outside bins or with null age)` +
      (idsBrushed.size ? ` · dashed outlines = P1-brushed subset per bin` : '')
    );
  }
}

/* ------------------------------------------------------------------ */
/* P5 — parallel coordinates (axis brushes are GLOBAL filters)         */
/* ------------------------------------------------------------------ */

class ParallelPanel extends Panel {
  constructor(containerId) {
    super(containerId, 1160, 380, { top: 66, right: 52, bottom: 26, left: 52 });
    this.xPos = d3.scalePoint().domain(REGION_MEASURES).range([0, this.innerW]).padding(0.5);
    // Independent per-axis scales over FROZEN extents — never normalized,
    // since z-normalizing here would hide unit differences (P6 does that,
    // explicitly labelled).
    this.yScales = {};
    for (const m of REGION_MEASURES) {
      this.yScales[m] = d3.scaleLinear().domain(META[m].extent).range([this.innerH, 0]);
    }
    this.gLines = this.g.append('g');
    this.gAxes = this.g.append('g');
    this.nTexts = {};

    // Points carry their precomputed pixel position (each axis has its own
    // scale); missing values break the polyline instead of drawing through them.
    this.lineGen = d3.line()
      .defined(p => p.v !== null)
      .x(p => p.px)
      .y(p => p.py);

    this.brush = d3.brushY().extent([[-9, 0], [9, this.innerH]])
      .on('end', (event, m) => this.brushEnded(event, m));

    // Build one group per axis, once (domains are frozen, so brush pixel
    // selections stay valid across updates).
    const axes = this.gAxes.selectAll('g.axis-g').data(REGION_MEASURES, m => m).join('g')
      .attr('class', 'axis-g')
      .attr('transform', m => `translate(${this.xPos(m)},0)`);
    axes.append('line')
      .attr('y1', 0).attr('y2', this.innerH)
      .attr('stroke', COLORS.muted);
    axes.append('text').attr('class', 'pc-axis-label')
      .attr('transform', 'translate(0,-10) rotate(-45)')
      .attr('text-anchor', 'start').text(m => m)
      .attr('aria-label', m => axisLabel(m) + ' axis');
    for (const m of REGION_MEASURES) {
      this.nTexts[m] = axes.filter(x => x === m).append('text')
        .attr('class', 'pc-axis-n')
        .attr('y', this.innerH + 18).attr('text-anchor', 'middle');
    }
    axes.append('g').attr('class', 'pc-brush').call(this.brush);
  }

  brushEnded(event, m) {
    if (!event.sourceEvent) return; // ignore programmatic Reset moves
    const sel = event.selection;
    if (!sel) state.pcBrushes.delete(m);
    else {
      // Store in DATA units so brushes survive filter changes; a brush on an
      // axis EXCLUDES rows with null there (they cannot be shown to qualify).
      const s = this.yScales[m];
      state.pcBrushes.set(m, [s.invert(sel[1]), s.invert(sel[0])]);
    }
    refresh();
  }

  update(rowsFiltered, idsBrushed) {
    // Selected rows are appended last so they paint on top; order inside each
    // group is the fixed (gender, id) sort -> fully deterministic.
    const hasBrush = idsBrushed.size > 0;
    const ordered = hasBrush
      ? [...rowsFiltered.filter(r => !idsBrushed.has(r.id)),
         ...rowsFiltered.filter(r => idsBrushed.has(r.id))]
      : rowsFiltered;

    this.gLines.selectAll('path').data(ordered, r => r.id).join('path')
      .attr('class', r => 'pc-line' + (idsBrushed.has(r.id) ? ' pc-selected' : ''))
      .attr('stroke', r => GENDER[r.gender].color)
      .attr('d', r => {
        const pts = REGION_MEASURES.map(m => ({
          v: r[m], px: this.xPos(m), py: this.yScales[m](r[m] === null ? 0 : r[m])
        }));
        return this.lineGen(pts);
      });

    for (const m of REGION_MEASURES) {
      this.nTexts[m].text(`n = ${rowsFiltered.length}`);
    }
    d3.select('#p5-caption').text(
      `n = ${rowsFiltered.length} polylines (1 per filtered row; one polyline per row, no sampling) · ` +
      `${state.pcBrushes.size} axis brush(es) active [global filter] · live n under each axis label`
    );
  }

  resetBrushes() {
    this.gAxes.selectAll('g.pc-brush').call(this.brush.move, null);
  }
}

/* ------------------------------------------------------------------ */
/* P6 — body-region z-scored violin grid                               */
/* ------------------------------------------------------------------ */

class RegionViolinGrid extends Panel {
  constructor(containerId) {
    // bottom margin 80 leaves room for the rotated per-column labels
    super(containerId, 1160, 330, { top: 40, right: 24, bottom: 80, left: 48 });
    this.zScale = d3.scaleLinear().domain(Z_DOMAIN).range([this.innerH, 0]);
    this.gGrid = this.g.append('g');
    this.gZero = this.g.append('g');
    this.gxAxis = this.g.append('g').attr('class', 'axis')
      .attr('transform', `translate(0,${this.innerH})`);
    this.gyAxis = this.g.append('g').attr('class', 'axis');
    this.g.append('text').attr('class', 'axis-label')
      .attr('transform', `translate(${-36},${this.innerH / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .text('z-score (within-measure, computed on current filter)');
  }

  update(rowsFiltered) {
    this.gGrid.selectAll('*').remove();
    const nCols = REGION_MEASURES.length;
    const colW = this.innerW / nCols;
    const halfMax = colW * 0.42;

    // z computed on the CURRENT filtered sample per measure, then KDE on the
    // common fixed grid [-3.5, 3.5] (same helper as P3).
    const cols = [];
    let densMax = 0;
    for (const m of REGION_MEASURES) {
      const per = {};
      for (const g of GENDER_KEYS) {
        const vals = [];
        for (const r of rowsFiltered) if (r.gender === g && r[m] !== null) vals.push(r[m]);
        if (vals.length > 1) {
          // z and box stats both on the standardized scale, so the median
          // tick inside each violin is the true z-median (not simply 0).
          const z = zValues(vals);
          const k = kde(z, Z_DOMAIN);
          per[g] = { kde: k, stats: boxStats(z) };
          densMax = Math.max(densMax, d3.max(k, p => p.y));
        }
      }
      cols.push({ m, per });
    }
    const densScale = d3.scaleLinear().domain([0, densMax || 1]).range([0, halfMax]);

    this.gyAxis.call(d3.axisLeft(this.zScale).tickValues(d3.range(-3, 3.1, 1))
      .tickFormat(v => (v > 0 ? '+' : '') + d3.format('.0f')(v)));
    this.gxAxis.call(d3.axisBottom(d3.scaleLinear().domain(Z_DOMAIN).range([0, this.innerW])).ticks(0));

    // Region bands: vertical rules + band labels.
    let colIdx = 0;
    for (const [band, ms] of REGIONS) {
      const first = colIdx, last = colIdx + ms.length - 1;
      const x0 = first * colW, x1 = (last + 1) * colW;
      if (first > 0) this.gGrid.append('line').attr('class', 'band-rule')
        .attr('x1', x0).attr('x2', x0).attr('y1', -18).attr('y2', this.innerH);
      this.gGrid.append('text').attr('class', 'band-label')
        .attr('x', (x0 + x1) / 2).attr('y', -24).attr('text-anchor', 'middle')
        .text(band);
      colIdx += ms.length;
    }

    // Zero reference line across the panel.
    this.gZero.selectAll('*').remove();
    this.gZero.append('line').attr('class', 'z-zero')
      .attr('x1', 0).attr('x2', this.innerW).attr('y1', this.zScale(0)).attr('y2', this.zScale(0));

    cols.forEach((c, i) => {
      const cx = i * colW + colW / 2;
      const genders = GENDER_KEYS.filter(g => c.per[g]);
      const sub = colW / (genders.length + 1);
      genders.forEach((g, gi) => {
        const gx = cx - colW / 2 + sub * (gi + 1);
        const d = c.per[g];
        this.gGrid.append('path')
          .attr('d', violinArea(d.kde, this.zScale, densScale, gx))
          .attr('fill', g === 'F' ? 'url(#fill-female-hatch)' : GENDER[g].color)
          .attr('fill-opacity', g === 'M' ? 0.5 : 1)
          .attr('stroke', GENDER[g].color).attr('stroke-width', 1);
        // median tick inside each violin (z scale)
        this.gGrid.append('line')
          .attr('x1', gx - 5).attr('x2', gx + 5)
          .attr('y1', this.zScale(d.stats.median)).attr('y2', this.zScale(d.stats.median))
          .attr('stroke', COLORS.fg).attr('stroke-width', 1.5);
      });
      // Column label rotated -45° (16 columns are too close for horizontal text).
      this.gGrid.append('text').attr('class', 'pc-axis-n')
        .attr('transform', `translate(${cx},${this.innerH + 14}) rotate(-45)`)
        .attr('text-anchor', 'end').text(c.m);
    });

    d3.select('#p6-caption').text(
      `z = (x − mean) / sd per measure on the current filtered sample (n = ${rowsFiltered.length}); ` +
      `grid fixed to z ∈ [${Z_DOMAIN[0]}, ${Z_DOMAIN[1]}], shared density scale; ` +
      `dashed line = z = 0. This is the only panel with units removed — ` +
      `it compares size-independent shape, not millimetres (original units: height in, weight lbs, ` +
      `all others mm). M solid teal, F hatched coral; short white tick = z-median.`
    );
  }
}

/* ------------------------------------------------------------------ */
/* Global state, derived data, refresh() wiring                        */
/* ------------------------------------------------------------------ */

const state = {
  gender: 'ALL',            // 'ALL' | 'M' | 'F'
  xVar: 'stature',          // big scatter X (default)
  yVar: 'span',             // big scatter Y (default)
  densityOverlay: true,     // d3.contourDensity on/off (default on)
  matrixMetric: 'r',        // 'r' | 'cov'
  scatterBrush: null,       // {xVar, yVar, x:[lo,hi], y:[lo,hi]} in data space
  pcBrushes: new Map(),     // measure -> [lo, hi] in data units (global filter)
  pinnedIds: new Set()      // reserved for click-pinning; brushes/Reset clear it
};

let ANALYSIS_ROWS = []; // sentinel-excluded, sorted once by (gender, id)
let META = {};          // frozen per-measure stats (axes never rescale)
let rowsFiltered = [];
let idsBrushed = new Set();
let panels = [];

function computeRowsFiltered() {
  return ANALYSIS_ROWS.filter(r => {
    if (state.gender !== 'ALL' && r.gender !== state.gender) return false;
    for (const [m, [lo, hi]] of state.pcBrushes) {
      const v = r[m];
      // Nulls are excluded while that axis is brushed: we cannot show that a
      // missing value lies inside the chosen range.
      if (v === null || v < lo || v > hi) return false;
    }
    return true;
  });
}

function computeIdsBrushed(rs) {
  const out = new Set();
  const sb = state.scatterBrush;
  if (!sb || sb.xVar !== state.xVar || sb.yVar !== state.yVar) return out;
  for (const r of rs) {
    const xv = r[state.xVar], yv = r[state.yVar];
    if (xv === null || yv === null) continue;
    if (xv >= sb.x[0] && xv <= sb.x[1] && yv >= sb.y[0] && yv <= sb.y[1]) out.add(r.id);
  }
  return out;
}

function updateTiles() {
  const n = rowsFiltered.length;
  if (n === 0) {
    // Possible when parallel-coordinate brushes leave nothing; show zeros
    // rather than NaN so the filter state stays readable.
    d3.select('#tile-n').text('0');
    d3.select('#tile-pct-female').text('–');
    d3.select('#tile-mean-height').text('–');
    d3.select('#tile-r').text('–');
    d3.select('#tile-r-label').text(`r(${state.xVar}, ${state.yVar}) · n = 0`);
    return;
  }
  const nF = rowsFiltered.filter(r => r.gender === 'F').length;
  d3.select('#tile-n').text(d3.format(',d')(n));
  d3.select('#tile-pct-female').text(d3.format('.1f')(100 * nF / n) + '%');
  d3.select('#tile-mean-height').text(d3.format('.2f')(d3.mean(rowsFiltered, r => r.height)) + ' in');
  const [xs, ys] = pairwise(rowsFiltered, state.xVar, state.yVar);
  const r = pearson(xs, ys);
  d3.select('#tile-r').text(r === null ? 'n/a' : d3.format('.3f')(r));
  d3.select('#tile-r-label').text(
    `r(${state.xVar}, ${state.yVar}) · n = ${xs.length} (pairwise complete)`
  );
}

function refresh() {
  rowsFiltered = computeRowsFiltered();
  idsBrushed = computeIdsBrushed(rowsFiltered);
  // Panels only ever see (rowsFiltered, idsBrushed) — they never talk to
  // each other; this is the entire cross-chart wiring.
  for (const p of panels) p.update(rowsFiltered, idsBrushed);
  updateTiles();
}

function boot(rawRows) {
  /* ---- derive ---- */
  // Stable ids = source row index; the join key for every cross-chart
  // selection, so selections survive re-sorting and re-filtering.
  rawRows.forEach((r, i) => { r.id = i; });

  // Sentinel exclusion (ONE auditable place): exactly 1 row has weight = 0.0
  // (gender M, height 71 in, age 41) — an invalid sentinel, excluded from
  // every panel; n drops 6068 -> 6067; the header shows both numbers.
  ANALYSIS_ROWS = rawRows.filter(r => r.weight === null || r.weight > 0);

  // Deterministic sort once by (gender, id); every later bind uses this order.
  ANALYSIS_ROWS.sort((a, b) =>
    a.gender < b.gender ? -1 : a.gender > b.gender ? 1 : a.id - b.id);

  // Frozen per-measure metadata on the ANALYSIS rows (pre gender/PC filter):
  // fixed axis domains, so toggling gender or brushing never rescales an
  // axis (keeps cross-filter comparisons honest).
  META = {};
  for (const m of MEASURES) {
    const vals = ANALYSIS_ROWS.map(r => r[m]).filter(v => v !== null);
    const s = vals.slice().sort(d3.ascending);
    const { q1, median, q3 } = quantilesSorted(s);
    META[m] = {
      extent: d3.extent(s), mean: d3.mean(s), sd: d3.deviation(s),
      q1, median, q3, iqr: q3 - q1, n: vals.length
    };
  }

  /* ---- controls ---- */
  const xSel = d3.select('#x-var'), ySel = d3.select('#y-var');
  for (const m of MEASURES) {
    xSel.append('option').attr('value', m).text(axisLabel(m));
    ySel.append('option').attr('value', m).text(axisLabel(m));
  }
  xSel.property('value', state.xVar);
  ySel.property('value', state.yVar);
  xSel.on('change', function () { state.xVar = this.value; refresh(); });
  ySel.on('change', function () { state.yVar = this.value; refresh(); });
  d3.select('#density-toggle').on('change', function () {
    state.densityOverlay = this.checked; refresh();
  });
  d3.selectAll('input[name="gender"]').on('change', function () {
    state.gender = this.value; refresh();
  });
  d3.selectAll('input[name="metric"]').on('change', function () {
    state.matrixMetric = this.value; refresh();
  });
  d3.select('#reset').on('click', () => {
    state.gender = 'ALL';
    d3.selectAll('input[name="gender"]').property('checked', function () {
      return this.value === 'ALL';
    });
    state.pcBrushes.clear();
    state.scatterBrush = null;
    state.pinnedIds.clear();
    for (const p of panels) p.resetBrushes(); // end handlers ignore programmatic moves
    refresh();
  });

  /* ---- panels (order = reading order) ---- */
  panels = [
    new ScatterPanel('#p1-chart'),
    new MatrixPanel('#p2-chart'),
    new ViolinPanel('#p3-chart'),
    new HistogramPanel('#p4-chart'),
    new ParallelPanel('#p5-chart'),
    new RegionViolinGrid('#p6-chart')
  ];

  refresh();
}

/* ---- load ---- */
window.addEventListener('DOMContentLoaded', () => {
  d3.json(DATA_PATH)
    .then(rows => {
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('empty or unexpected JSON');
      boot(rows);
    })
    .catch(err => {
      // Visible, specific failure: name the path and the http requirement.
      const p = document.createElement('p');
      p.className = 'load-error';
      p.textContent =
        `Could not load ${DATA_PATH} (${err.message}). The path is relative to ` +
        `index.html's location (results/viz-ansur-qwen-qwen/), so the page must be ` +
        `served over http from the repo root, e.g. ` +
        `"python3 -m http.server 8000" then http://localhost:8000/results/viz-ansur-qwen-qwen/index.html ` +
        `(fetch of local JSON over file:// is CORS-blocked).`;
      document.body.insertBefore(p, document.querySelector('main'));
    });
});
