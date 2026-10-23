/* ==========================================================================
   ANSUR anthropometric survey - dashboard

   D3 v7.9.0 (vendored, pinned). No transitions, no randomness, no animation:
   every render is a pure function of (data, filter state), so the output is
   stable across runs and machines.

   Colour model
     - Categorical: gender identity. F = slot 1 (blue), M = slot 2 (orange).
       The hue follows the entity, so filtering never repaints a survivor.
     - Diverging: the matrix. Two hues (red/blue) that read as opposite, with a
       neutral gray midpoint.
     - Every categorical pair was checked with the dataviz palette validator
       (--pairs all, the binding test for scatter) in both light and dark mode.

   Missing data is never imputed. Each statistic reports the n it was
   computed from, so the reader can see what a number is based on.
   ========================================================================== */

(function () {
  "use strict";

  var d3 = window.d3;
  var DATA = window.ANSUR_DATA;
  var STATS = window.ANSUR_STATS;

  /* ---------------------------------------------------------------- palette */

  var PALETTE = {
    light: {
      surface: "#fcfcfb",
      series: { F: "#2a78d6", M: "#eb6834" },
      /* Slot 3 carries a third, unrelated measure (missing values) on this
         page. It is deliberately NOT slot 1 or 2, because those two hues
         mean "women" and "men" everywhere else here. Aqua sits below 3:1 on
         the light surface, so the relief rule applies - and it is met: every
         bar carries a visible value label and the chart has a table twin. */
      quality: "#1baf7a",
      divNeg: "#e34948",
      divPos: "#2a78d6",
      divMid: "#f0efec",
      ink: "#0b0b0b",
      inkSecondary: "#52514e",
      muted: "#898781",
      grid: "#e1e0d9",
      axis: "#c3c2b7"
    },
    dark: {
      surface: "#1a1a19",
      series: { F: "#3987e5", M: "#d95926" },
      quality: "#199e70",
      divNeg: "#e66767",
      divPos: "#3987e5",
      divMid: "#383835",
      ink: "#f0efec",
      inkSecondary: "#c3c2b7",
      muted: "#898781",
      grid: "#2c2c2a",
      axis: "#383835"
    }
  };

  var GENDERS = ["F", "M"];
  var GENDER_LABEL = { F: "Women (F)", M: "Men (M)" };

  /* Measures offered in the filter row. `key` is the record field; the unit
     comes from the metadata written by tools/build_data.py. */
  var MEASURES = [
    { key: "age", label: "Age", unit: "years" },
    { key: "height_cm", label: "Height", unit: "cm" },
    { key: "weight_kg", label: "Weight", unit: "kg" },
    { key: "bmi", label: "BMI", unit: "kg/m²" },
    { key: "stature_cm", label: "Stature", unit: "cm" },
    { key: "span_cm", label: "Arm span", unit: "cm" },
    { key: "head.circumference", label: "Head circumference", unit: "mm" },
    { key: "foot.length", label: "Foot length", unit: "mm" },
    { key: "hand.length", label: "Hand length", unit: "mm" },
    { key: "ear.length", label: "Ear length", unit: "mm" }
  ];

  var MEASURE_BY_KEY = {};
  MEASURES.forEach(function (m) {
    MEASURE_BY_KEY[m.key] = m;
  });

  /* Short labels for the matrix axes - 17 full names would not fit. */
  var SHORT_LABELS = {
    age: "age",
    height: "height",
    weight: "weight",
    span: "span",
    stature: "stature",
    "ear.breadth": "ear br",
    "ear.length": "ear len",
    "ear.protrusion": "ear prot",
    "foot.breadth": "foot br",
    "foot.length": "foot len",
    "hand.breadth": "hand br",
    "hand.length": "hand len",
    "hand.palm": "hand palm",
    "head.breadth": "head br",
    "head.length": "head len",
    "head.height": "head ht",
    "head.circumference": "head circ"
  };

  var AGE_BANDS = [
    { label: "17-24", lo: 17, hi: 24 },
    { label: "25-34", lo: 25, hi: 34 },
    { label: "35-44", lo: 35, hi: 44 },
    { label: "45-54", lo: 45, hi: 54 },
    { label: "55+", lo: 55, hi: Infinity }
  ];

  /* The statistical definitions live in stats.js so they can be unit-tested
     and cross-checked against tools/analyze.py. chart.js only renders. */
  var core = window.ANSUR_STATS_CORE;

  /* ---------------------------------------------------------------- helpers */

  function formatCount(n) {
    return d3.format(",")(n);
  }

  function formatValue(value, key) {
    if (value === null || value === undefined) return "-";
    var measure = MEASURE_BY_KEY[key];
    var unit = measure ? measure.unit : "";
    var text;
    if (unit === "years" || unit === "mm") {
      text = d3.format(",.0f")(value);
    } else if (unit === "kg/m²") {
      text = d3.format(".1f")(value);
    } else {
      text = d3.format(",.1f")(value);
    }
    return unit ? text + " " + unit : text;
  }

  function formatSigned(value) {
    if (value === null || value === undefined) return "-";
    var sign = value >= 0 ? "+" : "-";
    var magnitude = Math.abs(value);
    /* Correlation lives in [-1, 1]; covariance spans orders of magnitude, so
       it gets an exponent form. */
    if (magnitude !== 0 && (magnitude < 0.001 || magnitude >= 10000)) {
      return sign + d3.format(".2e")(magnitude);
    }
    return sign + d3.format(magnitude < 10 ? ".3f" : ".1f")(magnitude);
  }

  function relativeLuminance(hex) {
    var rgb = d3.rgb(hex);
    var channels = [rgb.r, rgb.g, rgb.b].map(function (v) {
      var c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  /* Ink on a coloured fill: pick by the fill's luminance so it always clears
     contrast (the documented exception to "text never wears the data colour"). */
  function inkOn(hex) {
    return relativeLuminance(hex) > 0.42 ? "#0b0b0b" : "#fcfcfb";
  }

  /* Diverging colour for the matrix: two hues that read as opposite, meeting
     at a neutral gray midpoint. `t` runs from -1 to +1. */
  function divergingColor(palette) {
    var toNegative = d3.interpolateLab(palette.divMid, palette.divNeg);
    var toPositive = d3.interpolateLab(palette.divMid, palette.divPos);
    return function (t) {
      if (t < 0) return toNegative(-t);
      return toPositive(t);
    };
  }

  /* Covariance spans orders of magnitude, so a linear colour scale would
     crush every pair but the largest into one colour. A symmetric-log
     compression keeps the small values legible while preserving sign.
     The implementation lives in stats.js so it can be tested in isolation. */
  function symlogNormalize(value, maxAbs) {
    return core.symlogNormalize(value, maxAbs);
  }

  function currentMode() {
    var root = document.documentElement;
    var explicit = root.getAttribute("data-theme");
    if (explicit === "dark" || explicit === "light") return explicit;
    var prefersDark = window.matchMedia
      && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "light";
  }

  function colors() {
    return PALETTE[currentMode()];
  }

  function orderedGroups(state) {
    if (state.gender === "all") return GENDERS.slice();
    return [state.gender];
  }

  /* A rounded data-end path: rounded at the value end, square at the baseline. */
  function roundedTopPath(x, y, w, h, r) {
    var radius = Math.max(0, Math.min(r, w / 2, h));
    if (h <= 0) return "";
    return (
      "M" + x + "," + (y + h) +
      "V" + (y + radius) +
      "Q" + x + "," + y + " " + (x + radius) + "," + y +
      "H" + (x + w - radius) +
      "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + radius) +
      "V" + (y + h) +
      "Z"
    );
  }

  function roundedRightPath(x, y, w, h, r) {
    var radius = Math.max(0, Math.min(r, h / 2, w));
    if (w <= 0) return "";
    return (
      "M" + x + "," + y +
      "H" + (x + w - radius) +
      "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + radius) +
      "V" + (y + h - radius) +
      "Q" + (x + w) + "," + (y + h) + " " + (x + w - radius) + "," + (y + h) +
      "H" + x +
      "Z"
    );
  }

  /* --------------------------------------------------------------- tooltip */

  function Tooltip(element) {
    this.element = element;
  }

  Tooltip.prototype.show = function (event, title, rows) {
    var el = this.element;
    el.textContent = "";
    var heading = document.createElement("div");
    heading.className = "tt-title";
    heading.textContent = title;
    el.appendChild(heading);
    rows.forEach(function (row) {
      var line = document.createElement("div");
      line.className = "tt-row";
      if (row.color) {
        var key = document.createElement("span");
        key.className = "tt-key";
        key.style.background = row.color;
        line.appendChild(key);
      }
      var value = document.createElement("span");
      value.className = "tt-value";
      value.textContent = row.value;
      line.appendChild(value);
      if (row.name) {
        var name = document.createElement("span");
        name.className = "tt-name";
        name.textContent = row.name;
        line.appendChild(name);
      }
      el.appendChild(line);
    });
    el.classList.add("visible");
    this.move(event);
  };

  Tooltip.prototype.move = function (event) {
    var el = this.element;
    var pad = 14;
    /* A focus event carries no pointer position, so fall back to the anchor
       element's box and place the tooltip beside it. */
    var anchorX = event.pageX;
    var anchorY = event.pageY;
    if (typeof anchorX !== "number" || isNaN(anchorX)) {
      var source = event.target && event.target.getBoundingClientRect
        ? event.target.getBoundingClientRect()
        : null;
      anchorX = source ? source.left + source.width / 2 : window.pageXOffset + 40;
      anchorY = source ? source.top : window.pageYOffset + 40;
    }
    var x = anchorX + pad;
    var y = anchorY - pad;
    var box = el.getBoundingClientRect();
    if (x + box.width > window.pageXOffset + document.documentElement.clientWidth) {
      x = anchorX - box.width - pad;
    }
    if (y < window.pageYOffset) y = window.pageYOffset + pad;
    el.style.left = x + "px";
    el.style.top = y + "px";
  };

  Tooltip.prototype.hide = function () {
    this.element.classList.remove("visible");
  };

  /* ------------------------------------------------------------- legend DOM */

  function renderLegend(container, entries) {
    var list = d3.select(container);
    list.selectAll("li").remove();
    entries.forEach(function (entry) {
      var item = list.append("li");
      var key = item.append("span");
      key.className = entry.line ? "key-line" : "key";
      if (entry.line) {
        key.style.background = entry.color;
      } else {
        key.style.background = entry.color;
      }
      item.append("span").text(entry.label);
    });
  }

  /* ================================================================ scatter */

  function ScatterChart(container, tooltip) {
    this.container = container;
    this.tooltip = tooltip;
    this.width = 560;
    this.height = 380;
    this.margin = { top: 12, right: 18, bottom: 52, left: 56 };
  }

  ScatterChart.prototype.render = function (records, state) {
    var self = this;
    var palette = colors();
    var xKey = state.scatterX;
    var yKey = state.scatterY;
    var xMeasure = MEASURE_BY_KEY[xKey];
    var yMeasure = MEASURE_BY_KEY[yKey];

    var points = records
      .filter(function (r) { return r[xKey] !== null && r[yKey] !== null; })
      .map(function (r, index) {
        return { x: r[xKey], y: r[yKey], gender: r.gender, record: r, index: index };
      })
      .sort(function (a, b) {
        return a.x - b.x || a.y - b.y || a.index - b.index;
      });

    var svg = d3
      .select(this.container)
      .selectAll("svg")
      .data([null])
      .join("svg")
      .attr("viewBox", "0 0 " + this.width + " " + this.height)
      .attr("width", this.width)
      .attr("height", this.height)
      .attr("role", "img")
      .attr("aria-label", "Scatter plot of " + xMeasure.label + " against " + yMeasure.label + ", coloured by gender");
    svg.selectAll("*").remove();

    if (points.length === 0) {
      svg.append("text")
        .attr("class", "mark-label")
        .attr("x", this.width / 2)
        .attr("y", this.height / 2)
        .attr("text-anchor", "middle")
        .text("No records match the current filters.");
      this.container.dataset.empty = "1";
      return;
    }
    delete this.container.dataset.empty;

    var innerW = this.width - this.margin.left - this.margin.right;
    var innerH = this.height - this.margin.top - this.margin.bottom;

    var xExtent = d3.extent(points, function (p) { return p.x; });
    var yExtent = d3.extent(points, function (p) { return p.y; });
    var xScale = d3.scaleLinear().domain(xExtent).nice().range([0, innerW]);
    var yScale = d3.scaleLinear().domain(yExtent).nice().range([innerH, 0]);

    var g = svg.append("g").attr("transform", "translate(" + this.margin.left + "," + this.margin.top + ")");

    /* Gridlines: hairline, solid, one step off the surface. */
    var yTicks = yScale.ticks(6);
    g.append("g")
      .attr("class", "grid")
      .selectAll("line")
      .data(yTicks)
      .join("line")
      .attr("class", "grid-line")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", function (d) { return yScale(d); })
      .attr("y2", function (d) { return yScale(d); });

    g.append("g")
      .attr("class", "axis axis-x")
      .attr("transform", "translate(0," + innerH + ")")
      .call(d3.axisBottom(xScale).ticks(6).tickSizeOuter(0));

    g.append("g")
      .attr("class", "axis axis-y")
      .call(d3.axisLeft(yScale).ticks(6).tickSizeOuter(0));

    g.append("text")
      .attr("class", "axis-label")
      .attr("x", innerW / 2)
      .attr("y", innerH + 40)
      .attr("text-anchor", "middle")
      .text(xMeasure.label + " (" + xMeasure.unit + ")");

    g.append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -innerH / 2)
      .attr("y", -42)
      .attr("text-anchor", "middle")
      .text(yMeasure.label + " (" + yMeasure.unit + ")");

    /* Points. At this sample size a 8px marker would render as a solid mass,
       so the marks are 2.5px with the surface ring reserved for the hovered
       point; hit-testing is done by nearest-point search instead. */
    var pointLayer = g.append("g").attr("class", "points");

    pointLayer
      .selectAll("circle")
      .data(points, function (d) { return d.index; })
      .join("circle")
      .attr("cx", function (d) { return xScale(d.x); })
      .attr("cy", function (d) { return yScale(d.y); })
      .attr("r", 2.5)
      .attr("fill", function (d) { return palette.series[d.gender]; })
      .attr("fill-opacity", 0.55);

    /* Per-gender least-squares line: the relationship the scatter is about. */
    var groups = orderedGroups(state);
    var lineLayer = g.append("g").attr("class", "fit-lines");

    groups.forEach(function (gender) {
      var subset = points.filter(function (p) { return p.gender === gender; });
      if (subset.length < 3) return;
      var n = subset.length;
      var meanX = core.mean(subset.map(function (p) { return p.x; }));
      var meanY = core.mean(subset.map(function (p) { return p.y; }));
      var sxy = d3.sum(subset, function (p) { return (p.x - meanX) * (p.y - meanY); });
      var sxx = d3.sum(subset, function (p) { return (p.x - meanX) * (p.x - meanX); });
      if (sxx === 0) return;
      var slope = sxy / sxx;
      var intercept = meanY - slope * meanX;
      var x0 = xScale.domain()[0];
      var x1 = xScale.domain()[1];
      lineLayer
        .append("line")
        .attr("x1", xScale(x0))
        .attr("y1", yScale(intercept + slope * x0))
        .attr("x2", xScale(x1))
        .attr("y2", yScale(intercept + slope * x1))
        .attr("stroke", palette.series[gender])
        .attr("stroke-width", 2)
        .attr("stroke-linecap", "round")
        .attr("fill", "none");
    });

    /* Highlighted point - carries the 2px surface ring. */
    var highlight = g
      .append("circle")
      .attr("r", 5)
      .attr("fill", "none")
      .attr("stroke", palette.surface)
      .attr("stroke-width", 2)
      .style("display", "none")
      .style("pointer-events", "none");

    /* Nearest-point hit testing: the reader only has to be closest, not on
       the 2.5px mark. */
    var delaunay = d3.Delaunay.from(
      points,
      function (p) { return xScale(p.x); },
      function (p) { return yScale(p.y); }
    );

    g.append("rect")
      .attr("width", innerW)
      .attr("height", innerH)
      .attr("fill", "none")
      .style("pointer-events", "all")
      .on("mousemove", function (event) {
        var [mx, my] = d3.pointer(event);
        var index = delaunay.find(mx, my);
        if (index === undefined || index < 0) {
          highlight.style("display", "none");
          self.tooltip.hide();
          return;
        }
        var p = points[index];
        var distance = Math.hypot(xScale(p.x) - mx, yScale(p.y) - my);
        if (distance > 40) {
          highlight.style("display", "none");
          self.tooltip.hide();
          return;
        }
        highlight
          .style("display", null)
          .attr("cx", xScale(p.x))
          .attr("cy", yScale(p.y))
          .attr("stroke", palette.series[p.gender]);
        self.tooltip.show(event, GENDER_LABEL[p.gender] + ", age " + p.record.age, [
          { color: palette.series[p.gender], value: formatValue(p.x, xKey), name: xMeasure.label },
          { color: null, value: formatValue(p.y, yKey), name: yMeasure.label }
        ]);
      })
      .on("mouseleave", function () {
        highlight.style("display", "none");
        self.tooltip.hide();
      });

    return {
      points: points,
      summary: groups.map(function (gender) {
        var subset = points.filter(function (p) { return p.gender === gender; });
        var n = subset.length;
        var meanX = n ? core.mean(subset.map(function (p) { return p.x; })) : null;
        var meanY = n ? core.mean(subset.map(function (p) { return p.y; })) : null;
        var sxy = 0, sxx = 0, syy = 0;
        if (n > 1) {
          subset.forEach(function (p) {
            sxy += (p.x - meanX) * (p.y - meanY);
            sxx += (p.x - meanX) * (p.x - meanX);
            syy += (p.y - meanY) * (p.y - meanY);
          });
        }
        var r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
        return {
          gender: gender,
          n: n,
          meanX: meanX,
          meanY: meanY,
          sdX: n > 1 ? Math.sqrt(sxx / (n - 1)) : null,
          sdY: n > 1 ? Math.sqrt(syy / (n - 1)) : null,
          r: r
        };
      })
    };
  };

  /* ============================================================= population */

  function PopulationChart(container, tooltip) {
    this.container = container;
    this.tooltip = tooltip;
    this.width = 560;
    this.height = 380;
    this.margin = { top: 12, right: 18, bottom: 52, left: 56 };
  }

  PopulationChart.prototype.render = function (records, state) {
    var self = this;
    var palette = colors();

    var bands = AGE_BANDS.map(function (band) {
      var members = records.filter(function (r) {
        return r.age !== null && r.age >= band.lo && r.age <= band.hi;
      });
      var counts = {};
      GENDERS.forEach(function (gender) {
        counts[gender] = members.filter(function (r) { return r.gender === gender; }).length;
      });
      return {
        label: band.label,
        total: members.length,
        counts: counts,
        meanAge: members.length ? core.mean(members.map(function (r) { return r.age; })) : null
      };
    });

    var svg = d3
      .select(this.container)
      .selectAll("svg")
      .data([null])
      .join("svg")
      .attr("viewBox", "0 0 " + this.width + " " + this.height)
      .attr("width", this.width)
      .attr("height", this.height)
      .attr("role", "img")
      .attr("aria-label", "Stacked bar chart of respondents by age band, split by gender");
    svg.selectAll("*").remove();

    var innerW = this.width - this.margin.left - this.margin.right;
    var innerH = this.height - this.margin.top - this.margin.bottom;
    var g = svg.append("g").attr("transform", "translate(" + this.margin.left + "," + this.margin.top + ")");

    var xScale = d3.scaleBand().domain(bands.map(function (b) { return b.label; })).range([0, innerW]).padding(0.35);
    var maxTotal = d3.max(bands, function (b) { return b.total; }) || 1;
    var yScale = d3.scaleLinear().domain([0, maxTotal]).nice().range([innerH, 0]);

    g.append("g")
      .attr("class", "grid")
      .selectAll("line")
      .data(yScale.ticks(6))
      .join("line")
      .attr("class", "grid-line")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", function (d) { return yScale(d); })
      .attr("y2", function (d) { return yScale(d); });

    g.append("g")
      .attr("class", "axis axis-x")
      .attr("transform", "translate(0," + innerH + ")")
      .call(d3.axisBottom(xScale).tickSizeOuter(0));

    g.append("g")
      .attr("class", "axis axis-y")
      .call(d3.axisLeft(yScale).ticks(6).tickSizeOuter(0));

    g.append("text")
      .attr("class", "axis-label")
      .attr("x", innerW / 2)
      .attr("y", innerH + 40)
      .attr("text-anchor", "middle")
      .text("Age band (years)");

    g.append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -innerH / 2)
      .attr("y", -42)
      .attr("text-anchor", "middle")
      .text("Respondents");

    var groups = orderedGroups(state);
    var barWidth = Math.min(24, xScale.bandwidth());
    var GAP = 2; // surface gap between touching segments

    bands.forEach(function (band) {
      var x = xScale(band.label) + (xScale.bandwidth() - barWidth) / 2;
      var stack = groups
        .map(function (gender) { return { gender: gender, value: band.counts[gender] }; })
        .filter(function (d) { return d.value > 0; });

      /* Each segment is positioned from the scale, so the stack always
         measures the right total. The 2px surface gap is taken out of the
         lower edge of every segment except the bottom one, which leaves the
         bar's top exactly at its true value. */
      var cumulative = 0;
      stack.forEach(function (segment, index) {
        var before = cumulative;
        cumulative += segment.value;
        var top = yScale(cumulative);
        var bottom = yScale(before);
        if (index > 0) bottom -= GAP;
        var height = Math.max(0, bottom - top);
        var isTop = index === stack.length - 1;
        var path = isTop
          ? roundedTopPath(x, top, barWidth, height, 4)
          : "M" + x + "," + top + "h" + barWidth + "v" + height + "h" + (-barWidth) + "Z";

        g.append("path")
          .attr("d", path)
          .attr("fill", palette.series[segment.gender])
          .attr("tabindex", 0)
          .style("cursor", "pointer")
          .on("mousemove", function (event) {
            self.tooltip.show(event, "Age " + band.label, [
              { color: palette.series[segment.gender], value: formatCount(segment.value), name: GENDER_LABEL[segment.gender] },
              { color: null, value: formatCount(band.total), name: "in band" }
            ]);
          })
          .on("mouseleave", function () { self.tooltip.hide(); })
          .on("focus", function (event) {
            self.tooltip.show(event, "Age " + band.label, [
              { color: palette.series[segment.gender], value: formatCount(segment.value), name: GENDER_LABEL[segment.gender] },
              { color: null, value: formatCount(band.total), name: "in band" }
            ]);
          })
          .on("blur", function () { self.tooltip.hide(); });
      });
    });

    /* One direct label per column: the band total at the top of the stack. */
    bands.forEach(function (band) {
      if (band.total === 0) return;
      var x = xScale(band.label) + xScale.bandwidth() / 2;
      g.append("text")
        .attr("class", "mark-label strong")
        .attr("x", x)
        .attr("y", yScale(band.total) - 7)
        .attr("text-anchor", "middle")
        .text(formatCount(band.total));
    });

    return bands;
  };

  /* ================================================================ matrix */

  function MatrixChart(container, tooltip) {
    this.container = container;
    this.tooltip = tooltip;
    this.cell = 30;
    this.margin = { top: 108, right: 16, bottom: 12, left: 96 };
  }

  MatrixChart.prototype.render = function (records, state) {
    var self = this;
    var palette = colors();
    var features = STATS.covariance.features;
    var size = features.length;
    var metric = state.matrixMetric;

    /* The matrix is recomputed on the filtered slice so it always describes
       the people on screen. Pairwise-complete, matching tools/analyze.py.
       The computation lives in stats.js so it can be tested in isolation. */
    var matrix = core.correlationMatrix(records, features);
    var values = metric === "covariance" ? matrix.covariance : matrix.correlation;
    var counts = matrix.n;

    var finite = [];
    values.forEach(function (row) {
      row.forEach(function (v) {
        if (v !== null && isFinite(v)) finite.push(v);
      });
    });

    var maxAbs = d3.max(finite, function (v) { return Math.abs(v); }) || 1;
    var color = divergingColor(palette);

    /* One place decides a cell's colour, so the fill and the label ink can
       never disagree. */
    function cellColor(value) {
      if (value === null) return "none";
      var t = metric === "covariance"
        ? symlogNormalize(value, maxAbs)
        : value / maxAbs;
      return color(t);
    }

    var width = this.margin.left + size * this.cell + this.margin.right;
    var height = this.margin.top + size * this.cell + this.margin.bottom;

    /* Inside a d3 callback `this` is the DOM node, not the chart, so the
       cell size is captured here rather than read off `this`. */
    var cellSize = this.cell;

    var svg = d3
      .select(this.container)
      .selectAll("svg")
      .data([null])
      .join("svg")
      .attr("viewBox", "0 0 " + width + " " + height)
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img")
      .attr("aria-label", metric === "covariance" ? "Covariance matrix" : "Correlation matrix" + " of " + size + " body measurements");
    svg.selectAll("*").remove();

    var g = svg.append("g").attr("transform", "translate(" + this.margin.left + "," + this.margin.top + ")");

    var cells = [];
    for (let i = 0; i < size; i += 1) {
      for (let j = 0; j < size; j += 1) {
        cells.push({ i: i, j: j, value: values[i][j], n: counts[i][j] });
      }
    }

    g.selectAll("rect")
      .data(cells)
      .join("rect")
      .attr("x", function (d) { return d.j * cellSize; })
      .attr("y", function (d) { return d.i * cellSize; })
      .attr("width", cellSize - 2)
      .attr("height", cellSize - 2)
      .attr("rx", 2)
      .attr("fill", function (d) { return cellColor(d.value); })
      .attr("tabindex", 0)
      .style("cursor", "pointer")
      .on("mousemove", function (event, d) {
        if (d.value === null) {
          self.tooltip.show(event, SHORT_LABELS[features[d.i]] + " × " + SHORT_LABELS[features[d.j]], [
            { color: null, value: "not enough data", name: "n = " + d.n }
          ]);
          return;
        }
        self.tooltip.show(event, SHORT_LABELS[features[d.i]] + " × " + SHORT_LABELS[features[d.j]], [
          { color: null, value: formatSigned(d.value), name: metric === "covariance" ? "covariance" : "correlation r" },
          { color: null, value: formatCount(d.n), name: "paired records" }
        ]);
      })
      .on("mouseleave", function () { self.tooltip.hide(); })
      .on("focus", function (event, d) {
        self.tooltip.show(event, SHORT_LABELS[features[d.i]] + " × " + SHORT_LABELS[features[d.j]], [
          { color: null, value: d.value === null ? "-" : formatSigned(d.value), name: metric === "covariance" ? "covariance" : "correlation r" },
          { color: null, value: formatCount(d.n), name: "paired records" }
        ]);
      })
      .on("blur", function () { self.tooltip.hide(); });

    /* Selective labels: only the strong relationships get a number, so the
       matrix stays readable. Everything else is in the tooltip and the table.
       The threshold is on the normalised value, so it means the same thing
       for correlation and for the much wider covariance range. */
    g.selectAll("text")
      .data(cells.filter(function (d) {
        if (d.value === null) return false;
        var t = metric === "covariance"
          ? symlogNormalize(d.value, maxAbs)
          : d.value / maxAbs;
        return Math.abs(t) >= 0.5;
      }))
      .join("text")
      .attr("class", "cell-label")
      .attr("x", function (d) { return d.j * cellSize + (cellSize - 2) / 2; })
      .attr("y", function (d) { return d.i * cellSize + (cellSize - 2) / 2 + 3.5; })
      .attr("text-anchor", "middle")
      .attr("fill", function (d) { return inkOn(cellColor(d.value)); })
      .text(function (d) {
        return metric === "covariance"
          ? d3.format(".2e")(d.value)
          : d3.format(".2f")(d.value);
      });

    var labelY = features.map(function (f) { return SHORT_LABELS[f]; });
    g.append("g")
      .selectAll("text")
      .data(labelY)
      .join("text")
      .attr("class", "mark-label")
      .attr("x", -8)
      .attr("y", function (d, i) { return i * cellSize + cellSize / 2 + 3.5; })
      .attr("text-anchor", "end")
      .text(function (d) { return d; });

    g.append("g")
      .selectAll("text")
      .data(labelY)
      .join("text")
      .attr("class", "mark-label")
      .attr("transform", function (d, i) { return "translate(" + (i * cellSize + cellSize / 2) + ",-8) rotate(-45)"; })
      .attr("text-anchor", "start")
      .text(function (d) { return d; });

    return { features: features, values: values, counts: counts, cells: cells, finite: finite };
  };

  /* ================================================================== box */

  function boxStats(values) {
    return core.boxStats(values);
  }

  function BoxChart(container, tooltip) {
    this.container = container;
    this.tooltip = tooltip;
    this.width = 560;
    this.height = 300;
    this.margin = { top: 14, right: 18, bottom: 50, left: 56 };
  }

  BoxChart.prototype.render = function (records, state) {
    var self = this;
    var palette = colors();
    var key = state.focusMeasure;
    var measure = MEASURE_BY_KEY[key];
    var groups = orderedGroups(state);

    var stats = groups.map(function (gender) {
      var values = records
        .filter(function (r) { return r.gender === gender && r[key] !== null && r[key] !== undefined; })
        .map(function (r) { return r[key]; });
      return { gender: gender, stats: boxStats(values) };
    });

    var svg = d3
      .select(this.container)
      .selectAll("svg")
      .data([null])
      .join("svg")
      .attr("viewBox", "0 0 " + this.width + " " + this.height)
      .attr("width", this.width)
      .attr("height", this.height)
      .attr("role", "img")
      .attr("aria-label", "Box plot of " + measure.label + " by gender");
    svg.selectAll("*").remove();

    var innerW = this.width - this.margin.left - this.margin.right;
    var innerH = this.height - this.margin.top - this.margin.bottom;
    var g = svg.append("g").attr("transform", "translate(" + this.margin.left + "," + this.margin.top + ")");

    var allValues = [];
    stats.forEach(function (s) {
      if (s.stats) allValues.push(s.stats.min, s.stats.max);
    });
    if (allValues.length === 0) {
      g.append("text")
        .attr("class", "mark-label")
        .attr("x", innerW / 2)
        .attr("y", innerH / 2)
        .attr("text-anchor", "middle")
        .text("No records match the current filters.");
      return [];
    }

    var yScale = d3.scaleLinear().domain(d3.extent(allValues)).nice().range([innerH, 0]);
    var xScale = d3.scaleBand().domain(groups).range([0, innerW]).padding(0.5);
    var boxWidth = Math.min(24, xScale.bandwidth());

    g.append("g")
      .attr("class", "grid")
      .selectAll("line")
      .data(yScale.ticks(6))
      .join("line")
      .attr("class", "grid-line")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", function (d) { return yScale(d); })
      .attr("y2", function (d) { return yScale(d); });

    g.append("g")
      .attr("class", "axis axis-x")
      .attr("transform", "translate(0," + innerH + ")")
      .call(d3.axisBottom(xScale).tickSizeOuter(0));

    g.append("g")
      .attr("class", "axis axis-y")
      .call(d3.axisLeft(yScale).ticks(6).tickSizeOuter(0));

    g.append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -innerH / 2)
      .attr("y", -42)
      .attr("text-anchor", "middle")
      .text(measure.label + " (" + measure.unit + ")");

    var OUTLIER_CAP = 60;

    stats.forEach(function (entry) {
      if (!entry.stats) return;
      var s = entry.stats;
      var x = xScale(entry.gender) + (xScale.bandwidth() - boxWidth) / 2;
      var color = palette.series[entry.gender];

      g.append("line")
        .attr("x1", x + boxWidth / 2)
        .attr("x2", x + boxWidth / 2)
        .attr("y1", yScale(s.lowerWhisker))
        .attr("y2", yScale(s.upperWhisker))
        .attr("stroke", color)
        .attr("stroke-width", 1);

      [s.lowerWhisker, s.upperWhisker].forEach(function (v) {
        g.append("line")
          .attr("x1", x + boxWidth / 2 - 6)
          .attr("x2", x + boxWidth / 2 + 6)
          .attr("y1", yScale(v))
          .attr("y2", yScale(v))
          .attr("stroke", color)
          .attr("stroke-width", 1);
      });

      g.append("rect")
        .attr("x", x)
        .attr("y", yScale(s.q3))
        .attr("width", boxWidth)
        .attr("height", Math.max(1, yScale(s.q1) - yScale(s.q3)))
        .attr("rx", 3)
        .attr("fill", color)
        .attr("fill-opacity", 0.18)
        .attr("stroke", color)
        .attr("stroke-width", 2)
        .attr("tabindex", 0)
        .style("cursor", "pointer")
        .on("mousemove", function (event) {
          self.tooltip.show(event, GENDER_LABEL[entry.gender], [
            { color: color, value: formatValue(s.median, key), name: "median" },
            { color: null, value: formatValue(s.q1, key) + " - " + formatValue(s.q3, key), name: "interquartile range" },
            { color: null, value: formatCount(s.n), name: "records" }
          ]);
        })
        .on("mouseleave", function () { self.tooltip.hide(); })
        .on("focus", function (event) {
          self.tooltip.show(event, GENDER_LABEL[entry.gender], [
            { color: color, value: formatValue(s.median, key), name: "median" },
            { color: null, value: formatValue(s.q1, key) + " - " + formatValue(s.q3, key), name: "interquartile range" },
            { color: null, value: formatCount(s.n), name: "records" }
          ]);
        })
        .on("blur", function () { self.tooltip.hide(); });

      g.append("line")
        .attr("x1", x)
        .attr("x2", x + boxWidth)
        .attr("y1", yScale(s.median))
        .attr("y2", yScale(s.median))
        .attr("stroke", color)
        .attr("stroke-width", 2)
        .attr("stroke-linecap", "round");

      /* Outliers, capped so the plot stays light; the table carries the count.
         Each gender gets its own group so one gender's outliers never merge
         into the next one's selection. */
      var shown = s.outliers.slice(0, OUTLIER_CAP);
      g.append("g")
        .attr("class", "outliers")
        .selectAll("circle")
        .data(shown)
        .join("circle")
        .attr("cx", x + boxWidth / 2)
        .attr("cy", function (v) { return yScale(v); })
        .attr("r", 1.8)
        .attr("fill", color)
        .attr("fill-opacity", 0.45);

      /* One direct label: the median. */
      g.append("text")
        .attr("class", "mark-label strong")
        .attr("x", x + boxWidth / 2)
        .attr("y", yScale(s.median) - 8)
        .attr("text-anchor", "middle")
        .text(d3.format(".1f")(s.median));
    });

    return stats;
  };

  /* ================================================================ violin */

  /* Gaussian kernel density estimate with Silverman's bandwidth. The
     implementation lives in stats.js so it can be tested in isolation. */
  function kde(values, grid, bandwidth) {
    return core.kde(values, grid, bandwidth);
  }

  function ViolinChart(container, tooltip) {
    this.container = container;
    this.tooltip = tooltip;
    this.width = 560;
    this.height = 300;
    this.margin = { top: 14, right: 18, bottom: 50, left: 56 };
  }

  ViolinChart.prototype.render = function (records, state) {
    var self = this;
    var palette = colors();
    var key = state.focusMeasure;
    var measure = MEASURE_BY_KEY[key];
    var groups = orderedGroups(state);

    var series = groups.map(function (gender) {
      var values = records
        .filter(function (r) { return r.gender === gender && r[key] !== null && r[key] !== undefined; })
        .map(function (r) { return r[key]; })
        .sort(d3.ascending);
      return { gender: gender, values: values };
    }).filter(function (s) { return s.values.length > 1; });

    var svg = d3
      .select(this.container)
      .selectAll("svg")
      .data([null])
      .join("svg")
      .attr("viewBox", "0 0 " + this.width + " " + this.height)
      .attr("width", this.width)
      .attr("height", this.height)
      .attr("role", "img")
      .attr("aria-label", "Violin plot of " + measure.label + " by gender");
    svg.selectAll("*").remove();

    var innerW = this.width - this.margin.left - this.margin.right;
    var innerH = this.height - this.margin.top - this.margin.bottom;
    var g = svg.append("g").attr("transform", "translate(" + this.margin.left + "," + this.margin.top + ")");

    if (series.length === 0) {
      g.append("text")
        .attr("class", "mark-label")
        .attr("x", innerW / 2)
        .attr("y", innerH / 2)
        .attr("text-anchor", "middle")
        .text("No records match the current filters.");
      return [];
    }

    var extent = [Infinity, -Infinity];
    series.forEach(function (s) {
      extent[0] = Math.min(extent[0], s.values[0]);
      extent[1] = Math.max(extent[1], s.values[s.values.length - 1]);
    });

    var yScale = d3.scaleLinear().domain(extent).nice().range([innerH, 0]);
    var xScale = d3.scaleBand().domain(groups).range([0, innerW]).padding(0.4);

    /* A fixed 120-point grid across the observed value range. The step is
       guarded so a degenerate range (every value identical) cannot produce a
       zero step and an infinite loop. 120 points is more than enough to
       describe a violin outline, and it keeps the KDE affordable - the
       estimate is O(values x grid). */
    var span = extent[1] - extent[0];
    var step = span > 0 ? span / 120 : 1;
    var grid = [];
    for (var gi = 0; gi <= 120; gi += 1) {
      grid.push(extent[0] + gi * step);
    }

    g.append("g")
      .attr("class", "grid")
      .selectAll("line")
      .data(yScale.ticks(6))
      .join("line")
      .attr("class", "grid-line")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", function (d) { return yScale(d); })
      .attr("y2", function (d) { return yScale(d); });

    g.append("g")
      .attr("class", "axis axis-x")
      .attr("transform", "translate(0," + innerH + ")")
      .call(d3.axisBottom(xScale).tickSizeOuter(0));

    g.append("g")
      .attr("class", "axis axis-y")
      .call(d3.axisLeft(yScale).ticks(6).tickSizeOuter(0));

    g.append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -innerH / 2)
      .attr("y", -42)
      .attr("text-anchor", "middle")
      .text(measure.label + " (" + measure.unit + ")");

    var halfWidth = Math.min(38, xScale.bandwidth() / 2 - 4);
    var densities = series.map(function (s) {
      return { gender: s.gender, values: s.values, density: kde(s.values, grid) };
    });
    var maxDensity = d3.max(densities, function (d) { return d3.max(d.density, function (p) { return p.y; }); }) || 1;

    densities.forEach(function (d) {
      var color = palette.series[d.gender];
      var centre = xScale(d.gender) + xScale.bandwidth() / 2;

      /* A violin is one closed outline: the density curve, mirrored about the
         centre line. The left half runs up the value axis and the right half
         runs back down, so the pair of curves forms the body. */
      var widthAt = function (density) {
        return (density / maxDensity) * halfWidth;
      };
      var left = d.density.map(function (p) {
        return [centre - widthAt(p.y), yScale(p.x)];
      });
      var right = d.density.slice().reverse().map(function (p) {
        return [centre + widthAt(p.y), yScale(p.x)];
      });
      var outline = left.concat(right);

      g.append("path")
        .datum(outline)
        .attr("d", function (p) {
          return "M" + p.map(function (point) {
            return point[0].toFixed(2) + "," + point[1].toFixed(2);
          }).join("L") + "Z";
        })
        .attr("fill", color)
        .attr("fill-opacity", 0.16)
        .attr("stroke", color)
        .attr("stroke-width", 2)
        .attr("stroke-linejoin", "round")
        .attr("tabindex", 0)
        .style("cursor", "pointer")
        .on("mousemove", function (event) {
          var s = boxStats(d.values);
          self.tooltip.show(event, GENDER_LABEL[d.gender], [
            { color: color, value: formatValue(s.median, key), name: "median" },
            { color: null, value: formatValue(s.q1, key) + " - " + formatValue(s.q3, key), name: "middle 50%" },
            { color: null, value: formatCount(s.n), name: "records" }
          ]);
        })
        .on("mouseleave", function () { self.tooltip.hide(); })
        .on("focus", function (event) {
          var s = boxStats(d.values);
          self.tooltip.show(event, GENDER_LABEL[d.gender], [
            { color: color, value: formatValue(s.median, key), name: "median" },
            { color: null, value: formatValue(s.q1, key) + " - " + formatValue(s.q3, key), name: "middle 50%" },
            { color: null, value: formatCount(s.n), name: "records" }
          ]);
        })
        .on("blur", function () { self.tooltip.hide(); });

      /* Centre line + median tick. */
      g.append("line")
        .attr("x1", centre)
        .attr("x2", centre)
        .attr("y1", yScale(extent[0]))
        .attr("y2", yScale(extent[1]))
        .attr("stroke", color)
        .attr("stroke-width", 1)
        .attr("stroke-opacity", 0.5);

      var median = core.quantile(d.values, 0.5);
      g.append("line")
        .attr("x1", centre - 5)
        .attr("x2", centre + 5)
        .attr("y1", yScale(median))
        .attr("y2", yScale(median))
        .attr("stroke", color)
        .attr("stroke-width", 2)
        .attr("stroke-linecap", "round");
    });

    return densities.map(function (d) {
      var s = boxStats(d.values);
      return {
        gender: d.gender,
        n: s.n,
        min: s.min,
        q1: s.q1,
        median: s.median,
        q3: s.q3,
        max: s.max,
        mean: s.mean,
        sd: s.sd
      };
    });
  };

  /* ============================================================== missing */

  function MissingChart(container, tooltip) {
    this.container = container;
    this.tooltip = tooltip;
    this.width = 1100;
    this.rowHeight = 22;
    this.margin = { top: 8, right: 90, bottom: 34, left: 150 };
  }

  MissingChart.prototype.render = function (records) {
    var self = this;
    var palette = colors();
    var columns = DATA.metadata.numeric_features;

    var rows = columns.map(function (column) {
      var missing = records.filter(function (r) { return r[column] === null || r[column] === undefined; }).length;
      return {
        column: column,
        label: DATA.metadata.labels[column] || column,
        missing: missing,
        share: records.length ? missing / records.length : 0
      };
    }).filter(function (r) { return r.missing > 0; })
      .sort(function (a, b) { return b.missing - a.missing || (a.column < b.column ? -1 : 1); });

    var height = this.margin.top + this.margin.bottom + Math.max(1, rows.length) * this.rowHeight;

    var svg = d3
      .select(this.container)
      .selectAll("svg")
      .data([null])
      .join("svg")
      .attr("viewBox", "0 0 " + this.width + " " + height)
      .attr("width", this.width)
      .attr("height", height)
      .attr("role", "img")
      .attr("aria-label", "Bar chart of missing values per measurement column");
    svg.selectAll("*").remove();

    var innerW = this.width - this.margin.left - this.margin.right;
    var innerH = height - this.margin.top - this.margin.bottom;
    var g = svg.append("g").attr("transform", "translate(" + this.margin.left + "," + this.margin.top + ")");

    if (rows.length === 0) {
      g.append("text")
        .attr("class", "mark-label")
        .attr("x", 0)
        .attr("y", 16)
        .text("No missing values in the current slice.");
      return rows;
    }

    var xScale = d3.scaleLinear()
      .domain([0, d3.max(rows, function (r) { return r.missing; })])
      .nice()
      .range([0, innerW]);
    var yScale = d3.scaleBand().domain(rows.map(function (r) { return r.column; })).range([0, innerH]).padding(0.28);

    g.append("g")
      .attr("class", "grid")
      .selectAll("line")
      .data(xScale.ticks(6))
      .join("line")
      .attr("class", "grid-line")
      .attr("x1", function (d) { return xScale(d); })
      .attr("x2", function (d) { return xScale(d); })
      .attr("y1", 0)
      .attr("y2", innerH);

    g.append("g")
      .attr("class", "axis axis-x")
      .attr("transform", "translate(0," + innerH + ")")
      .call(d3.axisBottom(xScale).ticks(6).tickSizeOuter(0));

    g.append("g")
      .attr("class", "axis axis-y")
      .call(d3.axisLeft(yScale).tickSizeOuter(0));

    g.append("text")
      .attr("class", "axis-label")
      .attr("x", innerW / 2)
      .attr("y", innerH + 26)
      .attr("text-anchor", "middle")
      .text("Records with a missing value");

    var barHeight = Math.min(14, yScale.bandwidth());

    rows.forEach(function (row) {
      var y = yScale(row.column) + (yScale.bandwidth() - barHeight) / 2;
      var w = xScale(row.missing);
      g.append("path")
        .attr("d", roundedRightPath(0, y, w, barHeight, 4))
        .attr("fill", palette.quality)
        .attr("tabindex", 0)
        .style("cursor", "pointer")
        .on("mousemove", function (event) {
          self.tooltip.show(event, row.label, [
            { color: palette.quality, value: formatCount(row.missing), name: "missing" },
            { color: null, value: d3.format(".1%")(row.share), name: "of the current slice" }
          ]);
        })
        .on("mouseleave", function () { self.tooltip.hide(); })
        .on("focus", function (event) {
          self.tooltip.show(event, row.label, [
            { color: palette.quality, value: formatCount(row.missing), name: "missing" },
            { color: null, value: d3.format(".1%")(row.share), name: "of the current slice" }
          ]);
        })
        .on("blur", function () { self.tooltip.hide(); });

      /* Value at the tip - the one direct label per bar. */
      g.append("text")
        .attr("class", "mark-label strong")
        .attr("x", w + 8)
        .attr("y", y + barHeight / 2 + 4)
        .text(formatCount(row.missing));
    });

    return rows;
  };

  /* =================================================================== app */

  function App() {
    this.records = DATA.records;
    this.tooltip = new Tooltip(document.getElementById("tooltip"));
    this.state = {
      gender: "all",
      ageMin: 17,
      ageMax: 58,
      focusMeasure: "bmi",
      scatterX: "height_cm",
      scatterY: "weight_kg",
      matrixMetric: "correlation"
    };
    this.scatter = new ScatterChart(document.getElementById("chart-scatter"), this.tooltip);
    this.population = new PopulationChart(document.getElementById("chart-population"), this.tooltip);
    this.matrix = new MatrixChart(document.getElementById("chart-matrix"), this.tooltip);
    this.box = new BoxChart(document.getElementById("chart-box"), this.tooltip);
    this.violin = new ViolinChart(document.getElementById("chart-violin"), this.tooltip);
    this.missing = new MissingChart(document.getElementById("chart-missing"), this.tooltip);
  }

  App.prototype.filtered = function () {
    var state = this.state;
    return this.records.filter(function (r) {
      if (state.gender !== "all" && r.gender !== state.gender) return false;
      if (r.age === null) return false;
      return r.age >= state.ageMin && r.age <= state.ageMax;
    });
  };

  App.prototype.renderTiles = function (records) {
    var palette = colors();
    var row = document.getElementById("kpi-row");
    row.textContent = "";

    function tile(label, value, note) {
      var card = document.createElement("div");
      card.className = "stat-tile";
      var l = document.createElement("div");
      l.className = "label";
      l.textContent = label;
      var v = document.createElement("div");
      v.className = "value";
      v.textContent = value;
      card.appendChild(l);
      card.appendChild(v);
      if (note) {
        var d = document.createElement("div");
        d.className = "delta";
        d.textContent = note;
        card.appendChild(d);
      }
      return card;
    }

    var ages = records.map(function (r) { return r.age; }).filter(function (v) { return v !== null; });
    var heights = records.map(function (r) { return r.height_cm; }).filter(function (v) { return v !== null; });
    var weights = records.map(function (r) { return r.weight_kg; }).filter(function (v) { return v !== null; });
    var bmis = records.map(function (r) { return r.bmi; }).filter(function (v) { return v !== null; });

    /* Medians come from the shared core, so the tiles, the box plot and the
       table all use one definition of a quantile. */
    function median(values) {
      return values.length ? core.quantile(values, 0.5) : null;
    }

    row.appendChild(tile(
      "Median age",
      ages.length ? d3.format(".1f")(median(ages)) + " years" : "-",
      "n = " + formatCount(ages.length)
    ));
    row.appendChild(tile(
      "Median height",
      heights.length ? d3.format(".1f")(median(heights)) + " cm" : "-",
      "n = " + formatCount(heights.length)
    ));
    row.appendChild(tile(
      "Median weight",
      weights.length ? d3.format(".1f")(median(weights)) + " kg" : "-",
      "n = " + formatCount(weights.length)
    ));
    row.appendChild(tile(
      "Median BMI",
      bmis.length ? d3.format(".1f")(median(bmis)) : "-",
      "n = " + formatCount(bmis.length)
    ));

    /* Gender split - identity swatches beside the numbers, never coloured
       text. Both genders are always listed, so a filtered view still shows
       what the other group contributes rather than silently dropping it. */
    var counts = { F: 0, M: 0 };
    records.forEach(function (r) { if (counts[r.gender] !== undefined) counts[r.gender] += 1; });
    var split = tile(
      "Gender split",
      formatCount(counts.F + counts.M),
      "in the current slice"
    );
    var swatches = document.createElement("div");
    swatches.className = "swatches";
    GENDERS.forEach(function (gender) {
      var line = document.createElement("div");
      line.className = "swatch-row";
      var swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = palette.series[gender];
      line.appendChild(swatch);
      var name = document.createElement("span");
      name.textContent = GENDER_LABEL[gender] + ": " + formatCount(counts[gender]);
      line.appendChild(name);
      swatches.appendChild(line);
    });
    split.appendChild(swatches);
    row.appendChild(split);

    var complete = records.filter(function (r) {
      return DATA.metadata.numeric_features.every(function (c) { return r[c] !== null && r[c] !== undefined; });
    }).length;
    row.appendChild(tile(
      "Complete records",
      records.length ? d3.format(".1%")(complete / records.length) : "-",
      formatCount(complete) + " of " + formatCount(records.length) + " have every measurement"
    ));
  };

  App.prototype.renderTables = function (records, scatterResult, bands, matrixResult, boxStatsList, violinStats, missingRows) {
    var self = this;

    function buildTable(container, caption, columns, rows) {
      container.textContent = "";
      var table = document.createElement("table");
      var cap = document.createElement("caption");
      cap.textContent = caption;
      table.appendChild(cap);
      var thead = document.createElement("thead");
      var headRow = document.createElement("tr");
      columns.forEach(function (column) {
        var th = document.createElement("th");
        th.scope = "col";
        th.textContent = column;
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);
      var tbody = document.createElement("tbody");
      rows.forEach(function (row) {
        var tr = document.createElement("tr");
        row.forEach(function (cell, index) {
          var td = document.createElement("td");
          if (index === 0) td.scope = "row";
          td.textContent = cell;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      container.appendChild(table);
    }

    /* Scatter - the summary statistics, not six thousand rows. */
    var scatterRows = [];
    if (scatterResult) {
      scatterResult.summary.forEach(function (entry) {
        scatterRows.push([
          GENDER_LABEL[entry.gender],
          formatCount(entry.n),
          formatValue(entry.meanX, self.state.scatterX),
          formatValue(entry.meanY, self.state.scatterY),
          entry.r === null ? "-" : d3.format(".3f")(entry.r)
        ]);
      });
    }
    buildTable(
      document.getElementById("table-scatter"),
      "Group summary for the scatter (r = Pearson correlation of the two axes)",
      ["Gender", "Records", "Mean " + MEASURE_BY_KEY[self.state.scatterX].label,
       "Mean " + MEASURE_BY_KEY[self.state.scatterY].label, "Correlation r"],
      scatterRows
    );

    buildTable(
      document.getElementById("table-population"),
      "Respondents by age band and gender",
      ["Age band", "F", "M", "Total", "Mean age"],
      bands.map(function (band) {
        return [
          band.label,
          formatCount(band.counts.F),
          formatCount(band.counts.M),
          formatCount(band.total),
          band.meanAge === null ? "-" : d3.format(".1f")(band.meanAge)
        ];
      })
    );

    /* Matrix - every pair, with the n behind each one. The column header
       follows the metric on screen, so the table always matches the chart. */
    var matrixFeatures = matrixResult ? matrixResult.features : [];
    var isCovariance = self.state.matrixMetric === "covariance";
    var matrixRows = [];
    matrixFeatures.forEach(function (featureA, i) {
      matrixFeatures.forEach(function (featureB, j) {
        if (j < i) return;
        var value = matrixResult ? matrixResult.values[i][j] : null;
        var n = matrixResult ? matrixResult.counts[i][j] : 0;
        matrixRows.push([
          SHORT_LABELS[featureA],
          SHORT_LABELS[featureB],
          value === null ? "-" : (isCovariance ? formatSigned(value) : d3.format(".4f")(value)),
          formatCount(n)
        ]);
      });
    });
    buildTable(
      document.getElementById("table-matrix"),
      isCovariance
        ? "Covariance values with the number of paired records"
        : "Correlation values with the number of paired records",
      ["Feature A", "Feature B", isCovariance ? "Covariance" : "Correlation r", "Paired records"],
      matrixRows
    );

    buildTable(
      document.getElementById("table-box"),
      "Box plot statistics for " + MEASURE_BY_KEY[self.state.focusMeasure].label,
      ["Gender", "Records", "Min", "Q1", "Median", "Q3", "Max", "Mean", "SD", "Outliers"],
      boxStatsList.filter(function (e) { return e.stats; }).map(function (e) {
        var s = e.stats;
        return [
          GENDER_LABEL[e.gender], formatCount(s.n),
          d3.format(".2f")(s.min), d3.format(".2f")(s.q1), d3.format(".2f")(s.median),
          d3.format(".2f")(s.q3), d3.format(".2f")(s.max), d3.format(".2f")(s.mean),
          d3.format(".2f")(s.sd), formatCount(s.outliers.length)
        ];
      })
    );

    buildTable(
      document.getElementById("table-violin"),
      "Violin plot statistics for " + MEASURE_BY_KEY[self.state.focusMeasure].label,
      ["Gender", "Records", "Min", "Q1", "Median", "Q3", "Max", "Mean", "SD"],
      violinStats.map(function (s) {
        return [
          GENDER_LABEL[s.gender], formatCount(s.n),
          d3.format(".2f")(s.min), d3.format(".2f")(s.q1), d3.format(".2f")(s.median),
          d3.format(".2f")(s.q3), d3.format(".2f")(s.max), d3.format(".2f")(s.mean),
          d3.format(".2f")(s.sd)
        ];
      })
    );

    /* Summary table - every analysed feature, with its completeness. */
    var summaryRows = [];
    var analysed = STATS.metadata.matrix_features;
    analysed.forEach(function (feature) {
      var values = records.map(function (r) { return r[feature]; })
        .filter(function (v) { return v !== null && v !== undefined; })
        .sort(d3.ascending);
      var missing = records.length - values.length;
      if (!values.length) {
        summaryRows.push([DATA.metadata.labels[feature] || feature, "0", "-", "-", "-", "-", "-", "-", formatCount(missing)]);
        return;
      }
      summaryRows.push([
        DATA.metadata.labels[feature] || feature,
        formatCount(values.length),
        d3.format(".2f")(core.quantile(values, 0.25)),
        d3.format(".2f")(core.quantile(values, 0.5)),
        d3.format(".2f")(core.quantile(values, 0.75)),
        d3.format(".2f")(values[0]),
        d3.format(".2f")(values[values.length - 1]),
        d3.format(".2f")(core.mean(values)),
        formatCount(missing)
      ]);
    });
    buildTable(
      document.getElementById("table-summary"),
      "Descriptive statistics for the current slice",
      ["Feature", "n", "Q1", "Median", "Q3", "Min", "Max", "Mean", "Missing"],
      summaryRows
    );

    return missingRows;
  };

  App.prototype.render = function () {
    var records = this.filtered();
    var palette = colors();
    var state = this.state;

    document.getElementById("hero-value").textContent = formatCount(records.length);
    document.getElementById("hero-label").textContent =
      records.length === this.records.length
        ? "respondents in the survey"
        : "respondents in the current slice";
    document.getElementById("hero-sub").textContent =
      "of " + formatCount(this.records.length) + " in data/ansur-full.csv";

    this.renderTiles(records);

    var groups = orderedGroups(state);
    renderLegend(document.getElementById("scatter-legend"), groups.map(function (gender) {
      return { color: palette.series[gender], label: GENDER_LABEL[gender] };
    }));
    renderLegend(document.getElementById("population-legend"), groups.map(function (gender) {
      return { color: palette.series[gender], label: GENDER_LABEL[gender] };
    }));
    renderLegend(document.getElementById("box-legend"), groups.map(function (gender) {
      return { color: palette.series[gender], label: GENDER_LABEL[gender] };
    }));
    renderLegend(document.getElementById("violin-legend"), groups.map(function (gender) {
      return { color: palette.series[gender], label: GENDER_LABEL[gender] };
    }));

    document.getElementById("scatter-subtitle").textContent =
      MEASURE_BY_KEY[state.scatterX].label + " against " + MEASURE_BY_KEY[state.scatterY].label +
      ", with a least-squares line per gender. Every point is one respondent.";
    document.getElementById("box-subtitle").textContent =
      MEASURE_BY_KEY[state.focusMeasure].label + " (" + MEASURE_BY_KEY[state.focusMeasure].unit +
      ") for each gender. The box holds the middle 50%, the line marks the median.";
    document.getElementById("violin-subtitle").textContent =
      "Kernel density of " + MEASURE_BY_KEY[state.focusMeasure].label +
      ", one violin per gender. The width shows where values concentrate.";

    var scatterResult = this.scatter.render(records, state);
    var bands = this.population.render(records, state);
    var matrixResult = this.matrix.render(records, state);
    var boxStatsList = this.box.render(records, state);
    var violinStats = this.violin.render(records, state);
    var missingRows = this.missing.render(records);

    /* Matrix scale legend - a diverging ramp with its neutral midpoint.
       The ramp is built from the same divergingColor the cells use, so the
       legend and the marks always agree. */
    var legendHost = document.getElementById("matrix-scale-legend");
    legendHost.textContent = "";
    var ramp = document.createElement("span");
    ramp.className = "ramp";
    var rampColor = divergingColor(palette);
    var stops = [-1, -0.5, 0, 0.5, 1].map(function (t) {
      return rampColor(t) + " " + ((t + 1) * 50) + "%";
    });
    ramp.style.background = "linear-gradient(to right, " + stops.join(", ") + ")";
    legendHost.appendChild(ramp);
    var caption = document.createElement("span");
    var maxAbs = d3.max(matrixResult.finite, function (v) { return Math.abs(v); }) || 1;
    if (state.matrixMetric === "covariance") {
      caption.textContent =
        "covariance −" + d3.format(".2e")(maxAbs) + " to +" + d3.format(".2e")(maxAbs) +
        " (colour uses a symmetric-log scale; values depend on the units of each column)";
    } else {
      caption.textContent =
        "correlation −" + d3.format(".2f")(maxAbs) + " to +" + d3.format(".2f")(maxAbs) +
        " (grey is zero; blue positive, red negative)";
    }
    legendHost.appendChild(caption);

    document.getElementById("matrix-title").textContent =
      state.matrixMetric === "covariance" ? "Covariance matrix" : "Correlation matrix";
    document.getElementById("matrix-subtitle").textContent =
      state.matrixMetric === "covariance"
        ? "Raw covariance across the 17 source measurements, computed on the current slice with pairwise-complete pairs. Covariance depends on each column's units, so compare the correlation view for strength."
        : "Pearson correlation across the 17 source measurements, computed on the current slice with pairwise-complete pairs. Only relationships of |r| ≥ 0.5 are labelled.";

    document.getElementById("summary-subtitle").textContent =
      "How much of each measurement is missing in the current slice. Nothing is imputed, " +
      "so every statistic elsewhere on the page is computed from the values that exist.";

    this.renderTables(records, scatterResult, bands, matrixResult, boxStatsList, violinStats, missingRows);
  };

  App.prototype.bind = function () {
    var self = this;

    var genderSelect = document.getElementById("filter-gender");
    var ageMin = document.getElementById("filter-age-min");
    var ageMax = document.getElementById("filter-age-max");
    var focusSelect = document.getElementById("focus-measure");
    var scatterX = document.getElementById("scatter-x");
    var scatterY = document.getElementById("scatter-y");

    function fillMeasureSelect(select, selected) {
      MEASURES.forEach(function (measure) {
        var option = document.createElement("option");
        option.value = measure.key;
        option.textContent = measure.label + " (" + measure.unit + ")";
        if (measure.key === selected) option.selected = true;
        select.appendChild(option);
      });
    }
    fillMeasureSelect(focusSelect, this.state.focusMeasure);
    fillMeasureSelect(scatterX, this.state.scatterX);
    fillMeasureSelect(scatterY, this.state.scatterY);

    genderSelect.addEventListener("change", function () {
      self.state.gender = genderSelect.value;
      self.render();
    });
    ageMin.addEventListener("change", function () {
      self.state.ageMin = Math.max(0, Number(ageMin.value) || 0);
      self.render();
    });
    ageMax.addEventListener("change", function () {
      self.state.ageMax = Number(ageMax.value) || 999;
      self.render();
    });
    focusSelect.addEventListener("change", function () {
      self.state.focusMeasure = focusSelect.value;
      self.render();
    });
    scatterX.addEventListener("change", function () {
      self.state.scatterX = scatterX.value;
      self.render();
    });
    scatterY.addEventListener("change", function () {
      self.state.scatterY = scatterY.value;
      self.render();
    });

    document.getElementById("reset-filters").addEventListener("click", function () {
      self.state.gender = "all";
      self.state.ageMin = 17;
      self.state.ageMax = 58;
      self.state.focusMeasure = "bmi";
      self.state.scatterX = "height_cm";
      self.state.scatterY = "weight_kg";
      genderSelect.value = "all";
      ageMin.value = 17;
      ageMax.value = 58;
      focusSelect.value = "bmi";
      scatterX.value = "height_cm";
      scatterY.value = "weight_kg";
      self.render();
    });

    d3.selectAll("[data-matrix]").on("click", function (event) {
      self.state.matrixMetric = event.currentTarget.getAttribute("data-matrix");
      d3.selectAll("[data-matrix]").attr("aria-pressed", function () {
        return this.getAttribute("data-matrix") === self.state.matrixMetric ? "true" : "false";
      });
      self.render();
    });

    /* Table twins: every chart has one, so no value is hover-gated. */
    d3.selectAll("[data-table]").on("click", function (event) {
      var target = document.getElementById(event.currentTarget.getAttribute("data-table"));
      var open = target.hasAttribute("hidden");
      if (open) {
        target.removeAttribute("hidden");
      } else {
        target.setAttribute("hidden", "");
      }
      event.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
      event.currentTarget.textContent = open ? "Hide table" : "Show table";
    });

    var themeButton = document.getElementById("theme-toggle");
    themeButton.addEventListener("click", function () {
      var next = currentMode() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      themeButton.textContent = next === "dark" ? "Light mode" : "Dark mode";
      themeButton.setAttribute("aria-pressed", next === "dark" ? "true" : "false");
      self.render();
    });

    /* SVG export: the live charts serialised into one standalone file. */
    var exportButton = document.getElementById("export-svg");
    exportButton.addEventListener("click", function () {
      downloadSvg();
    });

    /* Re-render when the OS theme changes while the page is open. */
    if (window.matchMedia) {
      var query = window.matchMedia("(prefers-color-scheme: dark)");
      var listener = function () {
        if (!document.documentElement.hasAttribute("data-theme")) self.render();
      };
      if (query.addEventListener) query.addEventListener("change", listener);
      else if (query.addListener) query.addListener(listener);
    }
  };

  /* --------------------------------------------------------- SVG export */

  /* Serialise the live chart SVGs into one standalone SVG document.
     The output is deterministic: the charts are already rendered, and the
     markup is taken verbatim, so the same data and filter state always
     produce the same file. */
  var EXPORT_CHARTS = [
    { id: "chart-scatter", card: "card-scatter", title: "Height against weight" },
    { id: "chart-population", card: "card-population", title: "Respondents by age band" },
    { id: "chart-matrix", card: "card-matrix", title: "Correlation matrix" },
    { id: "chart-box", card: "card-box", title: "Distribution by gender" },
    { id: "chart-violin", card: "card-violin", title: "Shape of the distribution" },
    { id: "chart-missing", card: "card-summary", title: "Missing values by measurement" }
  ];

  /* Serialise one SVG element to markup. XMLSerializer keeps the SVG
     namespace correct, which innerHTML does not guarantee in every browser;
     the innerHTML path is the fallback for older engines. */
  function serializeSvg(svg) {
    if (typeof XMLSerializer !== "undefined") {
      return new XMLSerializer().serializeToString(svg);
    }
    return svg.innerHTML;
  }

  function buildExportSvg() {
    var palette = colors();
    var parts = [];
    var width = 0;
    var height = 0;

    EXPORT_CHARTS.forEach(function (entry) {
      var host = document.getElementById(entry.id);
      if (!host) return;
      var svg = host.querySelector("svg");
      if (!svg) return;
      /* The card's heading names the chart in the export, so the file reads
         the same way the page does. */
      var card = document.getElementById(entry.card);
      var heading = card ? card.querySelector("h2") : null;
      var title = heading ? heading.textContent : entry.title;
      var viewBox = svg.getAttribute("viewBox");
      if (!viewBox) return;
      var box = viewBox.split(/\s+/).map(Number);
      var chartWidth = box[2];
      var chartHeight = box[3];
      width = Math.max(width, chartWidth);
      height += chartHeight + 28;

      parts.push(
        '<g transform="translate(0,' + (height - chartHeight - 28) + ')">' +
        '<text x="0" y="14" font-family="system-ui, -apple-system, Segoe UI, sans-serif" ' +
        'font-size="13" font-weight="600" fill="' + palette.ink + '">' +
        title + "</text>" +
        serializeSvg(svg) +
        "</g>"
      );
    });

    /* The page styles the chart chrome with CSS custom properties, which do
       not resolve in a standalone file. Inline the resolved values so the
       exported SVG is self-contained and renders identically on its own. */
    var style =
      "<style>" +
      ".axis text{fill:" + palette.muted + ";font-size:11px;font-variant-numeric:tabular-nums}" +
      ".axis .domain{stroke:" + palette.axis + ";fill:none}" +
      ".axis line{stroke:" + palette.axis + "}" +
      ".grid-line{stroke:" + palette.grid + ";stroke-width:1}" +
      ".axis-label{fill:" + palette.inkSecondary + ";font-size:12px}" +
      ".mark-label{fill:" + palette.inkSecondary + ";font-size:11px}" +
      ".mark-label.strong{fill:" + palette.ink + ";font-weight:600}" +
      ".cell-label{font-size:10px;font-variant-numeric:tabular-nums}" +
      "text{font-family:system-ui,-apple-system,'Segoe UI',sans-serif}" +
      "</style>";

    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
      '" viewBox="0 0 ' + width + " " + height + '">' +
      style +
      '<rect width="' + width + '" height="' + height + '" fill="' + palette.surface + '"/>' +
      parts.join("") +
      "</svg>"
    );
  }

  function downloadSvg() {
    var markup = buildExportSvg();
    var blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "ansur-dashboard.svg";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /* ------------------------------------------------------------------ boot */

  function boot() {
    var app = new App();
    app.bind();
    app.render();
    window.ANSUR_APP = app;
    /* Exposed so the build harness can produce the same static SVG the
       Download SVG button downloads. */
    window.ANSUR_BUILD_EXPORT_SVG = buildExportSvg;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
