/*
 * box.js — stops2boxes object-detection dashboard logic (PGDV5200 LAB09)
 * Model signature: gemma4:e4b
 *
 * Data source: dist/data.js → window.DETECTIONS, a flat array of 16,397 records:
 *   { stop_id, label ("bus_sign" | "bus_stop" | "person" | "tree"),
 *     score (0.25–0.965), x_min, y_min, x_max, y_max }   (normalized image coords)
 *
 * Documented defaults:
 *  - Deterministic rendering: no Math.random(), no d3-random, no transitions,
 *    fixed chart sizes, deterministic sorts before data binding, stable string IDs
 *    for any SVG defs.
 *  - Object Frequency bars and the Score box plots react to the score filter and
 *    highlight the selected label, but do NOT apply the label filter to themselves:
 *    the primary filter control must always show (and stay clickable) all four labels.
 *  - Heatmap: 20x20 bins over normalized image space [0,1]^2; y=0 is drawn at the
 *    top (image convention); the sequential color scale rescales to the maximum bin
 *    count under the active filters; empty bins are neutral gray.
 *  - Scatter: x (box area) is log-scaled because areas span ~3 orders of magnitude
 *    (0.00074–0.79144); y (score) shares the fixed [0.2, 1.0] domain with the box
 *    plot. At most ~4,000 points are rendered using a deterministic stride sample:
 *    every k-th record with k = Math.ceil(n / 4000). For n = 16,397 → k = 5 → 3,280
 *    points. (The records are already sorted by (stop_id, label, score, x_min), so
 *    the stride is stable across runs.)
 *  - Box plot whiskers extend to the data min/max (a plain five-number summary),
 *    rather than 1.5xIQR fences.
 */
"use strict";

/* ---------------- Data loading & derived fields ---------------- */

const DETECTIONS = Array.isArray(window.DETECTIONS) ? window.DETECTIONS : [];

// Derived record: raw fields are preserved; area/cx/cy are added on a copy.
const RECORDS = DETECTIONS.map(function (d) {
  return {
    stop_id: d.stop_id,
    label: d.label,
    score: d.score,
    x_min: d.x_min,
    y_min: d.y_min,
    x_max: d.x_max,
    y_max: d.y_max,
    area: (d.x_max - d.x_min) * (d.y_max - d.y_min),
    cx: (d.x_min + d.x_max) / 2,
    cy: (d.y_min + d.y_max) / 2
  };
});

/* ---------------- Constants (derived from data, not hard-coded) ---------------- */

// Canonical, sorted label order for stable grouping.
const LABELS = ["bus_sign", "bus_stop", "person", "tree"];

// Paul Tol "bright" palette — distinct under common color-vision deficiencies.
const LABEL_COLORS = {
  bus_sign: "#4477AA",
  bus_stop: "#EE7733",
  person: "#0077BB",
  tree: "#009988"
};

// Fixed score domain shared by the box plot and the scatter plot.
const SCORE_DOMAIN = [0.2, 1.0];

// Slider bounds derived from the data (0.25 / 0.965).
const SCORE_MIN = d3.min(DETECTIONS, d => d.score) ?? 0.25;
const SCORE_MAX = d3.max(DETECTIONS, d => d.score) ?? 1;

const HEAT_BINS = 20;
const MAX_SCATTER_POINTS = 4000;
const LEGEND_STEP = 88; // fixed legend item width (deterministic; avoids text measurement)

// Fixed chart geometry, derived from the 1320px dashboard:
// 3-column cards are 420px outer → 386px content; wide card is 1286px content.
const CHART_W = 386;
const CHART_H = 400;
const SCATTER_W = 1286;
const SCATTER_H = 400;

/* ---------------- Formatters (consistent precision) ---------------- */

const fmtCount = d3.format(",.0f");
const fmtScore3 = d3.format(".3f");
const fmtScore4 = d3.format(".4f");
const fmtArea = d3.format(".5f");
const fmtCoord2 = d3.format(".2f");
const fmtPct1 = d3.format(".1%");
const fmtAxis1 = d3.format(".1f");
const fmtTick2 = d3.format(".2~f");
const fmtLog = d3.format(".3~f");

/* ---------------- Small helpers ---------------- */

// SVG path for the mean marker (diamond), distinct from the median line.
function diamondPath(cx, cy, r) {
  return "M" + cx + "," + (cy - r) +
    "L" + (cx + r) + "," + cy +
    "L" + cx + "," + (cy + r) +
    "L" + (cx - r) + "," + cy + "Z";
}

/* ---------------- Base chart class (shared svg/axes/tooltip logic) ---------------- */

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

  // Re-render support: remove plot contents and any rebuilt defs (gradients).
  clear() {
    this.plot.selectAll("*").remove();
    this.svg.selectAll("defs").remove();
  }

  renderXAxis(scale, label, tickFormat) {
    this.plot.append("g")
      .attr("class", "axis")
      .attr("transform", "translate(0," + this.innerH + ")")
      .call(d3.axisBottom(scale).tickFormat(tickFormat || (t => t)));
    this.plot.append("text")
      .attr("class", "axis-label")
      .attr("x", this.innerW / 2)
      .attr("y", this.innerH + 40)
      .attr("text-anchor", "middle")
      .text(label);
  }

  renderYAxis(scale, label, tickFormat) {
    this.plot.append("g")
      .attr("class", "axis")
      .call(d3.axisLeft(scale).tickFormat(tickFormat || (t => t)));
    this.plot.append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -this.innerH / 2)
      .attr("y", -40)
      .attr("text-anchor", "middle")
      .text(label);
  }

  // Tooltip: single shared #tooltip element, .visible opacity pattern (see box.css).
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

/* ---------------- Chart 1: Object Frequency (horizontal bars, primary filter) ---------------- */

class BarChart extends ChartBase {
  constructor(dashboard) {
    super("chart-frequency", CHART_W, CHART_H,
      { top: 8, right: 58, bottom: 46, left: 84 },
      "Horizontal bar chart of detection counts per object label; click a bar to filter");
    this.dashboard = dashboard;

    // Fixed x-domain: the overall maximum label count (derived once from the full
    // data), so bar lengths stay comparable as the score filter shrinks counts.
    this.maxOverallCount = d3.max(LABELS, l => d3.sum(RECORDS, r => r.label === l)) ?? 1;
  }

  // Intentionally receives only the score-filtered records (not the label-filtered
  // ones): the frequency chart is the label filter control and must keep showing all
  // four labels so any of them can be selected or re-selected.
  render(scoreFiltered) {
    this.clear();
    const total = scoreFiltered.length;

    // Deterministic order: count descending, then label ascending.
    const rows = LABELS
      .map(label => ({ label, count: d3.sum(scoreFiltered, r => r.label === label) }))
      .sort((a, b) => (b.count - a.count) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

    const x = d3.scaleLinear().domain([0, this.maxOverallCount]).range([0, this.innerW]);
    const y = d3.scaleBand().domain(rows.map(r => r.label)).range([0, this.innerH]).padding(0.28);

    this.renderXAxis(x, "Detections", fmtCount);

    const rows_ = this.plot.selectAll(".bar-row")
      .data(rows, r => r.label)
      .join("g")
      .attr("class", "bar-row")
      .attr("transform", r => "translate(0," + y(r.label) + ")");

    // Full-width invisible hit area keeps every label clickable, even when its
    // count is zero under the score filter.
    rows_.append("rect")
      .attr("class", "bar-hit")
      .attr("width", this.innerW)
      .attr("height", y.bandwidth())
      .attr("fill", "transparent")
      .on("click", (event, r) => this.dashboard.toggleLabel(r.label))
      .on("mouseover", (event, r) => this.showTooltip(event,
        "<strong>" + r.label + "</strong><br/>" +
        fmtCount(r.count) + " detections (" + fmtPct1(r.count / Math.max(total, 1)) + ")<br/>" +
        "<span class=\"tt-hint\">click to " +
        (this.dashboard.state.label === r.label ? "clear" : "apply") + " label filter</span>"))
      .on("mouseout", () => this.hideTooltip());

    rows_.append("rect")
      .attr("class", r => {
        const sel = this.dashboard.state.label;
        if (sel === r.label) return "bar selected";
        if (sel) return "bar dimmed";
        return "bar";
      })
      .attr("width", r => Math.max(0, x(r.count)))
      .attr("height", y.bandwidth())
      .attr("fill", r => LABEL_COLORS[r.label])
      .style("pointer-events", "none");

    rows_.append("text")
      .attr("class", "bar-label")
      .attr("x", -10)
      .attr("y", y.bandwidth() / 2)
      .attr("dy", "0.32em")
      .attr("text-anchor", "end")
      .style("pointer-events", "none") // keep the invisible hit area clickable
      .text(r => r.label);

    rows_.append("text")
      .attr("class", "bar-value")
      .attr("x", r => Math.max(0, x(r.count)) + 6)
      .attr("y", y.bandwidth() / 2)
      .attr("dy", "0.32em")
      .style("pointer-events", "none")
      .text(r => fmtCount(r.count));
  }
}

/* ---------------- Chart 2: Score distribution (box plot per label) ---------------- */

class BoxPlot extends ChartBase {
  constructor(dashboard) {
    super("chart-boxplot", CHART_W, CHART_H,
      { top: 38, right: 14, bottom: 48, left: 50 },
      "Box plot of detection score distributions per object label, with median line, mean diamond, and min-to-max whiskers");
    this.dashboard = dashboard;
  }

  // Like the frequency chart, receives the score-filtered records for all labels
  // (label selection is shown as a highlight, not a removal).
  render(scoreFiltered) {
    this.clear();
    const sel = this.dashboard.state.label;

    const y = d3.scaleLinear().domain(SCORE_DOMAIN).range([this.innerH, 0]);
    const x = d3.scaleBand().domain(LABELS).range([0, this.innerW]).padding(0.45);

    this.renderYAxis(y, "Score", fmtAxis1);
    this.plot.append("g")
      .attr("class", "axis")
      .attr("transform", "translate(0," + this.innerH + ")")
      .call(d3.axisBottom(x).tickSize(0));

    // Legend: median (line) vs mean (diamond) — not color-only.
    const legend = this.plot.append("g").attr("class", "legend").attr("transform", "translate(0,-22)");
    legend.append("line").attr("x1", 0).attr("x2", 16).attr("stroke", "#1f2430").attr("stroke-width", 2);
    legend.append("text").attr("x", 22).attr("dy", "0.32em").text("median");
    legend.append("path").attr("d", diamondPath(70, 0, 4.5)).attr("fill", "#ffffff").attr("stroke", "#1f2430").attr("stroke-width", 1.5);
    legend.append("text").attr("x", 80).attr("dy", "0.32em").text("mean");

    for (const label of LABELS) {
      const g = this.plot.append("g")
        .attr("class", "box-group" + (sel === label ? " selected" : sel ? " dimmed" : ""));
      const cx = x(label) + x.bandwidth() / 2;
      const bw = x.bandwidth();

      // Deterministic sort before quantiles (quantiles need sorted values).
      const scores = scoreFiltered
        .filter(r => r.label === label)
        .map(r => r.score)
        .sort(d3.ascending);

      if (scores.length === 0) {
        g.append("text")
          .attr("x", cx)
          .attr("y", this.innerH / 2)
          .attr("text-anchor", "middle")
          .text("no data");
        continue;
      }

      const min = scores[0];
      const max = scores[scores.length - 1];
      const q1 = d3.quantile(scores, 0.25);
      const median = d3.quantile(scores, 0.5);
      const q3 = d3.quantile(scores, 0.75);
      const mean = d3.mean(scores);
      const capW = bw * 0.5;

      // Whiskers to min/max (a plain five-number summary; see header comment —
      // chosen per dashboard spec rather than 1.5xIQR outlier fences).
      g.append("line").attr("x1", cx).attr("x2", cx).attr("y1", y(min)).attr("y2", y(max))
        .attr("stroke", "#667085");
      g.append("line").attr("x1", cx - capW / 2).attr("x2", cx + capW / 2)
        .attr("y1", y(min)).attr("y2", y(min)).attr("stroke", "#667085");
      g.append("line").attr("x1", cx - capW / 2).attr("x2", cx + capW / 2)
        .attr("y1", y(max)).attr("y2", y(max)).attr("stroke", "#667085");

      g.append("rect").attr("class", "box")
        .attr("x", x(label))
        .attr("y", y(q3))
        .attr("width", bw)
        .attr("height", Math.max(1, y(q1) - y(q3)))
        .attr("fill", LABEL_COLORS[label])
        .attr("fill-opacity", 0.45)
        .attr("stroke", LABEL_COLORS[label])
        .attr("stroke-width", 1.5);

      g.append("line")
        .attr("x1", x(label)).attr("x2", x(label) + bw)
        .attr("y1", y(median)).attr("y2", y(median))
        .attr("stroke", "#1f2430").attr("stroke-width", 2);

      // Distinct mean marker: white diamond with a dark outline.
      g.append("path")
        .attr("d", diamondPath(cx, y(mean), 4.5))
        .attr("fill", "#ffffff").attr("stroke", "#1f2430").attr("stroke-width", 1.5);

      // Invisible hit area for the column tooltip.
      g.append("rect")
        .attr("x", x(label) - 4)
        .attr("y", 0)
        .attr("width", bw + 8)
        .attr("height", this.innerH)
        .attr("fill", "transparent")
        .on("mouseover", event => this.showTooltip(event,
          "<strong>" + label + "</strong> (n = " + fmtCount(scores.length) + ")<br/>" +
          "min " + fmtScore3(min) + " · q1 " + fmtScore3(q1) + " · median " + fmtScore3(median) + "<br/>" +
          "q3 " + fmtScore3(q3) + " · max " + fmtScore3(max) + "<br/>" +
          "mean " + fmtScore3(mean)))
        .on("mouseout", () => this.hideTooltip());
    }
  }
}

/* ---------------- Chart 3: Spatial density heatmap (20x20 grid) ---------------- */

class Heatmap extends ChartBase {
  constructor(dashboard) {
    super("chart-heatmap", CHART_W, CHART_H,
      { top: 42, right: 14, bottom: 62, left: 50 },
      "Spatial density heatmap of detection box centers in normalized image space, 20 by 20 bins");
    this.dashboard = dashboard;

    // Square cells sized to fit the plot area; grid is centered horizontally.
    this.cell = Math.max(1, Math.floor(Math.min(this.innerW, this.innerH) / HEAT_BINS));
    this.gridSize = this.cell * HEAT_BINS;
    this.gridX = Math.round((this.innerW - this.gridSize) / 2);
  }

  // Bin index in [0, HEAT_BINS-1]; clamped because some coordinates lie slightly
  // outside [0,1].
  binIndex(v) {
    const i = Math.floor(v * HEAT_BINS);
    return Math.max(0, Math.min(HEAT_BINS - 1, i));
  }

  // Receives the fully filtered records (label + score).
  render(filtered) {
    this.clear();

    const bins = new Map();
    for (const r of filtered) {
      const key = this.binIndex(r.cx) + "," + this.binIndex(r.cy);
      bins.set(key, (bins.get(key) || 0) + 1);
    }

    // Row-major cell list (iy outer, ix inner) — deterministic binding order.
    const cellData = [];
    for (let iy = 0; iy < HEAT_BINS; iy++) {
      for (let ix = 0; ix < HEAT_BINS; ix++) {
        cellData.push({ ix, iy, count: bins.get(ix + "," + iy) || 0 });
      }
    }

    // Sequential scale rescaled to the current max bin count (deterministic for a
    // given filter state); empty bins keep a neutral gray fill.
    const maxCount = d3.max(cellData, c => c.count) || 1;
    const color = d3.scaleSequential(d3.interpolateBlues).domain([0, maxCount]);
    const EMPTY_FILL = "#eef0f3";

    // Legend gradient (stable id, rebuilt on every render).
    const grad = this.svg.append("defs").append("linearGradient")
      .attr("id", "heat-legend-gradient")
      .attr("x1", "0%").attr("y1", "0%").attr("x2", "100%").attr("y2", "0%");
    grad.selectAll("stop")
      .data(d3.range(8).map(i => i / 7))
      .join("stop")
      .attr("offset", t => d3.format(".2f")(t * 100) + "%")
      .attr("stop-color", t => color(t * maxCount));

    const lg = this.plot.append("g").attr("class", "legend")
      .attr("transform", "translate(" + this.innerW + ",-20)");
    lg.append("rect")
      .attr("x", -110).attr("y", -5).attr("width", 110).attr("height", 10)
      .attr("fill", "url(#heat-legend-gradient)")
      .attr("stroke", "#c9ced6").attr("stroke-width", 0.5);
    lg.append("text").attr("x", -116).attr("dy", "0.32em").attr("text-anchor", "end").text("0");
    lg.append("text").attr("x", 4).attr("dy", "0.32em").text(fmtCount(maxCount));

    const grid = this.plot.append("g")
      .attr("transform", "translate(" + this.gridX + ",0)");

    grid.selectAll("rect")
      .data(cellData, c => c.ix + "," + c.iy)
      .join("rect")
      .attr("class", "heat-cell")
      .attr("x", c => c.ix * this.cell)
      .attr("y", c => c.iy * this.cell)
      .attr("width", this.cell - 1)
      .attr("height", this.cell - 1)
      .attr("fill", c => (c.count > 0 ? color(c.count) : EMPTY_FILL))
      .on("mouseover", (event, c) => this.showTooltip(event,
        "x " + fmtCoord2(c.ix / HEAT_BINS) + "–" + fmtCoord2((c.ix + 1) / HEAT_BINS) +
        " · y " + fmtCoord2(c.iy / HEAT_BINS) + "–" + fmtCoord2((c.iy + 1) / HEAT_BINS) + "<br/>" +
        "<strong>" + fmtCount(c.count) + "</strong> detections"))
      .on("mouseout", () => this.hideTooltip());

    // Axes in normalized image space. y range grows downward: y=0 at the top,
    // matching image coordinates.
    const xScale = d3.scaleLinear().domain([0, 1]).range([this.gridX, this.gridX + this.gridSize]);
    this.plot.append("g")
      .attr("class", "axis")
      .attr("transform", "translate(0," + this.gridSize + ")")
      .call(d3.axisBottom(xScale).tickValues([0, 0.25, 0.5, 0.75, 1]).tickFormat(fmtTick2));
    this.plot.append("text")
      .attr("class", "axis-label")
      .attr("x", this.gridX + this.gridSize / 2)
      .attr("y", this.gridSize + 38)
      .attr("text-anchor", "middle")
      .text("Normalized x (image space)");

    const yScale = d3.scaleLinear().domain([0, 1]).range([0, this.gridSize]);
    this.plot.append("g")
      .attr("class", "axis")
      .attr("transform", "translate(" + this.gridX + ",0)")
      .call(d3.axisLeft(yScale).tickValues([0, 0.25, 0.5, 0.75, 1]).tickFormat(fmtTick2));
    this.plot.append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -this.gridSize / 2)
      .attr("y", this.gridX - 36)
      .attr("text-anchor", "middle")
      .text("Normalized y (0 = top)");
  }
}

/* ---------------- Chart 4: Detail scatter (area vs score, colored by label) ---------------- */

class Scatter extends ChartBase {
  constructor(dashboard) {
    super("chart-scatter", SCATTER_W, SCATTER_H,
      { top: 30, right: 22, bottom: 54, left: 62 },
      "Scatter plot of normalized box area (log scale) versus score, colored by object label");
    this.dashboard = dashboard;

    // Fixed x-domain from the full data (derived once), so the scale is stable
    // while filters only change which points are drawn.
    this.areaMin = d3.min(RECORDS, r => r.area) ?? 0.001;
    this.areaMax = d3.max(RECORDS, r => r.area) ?? 1;
  }

  // Receives the fully filtered records (label + score).
  render(filtered) {
    this.clear();

    // Log scale: areas span ~3 orders of magnitude (0.00074–0.79144).
    const x = d3.scaleLog().base(10).domain([this.areaMin, this.areaMax]).range([0, this.innerW]);
    const y = d3.scaleLinear().domain(SCORE_DOMAIN).range([this.innerH, 0]);

    this.renderXAxis(x, "Normalized box area (log scale)", fmtLog);
    this.renderYAxis(y, "Score", fmtAxis1);

    // Legend row (top-right), fixed item width — no text measurement needed.
    const legend = this.plot.append("g").attr("class", "legend")
      .attr("transform", "translate(" + this.innerW + ",-14)");
    LABELS.forEach((label, i) => {
      const item = legend.append("g").attr("transform", "translate(" + i * LEGEND_STEP + ",0)");
      item.append("rect")
        .attr("x", -8).attr("y", -5).attr("width", 10).attr("height", 10).attr("rx", 2)
        .attr("fill", LABEL_COLORS[label]);
      item.append("text").attr("x", 8).attr("dy", "0.32em").text(label);
    });

    if (filtered.length === 0) {
      this.plot.append("text")
        .attr("x", this.innerW / 2)
        .attr("y", this.innerH / 2)
        .attr("text-anchor", "middle")
        .text("no data under current filters");
      return;
    }

    // Deterministic stride sample: at most ~4,000 points (see header comment).
    const k = Math.max(1, Math.ceil(filtered.length / MAX_SCATTER_POINTS));
    const sample = filtered.filter((r, i) => i % k === 0);

    this.plot.selectAll(".dot")
      .data(sample, r => r.stop_id + "|" + r.label + "|" + r.score + "|" + r.x_min)
      .join("circle")
      .attr("class", "dot")
      .attr("cx", r => x(r.area))
      .attr("cy", r => y(r.score))
      .attr("r", 3)
      .attr("fill", r => LABEL_COLORS[r.label])
      .attr("fill-opacity", 0.65)
      .on("mouseover", (event, r) => this.showTooltip(event,
        "<strong>" + r.label + "</strong><br/>" +
        "stop " + r.stop_id + "<br/>" +
        "score " + fmtScore3(r.score) + "<br/>" +
        "area " + fmtArea(r.area) + "<br/>" +
        "bbox [" + fmtCoord2(r.x_min) + ", " + fmtCoord2(r.y_min) +
        ", " + fmtCoord2(r.x_max) + ", " + fmtCoord2(r.y_max) + "]"))
      .on("mouseout", () => this.hideTooltip());
  }
}

/* ---------------- Dashboard: owns filter state, single re-render path ---------------- */

class Dashboard {
  constructor() {
    // Filter state: label selection + global minimum score.
    this.state = { label: null, minScore: SCORE_MIN };

    this.kpi = {
      detections: d3.select("#kpi-detections"),
      stops: d3.select("#kpi-stops"),
      types: d3.select("#kpi-types"),
      avgScore: d3.select("#kpi-avg-score"),
      mostFrequent: d3.select("#kpi-most-frequent")
    };
    this.slider = d3.select("#score-slider");
    this.scoreValue = d3.select("#score-value");
    this.labelValue = d3.select("#label-value");

    this.bars = new BarChart(this);
    this.box = new BoxPlot(this);
    this.heat = new Heatmap(this);
    this.scatter = new Scatter(this);

    // Slider bounds derived from the data (0.25–0.965), step 0.005.
    this.slider
      .attr("min", SCORE_MIN)
      .attr("max", SCORE_MAX)
      .attr("step", 0.005)
      .attr("value", SCORE_MIN)
      .on("input", event => this.setMinScore(parseFloat(event.target.value)));

    d3.select("#reset-labels").on("click", () => this.resetLabel());
  }

  toggleLabel(label) {
    this.state.label = this.state.label === label ? null : label;
    this.applyFilters();
  }

  resetLabel() {
    if (this.state.label !== null) {
      this.state.label = null;
      this.applyFilters();
    }
  }

  setMinScore(value) {
    this.state.minScore = value;
    this.applyFilters();
  }

  // Single re-render path: derive the filtered records once, then refresh every
  // KPI and chart. Frequency + box plot show all labels (score-filtered) with the
  // selection highlighted; heatmap + scatter apply both filters.
  applyFilters() {
    const scoreFiltered = RECORDS.filter(r => r.score >= this.state.minScore);
    const filtered = this.state.label === null
      ? scoreFiltered
      : scoreFiltered.filter(r => r.label === this.state.label);

    this.renderKpis(filtered);
    this.bars.render(scoreFiltered);
    this.box.render(scoreFiltered);
    this.heat.render(filtered);
    this.scatter.render(filtered);

    this.scoreValue.text(fmtScore3(this.state.minScore));
    this.labelValue.text(this.state.label === null ? "All" : this.state.label);
  }

  renderKpis(records) {
    const total = records.length;
    const stops = new Set(records.map(r => r.stop_id)).size;
    const types = new Set(records.map(r => r.label)).size;
    const avg = total > 0 ? d3.mean(records, r => r.score) : null;

    // Most frequent label: count descending, label ascending (deterministic tie-break).
    let most = null;
    if (total > 0) {
      const counts = LABELS
        .map(label => ({ label, count: d3.sum(records, r => r.label === label) }))
        .filter(c => c.count > 0)
        .sort((a, b) => (b.count - a.count) || (a.label < b.label ? -1 : 1));
      most = counts[0];
    }

    this.kpi.detections.text(fmtCount(total));
    this.kpi.stops.text(fmtCount(stops));
    this.kpi.types.text(String(types));
    this.kpi.avgScore.text(avg === null ? "—" : fmtScore4(avg));
    this.kpi.mostFrequent.text(most ? most.label + " (" + fmtCount(most.count) + ")" : "—");
  }
}

/* ---------------- Boot ---------------- */

if (DETECTIONS.length === 0) {
  // data.js did not provide window.DETECTIONS — say so instead of rendering empty charts.
  document.querySelector(".dashboard").innerHTML =
    '<p class="fatal">Could not load detection data: <code>window.DETECTIONS</code> is undefined. ' +
    "Make sure <code>data.js</code> is present next to <code>box.html</code>.</p>";
} else {
  const dashboard = new Dashboard();
  dashboard.applyFilters();
}
