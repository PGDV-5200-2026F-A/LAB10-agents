/**
 * Model: google/gemini-3.8-flash[1m]
 * Palmer Penguins Dashboard Implementation
 * D3.js v7.9.0
 * Modular chart classes adhering to determinism and accessibility rules.
 */

// Global Palette & Mappings
const SPECIES_PALETTE = {
  "Adelie": "#e66101",     // Vivid orange
  "Chinstrap": "#5e3c99",  // Deep purple
  "Gentoo": "#008837"      // Emerald green
};

const SEX_PALETTE = {
  "FEMALE": "#e377c2",
  "MALE": "#1f77b4",
  "UNKNOWN": "#7f7f7f"
};

const METRIC_LABELS = {
  "body_mass_g": "Body Mass (g)",
  "flipper_length_mm": "Flipper Length (mm)",
  "bill_length_mm": "Bill Length (mm)",
  "bill_depth_mm": "Bill Depth (mm)"
};

// Tooltip Helper
class TooltipHandler {
  constructor(tooltipId) {
    this.tooltip = d3.select(tooltipId);
  }

  show(event, htmlContent) {
    this.tooltip
      .classed("visible", true)
      .html(htmlContent)
      .style("left", `${event.pageX + 12}px`)
      .style("top", `${event.pageY - 12}px`);
  }

  hide() {
    this.tooltip.classed("visible", false);
  }
}

const tooltip = new TooltipHandler("#tooltip");

// -------------------------------------------------------------
// 1. Scatter Plot Component
// -------------------------------------------------------------
class ScatterPlot {
  constructor(containerId, options = {}) {
    this.container = d3.select(containerId);
    this.width = options.width || 480;
    this.height = options.height || 340;
    this.margin = options.margin || { top: 25, right: 25, bottom: 45, left: 55 };
    this.innerW = this.width - this.margin.left - this.margin.right;
    this.innerH = this.height - this.margin.top - this.margin.bottom;
    this.svg = null;
    this.g = null;
    this.init();
  }

  init() {
    this.container.selectAll("*").remove();
    this.svg = this.container.append("svg")
      .attr("width", this.width)
      .attr("height", this.height)
      .attr("viewBox", `0 0 ${this.width} ${this.height}`)
      .attr("preserveAspectRatio", "xMidYMid meet");

    this.g = this.svg.append("g")
      .attr("transform", `translate(${this.margin.left},${this.margin.top})`);

    this.g.append("g").attr("class", "x-axis").attr("transform", `translate(0,${this.innerH})`);
    this.g.append("g").attr("class", "y-axis");

    // Axis Labels
    this.g.append("text")
      .attr("class", "axis-label")
      .attr("x", this.innerW / 2)
      .attr("y", this.innerH + 38)
      .attr("text-anchor", "middle")
      .text("Flipper Length (mm)");

    this.g.append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -this.innerH / 2)
      .attr("y", -40)
      .attr("text-anchor", "middle")
      .text("Body Mass (g)");
  }

  render(data) {
    const xExtent = d3.extent(data, d => d.flipper_length_mm);
    const yExtent = d3.extent(data, d => d.body_mass_g);

    const xPadding = (xExtent[1] - xExtent[0]) * 0.05 || 5;
    const yPadding = (yExtent[1] - yExtent[0]) * 0.05 || 100;

    const xScale = d3.scaleLinear()
      .domain([Math.floor(xExtent[0] - xPadding), Math.ceil(xExtent[1] + xPadding)])
      .range([0, this.innerW]);

    const yScale = d3.scaleLinear()
      .domain([Math.floor(yExtent[0] - yPadding), Math.ceil(yExtent[1] + yPadding)])
      .range([this.innerH, 0]);

    // Draw Axes
    this.g.select(".x-axis").call(d3.axisBottom(xScale).ticks(6));
    this.g.select(".y-axis").call(d3.axisLeft(yScale).ticks(6));

    // Dots
    const dots = this.g.selectAll(".scatter-dot")
      .data(data, d => `${d.species}-${d.flipper_length_mm}-${d.body_mass_g}-${d.bill_length_mm}`);

    dots.exit().remove();

    const enter = dots.enter().append("circle")
      .attr("class", "scatter-dot")
      .attr("r", 5);

    enter.merge(dots)
      .attr("cx", d => xScale(d.flipper_length_mm))
      .attr("cy", d => yScale(d.body_mass_g))
      .attr("fill", d => SPECIES_PALETTE[d.species] || "#333")
      .on("mouseover", (event, d) => {
        tooltip.show(event, `
          <strong>${d.species} (${d.sex})</strong><br/>
          Island: ${d.island}<br/>
          Flipper: ${d.flipper_length_mm} mm<br/>
          Body Mass: ${d.body_mass_g} g<br/>
          Culmen: ${d.bill_length_mm} x ${d.bill_depth_mm} mm
        `);
      })
      .on("mouseout", () => tooltip.hide());
  }
}

// -------------------------------------------------------------
// 2. Histogram / Distribution Plot Component
// -------------------------------------------------------------
class DistributionPlot {
  constructor(containerId, options = {}) {
    this.container = d3.select(containerId);
    this.width = options.width || 480;
    this.height = options.height || 340;
    this.margin = options.margin || { top: 25, right: 25, bottom: 45, left: 55 };
    this.innerW = this.width - this.margin.left - this.margin.right;
    this.innerH = this.height - this.margin.top - this.margin.bottom;
    this.init();
  }

  init() {
    this.container.selectAll("*").remove();
    this.svg = this.container.append("svg")
      .attr("width", this.width)
      .attr("height", this.height)
      .attr("viewBox", `0 0 ${this.width} ${this.height}`)
      .attr("preserveAspectRatio", "xMidYMid meet");

    this.g = this.svg.append("g")
      .attr("transform", `translate(${this.margin.left},${this.margin.top})`);

    this.g.append("g").attr("class", "x-axis").attr("transform", `translate(0,${this.innerH})`);
    this.g.append("g").attr("class", "y-axis");

    this.g.append("text")
      .attr("class", "axis-label")
      .attr("x", this.innerW / 2)
      .attr("y", this.innerH + 38)
      .attr("text-anchor", "middle")
      .text("Bill Length (mm)");

    this.g.append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -this.innerH / 2)
      .attr("y", -40)
      .attr("text-anchor", "middle")
      .text("Frequency Count");
  }

  render(data) {
    if (!data.length) return;

    const xExtent = [30, 60]; // Consistent bill length domain
    const xScale = d3.scaleLinear()
      .domain(xExtent)
      .range([0, this.innerW]);

    // Bins generator
    const histogram = d3.bin()
      .value(d => d.bill_length_mm)
      .domain(xScale.domain())
      .thresholds(xScale.ticks(16));

    const speciesList = ["Adelie", "Chinstrap", "Gentoo"];
    const binnedBySpecies = {};
    let maxBinCount = 0;

    speciesList.forEach(sp => {
      const spData = data.filter(d => d.species === sp);
      const bins = histogram(spData);
      binnedBySpecies[sp] = bins;
      bins.forEach(b => {
        if (b.length > maxBinCount) maxBinCount = b.length;
      });
    });

    const yScale = d3.scaleLinear()
      .domain([0, Math.ceil(maxBinCount * 1.1) || 10])
      .range([this.innerH, 0]);

    this.g.select(".x-axis").call(d3.axisBottom(xScale).ticks(8));
    this.g.select(".y-axis").call(d3.axisLeft(yScale).ticks(5));

    this.g.selectAll(".hist-group").remove();

    // Render grouped bars side-by-side or stacked opacity
    speciesList.forEach(sp => {
      const bins = binnedBySpecies[sp];
      const grp = this.g.append("g").attr("class", "hist-group");

      grp.selectAll("rect")
        .data(bins)
        .enter()
        .append("rect")
        .attr("x", d => xScale(d.x0) + 1)
        .attr("y", d => yScale(d.length))
        .attr("width", d => Math.max(0, xScale(d.x1) - xScale(d.x0) - 2))
        .attr("height", d => this.innerH - yScale(d.length))
        .attr("fill", SPECIES_PALETTE[sp])
        .attr("opacity", 0.55)
        .on("mouseover", (event, d) => {
          tooltip.show(event, `
            <strong>${sp}</strong><br/>
            Range: ${d.x0.toFixed(1)} – ${d.x1.toFixed(1)} mm<br/>
            Count: ${d.length} penguins
          `);
        })
        .on("mouseout", () => tooltip.hide());
    });
  }
}

// -------------------------------------------------------------
// 3. Grouped Bar Chart with Error Bars (KPI & Dimorphism)
// -------------------------------------------------------------
class GroupedBarPlot {
  constructor(containerId, options = {}) {
    this.container = d3.select(containerId);
    this.width = options.width || 480;
    this.height = options.height || 340;
    this.margin = options.margin || { top: 25, right: 25, bottom: 45, left: 55 };
    this.innerW = this.width - this.margin.left - this.margin.right;
    this.innerH = this.height - this.margin.top - this.margin.bottom;
    this.init();
  }

  init() {
    this.container.selectAll("*").remove();
    this.svg = this.container.append("svg")
      .attr("width", this.width)
      .attr("height", this.height)
      .attr("viewBox", `0 0 ${this.width} ${this.height}`)
      .attr("preserveAspectRatio", "xMidYMid meet");

    this.g = this.svg.append("g")
      .attr("transform", `translate(${this.margin.left},${this.margin.top})`);

    this.g.append("g").attr("class", "x-axis").attr("transform", `translate(0,${this.innerH})`);
    this.g.append("g").attr("class", "y-axis");

    this.g.append("text")
      .attr("class", "axis-label")
      .attr("x", this.innerW / 2)
      .attr("y", this.innerH + 38)
      .attr("text-anchor", "middle")
      .text("Species");

    this.yLabel = this.g.append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -this.innerH / 2)
      .attr("y", -42)
      .attr("text-anchor", "middle")
      .text("Mean Metric");
  }

  render(derivedStats, selectedMetric = "body_mass_g") {
    this.yLabel.text(`Mean ${METRIC_LABELS[selectedMetric] || selectedMetric}`);

    const species = ["Adelie", "Chinstrap", "Gentoo"];
    const sexes = ["FEMALE", "MALE"];

    // Format data: species -> [ { sex, mean, std, count } ]
    const plotData = [];
    let maxVal = 0;

    species.forEach(sp => {
      const spObj = { species: sp, values: [] };
      sexes.forEach(sx => {
        const stats = derivedStats.stats_by_species_sex[sp] &&
                      derivedStats.stats_by_species_sex[sp][sx] &&
                      derivedStats.stats_by_species_sex[sp][sx].features[selectedMetric];

        if (stats) {
          const val = {
            species: sp,
            sex: sx,
            mean: stats.mean,
            std: stats.std,
            count: stats.count
          };
          spObj.values.push(val);
          if (stats.mean + stats.std > maxVal) {
            maxVal = stats.mean + stats.std;
          }
        }
      });
      plotData.push(spObj);
    });

    const x0 = d3.scaleBand()
      .domain(species)
      .rangeRound([0, this.innerW])
      .paddingInner(0.25);

    const x1 = d3.scaleBand()
      .domain(sexes)
      .rangeRound([0, x0.bandwidth()])
      .padding(0.1);

    const y = d3.scaleLinear()
      .domain([0, maxVal * 1.15])
      .range([this.innerH, 0]);

    this.g.select(".x-axis").call(d3.axisBottom(x0));
    this.g.select(".y-axis").call(d3.axisLeft(y).ticks(6));

    this.g.selectAll(".species-bar-group").remove();

    const speciesGroups = this.g.selectAll(".species-bar-group")
      .data(plotData)
      .enter().append("g")
      .attr("class", "species-bar-group")
      .attr("transform", d => `translate(${x0(d.species)},0)`);

    // Bars
    speciesGroups.selectAll(".bar")
      .data(d => d.values)
      .enter().append("rect")
      .attr("class", "bar")
      .attr("x", d => x1(d.sex))
      .attr("y", d => y(d.mean))
      .attr("width", x1.bandwidth())
      .attr("height", d => this.innerH - y(d.mean))
      .attr("fill", d => SEX_PALETTE[d.sex] || "#3b82f6")
      .attr("rx", 3)
      .on("mouseover", (event, d) => {
        tooltip.show(event, `
          <strong>${d.species} (${d.sex})</strong><br/>
          Mean: ${d.mean}<br/>
          Std Dev: ±${d.std}<br/>
          Sample Size: n=${d.count}
        `);
      })
      .on("mouseout", () => tooltip.hide());

    // Error bars (Standard Deviation)
    speciesGroups.selectAll(".error-line")
      .data(d => d.values)
      .enter().append("line")
      .attr("class", "error-line")
      .attr("x1", d => x1(d.sex) + x1.bandwidth() / 2)
      .attr("x2", d => x1(d.sex) + x1.bandwidth() / 2)
      .attr("y1", d => y(Math.max(0, d.mean - d.std)))
      .attr("y2", d => y(d.mean + d.std))
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 1.5);

    speciesGroups.selectAll(".error-cap-top")
      .data(d => d.values)
      .enter().append("line")
      .attr("class", "error-cap-top")
      .attr("x1", d => x1(d.sex) + x1.bandwidth() / 4)
      .attr("x2", d => x1(d.sex) + 3 * x1.bandwidth() / 4)
      .attr("y1", d => y(d.mean + d.std))
      .attr("y2", d => y(d.mean + d.std))
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 1.5);
  }
}

// -------------------------------------------------------------
// 4. Covariance & Correlation Matrix Heatmap
// -------------------------------------------------------------
class CorrelationHeatmap {
  constructor(containerId, options = {}) {
    this.container = d3.select(containerId);
    this.width = options.width || 480;
    this.height = options.height || 340;
    this.margin = options.margin || { top: 25, right: 35, bottom: 55, left: 110 };
    this.innerW = this.width - this.margin.left - this.margin.right;
    this.innerH = this.height - this.margin.top - this.margin.bottom;
    this.init();
  }

  init() {
    this.container.selectAll("*").remove();
    this.svg = this.container.append("svg")
      .attr("width", this.width)
      .attr("height", this.height)
      .attr("viewBox", `0 0 ${this.width} ${this.height}`)
      .attr("preserveAspectRatio", "xMidYMid meet");

    this.g = this.svg.append("g")
      .attr("transform", `translate(${this.margin.left},${this.margin.top})`);
  }

  render(corrMatrix) {
    const features = ["bill_length_mm", "bill_depth_mm", "flipper_length_mm", "body_mass_g"];
    const labels = ["Bill Length", "Bill Depth", "Flipper Length", "Body Mass"];

    const x = d3.scaleBand()
      .range([0, this.innerW])
      .domain(features)
      .padding(0.06);

    const y = d3.scaleBand()
      .range([0, this.innerH])
      .domain(features)
      .padding(0.06);

    // Diverging color scale (-1 to +1)
    const colorScale = d3.scaleDiverging()
      .domain([-1, 0, 1])
      .interpolator(d3.interpolateRdBu);

    this.g.selectAll("*").remove();

    // Axes
    this.g.append("g")
      .attr("transform", `translate(0,${this.innerH})`)
      .call(d3.axisBottom(x).tickFormat((d, i) => labels[i]))
      .selectAll("text")
      .attr("transform", "rotate(-25)")
      .style("text-anchor", "end");

    this.g.append("g")
      .call(d3.axisLeft(y).tickFormat((d, i) => labels[i]));

    // Heatmap data flattening
    const cellData = [];
    features.forEach(f1 => {
      features.forEach(f2 => {
        cellData.push({
          f1: f1,
          f2: f2,
          val: corrMatrix[f1][f2]
        });
      });
    });

    // Rectangles
    this.g.selectAll(".matrix-cell")
      .data(cellData)
      .enter().append("rect")
      .attr("class", "matrix-cell")
      .attr("x", d => x(d.f1))
      .attr("y", d => y(d.f2))
      .attr("width", x.bandwidth())
      .attr("height", y.bandwidth())
      .attr("fill", d => colorScale(d.val))
      .attr("rx", 4)
      .on("mouseover", (event, d) => {
        tooltip.show(event, `
          <strong>${d.f1}</strong> vs <strong>${d.f2}</strong><br/>
          Pearson <em>r</em> = <strong>${d.val.toFixed(3)}</strong>
        `);
      })
      .on("mouseout", () => tooltip.hide());

    // Text labels inside cells
    this.g.selectAll(".cell-text")
      .data(cellData)
      .enter().append("text")
      .attr("class", "cell-text")
      .attr("x", d => x(d.f1) + x.bandwidth() / 2)
      .attr("y", d => y(d.f2) + y.bandwidth() / 2 + 4)
      .attr("text-anchor", "middle")
      .style("fill", d => Math.abs(d.val) > 0.45 ? "#ffffff" : "#0f172a")
      .style("font-size", "11px")
      .style("font-weight", "600")
      .text(d => d.val.toFixed(2));
  }
}

// -------------------------------------------------------------
// Main Orchestration & Legend Builders
// -------------------------------------------------------------
function buildLegends() {
  // Scatter Legend
  const scatterLegend = d3.select("#scatter-legend");
  Object.keys(SPECIES_PALETTE).forEach(sp => {
    const item = scatterLegend.append("div").attr("class", "legend-item");
    item.append("span")
      .attr("class", "legend-badge")
      .style("background-color", SPECIES_PALETTE[sp]);
    item.append("span").text(sp);
  });

  // Dist Legend
  const distLegend = d3.select("#dist-legend");
  Object.keys(SPECIES_PALETTE).forEach(sp => {
    const item = distLegend.append("div").attr("class", "legend-item");
    item.append("span")
      .attr("class", "legend-badge")
      .style("background-color", SPECIES_PALETTE[sp]);
    item.append("span").text(sp);
  });

  // Bar Legend
  const barLegend = d3.select("#bar-legend");
  ["FEMALE", "MALE"].forEach(sx => {
    const item = barLegend.append("div").attr("class", "legend-item");
    item.append("span")
      .attr("class", "legend-badge")
      .style("background-color", SEX_PALETTE[sx]);
    item.append("span").text(sx.charAt(0) + sx.slice(1).toLowerCase());
  });

  // Matrix Legend
  const matrixLegend = d3.select("#matrix-legend");
  matrixLegend.append("span").style("font-size", "11px").text("Negative (-1.0) ");
  const gradBox = matrixLegend.append("div")
    .style("width", "70px")
    .style("height", "10px")
    .style("background", "linear-gradient(to right, #ca0020, #f7f7f7, #0571b0)")
    .style("border", "1px solid #ccc")
    .style("border-radius", "2px");
  matrixLegend.append("span").style("font-size", "11px").text(" Positive (+1.0)");
}

async function initDashboard() {
  try {
    let derivedData = null;
    const embeddedScript = document.getElementById("embedded-data");
    if (embeddedScript && embeddedScript.textContent.trim().length > 10) {
      try {
        derivedData = JSON.parse(embeddedScript.textContent);
      } catch (e) {
        console.warn("Could not parse embedded data, falling back to fetch", e);
      }
    }

    if (!derivedData) {
      derivedData = await d3.json("../data/penguins_derived.json");
    }
    const rawCleanedData = derivedData.cleaned_data;

    buildLegends();

    // Instantiate Chart Modules
    const scatterPlot = new ScatterPlot("#scatter-chart");
    const distPlot = new DistributionPlot("#dist-chart");
    const barPlot = new GroupedBarPlot("#bar-chart");
    const matrixHeatmap = new CorrelationHeatmap("#matrix-chart");

    // Initial render
    function updateDashboard() {
      const spFilter = d3.select("#species-filter").property("value");
      const sxFilter = d3.select("#sex-filter").property("value");
      const metricFilter = d3.select("#metric-filter").property("value");

      // Filtered data for scatter and distribution
      let filteredData = rawCleanedData;
      if (spFilter !== "ALL") {
        filteredData = filteredData.filter(d => d.species === spFilter);
      }
      if (sxFilter !== "ALL") {
        filteredData = filteredData.filter(d => d.sex === sxFilter);
      }

      scatterPlot.render(filteredData);
      distPlot.render(filteredData);
      barPlot.render(derivedData, metricFilter);

      // Correlation matrix can display overall or selected species
      if (spFilter !== "ALL" && derivedData.species_correlations[spFilter]) {
        matrixHeatmap.render(derivedData.species_correlations[spFilter]);
      } else {
        matrixHeatmap.render(derivedData.correlation_matrix);
      }
    }

    // Bind event listeners to controls
    d3.select("#species-filter").on("change", updateDashboard);
    d3.select("#sex-filter").on("change", updateDashboard);
    d3.select("#metric-filter").on("change", updateDashboard);

    // Initial draw
    updateDashboard();

  } catch (err) {
    console.error("Error initializing dashboard:", err);
    d3.select("main").html(`<div style="color:red; padding: 20px;">Failed to load data: ${err.message}</div>`);
  }
}

// Kickoff
window.addEventListener("DOMContentLoaded", initDashboard);
