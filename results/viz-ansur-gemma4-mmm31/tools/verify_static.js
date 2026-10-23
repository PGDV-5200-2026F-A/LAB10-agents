/* ==========================================================================
   Static verification of the dashboard.

   Checks the contracts between the three files that make up the dashboard
   without executing the vendored d3 bundle:

     - every getElementById(...) in chart.js exists in chart.html
     - every data-table="..." target in chart.html exists
     - every data-matrix="..." button in chart.html has a handler path
     - every measure key chart.js offers is present in the data payload
     - every feature name the matrix uses has a short label
     - the HTML references only files that exist in dist/
     - no Math.random / Date.now / transition / animation in the render path
       (the d3 skill requires deterministic output)

   Usage: node tools/verify_static.js
   ========================================================================== */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const html = fs.readFileSync(path.join(DIST, "chart.html"), "utf8");
const chartJs = fs.readFileSync(path.join(DIST, "chart.js"), "utf8");
const statsJs = fs.readFileSync(path.join(DIST, "stats.js"), "utf8");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "ansur.json"), "utf8"));
const stats = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "ansur-stats.json"), "utf8"));

let passed = 0;
const failures = [];

function ok(label, condition, detail) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(label + (detail ? " - " + detail : ""));
  }
}

/* --- element ids referenced from chart.js ------------------------------ */

const htmlIds = new Set();
const idPattern = /id="([^"]+)"/g;
let match;
while ((match = idPattern.exec(html)) !== null) htmlIds.add(match[1]);

const referencedIds = new Set();
const getById = /getElementById\("([^"]+)"\)/g;
while ((match = getById.exec(chartJs)) !== null) referencedIds.add(match[1]);

/* Ids can also be referenced from a data structure (e.g. the export table). */
const quotedIds = /"([a-z]+-[a-z-]+)"/g;
while ((match = quotedIds.exec(chartJs)) !== null) {
  if (htmlIds.has(match[1])) referencedIds.add(match[1]);
}

referencedIds.forEach((id) => {
  ok("chart.js references an existing element id: " + id, htmlIds.has(id));
});

/* Every id the HTML defines should be used somewhere, or it is dead markup. */
const unusedIds = [...htmlIds].filter((id) => !referencedIds.has(id) && !id.startsWith("chart-"));
ok("no unused element ids in chart.html", unusedIds.length === 0, unusedIds.join(", "));

/* --- table twins ------------------------------------------------------- */

const tableTargets = [...html.matchAll(/data-table="([^"]+)"/g)].map((m) => m[1]);
ok("chart.html has table toggles", tableTargets.length > 0);
tableTargets.forEach((target) => {
  ok("table target exists in chart.html: " + target, htmlIds.has(target));
});

const matrixButtons = [...html.matchAll(/data-matrix="([^"]+)"/g)].map((m) => m[1]);
ok("chart.html has matrix metric buttons", matrixButtons.length === 2);
ok("chart.js handles matrix metrics", chartJs.includes("data-matrix"));

/* --- script and stylesheet references ---------------------------------- */

const sources = [...html.matchAll(/<(?:script src|link[^>]*href)="([^"]+)"/g)].map((m) => m[1]);
sources.forEach((src) => {
  ok("referenced asset exists: " + src, fs.existsSync(path.join(DIST, src)));
});

/* Load order matters: stats.js must come before chart.js. */
const scriptOrder = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
ok("stats.js loads before chart.js",
  scriptOrder.indexOf("stats.js") > -1 &&
  scriptOrder.indexOf("stats.js") < scriptOrder.indexOf("chart.js"));
ok("d3 loads before chart.js",
  scriptOrder.indexOf("vendor/d3.v7.9.0.min.js") < scriptOrder.indexOf("chart.js"));

/* --- measure keys ------------------------------------------------------ */

const measureBlock = chartJs.match(/var MEASURES = \[([\s\S]*?)\n  \];/);
ok("chart.js declares MEASURES", !!measureBlock);
const measureKeys = [...chartJs.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
ok("MEASURES is not empty", measureKeys.length > 0);
measureKeys.forEach((key) => {
  const present = Object.prototype.hasOwnProperty.call(data.records[0], key);
  ok("measure key exists in the data payload: " + key, present);
  const label = data.metadata.labels[key];
  ok("measure key has a label: " + key, !!label);
  const unit = data.metadata.units[key];
  ok("measure key has a unit: " + key, !!unit);
});

/* --- matrix feature labels --------------------------------------------- */

const matrixFeatures = stats.metadata.matrix_features;
ok("matrix has 17 features", matrixFeatures.length === 17);
matrixFeatures.forEach((feature) => {
  const escaped = feature.replace(/\./g, "\\.");
  /* Keys may be quoted ("ear.breadth") or bare identifiers (age). */
  const shortLabel = chartJs.match(new RegExp('("' + escaped + '"|\\b' + escaped + ')\\s*:\\s*"([^"]+)"'));
  ok("matrix feature has a short label: " + feature, !!shortLabel);
});

/* --- determinism ------------------------------------------------------- */

const renderSources = chartJs + statsJs;
ok("no Math.random in the render path", !renderSources.includes("Math.random"));
ok("no Date.now in the render path", !renderSources.includes("Date.now"));
ok("no new Date() in the render path", !renderSources.includes("new Date"));
ok("no d3 transitions", !/\.transition\(/.test(chartJs));
ok("no d3 ease/animations", !/\.ease[A-Z]/.test(chartJs));
ok("no setTimeout/setInterval in the render path",
  !/setTimeout\(|setInterval\(/.test(chartJs));
ok("no d3-random import", !/d3-random/.test(chartJs));

/* --- the shared core is actually used ---------------------------------- */

ok("chart.js uses the shared stats core", chartJs.includes("ANSUR_STATS_CORE"));
ok("chart.js has no local boxStats implementation",
  !/function boxStats\(values\) \{[\s\S]{0,400}d3\.quantile/.test(chartJs));
ok("chart.js has no local kde implementation",
  !/function kde\(values, grid, bandwidth\) \{[\s\S]{0,400}Math\.exp/.test(chartJs));
ok("chart.js has no local correlation loop",
  !/sxy \+= \(p\[0\] - meanA\)/.test(chartJs));
/* Every quantile in the dashboard should come from the one tested
   implementation, so the tiles, the plots and the tables cannot disagree. */
ok("chart.js computes no quantiles with d3 directly",
  !/d3\.quantile/.test(chartJs));
ok("chart.js computes no means with d3 directly", !/d3\.mean/.test(chartJs));
ok("chart.js computes no deviations with d3 directly", !/d3\.deviation/.test(chartJs));

/* --- palette ----------------------------------------------------------- */

const css = fs.readFileSync(path.join(DIST, "chart.css"), "utf8");
ok("css defines the light categorical slot 1", css.includes("--series-1: #2a78d6"));
ok("css defines the light categorical slot 2", css.includes("--series-2: #eb6834"));
ok("css defines the dark categorical slot 1", css.includes("--series-1: #3987e5"));
ok("css defines the dark categorical slot 2", css.includes("--series-2: #d95926"));
/* The missing-values chart uses slot 3, so it must not collide with the
   gender hues. */
ok("css defines the light quality hue", css.includes("--quality: #1baf7a"));
ok("css defines the dark quality hue", css.includes("--quality: #199e70"));
ok("chart.js uses the quality hue", chartJs.includes("#1baf7a") && chartJs.includes("#199e70"));
ok("css has a dark mode scope for the theme toggle", css.includes(':root[data-theme="dark"]'));
ok("css has an OS-preference scope", css.includes("prefers-color-scheme: dark"));
ok("chart.js defines both modes", chartJs.includes('dark: {') && chartJs.includes('light: {'));

/* Every colour chart.js paints must come from the documented palette. */
const allowed = new Set([
  /* categorical slots 1-3, light and dark */
  "#2a78d6", "#eb6834", "#3987e5", "#d95926", "#1baf7a", "#199e70",
  /* diverging poles and neutral midpoint */
  "#e34948", "#e66767", "#f0efec", "#383835",
  /* ink and chrome */
  "#0b0b0b", "#fcfcfb", "#52514e", "#c3c2b7", "#898781",
  "#e1e0d9", "#2c2c2a",
  /* chart surfaces, light and dark */
  "#f9f9f7", "#0d0d0d", "#1a1a19"
]);
const hexPattern = /#[0-9a-fA-F]{6}\b/g;
const chartColors = new Set(chartJs.match(hexPattern) || []);
[...chartColors].forEach((hex) => {
  ok("chart.js uses a documented palette hex: " + hex, allowed.has(hex));
});

/* --- accessibility ----------------------------------------------------- */

ok("every chart svg gets an aria-label", (chartJs.match(/aria-label/g) || []).length >= 6);
ok("tooltips are announced", html.includes('aria-live="polite"'));
ok("a table twin exists for every chart card",
  tableTargets.length >= 6, "found " + tableTargets.length);
ok("filter row is labelled", html.includes('aria-label="Dashboard filters"'));
ok("theme toggle reports its state", html.includes('id="theme-toggle"'));
ok("matrix buttons report pressed state", chartJs.includes('aria-pressed'));

/* A single-series chart needs no legend box - the title or subtitle already
   names what is plotted. The missing-values chart is single series. */
const legends = [...html.matchAll(/id="([a-z-]*legend)"/g)].map((m) => m[1]);
ok("the single-series chart has no legend box", !legends.includes("missing-legend"));
/* Every chart that does have a legend must be multi-series, or it is
   redundant. */
ok("multi-series charts keep their legends",
  legends.includes("scatter-legend") && legends.includes("population-legend") &&
  legends.includes("box-legend") && legends.includes("violin-legend"));
/* The single-series chart must name its encoding in prose instead. */
ok("the single-series chart names its encoding in the subtitle",
  chartJs.includes('summary-subtitle') && chartJs.includes("missing in the current slice"));

/* --- tooltip safety ---------------------------------------------------- */

/* Series names come from data, so they must never reach the DOM as HTML. */
ok("tooltip builds text with textContent", chartJs.includes("textContent = "));
/* The only permitted innerHTML is the SVG-serialisation fallback, which
   copies markup out of the DOM rather than data into it. Comments are
   stripped first so prose about innerHTML does not count as a use. */
const chartCode = chartJs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const innerHtmlUses = [...chartCode.matchAll(/innerHTML/g)];
ok("innerHTML is used only for SVG serialisation",
  innerHtmlUses.length === 1 && chartCode.includes("svg.innerHTML"));
ok("no data is written into the DOM as HTML",
  !/\.html\(/.test(chartCode) && !/insertAdjacentHTML/.test(chartCode));

/* --- report ------------------------------------------------------------ */

console.log("static checks passed: " + passed);
console.log("static checks failed: " + failures.length);
if (failures.length) {
  console.log("\nfailures:");
  failures.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
console.log("\nAll static checks passed.");
console.log("  element ids checked : " + referencedIds.size);
console.log("  measure keys       : " + measureKeys.length);
console.log("  palette hexes      : " + chartColors.size);
