/* ==========================================================================
   Headless render harness.

   Loads dist/chart.html into the self-contained minidom, runs the real
   dist/chart.js against it, and writes a static SVG export of every chart.

   This exercises the production rendering code path - the same file the
   browser loads - so it catches runtime errors, missing element ids and
   layout mistakes. It is not a browser: there is no CSS cascade or paint,
   so colours come from the explicit fill attributes chart.js sets.

   Usage: node tools/render.js
   ========================================================================== */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { parseHTML, DomEvent } = require("./minidom");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

function readFile(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

/* Load a classic script into the sandbox, in order. */
function runScript(context, relative) {
  const code = readFile(relative);
  vm.runInContext(code, context, { filename: relative });
}

function createContext(html) {
  const document = parseHTML(html);
  const sandbox = {
    console,
    Math,
    Date,
    JSON,
    Number,
    String,
    Array,
    Object,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
    Error,
    TypeError,
    RangeError,
    document,
    navigator: { userAgent: "minidom" },
    location: { href: "file:///" + path.relative(ROOT, DIST + "/chart.html") },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  sandbox.matchMedia = (query) => ({
    media: query,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  });

  sandbox.getComputedStyle = () => ({ getPropertyValue: () => "" });

  /* The tooltip positions itself from pageX/pageY and the window size. */
  sandbox.pageXOffset = 0;
  sandbox.pageYOffset = 0;
  sandbox.innerWidth = 1400;
  sandbox.innerHeight = 2000;
  Object.defineProperty(sandbox, "innerWidth", { value: 1400, writable: true });

  sandbox.Element = function () {};
  sandbox.Node = function () {};

  const context = vm.createContext(sandbox);

  /* d3 and the data payloads are plain scripts; run them in order. */
  runScript(context, "dist/vendor/d3.v7.9.0.min.js");
  runScript(context, "dist/ansur-data.js");
  runScript(context, "dist/ansur-stats.js");
  runScript(context, "dist/stats.js");
  runScript(context, "dist/chart.js");

  return { context, document, sandbox };
}

function collectSvgs(document) {
  const ids = ["chart-scatter", "chart-population", "chart-matrix",
               "chart-box", "chart-violin", "chart-missing"];
  const out = [];
  ids.forEach((id) => {
    const host = document.getElementById(id);
    if (!host) {
      out.push({ id, error: "missing host element" });
      return;
    }
    const svg = host.querySelector("svg");
    if (!svg) {
      out.push({ id, error: "no svg rendered" });
      return;
    }
    out.push({
      id,
      svg,
      viewBox: svg.getAttribute("viewBox"),
      width: Number(svg.getAttribute("width")),
      height: Number(svg.getAttribute("height")),
      markCount: svg.querySelectorAll("circle, rect, path, line, text").length
    });
  });
  return out;
}

function main() {
  const html = readFile("dist/chart.html");
  const { context, document, sandbox } = createContext(html);

  const app = sandbox.ANSUR_APP;
  if (!app) {
    console.error("FAIL: chart.js did not expose ANSUR_APP - boot() likely threw.");
    process.exit(1);
  }

  const report = { charts: [], interactions: [], errors: [] };

  /* --- every chart rendered? ------------------------------------------- */
  collectSvgs(document).forEach((entry) => {
    if (entry.error) {
      report.errors.push(entry.id + ": " + entry.error);
      return;
    }
    report.charts.push({
      id: entry.id,
      viewBox: entry.viewBox,
      size: entry.width + "x" + entry.height,
      marks: entry.markCount
    });
    if (entry.markCount === 0) {
      report.errors.push(entry.id + ": rendered zero marks");
    }
  });

  /* --- interaction: does filtering re-render correctly? ----------------- */
  function check(label, fn) {
    try {
      const detail = fn();
      report.interactions.push({ label, ok: true, detail: detail || "" });
    } catch (error) {
      report.interactions.push({ label, ok: false, detail: error.message });
      report.errors.push(label + ": " + error.message);
    }
  }

  const genderSelect = document.getElementById("filter-gender");
  const ageMin = document.getElementById("filter-age-min");
  const ageMax = document.getElementById("filter-age-max");
  const focusSelect = document.getElementById("focus-measure");
  const scatterX = document.getElementById("scatter-x");
  const scatterY = document.getElementById("scatter-y");

  function fire(element, type) {
    element.dispatchEvent(new DomEvent(type, { type: type }));
  }

  function heroCount() {
    return Number(document.getElementById("hero-value").textContent.replace(/[^0-9]/g, ""));
  }

  const totalCount = heroCount();

  check("filter to F only", () => {
    genderSelect.value = "F";
    fire(genderSelect, "change");
    const n = heroCount();
    if (n >= totalCount) throw new Error("expected fewer than " + totalCount + ", got " + n);
    const legend = document.getElementById("scatter-legend");
    if (legend.querySelectorAll("li").length !== 1) {
      throw new Error("expected 1 legend entry, got " + legend.querySelectorAll("li").length);
    }
    return "hero " + n + " records, legend filtered to 1 entry";
  });

  check("filter to M only", () => {
    genderSelect.value = "M";
    fire(genderSelect, "change");
    const n = heroCount();
    if (n >= totalCount) throw new Error("expected fewer than " + totalCount + ", got " + n);
    return "hero " + n + " records";
  });

  check("age range 30-40", () => {
    genderSelect.value = "all";
    fire(genderSelect, "change");
    ageMin.value = "30";
    ageMax.value = "40";
    fire(ageMin, "change");
    fire(ageMax, "change");
    const n = heroCount();
    if (n >= totalCount) throw new Error("expected fewer records, got " + n);
    return "hero " + n + " records";
  });

  check("impossible age range renders without throwing", () => {
    ageMin.value = "900";
    ageMax.value = "901";
    fire(ageMin, "change");
    fire(ageMax, "change");
    const n = heroCount();
    return "hero " + n + " records (empty slice handled)";
  });

  check("reset restores the full slice", () => {
    document.getElementById("reset-filters").dispatchEvent(new DomEvent("click", { type: "click" }));
    const n = heroCount();
    if (n !== totalCount) throw new Error("expected " + totalCount + ", got " + n);
    return "hero " + n + " records";
  });

  check("focus measure switch", () => {
    focusSelect.value = "age";
    fire(focusSelect, "change");
    return "focus measure = " + focusSelect.value;
  });

  check("scatter axis switch", () => {
    scatterX.value = "bmi";
    scatterY.value = "head.circumference";
    fire(scatterX, "change");
    fire(scatterY, "change");
    return "x=" + scatterX.value + " y=" + scatterY.value;
  });

  check("matrix metric toggle", () => {
    const buttons = document.querySelectorAll("[data-matrix]");
    const covariance = buttons.filter((b) => b.getAttribute("data-matrix") === "covariance")[0];
    covariance.dispatchEvent(new DomEvent("click", { type: "click" }));
    const title = document.getElementById("matrix-title").textContent;
    if (title.indexOf("Covariance") < 0) throw new Error("title did not switch: " + title);
    const correlation = buttons.filter((b) => b.getAttribute("data-matrix") === "correlation")[0];
    correlation.dispatchEvent(new DomEvent("click", { type: "click" }));
    return "toggled to covariance and back";
  });

  check("table twins open", () => {
    const toggles = document.querySelectorAll("[data-table]");
    toggles.forEach((toggle) => {
      toggle.dispatchEvent(new DomEvent("click", { type: "click" }));
    });
    const open = toggles.filter((t) => {
      const panel = document.getElementById(t.getAttribute("data-table"));
      return panel && !panel.hasAttribute("hidden") && panel.querySelector("table");
    }).length;
    if (open !== toggles.length) {
      throw new Error("only " + open + " of " + toggles.length + " tables opened");
    }
    return open + " tables opened with a <table> each";
  });

  check("theme toggle re-renders", () => {
    document.getElementById("theme-toggle").dispatchEvent(new DomEvent("click", { type: "click" }));
    const theme = document.documentElement.getAttribute("data-theme");
    if (theme !== "dark") throw new Error("expected data-theme=dark, got " + theme);
    const marks = document.getElementById("chart-scatter").querySelectorAll("circle").length;
    if (marks === 0) throw new Error("scatter lost its marks after the theme switch");
    document.getElementById("theme-toggle").dispatchEvent(new DomEvent("click", { type: "click" }));
    return "dark mode rendered " + marks + " scatter points";
  });

  check("tooltip on a scatter point", () => {
    const circle = document.getElementById("chart-scatter").querySelectorAll("circle")[0];
    if (!circle) throw new Error("no scatter circles");
    circle.dispatchEvent(new DomEvent("mousemove", { type: "mousemove", pageX: 100, pageY: 100 }));
    return "tooltip path exercised";
  });

  /* --- write the static export ----------------------------------------- */
  /* The export is produced by the same function the Download SVG button
     calls, so the file and the browser download cannot drift apart. */
  const buildExport = sandbox.ANSUR_BUILD_EXPORT_SVG;
  if (typeof buildExport !== "function") {
    console.error("FAIL: chart.js did not expose ANSUR_BUILD_EXPORT_SVG");
    process.exit(1);
  }
  const exportSvg = buildExport();
  fs.writeFileSync(path.join(DIST, "chart.svg"), exportSvg, "utf8");

  /* The export must be well-formed enough to parse back and must contain
     every chart. */
  const reparsed = parseHTML(exportSvg);
  const exportSvgs = reparsed.querySelectorAll("svg");
  if (exportSvgs.length === 0) {
    console.error("FAIL: the exported SVG does not parse back as an SVG");
    process.exit(1);
  }
  const exportPaths = reparsed.querySelectorAll("path, rect, circle, line, text");
  if (exportPaths.length < 100) {
    console.error("FAIL: the exported SVG has only " + exportPaths.length + " marks");
    process.exit(1);
  }
  report.charts.push({
    id: "chart.svg (export)",
    viewBox: exportSvgs[0].getAttribute("viewBox"),
    size: exportSvgs[0].getAttribute("width") + "x" + exportSvgs[0].getAttribute("height"),
    marks: exportPaths.length
  });

  /* --- report ----------------------------------------------------------- */
  console.log("charts rendered:");
  report.charts.forEach((chart) => {
    console.log("  " + chart.id.padEnd(18) + chart.size.padEnd(12) + chart.marks + " marks");
  });
  console.log("\ninteractions:");
  report.interactions.forEach((item) => {
    console.log("  [" + (item.ok ? "PASS" : "FAIL") + "] " + item.label +
      (item.detail ? " - " + item.detail : ""));
  });
  console.log("\nwrote dist/chart.svg (" + exportSvg.length + " bytes)");

  if (report.errors.length) {
    console.error("\nERRORS:");
    report.errors.forEach((error) => console.error("  - " + error));
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main();
