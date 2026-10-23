/* ==========================================================================
   ANSUR - statistical core.

   Pure computation, no DOM and no D3. Keeping the maths here means it can be
   unit-tested in plain Node and cross-checked against tools/analyze.py, and
   it keeps chart.js to what it is good at: rendering.

   Every function here is deterministic. There is no randomness anywhere, so
   the same input always produces the same output.

   All quantiles use the type-7 (linear interpolation) definition, which is
   what d3.quantile and Python's statistics.quantiles(method="inclusive")
   both implement - so the numbers agree across the three implementations.
   ========================================================================== */

(function (root) {
  "use strict";

  /* ------------------------------------------------------------- quantile */

  /* Type-7 quantile of an ALREADY SORTED array. Matches d3.quantile. */
  function quantileSorted(sorted, q) {
    var n = sorted.length;
    if (n === 0) return undefined;
    if (n === 1) return sorted[0];
    var position = (n - 1) * q;
    var lower = Math.floor(position);
    var upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    var weight = position - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /* Quantile of an unsorted array (sorts a copy, leaves the input alone). */
  function quantile(values, q) {
    return quantileSorted(values.slice().sort(ascending), q);
  }

  function ascending(a, b) {
    return a < b ? -1 : a > b ? 1 : a >= b ? 0 : NaN;
  }

  function mean(values) {
    if (!values.length) return undefined;
    var total = 0;
    for (var i = 0; i < values.length; i += 1) total += values[i];
    return total / values.length;
  }

  /* Sample standard deviation (n - 1 denominator), matching statistics.stdev. */
  function deviation(values) {
    var n = values.length;
    if (n < 2) return undefined;
    var m = mean(values);
    var sum = 0;
    for (var i = 0; i < n; i += 1) {
      var delta = values[i] - m;
      sum += delta * delta;
    }
    return Math.sqrt(sum / (n - 1));
  }

  /* ------------------------------------------------------------ box stats */

  /* Five-number summary plus the outliers a box plot draws.
     The whiskers reach the most extreme value within 1.5 x IQR. */
  function boxStats(values) {
    if (!values.length) return null;
    var sorted = values.slice().sort(ascending);
    var n = sorted.length;
    var q1 = quantileSorted(sorted, 0.25);
    var median = quantileSorted(sorted, 0.5);
    var q3 = quantileSorted(sorted, 0.75);
    var iqr = q3 - q1;
    var lowerFence = q1 - 1.5 * iqr;
    var upperFence = q3 + 1.5 * iqr;

    var inliers = [];
    var outliers = [];
    for (var i = 0; i < n; i += 1) {
      if (sorted[i] >= lowerFence && sorted[i] <= upperFence) inliers.push(sorted[i]);
      else outliers.push(sorted[i]);
    }

    return {
      n: n,
      min: sorted[0],
      max: sorted[n - 1],
      q1: q1,
      median: median,
      q3: q3,
      iqr: iqr,
      lowerWhisker: inliers.length ? inliers[0] : sorted[0],
      upperWhisker: inliers.length ? inliers[inliers.length - 1] : sorted[n - 1],
      mean: mean(sorted),
      sd: deviation(sorted),
      outliers: outliers
    };
  }

  /* ------------------------------------------------------------------ KDE */

  /* Gaussian kernel density estimate on a fixed grid.
     The bandwidth comes from Silverman's rule, which depends only on the
     data - never on a random draw - so the curve is reproducible. */
  function kde(values, grid, bandwidth) {
    var n = values.length;
    if (n === 0) return [];
    var h = bandwidth;
    if (!h) {
      var sd = deviation(values);
      var q1 = quantileSorted(values.slice().sort(ascending), 0.25);
      var q3 = quantileSorted(values.slice().sort(ascending), 0.75);
      var iqr = q3 - q1;
      var spread = iqr > 0 ? Math.min(sd, iqr / 1.349) : sd;
      h = 0.9 * spread * Math.pow(n, -0.2);
    }
    if (!h || !isFinite(h) || h <= 0) h = 1;
    var norm = 1 / (n * h * Math.sqrt(2 * Math.PI));
    var result = [];
    for (var g = 0; g < grid.length; g += 1) {
      var x = grid[g];
      var sum = 0;
      for (var i = 0; i < n; i += 1) {
        var u = (x - values[i]) / h;
        sum += Math.exp(-0.5 * u * u);
      }
      result.push({ x: x, y: norm * sum });
    }
    return result;
  }

  /* ----------------------------------------------------------- covariance */

  /* Pearson covariance and correlation over the rows where BOTH columns are
     present (pairwise-complete), reporting the n actually used. */
  function pairwiseMoments(pairs) {
    var n = pairs.length;
    if (n < 2) return { n: n, covariance: null, correlation: null };
    var meanA = 0;
    var meanB = 0;
    var i;
    for (i = 0; i < n; i += 1) {
      meanA += pairs[i][0];
      meanB += pairs[i][1];
    }
    meanA /= n;
    meanB /= n;

    var sxx = 0;
    var syy = 0;
    var sxy = 0;
    for (i = 0; i < n; i += 1) {
      var da = pairs[i][0] - meanA;
      var db = pairs[i][1] - meanB;
      sxx += da * da;
      syy += db * db;
      sxy += da * db;
    }
    return {
      n: n,
      covariance: sxy / (n - 1),
      correlation: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null
    };
  }

  /* Covariance and correlation matrices for a set of features, computed on
     the records provided. Returns the values, the pairwise n, and the list
     of feature names, so the caller can label them.

     The columns are extracted once and each pair is then accumulated in a
     single pass over the rows, so no per-pair arrays are allocated. That
     keeps a filter change (which re-renders the matrix) fast. */
  function correlationMatrix(records, features) {
    var size = features.length;
    var covariance = [];
    var correlation = [];
    var counts = [];
    var i;
    var j;
    for (i = 0; i < size; i += 1) {
      covariance.push(new Array(size).fill(null));
      correlation.push(new Array(size).fill(null));
      counts.push(new Array(size).fill(0));
    }

    /* Column values plus a per-record mask, so a pair's complete rows can be
       found without re-reading the record objects. */
    var columns = features.map(function (feature) {
      return records.map(function (record) {
        var value = record[feature];
        return value === null || value === undefined ? null : value;
      });
    });

    for (i = 0; i < size; i += 1) {
      for (j = i; j < size; j += 1) {
        var columnA = columns[i];
        var columnB = columns[j];
        var n = 0;
        var sumA = 0;
        var sumB = 0;
        var r;
        /* First pass: the pairwise-complete count and the two means. */
        for (r = 0; r < records.length; r += 1) {
          var a = columnA[r];
          var b = columnB[r];
          if (a === null || b === null) continue;
          n += 1;
          sumA += a;
          sumB += b;
        }

        counts[i][j] = counts[j][i] = n;
        if (n < 2) continue;

        var meanA = sumA / n;
        var meanB = sumB / n;

        /* Second pass: the centered sums of squares. Centering the values
           before squaring keeps the sums small, which avoids the
           cancellation error that raw sums of squares would introduce for
           measurements in the thousands. */
        var sxx = 0;
        var syy = 0;
        var sxy = 0;
        for (r = 0; r < records.length; r += 1) {
          var av = columnA[r];
          var bv = columnB[r];
          if (av === null || bv === null) continue;
          var da = av - meanA;
          var db = bv - meanB;
          sxx += da * da;
          syy += db * db;
          sxy += da * db;
        }

        var cov = sxy / (n - 1);
        var corr = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
        covariance[i][j] = covariance[j][i] = cov;
        correlation[i][j] = correlation[j][i] = corr;
      }
    }

    return { features: features, covariance: covariance, correlation: correlation, n: counts };
  }

  /* ------------------------------------------------------- diverging scale */

  /* Covariance spans orders of magnitude, so a linear colour scale would
     crush every pair but the largest into one colour. A symmetric-log
     compression keeps small values legible while preserving sign. */
  function symlogNormalize(value, maxAbs) {
    if (!maxAbs) return 0;
    var c = maxAbs / 100;
    var magnitude = function (v) {
      return Math.log(1 + Math.abs(v) / c) / Math.log(1 + maxAbs / c);
    };
    return value < 0 ? -magnitude(value) : magnitude(value);
  }

  var API = {
    ascending: ascending,
    mean: mean,
    deviation: deviation,
    quantile: quantile,
    quantileSorted: quantileSorted,
    boxStats: boxStats,
    kde: kde,
    pairwiseMoments: pairwiseMoments,
    correlationMatrix: correlationMatrix,
    symlogNormalize: symlogNormalize
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  if (root) {
    root.ANSUR_STATS_CORE = API;
  }
})(typeof window !== "undefined" ? window : null);
