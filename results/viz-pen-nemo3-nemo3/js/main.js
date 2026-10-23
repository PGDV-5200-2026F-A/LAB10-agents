/**
 * Main Dashboard Orchestration
 * Penguin Data Dashboard
 * Coordinates all charts, controls, and cross-filtering
 */

const Dashboard = (function() {
  'use strict';

  // Chart instances
  let scatter1 = null;  // Bill Length vs Bill Depth (with brushing)
  let scatter2 = null;  // Flipper Length vs Bill Length (with regression)
  let violin = null;    // Body Mass Distribution
  let heatmap = null;   // Correlation Heatmap
  let dataTable = null; // Data Table

  // State
  let isInitialized = false;
  let resizeObserver = null;

  // Chart containers
  const containers = {
    scatter1: '#scatter1-chart',
    scatter2: '#scatter2-chart',
    violin: '#violin-chart',
    heatmap: '#heatmap-chart'
  };

  /**
   * Initialize the dashboard
   */
  async function init() {
    try {
      // Show loading state
      showLoading(true);

      // Load data
      await DataLoader.loadData();

      // Initialize charts
      initializeCharts();

      // Initialize controls
      initializeControls();

      // Initialize table
      initializeTable();

      // Set up cross-filtering
      setupCrossFiltering();

      // Set up responsive resizing
      setupResizeObserver();

      // Initial render
      applyFilters();

      // Mark as initialized
      isInitialized = true;
      showLoading(false);

      console.log('Penguin Dashboard initialized successfully');

    } catch (error) {
      console.error('Failed to initialize dashboard:', error);
      showError(error.message);
    }
  }

  /**
   * Show/hide loading state
   */
  function showLoading(show) {
    const charts = document.querySelectorAll('.chart-wrapper');
    charts.forEach(chart => {
      if (show) {
        chart.style.opacity = '0.5';
        chart.style.pointerEvents = 'none';
      } else {
        chart.style.opacity = '1';
        chart.style.pointerEvents = 'auto';
      }
    });
  }

  /**
   * Show error state
   */
  function showError(message) {
    const charts = document.querySelectorAll('.chart-wrapper');
    charts.forEach(chart => {
      chart.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--color-text-muted);text-align:center;padding:2rem;">
          <p>Failed to load dashboard: ${message}</p>
        </div>
      `;
    });
  }

  /**
   * Initialize all chart components
   */
  function initializeCharts() {
    // Get chart dimensions
    const chartWidth = document.querySelector('.chart-wrapper').clientWidth || 500;
    const chartHeight = 400;

    // Scatter 1: Bill Length vs Bill Depth (with brushing)
    scatter1 = ScatterChart().init({
      container: containers.scatter1,
      width: chartWidth,
      height: chartHeight,
      xColumn: 'bill_length_mm',
      yColumn: 'bill_depth_mm',
      showRegression: false,
      onBrush: handleBrushSelection,
      onHover: handlePointHover,
      onClick: handlePointClick
    });

    // Scatter 2: Flipper Length vs Bill Length (with regression)
    scatter2 = ScatterChart().init({
      container: containers.scatter2,
      width: chartWidth,
      height: chartHeight,
      xColumn: 'flipper_length_mm',
      yColumn: 'bill_length_mm',
      showRegression: true,
      onBrush: null, // No brushing on this chart
      onHover: handlePointHover,
      onClick: handlePointClick
    });

    // Violin: Body Mass Distribution
    violin = ViolinChart().init({
      container: containers.violin,
      width: chartWidth,
      height: chartHeight,
      valueColumn: 'body_mass_g',
      onHover: handlePointHover,
      onClick: handlePointClick
    });

    // Heatmap: Correlation Matrix
    heatmap = HeatmapChart().init({
      container: containers.heatmap,
      width: chartWidth,
      height: chartHeight,
      onHover: handlePointHover
    });
  }

  /**
   * Initialize controls
   */
  function initializeControls() {
    Controls.init({
      onFilterChange: applyFilters,
      onAxisChange: handleAxisChange,
      onThemeChange: handleThemeChange,
      onReset: handleReset
    });
  }

  /**
   * Initialize data table
   */
  function initializeTable() {
    dataTable = DataTable().init({
      container: '#data-table',
      pageSize: 25,
      onRowHover: handleTableRowHover,
      onRowClick: handleTableRowClick
    });
  }

  /**
   * Set up cross-filtering between charts
   */
  function setupCrossFiltering() {
    // Cross-filtering is handled via:
    // 1. Controls -> applyFilters() -> updates all charts
    // 2. Scatter1 brush -> handleBrushSelection() -> updates all charts
    // 3. Table hover -> handleTableRowHover() -> highlights in charts
    // 4. Chart hover -> handlePointHover() -> highlights in table and other charts
  }

  /**
   * Set up resize observer for responsive charts
   */
  function setupResizeObserver() {
    resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.target.classList.contains('chart-wrapper')) {
          const width = entry.contentRect.width;
          const height = entry.contentRect.height || 400;

          // Update all charts
          [scatter1, scatter2, violin, heatmap].forEach(chart => {
            if (chart && chart.resize) {
              chart.resize(width, height);
            }
          });
        }
      }
    });

    document.querySelectorAll('.chart-wrapper').forEach(el => {
      resizeObserver.observe(el);
    });
  }

  /**
   * Apply current filters to all charts
   */
  function applyFilters() {
    const filterState = Controls.getState();

    // Get base filtered data (species + sex filters)
    const baseData = DataLoader.getBaseFilteredData(filterState.species, filterState.sex);

    // Update all charts with base data (they'll apply brush selection internally)
    scatter1.update(baseData, { xColumn: filterState.xAxis, yColumn: filterState.yAxis });
    scatter2.update(baseData, { xColumn: 'flipper_length_mm', yColumn: 'bill_length_mm' });
    violin.update(baseData);
    heatmap.update(baseData);

    // Update table
    dataTable.update(baseData);

    // Update summary stats
    updateSummaryStats(baseData);

    // Update filtered count
    dataTable.updateFilteredCount();
  }

  /**
   * Handle brush selection from scatter1
   */
  function handleBrushSelection(selectedIndices) {
    // The DataLoader already stores the brush selection
    // Charts will use it when they render via getChartData

    // Re-render all charts with brush applied
    const filterState = Controls.getState();
    const baseData = DataLoader.getBaseFilteredData(filterState.species, filterState.sex);

    // For scatter1, we need to pass the brush selection visually
    // The scatter1 chart handles its own brush visual feedback
    // Other charts need to filter by the brush selection

    // Update violin, heatmap, scatter2, table with brushed data
    const brushedData = DataLoader.getChartData(filterState.species, filterState.sex);

    scatter2.update(brushedData, { xColumn: 'flipper_length_mm', yColumn: 'bill_length_mm' });
    violin.update(brushedData);
    heatmap.update(brushedData);
    dataTable.update(brushedData);

    // Update summary stats for brushed data
    updateSummaryStats(brushedData);

    // Update filtered count
    const total = DataLoader.getRawData().length;
    const showing = brushedData.length;
    d3.select('#filtered-count').text(`Showing ${showing.toLocaleString()} of ${total.toLocaleString()} penguins (brushed)`);
  }

  /**
   * Handle point hover from any chart
   */
  function handlePointHover(d, index) {
    if (d && index !== null) {
      // Highlight in table
      dataTable.setHighlight(index);

      // Highlight in violin (by species and sex)
      violin.setHighlight(d.species, d.sex);
    } else {
      dataTable.clearHighlight();
      violin.clearHighlight();
    }
  }

  /**
   * Handle point click from any chart
   */
  function handlePointClick(d, index) {
    // Could show detail modal or pin tooltip
    console.log('Point clicked:', d);
  }

  /**
   * Handle table row hover
   */
  function handleTableRowHover(d, index) {
    if (d && index !== null) {
      // Highlight in scatter plots
      scatter1.setHighlight(index);
      scatter2.setHighlight(index);

      // Highlight in violin
      violin.setHighlight(d.species, d.sex);
    } else {
      scatter1.clearHighlight();
      scatter2.clearHighlight();
      violin.clearHighlight();
    }
  }

  /**
   * Handle table row click
   */
  function handleTableRowClick(d, index) {
    // Could show detail view
    console.log('Table row clicked:', d);
  }

  /**
   * Handle axis change from controls
   */
  function handleAxisChange(xAxis, yAxis) {
    const filterState = Controls.getState();
    const baseData = DataLoader.getBaseFilteredData(filterState.species, filterState.sex);

    // Update scatter1 with new axes
    scatter1.update(baseData, { xColumn: xAxis, yColumn: yAxis });

    // Update scatter2 if axes match its variables
    // (scatter2 is fixed to flipper vs bill length per requirements)
  }

  /**
   * Handle theme change
   */
  function handleThemeChange(theme) {
    // Force charts to re-render with new colors
    const filterState = Controls.getState();
    const baseData = DataLoader.getBaseFilteredData(filterState.species, filterState.sex);

    scatter1.update(baseData, { xColumn: filterState.xAxis, yColumn: filterState.yAxis });
    scatter2.update(baseData, { xColumn: 'flipper_length_mm', yColumn: 'bill_length_mm' });
    violin.update(baseData);
    heatmap.update(baseData);
  }

  /**
   * Handle reset
   */
  function handleReset() {
    // Clear brush selection
    scatter1.clearBrush();
    DataLoader.clearBrushSelection();

    // Re-apply filters (which are now reset)
    applyFilters();
  }

  /**
   * Update summary statistics in header
   */
  function updateSummaryStats(data) {
    const counts = DataLoader.getSpeciesCounts(data);

    d3.select('#stat-total').text(data.length.toLocaleString());
    d3.select('#stat-adelie').text(counts.Adelie.toLocaleString());
    d3.select('#stat-gentoo').text(counts.Gentoo.toLocaleString());
    d3.select('#stat-chinstrap').text(counts.Chinstrap.toLocaleString());
  }

  /**
   * Clean up resources
   */
  function destroy() {
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    isInitialized = false;
  }

  // Public API
  return {
    init,
    destroy,
    getCharts: () => ({ scatter1, scatter2, violin, heatmap, dataTable })
  };
})();

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  Dashboard.init();
});

// Handle page unload
window.addEventListener('beforeunload', () => {
  Dashboard.destroy();
});

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Dashboard;
}