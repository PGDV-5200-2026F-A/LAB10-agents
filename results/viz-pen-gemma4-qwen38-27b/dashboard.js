/* Model: qwen3.8:27b
 * Palmer Penguins dashboard — all chart logic.
 *
 * Data:
 *   - ../data/penguins.json  raw rows (seaborn-data / mwaskom 2021)
 *   - derived.json           Phase 1 stats (pen-gem/phase1_stats.py)
 *
 * Conventions (d3 skill, deterministic output):
 *   - No Math.random(), no transitions/animations.
 *   - Fixed width/height/viewBox on every SVG.
 *   - Input rows are sorted deterministically before binding; group order is
 *     a fixed, explicitly sorted array (SPECIES order, MALE before FEMALE).
 *   - Number formatting via d3.format (locale-stable).
 *   - Axis domains for the detail views are computed ONCE over the full
 *     dataset so scales stay stable when filters change.
 *   - Sex is encoded by SHAPE (circle = FEMALE, triangle = MALE,
 *     square = unknown), never by color alone.
 *   - Species palette: Okabe-Ito color-blind-safe colors.
 */
"use strict";

/* ============================ constants ============================ */

const FEATURES = [
  "bill_length_mm",
  "bill_depth_mm",
  "flipper_length_mm",
  "body_mass_g",
];

const FEATURE_LABELS = {
  bill_length_mm: "Bill length (mm)",
  bill_depth_mm: "Bill depth (mm)",
  flipper_length_mm: "Flipper length (mm)",
  body_mass_g: "Body mass (g)",
};

const FEATURE_SHORT = {
  bill_length_mm: "Bill L",
  bill_depth_mm: "Bill D",
  flipper_length_mm: "Flipper",
  body_mass_g: "Body mass",
};

// Fixed group order for deterministic rendering.
const SPECIES = ["Adelie", "Chinstrap", "Gentoo"];
const SEXES = ["MALE", "FEMALE"];

// Okabe-Ito color-blind-safe categorical palette for species.
const speciesColor = d3
  .scaleOrdinal()
  .domain(SPECIES)
  .range(["#0072B2", "#E69F00", "#009E73"]);

// Sex -> symbol shape (shape, not color, is the sex encoding).
const sexSymbol = d3
  .symbol()
  .type((d) =>
    d.sex === "MALE" ? d3.symbolTriangle :
    d.sex === "FEMALE" ? d3.symbolCircle :
    d3.symbolSquare
  )
  .size(46);

const sexBarColor = (sex) => (sex === "MALE" ? "#4a4a4a" : "#a8a8a8");

const fmtInt = d3.format(",");
const fmtMm = d3.format(".1f");
const fmtR = d3.format(".2f");

function fmtFeature(feature, value) {
  return feature === "body_mass_g" ? fmtInt(Math.round(value)) : fmtMm(value);
}

/* ============================ shared helpers ============================ */

function showTooltipAt(px, py, html) {
  d3.select("#tooltip")
    .classed("visible", true)
    .html(html)
    .style("left", px + "px")
    .style("top", py + "px");
}

function showTooltip(event, html) {
  showTooltipAt(event.pageX + 12, event.pageY - 12, html);
}

function showTooltipForElement(target, html) {
  const rect = target.getBoundingClientRect();
  showTooltipAt(
    rect.left + window.pageXOffset,
    rect.top + window.pageYOffset - 12,
    html
  );
}

function hideTooltip() {
  d3.select("#tooltip").classed("visible", false);
}

/* Pearson r over rows with pairwise complete observations.
 * Returns { r, n } or null when undefined (n < 2 or zero variance).
 * Mirrors pen-gem/phase1_stats.py so the unfiltered heatmap matches
 * derived.json. */
function pearson(rows, fa, fb) {
  const xs = [];
  const ys = [];
  for (const row of rows) {
    if (row[fa] == null || row[fb] == null) continue;
    xs.push(row[fa]);
    ys.push(row[fb]);
  }
  const n = xs.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return { r: cov / Math.sqrt(vx * vy), n };
}

/* ============================ global state ============================ */

const state = { species: "All", sex: "All" };
let ALL_ROWS = null;   // raw dataset (full, unfiltered)
let DERIVED = null;    // Phase 1 derived.json
let FIXED_DOMAINS = null; // full-dataset extents, so axes never rescale

function rowsPassingFilter(rows) {
  return rows.filter(
    (r) =>
      (state.species === "All" || r.species === state.species) &&
      (state.sex === "All" || r.sex === state.sex)
  );
}

function speciesShown() {
  return SPECIES.filter((s) => state.species === "All" || s === state.species);
}

function sexesShown() {
  return state.sex === "All" ? SEXES : [state.sex];
}

/* ============================ ChartBase ============================ */

/* Shared scaffolding: fixed-size SVG with <title>/<desc> (a11y), margin
 * group, and axis helpers. Subclasses add marks. */
class ChartBase {
  constructor(containerSel, width, height, margin, a11yTitle, a11yDesc) {
    this.width = width;
    this.height = height;
    this.margin = margin;
    this.innerW = width - margin.left - margin.right;
    this.innerH = height - margin.top - margin.bottom;

    const containerId = containerSel.replace("#", "");
    this.titleId = containerId + "-svg-title";
    this.descId = containerId + "-svg-desc";

    const container = d3.select(containerSel);
    container.selectAll("*").remove();
    this.svg = container
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img")
      .attr("aria-labelledby", `${this.titleId} ${this.descId}`);
    this.svg.append("title").attr("id", this.titleId).text(a11yTitle);
    this.svg.append("desc").attr("id", this.descId).text(a11yDesc);
    this.g = this.svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);
  }

  xAxis(scale) {
    this.g
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${this.innerH})`)
      .call(d3.axisBottom(scale));
  }

  yAxis(scale) {
    this.g.append("g").attr("class", "axis").call(d3.axisLeft(scale));
  }

  xLabel(text) {
    this.g
      .append("text")
      .attr("class", "axis-label")
      .attr("x", this.innerW / 2)
      .attr("y", this.innerH + 46)
      .attr("text-anchor", "middle")
      .text(text);
  }

  yLabel(text) {
    // Keep the rotated label 12px inside the top of the SVG viewBox
    // (positions depend on this chart's top margin, which varies).
    this.g
      .append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -this.innerH / 2)
      .attr("y", -(this.margin.top - 12))
      .attr("text-anchor", "middle")
      .text(text);
  }

  empty(message) {
    this.g
      .append("text")
      .attr("x", this.innerW / 2)
      .attr("y", this.innerH / 2)
      .attr("text-anchor", "middle")
      .attr("fill", "#555")
      .text(message);
  }
}

/* ============================ Scatter ============================ */

class ScatterChart extends ChartBase {
  constructor(rows) {
    super(
      "#scatter",
      760, 440,
      { top: 16, right: 20, bottom: 60, left: 74 },
      "Scatter plot of body mass versus flipper length, colored by species, shaped by sex",
      `One point per penguin (${rows.length} shown under the current filter). ` +
      "Color encodes species, shape encodes sex (circle female, triangle male, square unknown)."
    );

    // Fixed domains from the FULL dataset (computed once at load) so that
    // filtering never rescales the axes.
    const [fx0, fx1] = FIXED_DOMAINS.flipper;
    const [fy0, fy1] = FIXED_DOMAINS.mass;
    this.x = d3.scaleLinear().domain([fx0, fx1]).range([0, this.innerW]);
    this.y = d3.scaleLinear().domain([fy0, fy1]).range([this.innerH, 0]);

    this.xAxis(this.x);
    this.yAxis(this.y);
    this.xLabel("Flipper length (mm)");
    this.yLabel("Body mass (g)");

    const points = rows
      .filter((d) => d.flipper_length_mm != null && d.body_mass_g != null)
      // Deterministic bind order: x, then species, then sex.
      .sort(
        (a, b) =>
          (a.flipper_length_mm - b.flipper_length_mm) ||
          (a.species < b.species ? -1 : a.species > b.species ? 1 : 0) ||
          ((a.sex || "") < (b.sex || "") ? -1 : (a.sex || "") > (b.sex || "") ? 1 : 0)
      );

    if (points.length === 0) {
      this.empty("No penguins match the current filter.");
      return;
    }

    this.g
      .selectAll("path.scatter-point")
      .data(points)
      .join("path")
      .attr("class", "scatter-point")
      .attr("d", (d) => sexSymbol(d))
      .attr("transform", (d) =>
        `translate(${this.x(d.flipper_length_mm)},${this.y(d.body_mass_g)})`
      )
      .attr("fill", (d) => speciesColor(d.species))
      .attr("tabindex", 0)
      .attr("aria-label", describePoint)
      .on("mousemove", (event, d) => showTooltip(event, pointHtml(d)))
      .on("mouseout", hideTooltip)
      .on("focus", function (event, d) {
        showTooltipForElement(this, pointHtml(d));
      })
      .on("blur", hideTooltip);
  }
}

function describePoint(d) {
  const sex = d.sex || "unknown sex";
  return (
    `${d.species}, ${sex}, ${d.island || "unknown island"}: ` +
    `flipper ${d.flipper_length_mm} mm, body mass ${d.body_mass_g} g`
  );
}

function pointHtml(d) {
  return (
    `<strong>${d.species}</strong> (${d.sex || "unknown sex"})<br/>` +
    `Island: ${d.island || "&mdash;"}<br/>` +
    `Flipper: ${d.flipper_length_mm} mm<br/>` +
    `Body mass: ${fmtInt(d.body_mass_g)} g<br/>` +
    `Bill: ${d.bill_length_mm != null ? d.bill_length_mm : "&mdash;"} mm ` +
    `&times; ${d.bill_depth_mm != null ? d.bill_depth_mm : "&mdash;"} mm`
  );
}

/* ============================ Histogram ============================ */

/* Grouped histogram of bill_length_mm by species (2 mm bins). */
class HistogramChart extends ChartBase {
  constructor(rows) {
    super(
      "#histogram",
      560, 380,
      { top: 16, right: 16, bottom: 60, left: 54 },
      "Histogram of bill length by species, 2 millimetre bins",
      "Grouped bars: count of penguins in each 2 mm bill-length bin, one color per species, under the current filter."
    );

    const species = speciesShown();
    const perSpecies = species
      .map((s) => ({
        species: s,
        values: rows.filter(
          (r) => r.species === s && r.bill_length_mm != null
        ),
      }))
      .filter((d) => d.values.length > 0);

    if (perSpecies.length === 0) {
      this.empty("No bill-length data matches the current filter.");
      return;
    }

    // Fixed domain (full dataset), 2 mm bin edges.
    const [d0, d1] = FIXED_DOMAINS.bill;
    const x = d3.scaleLinear().domain([d0, d1]).range([0, this.innerW]);
    const thresholds = d3.range(Math.ceil(d0 / 2) * 2, d1, 2);
    const binner = d3
      .bin()
      .value((r) => r.bill_length_mm)
      .domain([d0, d1])
      .thresholds(thresholds);

    const binsBySpecies = perSpecies.map((d) => ({
      species: d.species,
      bins: binner(d.values),
    }));

    const maxCount = d3.max(
      binsBySpecies,
      (bs) => d3.max(bs.bins, (b) => b.length)
    );
    const y = d3
      .scaleLinear()
      .domain([0, maxCount])
      .nice()
      .range([this.innerH, 0]);

    const binPx = x(2) - x(0);
    const groupW = binPx * 0.9;
    const barW = groupW / perSpecies.length;

    this.xAxis(x);
    this.yAxis(y);
    this.xLabel("Bill length (mm)");
    this.yLabel("Count");

    const nBins = binsBySpecies[0].bins.length;
    for (let i = 0; i < nBins; i++) {
      binsBySpecies.forEach((bs, j) => {
        const bin = bs.bins[i];
        const bx =
          x(bin.x0) + (binPx - groupW) / 2 + j * barW;
        const barH = this.innerH - y(bin.length);
        this.g
          .append("rect")
          .attr("class", "bar-rect")
          .attr("x", bx)
          .attr("y", this.innerH - barH)
          .attr("width", Math.max(barW - 1, 1))
          .attr("height", barH)
          .attr("fill", speciesColor(bs.species))
          .on("mousemove", (event) =>
            showTooltip(
              event,
              `<strong>${bs.species}</strong><br/>${fmtMm(bin.x0)}&ndash;${fmtMm(bin.x1)} mm: ${bin.length} penguins`
            )
          )
          .on("mouseout", hideTooltip);
      });
    }
  }
}

/* ============================ Box plot ============================ */

/* Box plot of bill_length_mm by species: median, IQR, Tukey whiskers
 * (1.5 * IQR), outlier points. */
class BoxPlotChart extends ChartBase {
  constructor(rows) {
    super(
      "#boxplot",
      560, 380,
      { top: 16, right: 16, bottom: 60, left: 54 },
      "Box plot of bill length by species",
      "Box = interquartile range, line = median, whiskers = 1.5 IQR, points = outliers. Under the current filter."
    );

    const species = speciesShown()
      .map((s) => ({
        species: s,
        values: rows
          .filter((r) => r.species === s && r.bill_length_mm != null)
          .map((r) => r.bill_length_mm)
          .sort((a, b) => a - b),
      }))
      .filter((d) => d.values.length > 0);

    if (species.length === 0) {
      this.empty("No bill-length data matches the current filter.");
      return;
    }

    const [d0, d1] = FIXED_DOMAINS.bill;
    const y = d3
      .scaleLinear()
      .domain([d0, d1])
      .range([this.innerH, 0]);
    const x = d3
      .scaleBand()
      .domain(species.map((d) => d.species))
      .range([0, this.innerW])
      .paddingInner(0.45)
      .paddingOuter(0.3);

    this.xAxis(x);
    this.yAxis(y);
    this.xLabel("Species");
    this.yLabel("Bill length (mm)");

    const boxW = x.bandwidth();

    species.forEach((d) => {
      const q1 = d3.quantileSorted(d.values, 0.25);
      const q2 = d3.quantileSorted(d.values, 0.5);
      const q3 = d3.quantileSorted(d.values, 0.75);
      const iqr = q3 - q1;
      const loFence = q1 - 1.5 * iqr;
      const hiFence = q3 + 1.5 * iqr;
      const inliers = d.values.filter((v) => v >= loFence && v <= hiFence);
      const wLo = d3.min(inliers);
      const wHi = d3.max(inliers);
      const outliers = d.values.filter((v) => v < loFence || v > hiFence);
      const cx = x(d.species) + boxW / 2;
      const g = this.g;

      // Whisker stem + caps.
      g.append("line").attr("class", "box-whisker")
        .attr("x1", cx).attr("x2", cx)
        .attr("y1", y(wLo)).attr("y2", y(wHi));
      g.append("line").attr("class", "box-whisker")
        .attr("x1", cx - boxW / 3).attr("x2", cx + boxW / 3)
        .attr("y1", y(wLo)).attr("y2", y(wLo));
      g.append("line").attr("class", "box-whisker")
        .attr("x1", cx - boxW / 3).attr("x2", cx + boxW / 3)
        .attr("y1", y(wHi)).attr("y2", y(wHi));

      // IQR box.
      g.append("rect").attr("class", "box-rect")
        .attr("x", x(d.species))
        .attr("y", y(q3))
        .attr("width", boxW)
        .attr("height", Math.max(y(q1) - y(q3), 1))
        .attr("fill", speciesColor(d.species))
        .attr("fill-opacity", 0.55)
        .on("mousemove", (event) =>
          showTooltip(
            event,
            `<strong>${d.species}</strong> (n=${d.values.length})<br/>` +
            `median ${fmtMm(q2)} mm<br/>` +
            `Q1&ndash;Q3: ${fmtMm(q1)}&ndash;${fmtMm(q3)} mm<br/>` +
            `whiskers: ${fmtMm(wLo)}&ndash;${fmtMm(wHi)} mm`
          )
        )
        .on("mouseout", hideTooltip);

      // Median line.
      g.append("line").attr("class", "box-median")
        .attr("x1", x(d.species)).attr("x2", x(d.species) + boxW)
        .attr("y1", y(q2)).attr("y2", y(q2));

      // Outliers.
      g.selectAll("circle.box-outlier-" + d.species)
        .data(outliers)
        .join("circle")
        .attr("class", "box-outlier")
        .attr("cx", cx)
        .attr("cy", (v) => y(v))
        .attr("r", 3.5)
        .on("mousemove", (event, v) =>
          showTooltip(event, `<strong>${d.species}</strong> outlier: ${fmtMm(v)} mm`)
        )
        .on("mouseout", hideTooltip);
    });
  }
}

/* ============================ Bars (Phase 1 means) ============================ */

/* One small-multiples bar chart per feature: mean by species (x) and sex
 * (bar shade), values from Phase 1 derived.json. */
class FeatureBarChart extends ChartBase {
  constructor(containerSel, feature) {
    super(
      containerSel,
      420, 250,
      { top: 26, right: 14, bottom: 56, left: 60 },
      `Mean ${FEATURE_LABELS[feature]} by species and sex`,
      "Bar chart of Phase 1 mean values, grouped by sex within each species."
    );

    this.svg
      .append("text")
      .attr("x", this.margin.left)
      .attr("y", 16)
      .attr("font-size", 13)
      .attr("font-weight", 600)
      .text(FEATURE_LABELS[feature]);

    const species = speciesShown();
    const sexes = sexesShown();
    const data = [];
    species.forEach((sp) =>
      sexes.forEach((sex) => {
        const cell = (DERIVED.by_species_sex[sp + "|" + sex] || {})[feature];
        if (cell) {
          data.push({ species: sp, sex, mean: cell.mean, std: cell.std, n: cell.n });
        }
      })
    );

    if (data.length === 0) {
      this.empty("No data for this combination.");
      return;
    }

    const xOuter = d3
      .scaleBand()
      .domain(species)
      .range([0, this.innerW])
      .paddingInner(0.25)
      .paddingOuter(0.15);
    const xInner = d3
      .scaleBand()
      .domain(sexes)
      .range([0, xOuter.bandwidth()])
      .padding(0.1);
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.mean) * 1.18])
      .range([this.innerH, 0]);

    this.xAxis(xOuter);
    this.yAxis(y);
    this.yLabel(FEATURE_LABELS[feature]);

    data
      .sort(
        (a, b) =>
          (a.species < b.species ? -1 : 1) ||
          (a.sex < b.sex ? -1 : 1)
      )
      .forEach((d) => {
        const bx = xOuter(d.species) + xInner(d.sex);
        const by = y(d.mean);
        this.g
          .append("rect")
          .attr("class", "bar-rect")
          .attr("x", bx)
          .attr("y", by)
          .attr("width", Math.max(xInner.bandwidth(), 1))
          .attr("height", this.innerH - by)
          .attr("fill", sexBarColor(d.sex))
          .on("mousemove", (event) =>
            showTooltip(
              event,
              `<strong>${d.species} (${d.sex.toLowerCase()})</strong><br/>` +
              `mean ${fmtFeature(feature, d.mean)}${feature === "body_mass_g" ? " g" : " mm"}<br/>` +
              `std ${fmtFeature(feature, d.std)} &middot; n=${d.n}`
            )
          )
          .on("mouseout", hideTooltip);

        this.g
          .append("text")
          .attr("class", "bar-value-label")
          .attr("x", bx + xInner.bandwidth() / 2)
          .attr("y", by - 5)
          .attr("text-anchor", "middle")
          .text(fmtFeature(feature, d.mean));
      });
  }
}

/* ============================ Heatmap ============================ */

/* 4x4 Pearson correlation matrix, recomputed for the current filter.
 * With no filters active the values equal the Phase 1 derived.json matrix. */
class HeatmapChart extends ChartBase {
  constructor(rows) {
    super(
      "#heatmap",
      560, 520,
      { top: 64, right: 24, bottom: 24, left: 128 },
      "Heatmap of the 4 by 4 Pearson correlation matrix",
      "Red is positive, blue is negative. Values recomputed for the current filter with pairwise complete observations."
    );

    const cell = Math.min(this.innerW / FEATURES.length, this.innerH / FEATURES.length);
    const color = d3
      .scaleLinear()
      .domain([-1, 0, 1])
      .range(["#2166AC", "#F7F7F7", "#B2182B"])
      .clamp(true);

    // Column labels (top) and row labels (left).
    FEATURES.forEach((f, j) => {
      this.g
        .append("text")
        .attr("class", "heat-axis-label")
        .attr("x", j * cell + cell / 2)
        .attr("y", -10)
        .attr("text-anchor", "middle")
        .text(FEATURE_SHORT[f]);
    });
    FEATURES.forEach((f, i) => {
      this.g
        .append("text")
        .attr("class", "heat-axis-label")
        .attr("x", -10)
        .attr("y", i * cell + cell / 2 + 4)
        .attr("text-anchor", "end")
        .text(FEATURE_SHORT[f]);
    });

    for (let i = 0; i < FEATURES.length; i++) {
      for (let j = 0; j < FEATURES.length; j++) {
        const fa = FEATURES[i];
        const fb = FEATURES[j];
        const res = fa === fb ? { r: 1, n: null } : pearson(rows, fa, fb);
        const r = res ? res.r : null;

        this.g
          .append("rect")
          .attr("class", "heat-cell")
          .attr("x", j * cell)
          .attr("y", i * cell)
          .attr("width", cell)
          .attr("height", cell)
          .attr("fill", r == null ? "#eeeeee" : color(r))
          .on("mousemove", (event) =>
            showTooltip(
              event,
              `<strong>r(${FEATURE_SHORT[fa]}, ${FEATURE_SHORT[fb]})</strong><br/>` +
              (r == null ? "undefined for current filter" :
                `r = ${fmtR(r)}${res.n != null ? "<br/>n = " + res.n : ""}`)
            )
          )
          .on("mouseout", hideTooltip);

        this.g
          .append("text")
          .attr("class", "heat-value")
          .attr("x", j * cell + cell / 2)
          .attr("y", i * cell + cell / 2 + 5)
          .attr("text-anchor", "middle")
          .attr("fill", r != null && Math.abs(r) >= 0.6 ? "#ffffff" : "#1a1a1a")
          .attr("pointer-events", "none")
          .text(r == null ? "&mdash;" : fmtR(r));
      }
    }
  }
}

/* ============================ KPI cards (Phase 1) ============================ */

function renderKpi() {
  const host = d3.select("#kpi");
  host.selectAll("*").remove();

  const sexTag =
    state.sex === "All"
      ? "all sexes"
      : state.sex.toLowerCase() + "s";

  speciesShown().forEach((sp) => {
    const src =
      state.sex === "All"
        ? (DERIVED.by_species[sp] || {})
        : (DERIVED.by_species_sex[sp + "|" + state.sex] || {});
    if (Object.keys(src).length === 0) return;

    const card = host
      .append("div")
      .attr("class", "kpi-card")
      .style("border-left-color", speciesColor(sp));
    card.append("h3").text(`${sp} (${sexTag})`);

    FEATURES.forEach((f) => {
      const s = src[f];
      if (!s) return;
      const row = card.append("div").attr("class", "kpi-row");
      row.append("span").attr("class", "kpi-label").text(FEATURE_SHORT[f]);
      row
        .append("span")
        .attr("class", "kpi-value")
        .text(
          `${fmtFeature(f, s.mean)} ± ${fmtFeature(f, s.std)}`
        );
      row.append("span").attr("class", "kpi-sub").text(`n=${s.n}`);
    });
  });
}

/* ============================ scatter legend ============================ */

function renderScatterLegend() {
  const host = d3.select("#scatter-legend");
  host.selectAll("*").remove();

  SPECIES.forEach((s) => {
    const item = host.append("span").attr("class", "legend-item");
    item
      .append("span")
      .attr("class", "swatch")
      .style("background", speciesColor(s));
    item.append("span").text(s);
  });

  const shapes = [
    [d3.symbolCircle, "female"],
    [d3.symbolTriangle, "male"],
    [d3.symbolSquare, "unknown sex"],
  ];
  shapes.forEach(([type, label]) => {
    const item = host.append("span").attr("class", "legend-item");
    const svg = item
      .append("svg")
      .attr("class", "shape")
      .attr("viewBox", "0 0 20 20");
    svg
      .append("path")
      .attr("d", d3.symbol().type(type).size(60)())
      .attr("transform", "translate(10,10)")
      .attr("fill", "#666")
      .attr("stroke", "#222")
      .attr("stroke-width", 0.5);
    item.append("span").text(label);
  });
}

/* ============================ wiring & render ============================ */

function renderAll() {
  const rows = rowsPassingFilter(ALL_ROWS);

  d3.select("#scatter-desc").text(
    `One point per penguin (${rows.length} shown under the current filter). ` +
    "Color encodes species; shape encodes sex (circle = female, triangle = male, square = unknown). " +
    "Axes keep fixed full-dataset domains. Hover or focus a point for details."
  );

  new ScatterChart(rows);
  new HistogramChart(rows);
  new BoxPlotChart(rows);
  renderKpi();

  const barsHost = d3.select("#bars");
  barsHost.selectAll("*").remove();
  FEATURES.forEach((f) => {
    barsHost.append("div").attr("id", "bar-" + f);
    new FeatureBarChart("#bar-" + f, f);
  });

  new HeatmapChart(rows);
}

function wireFilters() {
  document
    .querySelectorAll("button.filter-btn")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const kind = btn.dataset.filter;
        const value = btn.dataset.value;
        state[kind] = value;
        document
          .querySelectorAll(`button.filter-btn[data-filter="${kind}"]`)
          .forEach((b) =>
            b.classList.toggle("active", b.dataset.value === value)
          );
        renderAll();
      });
    });
}

/* ============================ init ============================ */

Promise.all([
  d3.json("penguins.json"),
  d3.json("derived.json"),
])
  .then(([raw, derived]) => {
    ALL_ROWS = raw.filter(
      (r) =>
        r &&
        (r.species || r.island || r.sex || FEATURES.some((f) => r[f] != null))
    );
    DERIVED = derived;

    // Fixed axis domains computed once over the full dataset.
    FIXED_DOMAINS = {
      flipper: d3.extent(ALL_ROWS, (r) => r.flipper_length_mm),
      mass: d3.extent(ALL_ROWS, (r) => r.body_mass_g),
      bill: [
        Math.floor(d3.min(ALL_ROWS, (r) => r.bill_length_mm)),
        Math.ceil(d3.max(ALL_ROWS, (r) => r.bill_length_mm)),
      ],
    };

    wireFilters();
    renderScatterLegend();
    renderAll();
  })
  .catch((err) => {
    const box = document.createElement("div");
    box.style.cssText =
      "padding:20px;margin:20px auto;max-width:1180px;color:#a10000;border:1px solid #a10000";
    box.textContent =
      "Could not load the data files (" + err.message + "). " +
      "Serve the repository root over HTTP, e.g. `python3 -m http.server 8000`, " +
      "and open http://localhost:8000/pen-gem/index.html";
    document.body.appendChild(box);
  });
