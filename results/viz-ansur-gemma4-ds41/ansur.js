/*
 * ansur.js — ANSUR anthropometric dashboard logic (PGDV5200 LAB09)
 * Model signature: deepseek-v4.1-flash
 *
 * Data source: ansur/data.js → window.ANSUR
 *   { source, columns (18), numeric_columns (17), categorical_columns (["gender"]),
 *     row_count (6068), records: [ {age, gender, height, weight, span, ...}, ... ] }
 *   Every numeric field is a JS number, or null when the measurement is missing.
 *   Records keep the source CSV order and carry all 18 keys.
 *
 * The statistics below are computed here, client-side, from window.ANSUR.records,
 * so they react to the gender filter. The definitions deliberately match the ones
 * prep.py used (and which summary.json records):
 *   - covariance is PAIRWISE-COMPLETE: each cell uses only the rows where BOTH
 *     variables are non-null (not row-wise deletion);
 *   - sample covariance, n-1 denominator;
 *   - quantiles by linear interpolation (the d3.quantile definition);
 *   - Pearson r is derived from that same covariance matrix (r = cov / (sd_a * sd_b)),
 *     so the covariance and correlation views can never disagree.
 *
 * Documented defaults (full list is in the header comment of index.html):
 *   - D3 pinned to 7.9.0; no Math.random(), no d3-random, no transitions;
 *     fixed width/height/margins/viewBox; explicit deterministic sorts before
 *     every data binding; stable string ids for SVG defs.
 *   - Scatter point sampling is a deterministic stride over records sorted by
 *     (x value, gender, source index); never random.
 *   - Covariance heatmap defaults to the correlation matrix (unit-free).
 *   - Box/violin whiskers/extents use the data min–max (a five-number summary).
 */
"use strict";

/* ============================================================================
 * 0. Data access
 * ========================================================================== */

const ANSUR = window.ANSUR || null;

// Canonical column order comes straight from prep.py (ANSUR.numeric_columns),
// so every matrix, <select>, and legend keeps the same order across runs.
const NUMERIC = (ANSUR && Array.isArray(ANSUR.numeric_columns)) ? ANSUR.numeric_columns.slice() : [];

// Copies of the records, each tagged with its stable source index (_i). Raw
// fields are copied, never mutated: prep.py owns the canonical data.
const RECORDS = ((ANSUR && Array.isArray(ANSUR.records)) ? ANSUR.records : []).map(function (record, index) {
  const copy = { _i: index };
  const keys = Object.keys(record);
  for (let k = 0; k < keys.length; k++) copy[keys[k]] = record[keys[k]];
  return copy;
});

/* ============================================================================
 * 1. Configuration constants (metadata, not measured values)
 * ========================================================================== */

// Units mirror prep.py / summary.json. They are labels for the axes; keeping
// them here (rather than in data.js) avoids touching the generated file.
const UNITS = {
  "age": "years",
  "height": "in",
  "weight": "lb",
  "span": "mm",
  "stature": "mm",
  "ear.breadth": "mm",
  "ear.length": "mm",
  "ear.protrusion": "mm",
  "foot.breadth": "mm",
  "foot.length": "mm",
  "hand.breadth": "mm",
  "hand.length": "mm",
  "hand.palm": "mm",
  "head.breadth": "mm",
  "head.length": "mm",
  "head.height": "mm",
  "head.circumference": "mm"
};

// Short axis labels for the matrix (the full names are too long to interleave).
const SHORT = {
  "age": "age",
  "height": "height",
  "weight": "weight",
  "span": "span",
  "stature": "stature",
  "ear.breadth": "ear.br",
  "ear.length": "ear.ln",
  "ear.protrusion": "ear.pr",
  "foot.breadth": "foot.br",
  "foot.length": "foot.ln",
  "hand.breadth": "hand.br",
  "hand.length": "hand.ln",
  "hand.palm": "hand.pl",
  "head.breadth": "head.br",
  "head.length": "head.ln",
  "head.height": "head.ht",
  "head.circumference": "head.circ"
};

const GENDERS = ["M", "F"];                 // fixed, sorted order for stable grouping
const GENDER_LABEL = { M: "Male", F: "Female" };
const GENDER_COLOR = { M: "#0077bb", F: "#ee7733" };

// Matrix colour scale: blue (negative) → near-white (zero) → red (positive).
// The RdBu family is a conventional, reasonably CVD-safe diverging palette; the
// numeric value printed in each cell is the primary, non-colour encoding.
const MATRIX_NEG = "#2166ac";
const MATRIX_MID = "#f7f7f7";
const MATRIX_POS = "#b2182b";
const MATRIX_EMPTY = "#e9ebee";
// Fixed fill for the covariance diagonal (a variance; excluded from the scale).
const MATRIX_DIAG = "#b9c0c9";

// Defaults for the linked views.
const DEFAULT_FEATURE = "height";
const DEFAULT_SCATTER_Y = "weight";

const BINS = 30;              // histogram bins (fixed, documented)
const KDE_GRID = 120;         // violin density grid points (fixed)
const MAX_SCATTER_POINTS = 4000;

// Fixed chart geometry. 3-column cards are ~420px outer → 386px content; the
// wide cards span the full 1320px dashboard (1286px content).
const CHART_W = 386;
const CHART_H = 380;
const SCATTER_W = 1286;
const SCATTER_H = 420;
const MATRIX_W = 760;
const MATRIX_H = 785;

/* ============================================================================
 * 2. Formatters (consistent precision everywhere)
 * ========================================================================== */

const fmtInt = d3.format(",.0f");
const fmt1 = d3.format(".1f");
const fmt2 = d3.format(".2f");
const fmt3 = d3.format(".3f");
const fmtPct0 = d3.format(".0%");
const fmtPct1 = d3.format(".1%");
const fmtCov = d3.format(".4~s");   // covariance can span many orders of magnitude
const fmtTick = d3.format(".4~g");  // compact axis ticks (mm values are large)

/* ============================================================================
 * 3. Statistics (definitions match prep.py — see file header)
 * ========================================================================== */

// Descriptive statistics for one column; missing (null) values are excluded.
function describe(records, key) {
  const present = [];
  let missing = 0;
  for (let i = 0; i < records.length; i++) {
    const v = records[i][key];
    if (v === null || v === undefined) missing++;
    else present.push(v);
  }
  present.sort(d3.ascending);            // explicit deterministic sort
  const n = present.length;
  if (n === 0) {
    return { n: 0, missing: missing, min: null, q1: null, median: null, q3: null, max: null, mean: null, std: null };
  }
  const mean = d3.mean(present);
  const variance = n > 1 ? d3.sum(present, function (v) { return (v - mean) * (v - mean); }) / (n - 1) : 0;
  return {
    n: n,
    missing: missing,
    min: present[0],
    q1: d3.quantile(present, 0.25),
    median: d3.quantile(present, 0.50),
    q3: d3.quantile(present, 0.75),
    max: present[n - 1],
    mean: mean,
    std: Math.sqrt(variance)
  };
}

// Pairwise-complete sums for two columns: means and the cross-product over the
// rows where BOTH values are present. Two passes to match prep.py exactly.
function pairwiseStats(xs, ys) {
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i];
    if (x === null || x === undefined || y === null || y === undefined) continue;
    n++; sx += x; sy += y;
  }
  if (n < 2) {
    return { n: n, meanX: null, meanY: null, cov: null, varX: null, varY: null,
             slope: null, intercept: null, minX: null, maxX: null, minY: null, maxY: null };
  }
  const meanX = sx / n, meanY = sy / n;
  let sxy = 0, sxx = 0, syy = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i];
    if (x === null || x === undefined || y === null || y === undefined) continue;
    const dx = x - meanX, dy = y - meanY;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cov = sxy / (n - 1);
  const varX = sxx / (n - 1);
  const slope = varX > 0 ? cov / varX : 0;
  return {
    n: n, meanX: meanX, meanY: meanY, cov: cov, varX: varX, varY: syy / (n - 1),
    slope: slope, intercept: meanY - slope * meanX,
    minX: minX, maxX: maxX, minY: minY, maxY: maxY
  };
}

// Full covariance/correlation/count analysis over `columns` for `records`.
// - diagonal covariance = variance (n-1) of the available cases for the column;
// - off-diagonal = pairwise-complete covariance;
// - correlation = covariance normalised by the two single-column standard
//   deviations (prep.py's definition), so covariance and correlation agree.
function analyze(records, columns) {
  const series = {}, desc = {};
  for (let c = 0; c < columns.length; c++) {
    const key = columns[c];
    series[key] = records.map(function (r) { return r[key]; });
    desc[key] = describe(records, key);
  }

  const covariance = [], correlation = [], counts = [];
  for (let a = 0; a < columns.length; a++) {
    const covRow = [], corRow = [], cntRow = [];
    for (let b = 0; b < columns.length; b++) {
      const ka = columns[a], kb = columns[b];
      if (a === b) {
        covRow.push(desc[ka].n > 0 ? desc[ka].std * desc[ka].std : 0);
        corRow.push(desc[ka].n > 0 ? 1 : null);
        cntRow.push(desc[ka].n);
      } else {
        const stats = pairwiseStats(series[ka], series[kb]);
        covRow.push(stats.cov);
        cntRow.push(stats.n);
        const denom = (desc[ka].n > 0 && desc[kb].n > 0) ? desc[ka].std * desc[kb].std : 0;
        corRow.push(stats.cov === null || denom === 0 ? null : stats.cov / denom);
      }
    }
    covariance.push(covRow);
    correlation.push(corRow);
    counts.push(cntRow);
  }
  return { columns: columns, series: series, desc: desc,
           covariance: covariance, correlation: correlation, counts: counts };
}

// Kernel density estimate on a fixed grid (used by the violin plot). Deterministic:
// fixed grid size and a Silverman bandwidth derived from the data.
function gaussianKernel(u) {
  return Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
}

function kde(values, grid, bandwidth) {
  const n = values.length;
  const out = new Array(grid.length);
  for (let g = 0; g < grid.length; g++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += gaussianKernel((grid[g] - values[i]) / bandwidth);
    out[g] = sum / (n * bandwidth);
  }
  return out;
}

function silvermanBandwidth(values) {
  const n = values.length;
  if (n < 2) return 1;
  const mean = d3.mean(values);
  const variance = d3.sum(values, function (v) { return (v - mean) * (v - mean); }) / (n - 1);
  const sd = Math.sqrt(variance);
  const h = 1.06 * sd * Math.pow(n, -1 / 5);
  return h > 0 ? h : 1;
}

// Diverging colour for the matrix: t in [0,1] maps to neg → mid → pos.
// Piecewise-linear rather than a basis spline: a B-spline never reaches its
// middle control point, so d3.interpolateRgbBasis would render r = 0 as a muddy
// grey (#c8bac8) and MATRIX_MID would never appear on the scale at all. That
// would contradict both this scale's intent and the sr-only description in
// index.html ("near-zero values are light grey").
const matrixColor = d3.piecewise(d3.interpolateRgb, [MATRIX_NEG, MATRIX_MID, MATRIX_POS]);

// Pick a legible label colour for a cell background (contrast-aware).
function labelColorFor(bg) {
  const c = d3.color(bg);
  if (!c) return "#1f2430";
  const luminance = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  return luminance > 0.62 ? "#1f2430" : "#ffffff";
}

// 5%-padded range for axis domains; falls back to a unit span for degenerate data.
function paddedDomain(lo, hi, frac) {
  if (lo === null || hi === null) return [0, 1];
  const span = hi - lo;
  if (span <= 0) return [lo - 1, hi + 1];
  const pad = span * (frac === undefined ? 0.05 : frac);
  return [lo - pad, hi + pad];
}

/* ============================================================================
 * 4. Shared chart base (svg, axes, axis labels, tooltip)
 * ========================================================================== */

class ChartBase {
  constructor(containerId, width, height, margin, ariaLabel) {
    this.width = width;
    this.height = height;
    this.margin = margin;
    this.innerW = width - margin.left - margin.right;
    this.innerH = height - margin.top - margin.bottom;

    this.svg = d3.select("#" + containerId).append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", "0 0 " + width + " " + height)
      .attr("role", "img")
      .attr("aria-label", ariaLabel);

    this.plot = this.svg.append("g")
      .attr("transform", "translate(" + margin.left + "," + margin.top + ")");
  }

  // Re-render support: drop plot contents and any rebuilt defs (gradients).
  clear() {
    this.plot.selectAll("*").remove();
    this.svg.selectAll("defs").remove();
  }

  renderXAxis(scale, label, tickFormat, tickCount) {
    let axis = d3.axisBottom(scale).tickFormat(tickFormat || function (t) { return t; });
    if (tickCount) axis = axis.ticks(tickCount);
    this.plot.append("g")
      .attr("class", "axis")
      .attr("transform", "translate(0," + this.innerH + ")")
      .call(axis);
    if (label) {
      this.plot.append("text")
        .attr("class", "axis-label")
        .attr("x", this.innerW / 2)
        .attr("y", this.innerH + 40)
        .attr("text-anchor", "middle")
        .text(label);
    }
  }

  renderYAxis(scale, label, tickFormat, tickCount) {
    let axis = d3.axisLeft(scale).tickFormat(tickFormat || function (t) { return t; });
    if (tickCount) axis = axis.ticks(tickCount);
    this.plot.append("g").attr("class", "axis").call(axis);
    if (label) {
      this.plot.append("text")
        .attr("class", "axis-label")
        .attr("transform", "rotate(-90)")
        .attr("x", -this.innerH / 2)
        .attr("y", -42)
        .attr("text-anchor", "middle")
        .text(label);
    }
  }

  // Single shared #tooltip element, .visible opacity pattern (see ansur.css).
  showTooltip(event, html) {
    d3.select("#tooltip")
      .classed("visible", true)
      .html(html)
      .style("left", (event.pageX + 14) + "px")
      .style("top", (event.pageY - 14) + "px");
  }

  hideTooltip() {
    d3.select("#tooltip").classed("visible", false);
  }
}

// Axis label with the unit appended, e.g. "Stature (mm)".
function axisLabel(key) {
  return key + " (" + UNITS[key] + ")";
}

/* ============================================================================
 * 5. Distribution charts: box plot, violin plot, histogram (bar)
 * ========================================================================== */

// Box plot of one feature, one box per gender. Whiskers span the data min–max
// (a plain five-number summary), as in the earlier box/ dashboard.
class BoxPlot extends ChartBase {
  constructor() {
    super("chart-box", CHART_W, CHART_H,
      { top: 34, right: 16, bottom: 50, left: 62 },
      "Box plot of the selected measurement by gender: box is the interquartile range, the dark line is the median, the white diamond is the mean, and the whiskers span the minimum to the maximum.");
  }

  render(records, key) {
    this.clear();
    const desc = describe(records, key);
    const domain = paddedDomain(desc.min, desc.max, 0.02);
    const y = d3.scaleLinear().domain(domain).range([this.innerH, 0]);
    const x = d3.scaleBand().domain(GENDERS).range([0, this.innerW]).padding(0.45);

    this.renderYAxis(y, axisLabel(key), fmtTick);
    this.plot.append("g")
      .attr("class", "axis")
      .attr("transform", "translate(0," + this.innerH + ")")
      .call(d3.axisBottom(x).tickFormat(function (g) { return GENDER_LABEL[g]; }).tickSize(0));

    // Legend: median (line) vs mean (diamond) — shape + text, not colour alone.
    const legend = this.plot.append("g").attr("class", "legend")
      .attr("transform", "translate(0,-18)");
    legend.append("line").attr("x1", 0).attr("x2", 16).attr("class", "box-median");
    legend.append("text").attr("x", 22).attr("dy", "0.32em").text("median");
    legend.append("path").attr("class", "box-mean")
      .attr("d", diamondPath(74, 0, 4.5));
    legend.append("text").attr("x", 84).attr("dy", "0.32em").text("mean");

    if (desc.n === 0) {
      this.plot.append("text").attr("x", this.innerW / 2).attr("y", this.innerH / 2)
        .attr("text-anchor", "middle").text("no data for this feature");
      return;
    }

    const bw = x.bandwidth();
    for (let gi = 0; gi < GENDERS.length; gi++) {
      const gender = GENDERS[gi];
      const values = records
        .filter(function (r) { return r.gender === gender && r[key] !== null && r[key] !== undefined; })
        .map(function (r) { return r[key]; })
        .sort(d3.ascending);
      const g = this.plot.append("g").attr("class", "box-group");
      const cx = x(gender) + bw / 2;

      if (values.length === 0) {
        g.append("text").attr("x", cx).attr("y", this.innerH / 2)
          .attr("text-anchor", "middle").text("no " + GENDER_LABEL[gender]);
        continue;
      }

      const min = values[0], max = values[values.length - 1];
      const q1 = d3.quantile(values, 0.25), median = d3.quantile(values, 0.50), q3 = d3.quantile(values, 0.75);
      const mean = d3.mean(values);
      const capW = bw * 0.5;

      g.append("line").attr("class", "box-whisker")
        .attr("x1", cx).attr("x2", cx).attr("y1", y(min)).attr("y2", y(max));
      g.append("line").attr("class", "box-whisker")
        .attr("x1", cx - capW / 2).attr("x2", cx + capW / 2).attr("y1", y(min)).attr("y2", y(min));
      g.append("line").attr("class", "box-whisker")
        .attr("x1", cx - capW / 2).attr("x2", cx + capW / 2).attr("y1", y(max)).attr("y2", y(max));

      g.append("rect").attr("class", "box")
        .attr("x", x(gender)).attr("y", y(q3))
        .attr("width", bw).attr("height", Math.max(1, y(q1) - y(q3)))
        .attr("fill", GENDER_COLOR[gender]).attr("fill-opacity", 0.45)
        .attr("stroke", GENDER_COLOR[gender]).attr("stroke-width", 1.5);
      g.append("line").attr("class", "box-median")
        .attr("x1", x(gender)).attr("x2", x(gender) + bw)
        .attr("y1", y(median)).attr("y2", y(median));
      g.append("path").attr("class", "box-mean").attr("d", diamondPath(cx, y(mean), 4.5));

      g.append("rect").attr("x", x(gender) - 4).attr("y", 0)
        .attr("width", bw + 8).attr("height", this.innerH).attr("fill", "transparent")
        .on("mouseover", (event => this.showTooltip(event,
          "<strong>" + GENDER_LABEL[gender] + "</strong> · " + key + " (" + UNITS[key] + ")<br/>" +
          "n = " + fmtInt(values.length) + "<br/>" +
          "min " + fmtTick(min) + " · q1 " + fmtTick(q1) + " · median " + fmtTick(median) + "<br/>" +
          "q3 " + fmtTick(q3) + " · max " + fmtTick(max) + "<br/>" +
          "mean " + fmtTick(mean))))
          .on("mouseout", () => this.hideTooltip());
    }
  }
}

// Violin plot of one feature per gender, using a kernel density estimate.
// All violins share one width scale (the common maximum density), so their
// widths are directly comparable rather than each normalised to its own peak.
class ViolinPlot extends ChartBase {
  constructor() {
    super("chart-violin", CHART_W, CHART_H,
      { top: 34, right: 16, bottom: 50, left: 62 },
      "Violin plot of the selected measurement by gender: the outline is a kernel density estimate of the distribution and the dashed line marks the median.");
  }

  render(records, key) {
    this.clear();
    const desc = describe(records, key);
    const domain = paddedDomain(desc.min, desc.max, 0.02);
    const y = d3.scaleLinear().domain(domain).range([this.innerH, 0]);
    const x = d3.scaleBand().domain(GENDERS).range([0, this.innerW]).padding(0.45);

    this.renderYAxis(y, axisLabel(key), fmtTick);
    this.plot.append("g").attr("class", "axis")
      .attr("transform", "translate(0," + this.innerH + ")")
      .call(d3.axisBottom(x).tickFormat(function (g) { return GENDER_LABEL[g]; }).tickSize(0));

    if (desc.n === 0 || desc.min === null) {
      this.plot.append("text").attr("x", this.innerW / 2).attr("y", this.innerH / 2)
        .attr("text-anchor", "middle").text("no data for this feature");
      return;
    }

    // Fixed grid across the (padded) value domain, top→bottom.
    const grid = d3.range(KDE_GRID).map(function (i) {
      return domain[0] + (domain[1] - domain[0]) * (i / (KDE_GRID - 1));
    });

    // Pre-compute densities so a single shared maximum can be used for widths.
    const groups = GENDERS.map(function (gender) {
      const values = records
        .filter(function (r) { return r.gender === gender && r[key] !== null && r[key] !== undefined; })
        .map(function (r) { return r[key]; })
        .sort(d3.ascending);
      const density = values.length >= 2
        ? kde(values, grid, silvermanBandwidth(values))
        : null;
      return { gender: gender, values: values, density: density };
    });

    let maxDensity = 0;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].density) maxDensity = Math.max(maxDensity, d3.max(groups[i].density));
    }
    if (maxDensity <= 0) maxDensity = 1;

    const bw = x.bandwidth();
    const maxHalf = bw * 0.45;

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      const cx = x(group.gender) + bw / 2;
      const g = this.plot.append("g").attr("class", "violin-group");

      if (!group.density) {
        g.append("text").attr("x", cx).attr("y", this.innerH / 2)
          .attr("text-anchor", "middle").text(group.values.length ? "n<2" : "no " + GENDER_LABEL[group.gender]);
        continue;
      }

      // Build the mirrored outline: down the right side, back up the left side.
      // Coordinates are rounded to 2 decimals for a stable, compact path string.
      const r2 = function (v) { return Math.round(v * 100) / 100; };
      const right = [], left = [];
      for (let i = 0; i < grid.length; i++) {
        const half = (group.density[i] / maxDensity) * maxHalf;
        right.push([r2(cx + half), r2(y(grid[i]))]);
        left.push([r2(cx - half), r2(y(grid[i]))]);
      }
      const path = "M" + right.map(function (p) { return p[0] + "," + p[1]; }).join("L")
        + "L" + left.reverse().map(function (p) { return p[0] + "," + p[1]; }).join("L") + "Z";

      g.append("path").attr("class", "violin-shape").attr("d", path)
        .attr("fill", GENDER_COLOR[group.gender]).attr("fill-opacity", 0.42)
        .attr("stroke", GENDER_COLOR[group.gender]);

      const median = d3.quantile(group.values, 0.50);
      g.append("line").attr("class", "violin-median")
        .attr("x1", cx - maxHalf).attr("x2", cx + maxHalf)
        .attr("y1", y(median)).attr("y2", y(median));

      g.append("rect").attr("x", x(group.gender) - 4).attr("y", 0)
        .attr("width", bw + 8).attr("height", this.innerH).attr("fill", "transparent")
        .on("mouseover", (event => this.showTooltip(event,
          "<strong>" + GENDER_LABEL[group.gender] + "</strong> · " + key + " (" + UNITS[key] + ")<br/>" +
          "n = " + fmtInt(group.values.length) + "<br/>" +
          "median " + fmtTick(median) + " · mean " + fmtTick(d3.mean(group.values)) + "<br/>" +
          "range " + fmtTick(group.values[0]) + "–" + fmtTick(group.values[group.values.length - 1]) + "<br/>" +
          "<span class=\"tt-hint\">density: Silverman bandwidth, " + KDE_GRID + "-point grid</span>")))
          .on("mouseout", () => this.hideTooltip());
    }

    // Legend: the dashed line is the median (line + text, not colour alone).
    const legend = this.plot.append("g").attr("class", "legend")
      .attr("transform", "translate(0,-18)");
    legend.append("line").attr("x1", 0).attr("x2", 16).attr("class", "violin-median");
    legend.append("text").attr("x", 22).attr("dy", "0.32em").text("median");
  }
}

// Histogram of one feature (all filtered records pooled): a bar per bin.
class Histogram extends ChartBase {
  constructor() {
    super("chart-hist", CHART_W, CHART_H,
      { top: 34, right: 16, bottom: 50, left: 56 },
      "Histogram of the selected measurement in " + BINS + " equal-width bins, with vertical mean and median reference lines.");
  }

  render(records, key) {
    this.clear();
    const desc = describe(records, key);
    if (desc.n === 0 || desc.min === null) {
      this.plot.append("text").attr("x", this.innerW / 2).attr("y", this.innerH / 2)
        .attr("text-anchor", "middle").text("no data for this feature");
      return;
    }

    const lo = desc.min, hi = desc.max;
    const span = hi > lo ? hi - lo : 1;
    const width = span / BINS;
    const counts = new Array(BINS).fill(0);
    for (let i = 0; i < records.length; i++) {
      const v = records[i][key];
      if (v === null || v === undefined) continue;
      let b = Math.floor((v - lo) / width);
      if (b < 0) b = 0;
      if (b > BINS - 1) b = BINS - 1;
      counts[b]++;
    }
    const maxCount = d3.max(counts) || 1;

    const x = d3.scaleLinear().domain([lo, hi]).range([0, this.innerW]);
    const y = d3.scaleLinear().domain([0, maxCount]).nice().range([this.innerH, 0]);

    this.renderXAxis(x, axisLabel(key), fmtTick, 6);
    this.renderYAxis(y, "Count", fmtInt);

    const bars = d3.range(BINS).map(function (b) {
      return { index: b, from: lo + b * width, to: lo + (b + 1) * width, count: counts[b] };
    });

    const innerH = this.innerH;
    this.plot.selectAll(".hist-bar")
      .data(bars, function (d) { return String(d.index); })   // stable key
      .join("rect")
      .attr("class", "hist-bar")
      .attr("x", function (d) { return x(d.from) + 0.5; })
      .attr("y", function (d) { return y(d.count); })
      .attr("width", function (d) { return Math.max(1, x(d.to) - x(d.from) - 1); })
      .attr("height", function (d) { return Math.max(0, innerH - y(d.count)); })
      .attr("fill", "#4477aa")
      .attr("fill-opacity", 0.85)
      .on("mouseover", (event, d) => this.showTooltip(event,
        key + " (" + UNITS[key] + ")<br/>" +
        "bin " + fmtTick(d.from) + "–" + fmtTick(d.to) + "<br/>" +
        "<strong>" + fmtInt(d.count) + "</strong> (" + fmtPct1(d.count / desc.n) + " of n = " + fmtInt(desc.n) + ")"))
      .on("mouseout", () => this.hideTooltip());

    // Mean (dashed red) and median (solid dark) reference lines.
    this.plot.append("line").attr("class", "hist-mean")
      .attr("x1", x(desc.mean)).attr("x2", x(desc.mean)).attr("y1", 0).attr("y2", this.innerH);
    this.plot.append("line").attr("class", "hist-median")
      .attr("x1", x(desc.median)).attr("x2", x(desc.median)).attr("y1", 0).attr("y2", this.innerH);

    const legend = this.plot.append("g").attr("class", "legend")
      .attr("transform", "translate(0,-18)");
    legend.append("line").attr("x1", 0).attr("x2", 16).attr("class", "hist-median");
    legend.append("text").attr("x", 22).attr("dy", "0.32em").text("median");
    legend.append("line").attr("x1", 78).attr("x2", 94).attr("class", "hist-mean");
    legend.append("text").attr("x", 100).attr("dy", "0.32em").text("mean");
  }
}

/* ============================================================================
 * 6. Scatter plot (two selected features, coloured + shaped by gender)
 * ========================================================================== */

class Scatter extends ChartBase {
  constructor(dashboard) {
    super("chart-scatter", SCATTER_W, SCATTER_H,
      { top: 34, right: 24, bottom: 56, left: 68 },
      "Scatter plot of two selected measurements, one point per person, coloured and shaped by gender, with a least-squares trend line.");
    this.dashboard = dashboard;

    // Deterministic marker paths: circle = Male, triangle = Female, so gender is
    // encoded by shape as well as colour.
    this.symbolPath = {
      M: d3.symbol().type(d3.symbolCircle).size(28)(),
      F: d3.symbol().type(d3.symbolTriangle).size(38)()
    };
  }

  // `keyX`, `keyY`: feature keys. `r` and `n` are the Pearson r and pairwise n
  // taken from the same analysis matrix the heatmap shows, so they always agree.
  render(records, keyX, keyY, r, n) {
    this.clear();

    const xs = records.map(function (rec) { return rec[keyX]; });
    const ys = records.map(function (rec) { return rec[keyY]; });
    const stats = pairwiseStats(xs, ys);

    if (stats.n < 2) {
      this.plot.append("text").attr("x", this.innerW / 2).attr("y", this.innerH / 2)
        .attr("text-anchor", "middle").text("not enough paired measurements to plot");
      return;
    }

    const xDomain = paddedDomain(stats.minX, stats.maxX, 0.03);
    const yDomain = paddedDomain(stats.minY, stats.maxY, 0.03);
    const x = d3.scaleLinear().domain(xDomain).range([0, this.innerW]);
    const y = d3.scaleLinear().domain(yDomain).range([this.innerH, 0]);

    this.renderXAxis(x, axisLabel(keyX), fmtTick);
    this.renderYAxis(y, axisLabel(keyY), fmtTick);

    // Legend (top-right): shape + colour + text.
    const legend = this.plot.append("g").attr("class", "legend")
      .attr("transform", "translate(" + (this.innerW - 150) + ",-18)");
    GENDERS.forEach(function (gender, i) {
      const item = legend.append("g").attr("transform", "translate(" + (i * 78) + ",0)");
      item.append("path").attr("d", d3.symbol().type(gender === "M" ? d3.symbolCircle : d3.symbolTriangle).size(28)())
        .attr("fill", GENDER_COLOR[gender]).attr("transform", "translate(0,0)");
      item.append("text").attr("x", 10).attr("dy", "0.32em").text(GENDER_LABEL[gender]);
    });

    // Deterministic ordering before binding: by x value, then gender, then the
    // stable source index. The stride sample then walks that fixed order.
    const ordered = records
      .filter(function (rec) { return rec[keyX] !== null && rec[keyX] !== undefined && rec[keyY] !== null && rec[keyY] !== undefined; })
      .sort(function (a, b) {
        return (a[keyX] - b[keyX]) || (a.gender < b.gender ? -1 : a.gender > b.gender ? 1 : 0) || (a._i - b._i);
      });

    const k = Math.max(1, Math.ceil(ordered.length / MAX_SCATTER_POINTS));
    const sample = ordered.filter(function (_, i) { return i % k === 0; });

    this.plot.selectAll(".dot")
      .data(sample, function (d) { return d._i; })
      .join("path")
      .attr("class", "dot")
      .attr("transform", function (d) { return "translate(" + x(d[keyX]) + "," + y(d[keyY]) + ")"; })
      .attr("d", d => this.symbolPath[d.gender])
      .attr("fill", d => GENDER_COLOR[d.gender])
      .attr("fill-opacity", 0.62)
      .on("mouseover", (event, d) => this.showTooltip(event,
        "<strong>" + GENDER_LABEL[d.gender] + "</strong><br/>" +
        keyX + " " + fmtTick(d[keyX]) + " " + UNITS[keyX] + "<br/>" +
        keyY + " " + fmtTick(d[keyY]) + " " + UNITS[keyY] + "<br/>" +
        "age " + fmtInt(d.age) + " years"))
      .on("mouseout", () => this.hideTooltip());

    // Least-squares trend line, computed from the full pairwise-complete set
    // (not the stride sample). Shown with the row/column units implied by axes.
    const x1 = stats.minX, x2 = stats.maxX;
    this.plot.append("line").attr("class", "trend")
      .attr("x1", x(x1)).attr("y1", y(stats.intercept + stats.slope * x1))
      .attr("x2", x(x2)).attr("y2", y(stats.intercept + stats.slope * x2));

    const trendKey = this.plot.append("g").attr("class", "legend")
      .attr("transform", "translate(0,-18)");
    trendKey.append("line").attr("class", "trend-key").attr("x1", 0).attr("x2", 16);
    trendKey.append("text").attr("x", 22).attr("dy", "0.32em").text("least-squares fit");

    this.dashboard.setScatterStat(
      "<strong>" + keyY + "</strong> vs <strong>" + keyX + "</strong> — Pearson r = " +
      (r === null ? "n/a" : fmt3(r)) + " (pairwise n = " + fmtInt(n) + "). " +
      "Showing " + fmtInt(sample.length) + " of " + fmtInt(ordered.length) +
      " points (every " + fmtInt(k) + (k === 1 ? "st point" : "th point") + ", deterministic stride). " +
      "Axes are scaled to the observed data range, not to zero."
    );
  }
}

/* ============================================================================
 * 7. Covariance / correlation matrix heatmap
 * ========================================================================== */

class MatrixHeatmap extends ChartBase {
  constructor(dashboard) {
    super("chart-matrix", MATRIX_W, MATRIX_H,
      { top: 170, right: 30, bottom: 20, left: 120 },
      "Square heatmap of the correlation (or covariance) matrix across all numeric measurements; the printed value and the colour both encode the coefficient. Click any cell to load that pair into the scatter plot.");
    this.dashboard = dashboard;

    const n = NUMERIC.length || 1;
    this.cell = Math.floor(Math.min(this.innerW, this.innerH) / n);
    this.grid = this.cell * n;
    this.offX = Math.round((this.innerW - this.grid) / 2);
    this.offY = Math.round((this.innerH - this.grid) / 2);
  }

  render(analysis, state) {
    this.clear();
    const n = NUMERIC.length;
    const useCorrelation = state.scale === "correlation";
    const matrix = useCorrelation ? analysis.correlation : analysis.covariance;

    // Symmetric colour domain. Correlation is bounded to [-1, 1]; covariance is
    // scaled to its own maximum magnitude (units are mixed, so only the pattern
    // is meaningful — the tooltip carries the actual value). The covariance
    // DIAGONAL (a variance, often orders of magnitude larger than any covariance)
    // is excluded from that maximum, otherwise it would wash out every other cell;
    // diagonal cells get a fixed neutral fill instead.
    let extent = 1;
    if (!useCorrelation) {
      let maxAbs = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const v = matrix[i][j];
          if (v !== null && Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
        }
      }
      extent = maxAbs > 0 ? maxAbs : 1;
    }

    const cellData = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        cellData.push({ i: i, j: j, value: matrix[i][j], n: analysis.counts[i][j] });
      }
    }

    const selected = state.cell;
    const cells = this.plot.append("g")
      .attr("transform", "translate(" + this.offX + "," + this.offY + ")");

    cells.selectAll("rect")
      .data(cellData, function (d) { return d.i + "," + d.j; })   // stable key
      .join("rect")
      .attr("class", function (d) {
        return "matrix-cell" + (d.i === selected[0] && d.j === selected[1] ? " matrix-selected" : "");
      })
      .attr("x", d => d.j * this.cell)
      .attr("y", d => d.i * this.cell)
      .attr("width", this.cell)
      .attr("height", this.cell)
      .attr("fill", function (d) {
        if (d.value === null) return MATRIX_EMPTY;
        if (!useCorrelation && d.i === d.j) return MATRIX_DIAG;   // variance, not colour-scaled
        const t = (d.value + extent) / (2 * extent);
        return matrixColor(t);
      })
      .on("click", (event, d) => this.dashboard.selectMatrixCell(d.i, d.j))
      .on("mouseover", (event, d) => this.showTooltip(event,
        "<strong>" + NUMERIC[d.i] + "</strong> vs <strong>" + NUMERIC[d.j] + "</strong><br/>" +
        (useCorrelation
          ? "Pearson r = " + (d.value === null ? "n/a" : fmt3(d.value))
          : (d.i === d.j
              ? "variance = " + (d.value === null ? "n/a" : fmtCov(d.value)) + " " + UNITS[NUMERIC[d.i]] + "²"
              : "covariance = " + (d.value === null ? "n/a" : fmtCov(d.value)) +
                " " + UNITS[NUMERIC[d.i]] + "·" + UNITS[NUMERIC[d.j]])) + "<br/>" +
        "pairwise n = " + fmtInt(d.n) + "<br/>" +
        "<span class=\"tt-hint\">click to load this pair into the scatter plot</span>"))
      .on("mouseout", () => this.hideTooltip());

    // Printed values: correlation cells are bounded to [-1,1] and always shown;
    // covariance cells vary too widely to print legibly, so they are colour +
    // tooltip only (a documented choice).
    if (useCorrelation) {
      cells.selectAll("text")
        .data(cellData, function (d) { return d.i + "," + d.j; })
        .join("text")
        .attr("class", "matrix-cell-label")
        .attr("x", d => d.j * this.cell + this.cell / 2)
        .attr("y", d => d.i * this.cell + this.cell / 2)
        .attr("dy", "0.32em")
        .attr("text-anchor", "middle")
        .attr("fill", function (d) {
          if (d.value === null) return "#5c6470";
          return labelColorFor(matrixColor((d.value + extent) / (2 * extent)));
        })
        .text(function (d) { return d.value === null ? "—" : fmt2(d.value); });
    }

    // Axis labels: short names.
    for (let j = 0; j < n; j++) {
      const lx = this.offX + j * this.cell + this.cell / 2;
      const ly = this.offY - 8;
      this.plot.append("text")
        .attr("class", "matrix-label")
        .attr("transform", "translate(" + lx + "," + ly + ") rotate(-45)")
        .attr("text-anchor", "start")
        .text(SHORT[NUMERIC[j]] || NUMERIC[j]);
    }
    for (let i = 0; i < n; i++) {
      this.plot.append("text")
        .attr("class", "matrix-label")
        .attr("x", this.offX - 8)
        .attr("y", this.offY + i * this.cell + this.cell / 2)
        .attr("dy", "0.32em")
        .attr("text-anchor", "end")
        .text(SHORT[NUMERIC[i]] || NUMERIC[i]);
    }

    this.renderLegend(useCorrelation, extent);
  }

  // Gradient legend built as a small SVG in the #matrix-legend element that
  // sits directly under the heatmap.
  renderLegend(useCorrelation, extent) {
    const container = d3.select("#matrix-legend");
    container.selectAll("*").remove();
    const w = 180, h = 12;

    const svg = container.append("svg")
      .attr("width", w + 44)
      .attr("height", h + 20)
      .attr("viewBox", "0 0 " + (w + 44) + " " + (h + 20))
      .attr("aria-hidden", "true");

    const grad = svg.append("defs").append("linearGradient")
      .attr("id", "matrix-legend-gradient")    // stable id
      .attr("x1", "0%").attr("y1", "0%").attr("x2", "100%").attr("y2", "0%");
    grad.selectAll("stop")
      .data(d3.range(9).map(function (i) { return i / 8; }))
      .join("stop")
      .attr("offset", t => fmtPct0(t))
      .attr("stop-color", t => matrixColor(t));

    const g = svg.append("g").attr("class", "matrix-legend").attr("transform", "translate(22,4)");
    g.append("rect").attr("width", w).attr("height", h).attr("fill", "url(#matrix-legend-gradient)");
    const labels = useCorrelation
      ? ["-1", "0", "+1"]
      : [fmtCov(-extent), "0", "+" + fmtCov(extent)];
    const positions = [0, w / 2, w];
    labels.forEach(function (label, i) {
      g.append("text")
        .attr("x", positions[i])
        .attr("y", h + 12)
        .attr("text-anchor", i === 0 ? "start" : i === 1 ? "middle" : "end")
        .text(label);
    });
  }
}

/* ============================================================================
 * 8. Small path helper
 * ========================================================================== */

function diamondPath(cx, cy, r) {
  return "M" + cx + "," + (cy - r) +
    "L" + (cx + r) + "," + cy +
    "L" + cx + "," + (cy + r) +
    "L" + (cx - r) + "," + cy + "Z";
}

/* ============================================================================
 * 9. Dashboard: owns the linked state and the single re-render path
 * ========================================================================== */

class Dashboard {
  constructor() {
    const idx = function (key) {
      const i = NUMERIC.indexOf(key);
      return i >= 0 ? i : 0;
    };

    // Linked state. `feature` drives the distribution charts AND the scatter x;
    // `scatterY` is the scatter y; `cell` is the highlighted matrix pair.
    this.state = {
      gender: "all",
      feature: idx(DEFAULT_FEATURE),
      scatterY: idx(DEFAULT_SCATTER_Y),
      scale: "correlation",
      cell: [idx(DEFAULT_FEATURE), idx(DEFAULT_SCATTER_Y)]
    };

    this.kpi = {
      records: d3.select("#kpi-records"),
      male: d3.select("#kpi-male"),
      female: d3.select("#kpi-female"),
      missing: d3.select("#kpi-missing"),
      coverage: d3.select("#kpi-coverage"),
      coverageSub: d3.select("#kpi-coverage-sub")
    };
    this.featureStats = d3.select("#feature-stats");
    this.scatterStat = d3.select("#scatter-stat");
    this.detail = {
      pair: d3.select("#detail-pair"),
      r: d3.select("#detail-r"),
      cov: d3.select("#detail-cov"),
      n: d3.select("#detail-n"),
      strength: d3.select("#detail-strength")
    };

    this.box = new BoxPlot();
    this.violin = new ViolinPlot();
    this.hist = new Histogram();
    this.scatter = new Scatter(this);
    this.matrix = new MatrixHeatmap(this);

    // Populate the <select> controls from NUMERIC (canonical order).
    this.populateSelect("#feature-select", this.state.feature);
    this.populateSelect("#scatter-y-select", this.state.scatterY);

    // Controls, all keyboard-reachable native inputs.
    d3.select("#feature-select").on("change", (event) => {
      this.state.feature = parseInt(event.target.value, 10);
      this.state.cell = [this.state.feature, this.state.scatterY];
      this.applyState();
    });
    d3.select("#scatter-y-select").on("change", (event) => {
      this.state.scatterY = parseInt(event.target.value, 10);
      this.state.cell = [this.state.feature, this.state.scatterY];
      this.applyState();
    });
    d3.selectAll('input[name="gender"]').on("change", (event) => {
      this.state.gender = event.target.value;
      this.applyState();
    });
    d3.selectAll('input[name="matrix-scale"]').on("change", (event) => {
      this.state.scale = event.target.value;
      this.applyState();
    });
  }

  populateSelect(selector, selectedIndex) {
    const select = d3.select(selector);
    select.selectAll("option")
      .data(NUMERIC)
      .join("option")
      .attr("value", function (d, i) { return String(i); })
      .property("selected", function (d, i) { return i === selectedIndex; })
      .text(function (d) { return d + " (" + UNITS[d] + ")"; });
  }

  selectMatrixCell(i, j) {
    this.state.cell = [i, j];
    this.state.feature = i;
    this.state.scatterY = j;
    // Keep the visible controls in sync with the clicked cell.
    d3.select("#feature-select").property("value", String(i));
    d3.select("#scatter-y-select").property("value", String(j));
    this.applyState();
  }

  setScatterStat(html) {
    this.scatterStat.html(html);
  }

  applyState() {
    // Records under the current gender filter (the distribution, scatter and
    // matrix views all share this one filtered set).
    const records = this.state.gender === "all"
      ? RECORDS
      : RECORDS.filter((r) => r.gender === this.state.gender);

    // Compute the full matrix once; every view reads from it, so the Pearson r
    // shown in the scatter is exactly the matrix r for that pair.
    const analysis = analyze(records, NUMERIC);

    this.renderKpis(records, analysis);
    this.renderFeatureStats(analysis);

    const featureKey = NUMERIC[this.state.feature];
    const scatterXKey = NUMERIC[this.state.feature];
    const scatterYKey = NUMERIC[this.state.scatterY];
    const r = analysis.correlation[this.state.feature][this.state.scatterY];
    const n = analysis.counts[this.state.feature][this.state.scatterY];

    this.box.render(records, featureKey);
    this.violin.render(records, featureKey);
    this.hist.render(records, featureKey);
    this.scatter.render(records, scatterXKey, scatterYKey, r, n);
    this.matrix.render(analysis, this.state);
    this.renderDetail(analysis);

    // Reflect the active scale/feature back into the static page hints.
    d3.select("#matrix-scale-label").text(this.state.scale === "correlation" ? "Correlation (r)" : "Covariance");
  }

  renderKpis(records, analysis) {
    const total = records.length;
    const male = records.filter(function (r) { return r.gender === "M"; }).length;
    const female = records.filter(function (r) { return r.gender === "F"; }).length;

    // Missing cells across all numeric columns, under the current filter.
    let missing = 0;
    for (let i = 0; i < NUMERIC.length; i++) missing += analysis.desc[NUMERIC[i]].missing;

    const featureKey = NUMERIC[this.state.feature];
    const present = analysis.desc[featureKey].n;
    const coverage = total > 0 ? present / total : 0;

    this.kpi.records.text(fmtInt(total));
    this.kpi.male.text(fmtInt(male));
    this.kpi.female.text(fmtInt(female));
    this.kpi.missing.text(fmtInt(missing));
    this.kpi.coverage.text(fmtPct1(coverage));
    this.kpi.coverageSub.text(featureKey + ": " + fmtInt(present) + " of " + fmtInt(total));
  }

  renderFeatureStats(analysis) {
    const key = NUMERIC[this.state.feature];
    const d = analysis.desc[key];
    const unit = UNITS[key];
    if (d.n === 0) {
      this.featureStats.html("<strong>" + key + "</strong> — no non-missing values under the current filter.");
      return;
    }
    this.featureStats.html(
      "<strong>" + key + "</strong> (" + unit + ") — " +
      "n = " + fmtInt(d.n) + " · missing = " + fmtInt(d.missing) + " · " +
      "min " + fmtTick(d.min) + " · q1 " + fmtTick(d.q1) + " · median " + fmtTick(d.median) + " · " +
      "q3 " + fmtTick(d.q3) + " · max " + fmtTick(d.max) + " · " +
      "mean " + fmtTick(d.mean) + " · sd " + fmtTick(d.std) +
      " <span class=\"muted\">(sd uses the n−1 denominator)</span>"
    );
  }

  renderDetail(analysis) {
    const i = this.state.cell[0];
    const j = this.state.cell[1];
    const rowKey = NUMERIC[i];
    const colKey = NUMERIC[j];
    const r = analysis.correlation[i][j];
    const cov = analysis.covariance[i][j];
    const n = analysis.counts[i][j];

    this.detail.pair.text(rowKey + "  ×  " + colKey);
    this.detail.r.text(r === null ? "n/a" : fmt3(r));
    this.detail.cov.text(cov === null
      ? "n/a"
      : fmtCov(cov) + " " + UNITS[rowKey] + "·" + UNITS[colKey]);
    this.detail.n.text(fmtInt(n));

    // Strength wording derived from |r| — a plain description, not a judgement.
    let strength = "n/a";
    if (r !== null) {
      const a = Math.abs(r);
      if (a < 0.1) strength = "negligible";
      else if (a < 0.3) strength = "weak";
      else if (a < 0.5) strength = "moderate";
      else if (a < 0.7) strength = "strong";
      else strength = "very strong";
      strength += r < 0 ? " negative" : " positive";
    }
    this.detail.strength.text(strength);
  }
}

/* ============================================================================
 * 10. Boot
 * ========================================================================== */

if (!ANSUR || RECORDS.length === 0 || NUMERIC.length === 0) {
  document.querySelector(".dashboard").innerHTML =
    '<p class="fatal">Could not load ANSUR data: <code>window.ANSUR</code> is undefined or empty. ' +
    "Make sure <code>data.js</code> is present next to <code>index.html</code>.</p>";
} else {
  const dashboard = new Dashboard();
  dashboard.applyState();
}