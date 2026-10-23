/**
 * Scatter Plot Chart Component
 * Penguin Data Dashboard
 * Reusable chart with brushing support - Factory pattern for multiple instances
 */

function createScatterChart() {
  'use strict';

  let config = {
    container: null,
    width: 0,
    height: 0,
    margin: { top: 30, right: 20, bottom: 50, left: 60 },
    xColumn: 'bill_length_mm',
    yColumn: 'bill_depth_mm',
    showRegression: false,
    onBrush: null,
    onHover: null,
    onClick: null
  };

  let svg = null;
  let g = null;
  let xScale = null;
  let yScale = null;
  let xAxis = null;
  let yAxis = null;
  let brush = null;
  let data = [];
  let tooltip = null;
  let highlightedIndex = null;

  // Species colors from data module
  const speciesColors = DataLoader.speciesColors;

  /**
   * Initialize the chart
   */
  function init(userConfig) {
    config = { ...config, ...userConfig };
    const container = d3.select(config.container);

    // Clear container
    container.selectAll('*').remove();

    // Create tooltip reference
    tooltip = d3.select('#tooltip');

    // Set inner dimensions first
    config.innerWidth = config.width - config.margin.left - config.margin.right;
    config.innerHeight = config.height - config.margin.top - config.margin.bottom;

    // Create SVG
    svg = container.append('svg')
      .attr('viewBox', `0 0 ${config.width} ${config.height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .style('width', '100%')
      .style('height', '100%')
      .style('display', 'block');

    // Main group
    g = svg.append('g')
      .attr('transform', `translate(${config.margin.left},${config.margin.top})`);

    // Initialize scales
    xScale = d3.scaleLinear();
    yScale = d3.scaleLinear();

    // Initialize axes
    xAxis = g.append('g')
      .attr('class', 'axis x-axis')
      .attr('transform', `translate(0,${config.innerHeight})`);

    yAxis = g.append('g')
      .attr('class', 'axis y-axis');

    // Axis labels
    g.append('text')
      .attr('class', 'x-axis-label')
      .attr('text-anchor', 'middle')
      .attr('x', config.innerWidth / 2)
      .attr('y', config.innerHeight + 40);

    g.append('text')
      .attr('class', 'y-axis-label')
      .attr('text-anchor', 'middle')
      .attr('transform', 'rotate(-90)')
      .attr('x', -config.innerHeight / 2)
      .attr('y', -45);

    // Grid lines
    g.append('g')
      .attr('class', 'grid x-grid')
      .attr('transform', `translate(0,${config.innerHeight})`);

    g.append('g')
      .attr('class', 'grid y-grid');

    // Clip path for points
    const clipId = `clip-${config.container.replace('#', '')}-${Math.random().toString(36).substr(2, 9)}`;
    svg.append('defs')
      .append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('width', config.innerWidth)
      .attr('height', config.innerHeight);

    // Points group (clipped)
    g.append('g')
      .attr('class', 'points-group')
      .attr('clip-path', `url(#${clipId})`);

    // Regression lines group
    g.append('g')
      .attr('class', 'regression-group')
      .attr('clip-path', `url(#${clipId})`);

    // Brush
    brush = d3.brush()
      .extent([[0, 0], [config.innerWidth, config.innerHeight]])
      .on('brush', brushed)
      .on('end', brushEnd);

    g.append('g')
      .attr('class', 'brush')
      .call(brush);

    return chart;
  }

  /**
   * Update chart with new data
   */
  function update(newData, options = {}) {
    data = newData;

    // Update scales
    updateScales(options);

    // Update axes
    updateAxes();

    // Update points
    updatePoints(options);

    // Update regression lines if enabled
    if (config.showRegression) {
      updateRegressionLines();
    } else {
      g.select('.regression-group').selectAll('*').remove();
    }

    // Update axis labels
    updateAxisLabels();

    return chart;
  }

  /**
   * Update scales based on data
   */
  function updateScales(options) {
    const xCol = options.xColumn || config.xColumn;
    const yCol = options.yColumn || config.yColumn;

    const xValues = data.map(d => d[xCol]).filter(v => !isNaN(v));
    const yValues = data.map(d => d[yCol]).filter(v => !isNaN(v));

    const xPadding = (d3.max(xValues) - d3.min(xValues)) * 0.05 || 1;
    const yPadding = (d3.max(yValues) - d3.min(yValues)) * 0.05 || 1;

    xScale.domain([d3.min(xValues) - xPadding, d3.max(xValues) + xPadding])
      .range([0, config.innerWidth]);

    yScale.domain([d3.max(yValues) + yPadding, d3.min(yValues) - yPadding])
      .range([0, config.innerHeight]);
  }

  /**
   * Update axes
   */
  function updateAxes() {
    const tickCount = Math.min(8, Math.max(4, config.innerWidth / 80));

    xAxis.transition().duration(300)
      .call(d3.axisBottom(xScale).ticks(tickCount).tickSize(-config.innerHeight).tickPadding(8));

    yAxis.transition().duration(300)
      .call(d3.axisLeft(yScale).ticks(tickCount).tickSize(-config.innerWidth).tickPadding(8));

    // Update grids
    g.select('.x-grid')
      .transition().duration(300)
      .call(d3.axisBottom(xScale).ticks(tickCount).tickSize(-config.innerHeight).tickFormat(''));

    g.select('.y-grid')
      .transition().duration(300)
      .call(d3.axisLeft(yScale).ticks(tickCount).tickSize(-config.innerWidth).tickFormat(''));
  }

  /**
   * Update axis labels
   */
  function updateAxisLabels() {
    const xCol = config.xColumn;
    const yCol = config.yColumn;

    g.select('.x-axis-label')
      .text(DataLoader.axisLabels[xCol] || xCol);

    g.select('.y-axis-label')
      .text(DataLoader.axisLabels[yCol] || yCol);
  }

  /**
   * Update scatter points
   */
  function updatePoints(options) {
    const pointsGroup = g.select('.points-group');
    const xCol = options.xColumn || config.xColumn;
    const yCol = options.yColumn || config.yColumn;

    const points = pointsGroup.selectAll('.scatter-point')
      .data(data, d => d._index);

    // Exit
    points.exit()
      .transition().duration(200)
      .attr('r', 0)
      .remove();

    // Enter
    const enter = points.enter()
      .append('circle')
      .attr('class', d => `scatter-point species-${d.species.toLowerCase()} sex-${d.sex}`)
      .attr('cx', d => xScale(d[xCol]))
      .attr('cy', d => yScale(d[yCol]))
      .attr('r', 0)
      .attr('fill', d => d._color)
      .attr('opacity', 0.8)
      .style('cursor', 'crosshair')
      .on('mouseover', handleMouseOver)
      .on('mousemove', handleMouseMove)
      .on('mouseout', handleMouseOut)
      .on('click', handleClick);

    // Update + Enter
    points.merge(enter)
      .transition().duration(300)
      .attr('cx', d => xScale(d[xCol]))
      .attr('cy', d => yScale(d[yCol]))
      .attr('r', 4.5)
      .attr('class', d => `scatter-point species-${d.species.toLowerCase()} sex-${d.sex}`)
      .attr('fill', d => d._color)
      .attr('opacity', d => DataLoader.isSelected(d._index) ? 1 : 0.8);

    // Apply selection styling
    applySelectionStyling();
  }

  /**
   * Update regression lines
   */
  function updateRegressionLines() {
    const regGroup = g.select('.regression-group');
    const xCol = config.xColumn;
    const yCol = config.yColumn;

    const species = ['Adelie', 'Gentoo', 'Chinstrap'];

    species.forEach(sp => {
      const regData = DataLoader.getRegressionData(data, xCol, yCol, sp);
      if (!regData) return;

      const line = d3.line()
        .x(d => xScale(d.x))
        .y(d => yScale(d.y))
        .curve(d3.curveLinear);

      // Confidence band
      const area = d3.area()
        .x(d => xScale(d.x))
        .y0(d => yScale(d.yUpper))
        .y1(d => yScale(d.yLower))
        .curve(d3.curveLinear);

      // Draw confidence band
      regGroup.selectAll(`.confidence-${sp.toLowerCase()}`)
        .data([regData.confidenceData])
        .join('path')
        .attr('class', `confidence-band confidence-${sp.toLowerCase()}`)
        .attr('d', area)
        .attr('fill', regData.color)
        .attr('opacity', 0.15);

      // Draw regression line
      regGroup.selectAll(`.regression-${sp.toLowerCase()}`)
        .data([regData.lineData])
        .join('path')
        .attr('class', `regression-line regression-${sp.toLowerCase()}`)
        .attr('d', line)
        .attr('stroke', regData.color)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4,2')
        .attr('fill', 'none')
        .attr('opacity', 0.8);
    });
  }

  /**
   * Apply selection styling to points
   */
  function applySelectionStyling() {
    const hasSelection = DataLoader.getBrushSelection() !== null &&
      DataLoader.getBrushSelection().length > 0;

    g.selectAll('.scatter-point')
      .classed('selected', d => hasSelection && DataLoader.isSelected(d._index))
      .classed('unselected', d => hasSelection && !DataLoader.isSelected(d._index));
  }

  /**
   * Mouse over handler
   */
  function handleMouseOver(event, d) {
    highlightedIndex = d._index;

    // Highlight point
    d3.select(event.currentTarget)
      .raise()
      .transition().duration(100)
      .attr('r', 7)
      .attr('stroke-width', 2)
      .attr('stroke', getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim());

    // Show tooltip
    showTooltip(event, d);

    // Notify hover callback
    if (config.onHover) {
      config.onHover(d, highlightedIndex);
    }
  }

  /**
   * Mouse move handler
   */
  function handleMouseMove(event, d) {
    positionTooltip(event);
  }

  /**
   * Mouse out handler
   */
  function handleMouseOut(event, d) {
    highlightedIndex = null;

    d3.select(event.currentTarget)
      .transition().duration(200)
      .attr('r', 4.5)
      .attr('stroke-width', 1)
      .attr('stroke', getComputedStyle(document.documentElement).getPropertyValue('--bg-card').trim());

    hideTooltip();

    if (config.onHover) {
      config.onHover(null, null);
    }
  }

  /**
   * Click handler
   */
  function handleClick(event, d) {
    event.stopPropagation();
    if (config.onClick) {
      config.onClick(d, d._index);
    }
  }

  /**
   * Show tooltip
   */
  function showTooltip(event, d) {
    const html = `
      <div class="tooltip-title" style="color: ${d._color}">${d.species} Penguin</div>
      <div class="tooltip-row"><span class="tooltip-label">Sex:</span><span class="tooltip-value">${d._sexLabel}</span></div>
      <div class="tooltip-row"><span class="tooltip-label">Bill Length:</span><span class="tooltip-value">${d.bill_length_mm.toFixed(1)} mm</span></div>
      <div class="tooltip-row"><span class="tooltip-label">Bill Depth:</span><span class="tooltip-value">${d.bill_depth_mm.toFixed(1)} mm</span></div>
      <div class="tooltip-row"><span class="tooltip-label">Flipper Length:</span><span class="tooltip-value">${d.flipper_length_mm.toFixed(1)} mm</span></div>
      <div class="tooltip-row"><span class="tooltip-label">Body Mass:</span><span class="tooltip-value">${d.body_mass_g.toLocaleString()} g</span></div>
    `;

    tooltip.html(html)
      .classed('visible', true)
      .style('left', `${event.clientX + 15}px`)
      .style('top', `${event.clientY - 10}px`);
  }

  /**
   * Position tooltip
   */
  function positionTooltip(event) {
    const tooltipNode = tooltip.node();
    const tooltipRect = tooltipNode.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = event.clientX + 15;
    let top = event.clientY - tooltipRect.height - 10;

    if (left + tooltipRect.width > viewportWidth - 10) {
      left = event.clientX - tooltipRect.width - 15;
    }
    if (top < 10) {
      top = event.clientY + 15;
    }

    tooltip.style('left', `${left}px`).style('top', `${top}px`);
  }

  /**
   * Hide tooltip
   */
  function hideTooltip() {
    tooltip.classed('visible', false);
  }

  /**
   * Brush event handler
   */
  function brushed(event) {
    if (!event.selection) return;

    const [[x0, y0], [x1, y1]] = event.selection;

    const selected = data.filter(d => {
      const x = xScale(d[config.xColumn]);
      const y = yScale(d[config.yColumn]);
      return x >= x0 && x <= x1 && y >= y0 && y <= y1;
    }).map(d => d._index);

    // Visual feedback during brush
    g.selectAll('.scatter-point')
      .classed('selected', d => selected.includes(d._index))
      .classed('unselected', d => !selected.includes(d._index));
  }

  /**
   * Brush end handler
   */
  function brushEnd(event) {
    if (!event.selection) {
      // Clear selection
      DataLoader.clearBrushSelection();
      g.selectAll('.scatter-point')
        .classed('selected', false)
        .classed('unselected', false);
      if (config.onBrush) {
        config.onBrush(null);
      }
      return;
    }

    const [[x0, y0], [x1, y1]] = event.selection;

    const selected = data.filter(d => {
      const x = xScale(d[config.xColumn]);
      const y = yScale(d[config.yColumn]);
      return x >= x0 && x <= x1 && y >= y0 && y <= y1;
    }).map(d => d._index);

    DataLoader.setBrushSelection(selected);

    if (config.onBrush) {
      config.onBrush(selected);
    }
  }

  /**
   * Clear brush selection programmatically
   */
  function clearBrush() {
    g.select('.brush').call(brush.move, null);
    DataLoader.clearBrushSelection();
    g.selectAll('.scatter-point')
      .classed('selected', false)
      .classed('unselected', false);
  }

  /**
   * Set highlight from external source (e.g., table row hover)
   */
  function setHighlight(index) {
    highlightedIndex = index;
    g.selectAll('.scatter-point')
      .classed('highlighted', d => d._index === index);
  }

  /**
   * Clear external highlight
   */
  function clearHighlight() {
    highlightedIndex = null;
    g.selectAll('.scatter-point').classed('highlighted', false);
  }

  /**
   * Resize chart
   */
  function resize(width, height) {
    config.width = width;
    config.height = height;
    config.innerWidth = width - config.margin.left - config.margin.right;
    config.innerHeight = height - config.margin.top - config.margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`);

    xScale.range([0, config.innerWidth]);
    yScale.range([config.innerHeight, 0]);

    xAxis.attr('transform', `translate(0,${config.innerHeight})`);
    g.select('.x-grid').attr('transform', `translate(0,${config.innerHeight})`);
    g.select('.x-axis-label').attr('x', config.innerWidth / 2).attr('y', config.innerHeight + 40);
    g.select('.y-axis-label').attr('x', -config.innerHeight / 2);

    brush.extent([[0, 0], [config.innerWidth, config.innerHeight]]);

    update(data);
  }

  /**
   * Set X column
   */
  function setXColumn(column) {
    config.xColumn = column;
    if (data.length > 0) update(data);
  }

  /**
   * Set Y column
   */
  function setYColumn(column) {
    config.yColumn = column;
    if (data.length > 0) update(data);
  }

  /**
   * Toggle regression lines
   */
  function setShowRegression(show) {
    config.showRegression = show;
    if (data.length > 0) update(data);
  }

  // Public API
  const chart = {
    init,
    update,
    resize,
    clearBrush,
    setHighlight,
    clearHighlight,
    setXColumn,
    setYColumn,
    setShowRegression,
    getConfig: () => config
  };

  return chart;
}

// Export factory function
const ScatterChart = createScatterChart;

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScatterChart;
}