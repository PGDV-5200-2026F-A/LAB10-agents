/**
 * Data Loading & Preprocessing Module
 * Penguin Data Dashboard
 */

const DataLoader = (function() {
  'use strict';

  // Original data cache
  let rawData = [];
  // Current filtered data
  let filteredData = [];
  // Selection state for cross-filtering
  let selectedIndices = new Set();
  // Brush selection (array of indices)
  let brushSelection = null;

  // Numeric columns for correlation
  const numericColumns = ['bill_length_mm', 'bill_depth_mm', 'flipper_length_mm', 'body_mass_g'];

  // Species color mapping
  const speciesColors = {
    'Adelie': '#4C78A8',
    'Gentoo': '#F58518',
    'Chinstrap': '#54A24B'
  };

  // Sex labels
  const sexLabels = {
    0: 'Female',
    1: 'Male'
  };

  // Axis label mapping
  const axisLabels = {
    'bill_length_mm': 'Bill Length (mm)',
    'bill_depth_mm': 'Bill Depth (mm)',
    'flipper_length_mm': 'Flipper Length (mm)',
    'body_mass_g': 'Body Mass (g)'
  };

  /**
   * Load and parse the penguin data
   */
  async function loadData() {
    try {
      const response = await fetch('data/penguins.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      rawData = await response.json();
      preprocessData();
      filteredData = [...rawData];
      return rawData;
    } catch (error) {
      console.error('Failed to load penguin data:', error);
      throw error;
    }
  }

  /**
   * Preprocess raw data - add computed fields, validate
   */
  function preprocessData() {
    rawData.forEach((d, i) => {
      // Add unique index for cross-filtering
      d._index = i;
      // Ensure numeric types
      d.bill_length_mm = +d.bill_length_mm;
      d.bill_depth_mm = +d.bill_depth_mm;
      d.flipper_length_mm = +d.flipper_length_mm;
      d.body_mass_g = +d.body_mass_g;
      d.sex = d.sex === 1 || d.sex === '1' ? 1 : 0;
      // Add species color
      d._color = speciesColors[d.species] || '#999999';
      // Add sex label
      d._sexLabel = sexLabels[d.sex] || 'Unknown';
    });
  }

  /**
   * Get all raw data
   */
  function getRawData() {
    return rawData;
  }

  /**
   * Get current filtered data
   */
  function getFilteredData() {
    return filteredData;
  }

  /**
   * Get data filtered by current filters (species, sex)
   * Does not apply brush selection
   */
  function getBaseFilteredData(speciesFilter, sexFilter) {
    return rawData.filter(d => {
      const speciesMatch = speciesFilter.length === 0 || speciesFilter.includes(d.species);
      const sexMatch = sexFilter === 'all' || d.sex === parseInt(sexFilter, 10);
      return speciesMatch && sexMatch;
    });
  }

  /**
   * Get currently selected data (brush selection)
   */
  function getSelectedData() {
    if (brushSelection === null || brushSelection.length === 0) {
      return filteredData;
    }
    return filteredData.filter((_, i) => brushSelection.includes(i));
  }

  /**
   * Get data for a specific chart (applies both filters and brush)
   */
  function getChartData(speciesFilter, sexFilter) {
    const baseFiltered = getBaseFilteredData(speciesFilter, sexFilter);
    if (brushSelection === null || brushSelection.length === 0) {
      return baseFiltered;
    }
    // Map brush indices to baseFiltered indices
    // Since brushSelection contains indices into filteredData, we need to map
    const selectedSet = new Set(brushSelection);
    return baseFiltered.filter((_, i) => selectedSet.has(i));
  }

  /**
   * Set brush selection (indices into filteredData)
   */
  function setBrushSelection(indices) {
    brushSelection = indices;
    selectedIndices = new Set(indices || []);
  }

  /**
   * Get brush selection
   */
  function getBrushSelection() {
    return brushSelection;
  }

  /**
   * Clear brush selection
   */
  function clearBrushSelection() {
    brushSelection = null;
    selectedIndices.clear();
  }

  /**
   * Check if a data point is selected
   */
  function isSelected(index) {
    return selectedIndices.has(index);
  }

  /**
   * Get species counts
   */
  function getSpeciesCounts(data = filteredData) {
    const counts = { Adelie: 0, Gentoo: 0, Chinstrap: 0 };
    data.forEach(d => {
      if (counts.hasOwnProperty(d.species)) {
        counts[d.species]++;
      }
    });
    return counts;
  }

  /**
   * Get correlation matrix for numeric columns
   */
  function getCorrelationMatrix(data = filteredData) {
    const cols = numericColumns;
    const n = cols.length;
    const matrix = [];

    // Calculate means
    const means = {};
    cols.forEach(col => {
      const values = data.map(d => d[col]).filter(v => !isNaN(v));
      means[col] = values.reduce((a, b) => a + b, 0) / values.length;
    });

    // Calculate standard deviations
    const stds = {};
    cols.forEach(col => {
      const values = data.map(d => d[col]).filter(v => !isNaN(v));
      const mean = means[col];
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
      stds[col] = Math.sqrt(variance);
    });

    // Calculate correlations
    for (let i = 0; i < n; i++) {
      matrix[i] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) {
          matrix[i][j] = 1;
        } else {
          const col1 = cols[i];
          const col2 = cols[j];
          const values1 = data.map(d => d[col1]);
          const values2 = data.map(d => d[col2]);
          let covariance = 0;
          let validCount = 0;
          for (let k = 0; k < data.length; k++) {
            if (!isNaN(values1[k]) && !isNaN(values2[k])) {
              covariance += (values1[k] - means[col1]) * (values2[k] - means[col2]);
              validCount++;
            }
          }
          if (validCount > 0) {
            covariance /= validCount;
            matrix[i][j] = covariance / (stds[col1] * stds[col2]);
          } else {
            matrix[i][j] = 0;
          }
        }
      }
    }

    return { matrix, columns: cols };
  }

  /**
   * Get regression line data for a species
   */
  function getRegressionData(data, xCol, yCol, species) {
    const speciesData = data.filter(d => d.species === species);
    if (speciesData.length < 2) return null;

    const xVals = speciesData.map(d => d[xCol]);
    const yVals = speciesData.map(d => d[yCol]);

    const n = speciesData.length;
    const sumX = xVals.reduce((a, b) => a + b, 0);
    const sumY = yVals.reduce((a, b) => a + b, 0);
    const sumXY = xVals.reduce((sum, x, i) => sum + x * yVals[i], 0);
    const sumX2 = xVals.reduce((sum, x) => sum + x * x, 0);
    const sumY2 = yVals.reduce((sum, y) => sum + y * y, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R-squared
    const yMean = sumY / n;
    const ssTotal = yVals.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0);
    const ssResidual = yVals.reduce((sum, y, i) => {
      const predicted = slope * xVals[i] + intercept;
      return sum + Math.pow(y - predicted, 2);
    }, 0);
    const rSquared = 1 - (ssResidual / ssTotal);

    // Generate line points
    const xMin = Math.min(...xVals);
    const xMax = Math.max(...xVals);
    const lineData = [
      { x: xMin, y: slope * xMin + intercept },
      { x: xMax, y: slope * xMax + intercept }
    ];

    // Confidence band (simplified - using standard error)
    const xMean = sumX / n;
    const sxx = xVals.reduce((sum, x) => sum + Math.pow(x - xMean, 2), 0);
    const mse = ssResidual / (n - 2);
    const se = Math.sqrt(mse);

    const confidenceData = [];
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      const x = xMin + (xMax - xMin) * i / steps;
      const y = slope * x + intercept;
      const sePred = se * Math.sqrt(1/n + Math.pow(x - xMean, 2) / sxx);
      const t = 1.96; // Approximate 95% CI
      confidenceData.push({
        x,
        yUpper: y + t * sePred,
        yLower: y - t * sePred
      });
    }

    return {
      slope,
      intercept,
      rSquared,
      lineData,
      confidenceData,
      color: speciesColors[species]
    };
  }

  /**
   * Get violin plot data (kernel density estimation)
   */
  function getViolinData(data, groupBy, valueCol) {
    const groups = [...new Set(data.map(d => d[groupBy]))].sort();
    const values = data.map(d => d[valueCol]).filter(v => !isNaN(v));
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal;

    // Bandwidth using Silverman's rule
    const n = data.length;
    const std = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - values.reduce((a,b)=>a+b,0)/n, 2), 0) / n);
    const bandwidth = 1.06 * std * Math.pow(n, -0.2);

    const violins = groups.map(group => {
      const groupData = data.filter(d => d[groupBy] === group).map(d => d[valueCol]).filter(v => !isNaN(v));
      if (groupData.length === 0) return { group, density: [], stats: null };

      // Kernel density estimation
      const gridPoints = 100;
      const density = [];
      for (let i = 0; i <= gridPoints; i++) {
        const x = minVal + range * i / gridPoints;
        let sum = 0;
        groupData.forEach(v => {
          const u = (x - v) / bandwidth;
          sum += Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
        });
        density.push({ x, y: sum / (groupData.length * bandwidth) });
      }

      // Box plot stats
      const sorted = [...groupData].sort((a, b) => a - b);
      const q1 = d3.quantile(sorted, 0.25);
      const median = d3.quantile(sorted, 0.5);
      const q3 = d3.quantile(sorted, 0.75);
      const iqr = q3 - q1;
      const lowerWhisker = Math.max(sorted[0], q1 - 1.5 * iqr);
      const upperWhisker = Math.min(sorted[sorted.length - 1], q3 + 1.5 * iqr);
      const outliers = sorted.filter(v => v < lowerWhisker || v > upperWhisker);

      return {
        group,
        density,
        stats: {
          min: sorted[0],
          q1,
          median,
          q3,
          max: sorted[sorted.length - 1],
          lowerWhisker,
          upperWhisker,
          outliers,
          count: groupData.length
        }
      };
    });

    // Normalize density for violin width
    const maxDensity = Math.max(...violins.flatMap(v => v.density.map(d => d.y)));
    violins.forEach(v => {
      v.density.forEach(d => {
        d.scaledY = d.y / maxDensity;
      });
    });

    return violins;
  }

  /**
   * Get sex-split violin data
   */
  function getViolinDataBySex(data, species, valueCol) {
    const sexes = [0, 1];
    const result = {};

    sexes.forEach(sex => {
      const sexData = data.filter(d => d.species === species && d.sex === sex);
      result[sex] = getViolinData(sexData, 'species', valueCol)[0] || { density: [], stats: null };
      result[sex].sex = sex;
      result[sex].sexLabel = sexLabels[sex];
    });

    return result;
  }

  /**
   * Format value for display
   */
  function formatValue(value, column) {
    if (value === null || value === undefined || isNaN(value)) return '—';
    if (column === 'body_mass_g') return value.toLocaleString();
    if (column === 'sex') return sexLabels[value] || 'Unknown';
    return Number(value).toFixed(1);
  }

  /**
   * Export data to CSV
   */
  function exportToCSV(data) {
    const headers = ['Species', 'Bill Length (mm)', 'Bill Depth (mm)', 'Flipper Length (mm)', 'Body Mass (g)', 'Sex'];
    const rows = data.map(d => [
      d.species,
      d.bill_length_mm.toFixed(1),
      d.bill_depth_mm.toFixed(1),
      d.flipper_length_mm.toFixed(1),
      d.body_mass_g.toFixed(1),
      sexLabels[d.sex]
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    return csv;
  }

  // Public API
  return {
    loadData,
    getRawData,
    getFilteredData,
    getBaseFilteredData,
    getChartData,
    getSelectedData,
    setBrushSelection,
    getBrushSelection,
    clearBrushSelection,
    isSelected,
    getSpeciesCounts,
    getCorrelationMatrix,
    getRegressionData,
    getViolinData,
    getViolinDataBySex,
    formatValue,
    exportToCSV,
    axisLabels,
    speciesColors,
    sexLabels,
    numericColumns
  };
})();

// Export for ES modules (if needed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DataLoader;
}