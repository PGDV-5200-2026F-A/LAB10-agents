/* ==========================================================================
   Test suite for the pure-JS statistical core (dist/stats.js).

   Runs in plain Node with no external packages. Two kinds of check:

     1. Unit checks against hand-computed values (exact expectations).
     2. Cross-checks against tools/analyze.py, which computes the same
        statistics in Python - a genuinely independent implementation of the
        same definitions. Any disagreement means one of the two is wrong.

   Usage: node tools/test_stats.js
   ========================================================================== */

"use strict";

const fs = require("fs");
const path = require("path");
const core = require("../dist/stats.js");

const ROOT = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;
const failures = [];

function check(label, actual, expected, tolerance) {
  const tol = tolerance === undefined ? 1e-9 : tolerance;
  const ok = typeof expected === "number"
    ? Math.abs(actual - expected) <= tol
    : actual === expected;
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(label + ": expected " + expected + ", got " + actual);
  }
}

function checkTrue(label, value) {
  check(label, value ? 1 : 0, 1);
}

/* ------------------------------------------------------------ quantiles */

const sorted = [1, 2, 3, 4, 5];
check("quantile q0", core.quantile(sorted, 0), 1);
check("quantile q1", core.quantile(sorted, 1), 5);
check("quantile q0.5 (type 7)", core.quantile(sorted, 0.5), 3);
check("quantile q0.25 (type 7)", core.quantile(sorted, 0.25), 2);
check("quantile q0.75 (type 7)", core.quantile(sorted, 0.75), 4);

/* Type 7 on an even-length set interpolates: [1,2,3,4] at q=0.5 -> 2.5. */
check("quantile even q0.5", core.quantile([1, 2, 3, 4], 0.5), 2.5);
/* [1,2,3,4] at q=0.25 -> 1 + 0.75*(2-1) = 1.75. */
check("quantile even q0.25", core.quantile([1, 2, 3, 4], 0.25), 1.75);

/* Unsorting the input must not change the answer. */
check("quantile is order independent", core.quantile([5, 3, 1, 4, 2], 0.5), 3);

/* --------------------------------------------------- mean and deviation */

check("mean", core.mean([2, 4, 6, 8]), 5);
check("deviation (n-1)", core.deviation([2, 4, 6, 8]), Math.sqrt(20 / 3));
check("deviation single value", core.deviation([7]), undefined);
check("mean empty", core.mean([]), undefined);

/* ------------------------------------------------------------ box stats */

/* Expected values cross-checked against Python's statistics module:
   quantiles(d, n=4, method="inclusive") is the same type-7 definition. */
const box = core.boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
check("box n", box.n, 10);
check("box min", box.min, 1);
check("box max", box.max, 100);
check("box median", box.median, 5.5);
check("box q1", box.q1, 3.25);
check("box q3", box.q3, 7.75);
check("box lower whisker", box.lowerWhisker, 1);
check("box upper whisker", box.upperWhisker, 9);
check("box outlier count", box.outliers.length, 1);
check("box outlier value", box.outliers[0], 100);

/* A constant series has no spread: whiskers collapse to that value. */
const flat = core.boxStats([5, 5, 5, 5]);
check("flat box median", flat.median, 5);
check("flat box iqr", flat.iqr, 0);
check("flat box outliers", flat.outliers.length, 0);

/* -------------------------------------------------------------- moments */

/* Covariance uses the sample (n-1) denominator. */
const moments = core.pairwiseMoments([[1, 2], [2, 4], [3, 6], [4, 8]]);
check("pairwise n", moments.n, 4);
check("pairwise covariance", moments.covariance, 10 / 3);
check("pairwise correlation", moments.correlation, 1);

/* Perfectly anti-correlated data. */
const anti = core.pairwiseMoments([[1, 4], [2, 3], [3, 2], [4, 1]]);
check("anti correlation", anti.correlation, -1);

/* Insufficient data yields nulls, not NaN. */
const thin = core.pairwiseMoments([[1, 2]]);
check("pairwise n=1 covariance", thin.covariance, null);
check("pairwise n=1 correlation", thin.correlation, null);

/* ------------------------------------------------------------ symlog */

check("symlog of zero", core.symlogNormalize(0, 100), 0);
check("symlog of max", core.symlogNormalize(100, 100), 1);
check("symlog of -max", core.symlogNormalize(-100, 100), -1);
checkTrue("symlog is monotonic",
  core.symlogNormalize(1, 100) < core.symlogNormalize(10, 100));

/* ------------------------------------------------------------------ KDE */

/* A bell-shaped sample's density peaks near its centre. The sample is built
   from a deterministic, symmetric construction (no randomness) so the peak
   lands at zero. */
const normal = [];
for (let i = -60; i <= 60; i += 1) {
  for (let j = 0; j < 20; j += 1) {
    normal.push(i / 20);
  }
}
const grid = [];
for (let i = 0; i <= 200; i += 1) grid.push(-4 + (i * 8) / 200);
const density = core.kde(normal, grid);
let peak = density[0];
for (const point of density) if (point.y > peak.y) peak = point;
checkTrue("kde peaks near zero", Math.abs(peak.x) < 0.2);
checkTrue("kde density is positive", density[100].y > 0);

/* The KDE of a constant series must not blow up. */
const constant = core.kde([3, 3, 3, 3], grid);
checkTrue("kde on a constant series is finite", constant.every((p) => isFinite(p.y)));

/* Determinism: the same input gives the same curve, every time. */
const again = core.kde(normal, grid);
checkTrue("kde is deterministic",
  density.every((p, i) => p.y === again[i].y && p.x === again[i].x));

/* ------------------------------------------- cross-check against Python */

const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "ansur.json"), "utf8"));
const stats = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "ansur-stats.json"), "utf8"));
const records = data.records;
const features = stats.metadata.matrix_features;

const matrix = core.correlationMatrix(records, features);
let maxCovDiff = 0;
let maxCorrDiff = 0;
let minN = Infinity;
let maxNDiff = 0;
for (let i = 0; i < features.length; i += 1) {
  for (let j = 0; j < features.length; j += 1) {
    const pyCov = stats.covariance.covariance[i][j];
    const pyCorr = stats.covariance.correlation[i][j];
    const pyN = stats.covariance.n[i][j];
    if (pyCov !== null) {
      maxCovDiff = Math.max(maxCovDiff, Math.abs(matrix.covariance[i][j] - pyCov));
    }
    if (pyCorr !== null) {
      maxCorrDiff = Math.max(maxCorrDiff, Math.abs(matrix.correlation[i][j] - pyCorr));
    }
    maxNDiff = Math.max(maxNDiff, Math.abs(matrix.n[i][j] - pyN));
    minN = Math.min(minN, matrix.n[i][j]);
  }
}

/* The Python side rounds to 4 decimals, so allow that much drift. */
check("covariance matches Python", maxCovDiff, 0, 5e-4);
check("correlation matches Python", maxCorrDiff, 0, 5e-4);
check("pairwise n matches Python", maxNDiff, 0, 0);

/* Descriptives: the JS box stats must agree with the Python descriptives. */
let maxDescDiff = 0;
stats.metadata.matrix_features.forEach((feature) => {
  const values = records
    .filter((r) => r[feature] !== null && r[feature] !== undefined)
    .map((r) => r[feature]);
  const js = core.boxStats(values);
  const py = stats.descriptive[feature];
  maxDescDiff = Math.max(maxDescDiff, Math.abs(js.median - py.median));
  maxDescDiff = Math.max(maxDescDiff, Math.abs(js.q1 - py.q1));
  maxDescDiff = Math.max(maxDescDiff, Math.abs(js.q3 - py.q3));
  maxDescDiff = Math.max(maxDescDiff, Math.abs(js.mean - py.mean));
  maxDescDiff = Math.max(maxDescDiff, Math.abs(js.sd - py.sd));
});
check("descriptives match Python", maxDescDiff, 0, 5e-4);

/* Record counts and the shape of the payload the dashboard reads. */
check("record count", records.length, stats.metadata.record_count);
check("feature count", features.length, 17);
checkTrue("every record has a gender", records.every((r) => r.gender === "F" || r.gender === "M"));
checkTrue("derived bmi present", records.every((r) => r.bmi !== undefined));

/* Gender split matches the metadata. */
const counts = { F: 0, M: 0 };
records.forEach((r) => { counts[r.gender] += 1; });
check("F count", counts.F, stats.metadata.gender_counts.F);
check("M count", counts.M, stats.metadata.gender_counts.M);

/* ------------------------------------------------------------- report */

console.log("checks passed: " + passed);
console.log("checks failed: " + failed);
if (failures.length) {
  console.log("\nfailures:");
  failures.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
console.log("\nAll statistical checks passed.");
console.log("  covariance max |diff| vs Python: " + maxCovDiff.toExponential(2));
console.log("  correlation max |diff| vs Python: " + maxCorrDiff.toExponential(2));
console.log("  smallest pairwise n: " + minN);
