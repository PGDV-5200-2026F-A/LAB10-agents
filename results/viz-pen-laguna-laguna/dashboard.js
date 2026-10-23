/* Model: poolside/laguna-s-2.1:free */
/*
  Palmer Penguins Dashboard — JavaScript
  D3 v7.9.0 | Data source: ../data/penguins.json (333 records, no missing values)

  Visualization classes:
    Chart            (base class — SVG, margins, scales, tooltips)
    ScatterPlot      (bill_length vs flipper_length, colored by species)
    BoxPlotGrid      (2x2 grid of box plots per numerical variable by species)
    BarPlot          (count by species + means)
    CorrelationHeatmap (4x4 Pearson correlation matrix)
    ViolinPlot       (density distributions for 2 variables by species)
    SmallMultiples   (3 faceted scatter plots, one per species)
*/

"use strict";

// ============================================================
// Configuration constants
// ============================================================

// Path is relative to dist/dashboard.html (served from project root)
const DATA_PATH = "../../../data/penguins.json";

// Species in fixed alphabetical order for deterministic grouping
const SPECIES = ["Adelie", "Chinstrap", "Gentoo"];

// Numeric variables in fixed order
const NUMERIC_VARS = [
    "bill_length_mm",
    "bill_depth_mm",
    "flipper_length_mm",
    "body_mass_g",
];

// Human-readable labels
const VAR_LABELS = {
    bill_length_mm: "Bill Length (mm)",
    bill_depth_mm: "Bill Depth (mm)",
    flipper_length_mm: "Flipper Length (mm)",
    body_mass_g: "Body Mass (g)",
};

// Color palette (colorblind-friendly, fixed)
const COLORS = {
    Adelie: "#4477AA",
    Chinstrap: "#228833",
    Gentoo: "#EE6677",
};

// ============================================================
// Statistical utility functions
// ============================================================

/**
 * Compute Pearson correlation coefficient between two numeric arrays.
 * (d3 v7 does not provide a correlation function natively.)
 */
function correlation(x, y) {
    const n = x.length;
    if (n !== y.length || n < 2) return NaN;
    const mx = d3.mean(x);
    const my = d3.mean(y);
    let sxy = 0, sx2 = 0, sy2 = 0;
    for (let i = 0; i < n; i++) {
        const dx = x[i] - mx;
        const dy = y[i] - my;
        sxy += dx * dy;
        sx2 += dx * dx;
        sy2 += dy * dy;
    }
    const denom = Math.sqrt(sx2 * sy2);
    return denom === 0 ? 0 : sxy / denom;
}

/**
 * Compute five-number summary (min, Q1, median, Q3, max) and whiskers
 * using the 1.5*IQR rule. Returns an object with sorted values.
 */
function boxplotStats(values) {
    const sorted = values.slice().sort(d3.ascending);
    const q1 = d3.quantile(sorted, 0.25);
    const median = d3.quantile(sorted, 0.50);
    const q3 = d3.quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    const whiskerMin = d3.min(sorted.filter(v => v >= lowerBound));
    const whiskerMax = d3.max(sorted.filter(v => v <= upperBound));
    const outliers = sorted.filter(v => v < lowerBound || v > upperBound);
    return {
        min: d3.min(sorted),
        q1, median, q3,
        max: d3.max(sorted),
        whiskerMin,
        whiskerMax,
        iqr,
        outliers,
    };
}

/**
 * Gaussian kernel density estimate.
 * Uses Silverman's rule-of-thumb for bandwidth.
 * Returns nPoints [x, density] pairs over a padded range.
 * Deterministic: no randomness, fixed nPoints.
 */
function computeKDE(values, nPoints = 81) {
    const n = values.length;
    if (n === 0) return [];

    const sigma = d3.deviation(values);

    // Silverman's rule of thumb
    const sorted = values.slice().sort(d3.ascending);
    const q1 = d3.quantile(sorted, 0.25);
    const q3 = d3.quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const sigmaEff = sigma > 0 ? sigma : 1;
    const iqrEff = iqr === 0 ? sigmaEff : iqr / 1.34;
    const bandwidth = 0.9 * Math.min(sigmaEff, iqrEff) * Math.pow(n, -1 / 5);

    const dataMin = d3.min(values);
    const dataMax = d3.max(values);
    const range = dataMax - dataMin;
    const pad = range * 0.2;
    const start = dataMin - pad;
    const end = dataMax + pad;

    const step = (end - start) / (nPoints - 1);
    const points = [];

    for (let i = 0; i < nPoints; i++) {
        const x = start + i * step;
        let density = 0;
        for (const v of values) {
            const z = (x - v) / bandwidth;
            density += Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
        }
        density /= n * bandwidth;
        points.push([x, density]);
    }
    return points;
}

/**
 * Compute the full 4x4 Pearson correlation matrix for the numeric variables.
 * Returns a flat array of {row, col, xVar, yVar, value} objects.
 */
function correlationMatrix(data) {
    const result = [];
    for (let i = 0; i < NUMERIC_VARS.length; i++) {
        for (let j = 0; j < NUMERIC_VARS.length; j++) {
            const xCol = NUMERIC_VARS[i];
            const yCol = NUMERIC_VARS[j];
            const x = data.map(d => d[xCol]);
            const y = data.map(d => d[yCol]);
            result.push({
                row: i,
                col: j,
                xVar: xCol,
                yVar: yCol,
                value: correlation(x, y),
            });
        }
    }
    return result;
}

/**
 * Compute mean of a numeric variable grouped by species.
 * Returns array of {species, mean} sorted by species name.
 */
function meanBySpecies(data, variable) {
    const grouped = d3.group(data, d => d.species);
    const keys = Array.from(grouped.keys()).sort(d3.ascending);
    return keys.map(species => ({
        species,
        mean: d3.mean(grouped.get(species), d => d[variable]),
    }));
}

/**
 * Compute count grouped by species.
 * Returns array of {species, count} sorted by species name.
 */
function countBySpecies(data) {
    const grouped = d3.group(data, d => d.species);
    const keys = Array.from(grouped.keys()).sort(d3.ascending);
    return keys.map(species => ({
        species,
        count: grouped.get(species).length,
    }));
}

// ============================================================
// Tooltip singleton
// ============================================================

const Tooltip = {
    element: d3.select("#tooltip"),

    show(html, x, y) {
        this.element
            .classed("visible", true)
            .html(html)
            .style("left", (x + 12) + "px")
            .style("top", (y - 10) + "px");
    },

    hide() {
        this.element.classed("visible", false);
    },

    move(x, y) {
        this.element
            .style("left", (x + 12) + "px")
            .style("top", (y - 10) + "px");
    },
};

// ============================================================
// Base Chart class
// ============================================================

class Chart {
    /**
     * @param {string} container  selector for the DOM element to host the chart
     * @param {object} dims      { width, height, margin: {top,right,bottom,left} }
     */
    constructor(container, dims) {
        this.container = d3.select(container);
        this.width = dims.width;
        this.height = dims.height;
        this.margin = dims.margin;
        this.innerWidth = this.width - this.margin.left - this.margin.right;
        this.innerHeight = this.height - this.margin.top - this.margin.bottom;

        // Shared color scale (categorical, fixed domain)
        this.color = d3.scaleOrdinal()
            .domain(SPECIES)
            .range([COLORS.Adelie, COLORS.Chinstrap, COLORS.Gentoo]);

        // Interaction state
        this.selectedSpecies = null;

        this._setupSvg();
    }

    _setupSvg() {
        this.svg = this.container
            .append("svg")
            .attr("width", this.width)
            .attr("height", this.height)
            .attr("viewBox", `0 0 ${this.width} ${this.height}`);

        this.g = this.svg
            .append("g")
            .attr("transform", `translate(${this.margin.left},${this.margin.top})`);
    }

    /**
     * Clear the drawing group contents for re-rendering.
     */
    resetContent() {
        this.g.selectAll("*").remove();
    }

    /**
     * Append standard x and y axes with optional labels.
     */
    addAxes(xScale, yScale, { xLabel, yLabel }) {
        this.g
            .append("g")
            .attr("class", "axis x-axis")
            .attr("transform", `translate(0,${this.innerHeight})`)
            .call(d3.axisBottom(xScale).ticks(6));

        if (xLabel) {
            this.g.append("text")
                .attr("class", "chart-label")
                .attr("x", this.innerWidth / 2)
                .attr("y", 36)
                .text(xLabel);
        }

        this.g
            .append("g")
            .attr("class", "axis y-axis")
            .call(d3.axisLeft(yScale).ticks(6));

        if (yLabel) {
            this.g.append("text")
                .attr("class", "chart-label")
                .attr("transform", "rotate(-90)")
                .attr("x", -this.innerHeight / 2)
                .attr("y", -38)
                .attr("text-anchor", "middle")
                .text(yLabel);
        }
    }

    /**
     * Build a legend with species color swatches.
     */
    addLegend(x, y) {
        const legend = this.svg.append("g")
            .attr("class", "legend")
            .attr("transform", `translate(${x},${y})`);

        SPECIES.forEach((sp, i) => {
            const row = legend.append("g")
                .attr("transform", `translate(0,${i * 18})`);

            row.append("rect")
                .attr("x", 0).attr("y", 1)
                .attr("width", 12).attr("height", 12)
                .attr("rx", 2)
                .attr("class", "legend-swatch")
                .attr("fill", this.color(sp));

            row.append("text")
                .attr("x", 18).attr("y", 10)
                .attr("class", "legend-item")
                .text(sp);
        });
    }

    /**
     * Format a numeric value for tooltip display.
     */
    fmt(v) {
        return typeof v === "number" && v % 1 !== 0
            ? d3.format(".1f")(v)
            : String(v);
    }
}

// ============================================================
// 1. ScatterPlot
// ============================================================

class ScatterPlot extends Chart {
    constructor(container, dims) {
        super(container, dims);
    }

    render(data) {
        this.resetContent();

        const xVar = "bill_length_mm";
        const yVar = "flipper_length_mm";

        // Sort deterministically: by x value, then species
        const sorted = data.slice().sort((a, b) => {
            const dx = a[xVar] - b[xVar];
            if (dx !== 0) return dx;
            return a.species.localeCompare(b.species);
        });

        // Scales (fixed domains with padding)
        const xExtent = d3.extent(sorted, d => d[xVar]);
        const yExtent = d3.extent(sorted, d => d[yVar]);
        this.xScale = d3.scaleLinear()
            .domain([xExtent[0] - 2, xExtent[1] + 2])
            .range([0, this.innerWidth]);
        this.yScale = d3.scaleLinear()
            .domain([yExtent[0] - 5, yExtent[1] + 5])
            .range([this.innerHeight, 0]);

        this.addAxes(this.xScale, this.yScale, {
            xLabel: VAR_LABELS[xVar],
            yLabel: VAR_LABELS[yVar],
        });

        const dots = this.g
            .selectAll("circle.dot")
            .data(sorted)
            .join("circle")
            .attr("class", "dot")
            .attr("cx", d => this.xScale(d[xVar]))
            .attr("cy", d => this.yScale(d[yVar]))
            .attr("r", 4.5)
            .attr("fill", d => this.color(d.species))
            .on("mouseover", (event, d) => {
                if (this.selectedSpecies) {
                    const match = d.species === this.selectedSpecies;
                    this.svg.selectAll(".dot").classed("dimmed", !match);
                }
                Tooltip.show(
                    `<strong>${d.species}</strong><br/>` +
                    `Bill Length: ${this.fmt(d[xVar])} mm<br/>` +
                    `Flipper Length: ${this.fmt(d[yVar])} mm`,
                    event.pageX, event.pageY
                );
            })
            .on("mousemove", (event) => Tooltip.move(event.pageX, event.pageY))
            .on("mouseout", () => {
                this.svg.selectAll(".dot").classed("dimmed", false);
                Tooltip.hide();
            })
            .on("click", (event, d) => {
                const isSame = this.selectedSpecies === d.species;
                this.selectedSpecies = isSame ? null : d.species;

                this.svg.selectAll(".dot")
                    .classed("selected", pd => pd.species === d.species && !isSame)
                    .classed("dimmed",
                        this.selectedSpecies
                            ? pd => pd.species !== this.selectedSpecies
                            : false);
            });

        this.addLegend(this.width - 130, 20);
    }
}

// ============================================================
// 2. BoxPlotGrid (2x2 grid of box plots)
// ============================================================

class BoxPlotGrid extends Chart {
    constructor(container, dims) {
        super(container, dims);
        this.subWidth = 290;
        this.subHeight = 210;
        this.subMargin = { top: 28, right: 12, bottom: 40, left: 50 };
    }

    render(data) {
        this.resetContent();

        const nCols = 2;

        NUMERIC_VARS.forEach((variable, idx) => {
            const row = Math.floor(idx / nCols);
            const col = idx % nCols;
            const x0 = col * (this.subWidth + 24);
            const y0 = row * (this.subHeight + 18);

            const frame = this.g
                .append("g")
                .attr("class", "boxplot-frame")
                .attr("transform", `translate(${x0},${y0})`);

            this._renderBoxPlot(frame, data, variable);
        });
    }

    _renderBoxPlot(frame, data, variable) {
        const w = this.subWidth;
        const h = this.subHeight;
        const m = this.subMargin;
        const innerW = w - m.left - m.right;
        const innerH = h - m.top - m.bottom;

        const plot = frame
            .append("g")
            .attr("transform", `translate(${m.left},${m.top})`);

        // Group data by species (sorted for determinism)
        const grouped = d3.group(data, d => d.species);
        const groups = Array.from(grouped.keys()).sort(d3.ascending);

        // Y scale (fixed domain with padding)
        const values = data.map(d => d[variable]);
        const vExtent = d3.extent(values);
        const pad = (vExtent[1] - vExtent[0]) * 0.1;
        const yScale = d3.scaleLinear()
            .domain([vExtent[0] - pad, vExtent[1] + pad])
            .range([innerH, 0]);

        const xScale = d3.scaleBand()
            .domain(groups)
            .range([0, innerW])
            .paddingInner(0.25)
            .paddingOuter(0.4);

        const boxWidth = xScale.bandwidth() * 0.7;

        // Compute stats and render per species
        groups.forEach((sp, i) => {
            const vals = grouped.get(sp).map(d => d[variable]);
            const stats = boxplotStats(vals);
            const cx = xScale(sp) + xScale.step() / 2;

            // Whisker (vertical line)
            plot.append("line")
                .attr("class", "boxplot-whisker")
                .attr("x1", cx).attr("x2", cx)
                .attr("y1", yScale(stats.whisperMin))
                .attr("y2", yScale(stats.whisperMax));

            // Whisker caps
            const capW = boxWidth * 0.25;
            plot.append("line").attr("class", "boxplot-whisker")
                .attr("x1", cx - capW).attr("x2", cx + capW)
                .attr("y1", yScale(stats.whisperMin))
                .attr("y2", yScale(stats.whisperMin));
            plot.append("line").attr("class", "boxplot-whisker")
                .attr("x1", cx - capW).attr("x2", cx + capW)
                .attr("y1", yScale(stats.whisperMax))
                .attr("y2", yScale(stats.whisperMax));

            // Box (Q1 to Q3)
            const boxY = yScale(stats.q3);
            const boxH = yScale(stats.q1) - yScale(stats.q3);
            plot.append("rect")
                .attr("class", "boxplot-box")
                .attr("x", cx - boxWidth / 2)
                .attr("y", boxY)
                .attr("width", boxWidth)
                .attr("height", boxH)
                .attr("fill", this.color(sp));

            // Median line
            plot.append("line")
                .attr("class", "boxplot-median")
                .attr("x1", cx - boxWidth / 2)
                .attr("x2", cx + boxWidth / 2)
                .attr("y1", yScale(stats.median))
                .attr("y2", yScale(stats.median));

            // Outliers
            plot.selectAll("circle.outlier")
                .data(stats.outliers)
                .join("circle")
                .attr("class", "boxplot-outlier")
                .attr("cx", cx)
                .attr("cy", d => yScale(d))
                .attr("r", 2.5);
        });

        // Axes
        plot.append("g")
            .attr("class", "axis x-axis")
            .attr("transform", `translate(0,${innerH})`)
            .call(d3.axisBottom(xScale).tickSize(0));

        plot.append("g")
            .attr("class", "axis y-axis")
            .call(d3.axisLeft(yScale).ticks(5).tickSize(-innerW, 0, 0));

        // Remove axis line for cleaner look
        plot.selectAll(".y-axis path, .x-axis path").remove();

        // Sub-chart title
        frame.append("text")
            .attr("class", "chart-title")
            .attr("x", w / 2)
            .attr("y", 16)
            .text(VAR_LABELS[variable]);

        // X-axis label
        frame.append("text")
            .attr("class", "chart-label")
            .attr("x", m.left + innerW / 2)
            .attr("y", h - 8)
            .attr("text-anchor", "middle")
            .text("Species");
    }
}

// ============================================================
// 3. BarPlot (count by species + means)
// ============================================================

class BarPlot extends Chart {
    constructor(container, dims) {
        super(container, dims);
    }

    render(data) {
        this.resetContent();

        const countData = countBySpecies(data);

        // --- Count bar chart (left column) ---
        const countW = 360;
        const countH = 260;
        const countM = { top: 28, right: 12, bottom: 42, left: 50 };
        const countInnerW = countW - countM.left - countM.right;
        const countInnerH = countH - countM.top - countM.bottom;

        const countSvg = this.g.append("svg")
            .attr("width", countW)
            .attr("height", countH);

        const countPlot = countSvg.append("g")
            .attr("transform", `translate(${countM.left},${countM.top})`);

        const cxScale = d3.scaleBand()
            .domain(countData.map(d => d.species))
            .range([0, countInnerW])
            .paddingInner(0.2)
            .paddingOuter(0.3);

        const cyScale = d3.scaleLinear()
            .domain([0, d3.max(countData, d => d.count) * 1.15])
            .range([countInnerH, 0]);

        countPlot.append("g")
            .attr("class", "axis x-axis")
            .attr("transform", `translate(0,${countInnerH})`)
            .call(d3.axisBottom(cxScale).tickSize(0));

        countPlot.append("g")
            .attr("class", "axis y-axis")
            .call(d3.axisLeft(cyScale).ticks(5));

        countPlot.selectAll("rect.bar")
            .data(countData)
            .join("rect")
            .attr("class", "bar")
            .attr("x", d => cxScale(d.species))
            .attr("y", d => cyScale(d.count))
            .attr("width", cxScale.bandwidth())
            .attr("height", d => countInnerH - cyScale(d.count))
            .attr("fill", d => this.color(d.species))
            .on("mouseover", (event, d) => {
                Tooltip.show(
                    `<strong>${d.species}</strong><br/>Count: ${d.count}`,
                    event.pageX, event.pageY
                );
            })
            .on("mousemove", (event) => Tooltip.move(event.pageX, event.pageY))
            .on("mouseout", () => Tooltip.hide())
            .on("click", (event, d) => {
                // Highlight all bars of the clicked species within this chart
                this.svg.selectAll(".bar")
                    .classed("selected", pd => pd.species === d.species)
                    .classed("dimmed", pd => pd.species !== d.species);
            });

        countPlot.append("text")
            .attr("class", "chart-title")
            .attr("x", countInnerW / 2)
            .attr("y", 16)
            .text("Penguin Count by Species");

        countPlot.append("text")
            .attr("class", "chart-label")
            .attr("x", countInnerW / 2)
            .attr("y", countInnerH + 32)
            .text("Species");

        // --- Mean bar charts (2x2 grid, right side) ---
        const meanW = 180;
        const meanH = 170;
        const meanM = { top: 22, right: 8, bottom: 38, left: 40 };
        const meanInnerW = meanW - meanM.left - meanM.right;
        const meanInnerH = meanH - meanM.top - meanM.bottom;
        const startX = countW + 30;

        NUMERIC_VARS.forEach((variable, idx) => {
            const col = idx % 2;
            const row = Math.floor(idx / 2);
            const mx = startX + col * (meanW + 12);
            const my = row * (meanH + 14);

            const frame = this.g.append("g")
                .attr("transform", `translate(${mx},${my})`);

            const innerSvg = frame.append("svg")
                .attr("width", meanW)
                .attr("height", meanH);

            const plot = innerSvg.append("g")
                .attr("transform", `translate(${meanM.left},${meanM.top})`);

            const meanData = meanBySpecies(data, variable);

            const xS = d3.scaleBand()
                .domain(SPECIES)
                .range([0, meanInnerW])
                .paddingInner(0.25)
                .paddingOuter(0.4);

            const allMeans = meanData.map(d => d.mean);
            const minV = d3.min(allMeans);
            const maxV = d3.max(allMeans);
            const yS = d3.scaleLinear()
                .domain([minV * 0.95, maxV * 1.1])
                .range([meanInnerH, 0]);

            plot.append("g")
                .attr("class", "axis x-axis")
                .attr("transform", `translate(0,${meanInnerH})`)
                .call(d3.axisBottom(xS).tickSize(0).tickFormat(d => d.substring(0, 3)));

            plot.append("g")
                .attr("class", "axis y-axis")
                .call(d3.axisLeft(yS).ticks(4).tickFormat(d3.format(".2s")));

            plot.selectAll("rect.bar")
                .data(meanData)
                .join("rect")
                .attr("class", "bar")
                .attr("x", d => xS(d.species))
                .attr("y", d => yS(d.mean))
                .attr("width", xS.bandwidth())
                .attr("height", d => meanInnerH - yS(d.mean))
                .attr("fill", d => this.color(d.species))
                .on("mouseover", (event, d) => {
                    Tooltip.show(
                        `<strong>${d.species}</strong><br/>` +
                        `${VAR_LABELS[variable]}: ${d3.format(".1f")(d.mean)}`,
                        event.pageX, event.pageY
                    );
                })
                .on("mousemove", (event) => Tooltip.move(event.pageX, event.pageY))
                .on("mouseout", () => Tooltip.hide());

            // Variable label as title
            plot.append("text")
                .attr("class", "chart-title")
                .attr("x", meanInnerW / 2)
                .attr("y", 14)
                .text(VAR_LABELS[variable]);

            plot.append("text")
                .attr("class", "chart-label")
                .attr("x", meanInnerW / 2)
                .attr("y", meanInnerH + 30)
                .text("Species");
        });

        this.addLegend(this.width - 130, 12);
    }
}

// ============================================================
// 4. CorrelationHeatmap
// ============================================================

class CorrelationHeatmap extends Chart {
    constructor(container, dims) {
        super(container, dims);
    }

    render(data) {
        this.resetContent();

        const matrix = correlationMatrix(data);
        const n = NUMERIC_VARS.length;
        const cellSize = Math.min(this.innerWidth, this.innerHeight - 60) / n;
        const offsetX = (this.innerWidth - cellSize * n) / 2 + 10;
        const offsetY = (this.innerHeight - cellSize * n - 60) / 2;

        const corrScale = d3.scaleSequential(d3.interpolateRdBu)
            .domain([1, -1]);

        // Cell group
        const cells = this.g.append("g")
            .attr("class", "heatmap-cells")
            .attr("transform", `translate(${offsetX},${offsetY})`);

        cells.selectAll("rect.heatmap-cell")
            .data(matrix)
            .join("rect")
            .attr("class", "heatmap-cell")
            .attr("x", d => d.col * cellSize)
            .attr("y", d => d.row * cellSize)
            .attr("width", cellSize)
            .attr("height", cellSize)
            .attr("fill", d => corrScale(d.value))
            .on("mouseover", (event, d) => {
                Tooltip.show(
                    `<strong>${VAR_LABELS[d.xVar]}</strong> vs <strong>${VAR_LABELS[d.yVar]}</strong><br/>` +
                    `r = ${d3.format(".3f")(d.value)}`,
                    event.pageX, event.pageY
                );
            })
            .on("mousemove", (event) => Tooltip.move(event.pageX, event.pageY))
            .on("mouseout", () => Tooltip.hide());

        // Correlation values inside cells
        cells.selectAll("text.heatmap-text")
            .data(matrix)
            .join("text")
            .attr("class", "heatmap-text")
            .attr("x", d => d.col * cellSize + cellSize / 2)
            .attr("y", d => d.row * cellSize + cellSize / 2)
            .attr("dy", "0.32em")
            .attr("fill", d => Math.abs(d.value) > 0.6 ? "#ffffff" : "#2c3e50")
            .text(d => d3.format(".2f")(d.value));

        // Row labels (y-axis, left side)
        this.g.append("g").attr("class", "heatmap-row-labels")
            .selectAll("text")
            .data(NUMERIC_VARS)
            .join("text")
            .attr("x", offsetX - 8)
            .attr("y", (d, i) => offsetY + i * cellSize + cellSize / 2)
            .attr("dy", "0.32em")
            .attr("text-anchor", "end")
            .attr("font-size", 11)
            .attr("fill", "#34495e")
            .text(d => VAR_LABELS[d]);

        // Column labels (x-axis, rotated)
        const colLabelY = offsetY + n * cellSize + 12;
        this.g.append("g").attr("class", "heatmap-col-labels")
            .selectAll("text")
            .data(NUMERIC_VARS)
            .join("text")
            .attr("x", (d, i) => offsetX + i * cellSize + cellSize / 2)
            .attr("y", colLabelY)
            .attr("font-size", 11)
            .attr("fill", "#34495e")
            .attr("text-anchor", "end")
            .attr("transform", (d, i) => {
                const cx = offsetX + i * cellSize + cellSize / 2;
                return `rotate(-35,${cx},${colLabelY})`;
            })
            .text(d => VAR_LABELS[d]);

        // Title
        this.g.append("text")
            .attr("class", "chart-title")
            .attr("x", this.innerWidth / 2)
            .attr("y", 16)
            .text("Pearson Correlation Matrix");

        // Legend (color gradient + scale labels)
        this._drawLegend(offsetX, offsetY + n * cellSize + 34, cellSize * n);
    }

    _drawLegend(x, y, width) {
        const legendG = this.g.append("g")
            .attr("transform", `translate(${x},${y})`);

        const nStops = 50;
        const step = width / nStops;

        d3.range(nStops).forEach(i => {
            legendG.append("rect")
                .attr("x", i * step)
                .attr("y", 0)
                .attr("width", step + 1)
                .attr("height", 10)
                .attr("fill", d3.interpolateRdBu(i / (nStops - 1)));
        });

        // Scale axis marks
        legendG.append("line")
            .attr("x1", 0).attr("x2", 0)
            .attr("y1", 10).attr("y2", 15)
            .attr("stroke", "#34495e").attr("stroke-width", 1);
        legendG.append("line")
            .attr("x1", width).attr("x2", width)
            .attr("y1", 10).attr("y2", 15)
            .attr("stroke", "#34495e").attr("stroke-width", 1);
        legendG.append("text")
            .attr("x", 0).attr("y", 24)
            .attr("font-size", 10)
            .attr("text-anchor", "middle")
            .attr("fill", "#7f8c8d")
            .text("-1 (negative)");
        legendG.append("text")
            .attr("x", width / 2).attr("y", 24)
            .attr("font-size", 10)
            .attr("text-anchor", "middle")
            .attr("fill", "#7f8c8d")
            .text("0");
        legendG.append("text")
            .attr("x", width).attr("y", 24)
            .attr("font-size", 10)
            .attr("text-anchor", "middle")
            .attr("fill", "#7f8c8d")
            .text("1 (positive)");
    }
}

// ============================================================
// 5. ViolinPlot
// ============================================================

class ViolinPlot extends Chart {
    constructor(container, dims) {
        super(container, dims);
        this.variables = ["bill_length_mm", "flipper_length_mm"];
        this.subWidth = 290;
        this.subHeight = 250;
        this.subMargin = { top: 28, right: 14, bottom: 42, left: 50 };
    }

    render(data) {
        this.resetContent();

        this.variables.forEach((variable, idx) => {
            const offsetX = idx * (this.subWidth + 30);
            const frame = this.g.append("g")
                .attr("class", "violin-frame")
                .attr("transform", `translate(${offsetX},0)`);
            this._renderViolin(frame, data, variable);
        });
    }

    _renderViolin(frame, data, variable) {
        const w = this.subWidth;
        const h = this.subHeight;
        const m = this.subMargin;
        const innerW = w - m.left - m.right;
        const innerH = h - m.top - m.bottom;

        // Group data by species (sorted)
        const grouped = d3.group(data, d => d.species);
        const groups = Array.from(grouped.keys()).sort(d3.ascending);

        // Compute KDE per species and determine global x-range
        let xMin = Infinity, xMax = -Infinity;
        const kdeBySpecies = {};
        groups.forEach(sp => {
            const vals = grouped.get(sp).map(d => d[variable]);
            const kde = computeKDE(vals, 81);
            kdeBySpecies[sp] = kde;
            kde.forEach(p => {
                xMin = Math.min(xMin, p[0]);
                xMax = Math.max(xMax, p[0]);
            });
        });

        const yScale = d3.scaleLinear()
            .domain([xMin, xMax])
            .range([innerH, 0]);

        const xBand = d3.scaleBand()
            .domain(groups)
            .range([0, innerW])
            .paddingInner(0.25)
            .paddingOuter(0.35);

        // X-axis (categorical: species names)
        frame.append("g")
            .attr("class", "axis x-axis")
            .attr("transform", `translate(${m.left},${innerH + m.top})`)
            .call(d3.axisBottom(xBand).tickSize(0));

        frame.append("g")
            .attr("class", "axis y-axis")
            .attr("transform", `translate(${m.left},${m.top})`)
            .call(d3.axisLeft(yScale).ticks(5));

        // X-axis label
        frame.append("text")
            .attr("class", "chart-label")
            .attr("x", m.left + innerW / 2)
            .attr("y", innerH + m.top + 28)
            .attr("text-anchor", "middle")
            .text("Species");

        // Y-axis label (rotated)
        frame.append("text")
            .attr("class", "chart-label")
            .attr("transform", `translate(${m.left},${m.top + innerH / 2}) rotate(-90)`)
            .attr("text-anchor", "middle")
            .text(VAR_LABELS[variable]);

        // Sub-chart title
        frame.append("text")
            .attr("class", "chart-title")
            .attr("x", m.left + innerW / 2)
            .attr("y", 16)
            .text(VAR_LABELS[variable]);

        // Build violin paths
        groups.forEach((sp) => {
            const kde = kdeBySpecies[sp];
            const cx = xBand(sp) + xBand.step() / 2;
            const color = this.color(sp);

            const halfWidth = xBand.step() * 0.35;
            const yMax = d3.max(kde, d => d[1]);
            const yScaleKde = yMax > 0
                ? d3.scaleLinear().domain([0, yMax]).range([0, halfWidth])
                : d3.scaleLinear().domain([0, 1]).range([0, halfWidth]);

            // Build closed path: right side down, left side up
            const path = frame.append("path")
                .attr("class", "violin-path")
                .attr("fill", color)
                .attr("fill-opacity", 0.65)
                .attr("stroke", "#2c3e50")
                .attr("stroke-width", 1)
                .datum(kde)
                .attr("d", d => {
                    let r = "";
                    // Right side (top to bottom)
                    for (let j = 0; j < d.length; j++) {
                        const x = m.left + cx + yScaleKde(d[j][1]);
                        const y = m.top + yScale(d[j][0]);
                        r += (j === 0 ? `M ${x},${y}` : ` L ${x},${y}`);
                    }
                    // Left side (bottom to top)
                    for (let j = d.length - 1; j >= 0; j--) {
                        const x = m.left + cx - yScaleKde(d[j][1]);
                        const y = m.top + yScale(d[j][0]);
                        r += ` L ${x},${y}`;
                    }
                    r += " Z";
                    return r;
                })
                .on("mouseover", (event) => {
                    Tooltip.show(
                        `<strong>${sp}</strong><br/>` +
                        `${VAR_LABELS[variable]} KDE`,
                        event.pageX, event.pageY
                    );
                    this.svg.selectAll(".violin-path").classed("dimmed", true);
                    d3.select(event.currentTarget).classed("dimmed", false);
                })
                .on("mousemove", (event) => Tooltip.move(event.pageX, event.pageY))
                .on("mouseout", () => Tooltip.hide());

            // Median line
            const vals = grouped.get(sp).map(d => d[variable]);
            const med = d3.quantile(vals.slice().sort(d3.ascending), 0.50);
            frame.append("line")
                .attr("stroke", "#2c3e50")
                .attr("stroke-width", 1.5)
                .attr("stroke-dasharray", "3,2")
                .attr("x1", m.left + cx - halfWidth)
                .attr("x2", m.left + cx + halfWidth)
                .attr("y1", m.top + yScale(med))
                .attr("y2", m.top + yScale(med));
        });
    }
}

// ============================================================
// 6. SmallMultiples
// ============================================================

class SmallMultiples extends Chart {
    constructor(container, dims) {
        super(container, dims);
        this.subWidth = 250;
        this.subHeight = 230;
        this.subMargin = { top: 28, right: 10, bottom: 40, left: 44 };
    }

    render(data) {
        this.resetContent();

        const grouped = d3.group(data, d => d.species);
        const groups = Array.from(grouped.keys()).sort(d3.ascending);

        const xVar = "bill_length_mm";
        const yVar = "flipper_length_mm";

        // Global scales for consistency across facets
        const xExtent = d3.extent(data, d => d[xVar]);
        const yExtent = d3.extent(data, d => d[yVar]);

        groups.forEach((sp, idx) => {
            const x0 = idx * (this.subWidth + 26);
            const frame = this.g
                .append("g")
                .attr("class", "facet")
                .attr("transform", `translate(${x0},0)`);
            this._renderFacet(frame, grouped.get(sp), sp, xVar, yVar, xExtent, yExtent);
        });

        // Each facet is individually labeled with species + color, so a
        // separate legend is redundant here.
    }

    _renderFacet(frame, speciesData, sp, xVar, yVar, xExtent, yExtent) {
        const w = this.subWidth;
        const h = this.subHeight;
        const m = this.subMargin;
        const innerW = w - m.left - m.right;
        const innerH = h - m.top - m.bottom;

        // Sort data deterministically
        const sorted = speciesData.slice().sort((a, b) => {
            const dx = a[xVar] - b[xVar];
            return dx !== 0 ? dx : a[yVar] - b[yVar];
        });

        // Shared scales across facets
        const xScale = d3.scaleLinear()
            .domain([xExtent[0] - 2, xExtent[1] + 2])
            .range([0, innerW]);
        const yScale = d3.scaleLinear()
            .domain([yExtent[0] - 5, yExtent[1] + 5])
            .range([innerH, 0]);

        // Title
        frame.append("text")
            .attr("class", "chart-title")
            .attr("x", m.left + innerW / 2)
            .attr("y", 14)
            .text(`${sp} (n=${speciesData.length})`);

        const plot = frame.append("g")
            .attr("transform", `translate(${m.left},${m.top})`);

        // Background panel
        plot.append("rect")
            .attr("x", 0).attr("y", 0)
            .attr("width", innerW).attr("height", innerH)
            .attr("fill", "#fafbfc")
            .attr("stroke", "#e3e7ea");

        // Axes
        plot.append("g")
            .attr("class", "axis x-axis")
            .attr("transform", `translate(0,${innerH})`)
            .call(d3.axisBottom(xScale).ticks(5));

        plot.append("g")
            .attr("class", "axis y-axis")
            .call(d3.axisLeft(yScale).ticks(5));

        // Axis labels
        plot.append("text")
            .attr("class", "chart-label")
            .attr("x", innerW / 2)
            .attr("y", innerH + 30)
            .attr("text-anchor", "middle")
            .text(VAR_LABELS[xVar]);

        plot.append("text")
            .attr("class", "chart-label")
            .attr("transform", "rotate(-90)")
            .attr("x", -innerH / 2)
            .attr("y", -30)
            .attr("text-anchor", "middle")
            .text(VAR_LABELS[yVar]);

        // Dots
        plot.selectAll("circle.dot")
            .data(sorted)
            .join("circle")
            .attr("class", "dot")
            .attr("cx", d => xScale(d[xVar]))
            .attr("cy", d => yScale(d[yVar]))
            .attr("r", 3.5)
            .attr("fill", this.color(sp))
            .on("mouseover", (event, d) => {
                Tooltip.show(
                    `<strong>${d.species}</strong><br/>` +
                    `Bill Length: ${this.fmt(d[xVar])} mm<br/>` +
                    `Flipper Length: ${this.fmt(d[yVar])} mm`,
                    event.pageX, event.pageY
                );
            })
            .on("mousemove", (event) => Tooltip.move(event.pageX, event.pageY))
            .on("mouseout", () => Tooltip.hide());
    }
}

// ============================================================
// Chart dimensions (fixed for determinism)
// ============================================================

const DIMENSIONS = {
    scatter: {
        width: 660, height: 420,
        margin: { top: 30, right: 20, bottom: 55, left: 65 },
    },
    boxplot: {
        width: 640, height: 470,
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
    },
    barplot: {
        width: 960, height: 420,
        margin: { top: 10, right: 20, bottom: 10, left: 10 },
    },
    heatmap: {
        width: 520, height: 520,
        margin: { top: 30, right: 30, bottom: 50, left: 80 },
    },
    violin: {
        width: 640, height: 340,
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
    },
    smallmultiples: {
        width: 880, height: 320,
        margin: { top: 10, right: 20, bottom: 10, left: 10 },
    },
};

// ============================================================
// Initialization — load data, preprocess, render all charts
// ============================================================

d3.json(DATA_PATH).then(rawData => {
    // Preprocessing: sort deterministically by species, then bill length
    const data = rawData.slice().sort((a, b) => {
        const s = a.species.localeCompare(b.species);
        if (s !== 0) return s;
        return a.bill_length_mm - b.bill_length_mm;
    });

    // Instantiate and render each chart
    new ScatterPlot("#scatter-chart", DIMENSIONS.scatter).render(data);
    new BoxPlotGrid("#boxplot-chart", DIMENSIONS.boxplot).render(data);
    new BarPlot("#barplot-chart", DIMENSIONS.barplot).render(data);
    new CorrelationHeatmap("#heatmap-chart", DIMENSIONS.heatmap).render(data);
    new ViolinPlot("#violin-chart", DIMENSIONS.violin).render(data);
    new SmallMultiples("#smallmultiples-chart", DIMENSIONS.smallmultiples).render(data);
}).catch(err => {
    console.error("Failed to load data:", err);
    d3.select("main").append("p")
        .style("color", "red")
        .style("padding", "20px")
        .text("Error loading data. Ensure the page is served via a static server (the data file is at ../data/penguins.json relative to dist/).");
});
