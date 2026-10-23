/* Benchmark the parts of the dashboard that run on every filter change, so a
   slow interaction is caught rather than discovered by a reader.

   Usage: node tools/bench.js
   ========================================================================== */

"use strict";

const fs = require("fs");
const path = require("path");
const core = require("../dist/stats.js");

const ROOT = path.resolve(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "ansur.json"), "utf8"));
const stats = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "ansur-stats.json"), "utf8"));
const records = data.records;
const features = stats.metadata.matrix_features;

function time(label, iterations, fn) {
  const start = process.hrtime.bigint();
  let result;
  for (let i = 0; i < iterations; i += 1) result = fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  console.log(
    label.padEnd(46) +
    (ms / iterations).toFixed(1).padStart(8) + " ms/op" +
    "   total " + ms.toFixed(0) + " ms over " + iterations + " runs"
  );
  return result;
}

console.log("records: " + records.length + ", features: " + features.length + "\n");

/* The full matrix is the heaviest thing a filter change triggers. */
time("correlationMatrix (17 features, 6068 records)", 5, function () {
  return core.correlationMatrix(records, features);
});

/* A filtered slice, which is the case a reader hits most often. */
const young = records.filter((r) => r.age >= 25 && r.age <= 34);
console.log("\nfiltered slice: " + young.length + " records");
time("correlationMatrix (filtered slice)", 5, function () {
  return core.correlationMatrix(young, features);
});

/* The violin KDE runs a Gaussian over every value for every grid point. */
const weights = records.map((r) => r.weight_kg).filter((v) => v !== null);
const grid = [];
for (let i = 0; i <= 120; i += 1) grid.push(30 + (i * 90) / 120);
time("kde (6068 values x 121 grid points)", 5, function () {
  return core.kde(weights, grid);
});

/* Box stats per gender - cheap, but on every render. */
time("boxStats (all records)", 20, function () {
  return core.boxStats(weights);
});

/* The filter itself runs before every render. */
time("filter by age range", 200, function () {
  return records.filter((r) => r.age >= 30 && r.age <= 40);
});
