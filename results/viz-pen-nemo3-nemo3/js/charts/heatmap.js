/**
 * Correlation Heatmap Chart Component
 * Penguin Data Dashboard
 * 5x5 correlation matrix with diverging color scale - Factory pattern
 */

function createHeatmapChart() {
  'use strict';

  let config = {
    container: null,
    width: 0,
    height: 0,
    margin: { top: 30, right: 80, bottom: 50, left: 80 },
    onHover: null
  };

  let svg = null;
  let g = null;
  let xScale = null;
  let yScale = null;
  let colorScale = null;
  let data = [];
  let correlationData = null;
  let tooltip = null;
  let gradientId = null;

  // Column labels
  const columnLabels = {
    'bill_length_mm': 'Bill Length',
    'bill_depth_mm': 'Bill Depth',
    'flipper_length_mm': 'Flipper Length',
    'body_mass_g': 'Body Mass'
  };

  const columns = ['bill_length_mm', 'bill_depth_mm', 'flipper_length_mm', 'body_mass_g'];

  /**
   * Initialize the chart
   */
  function init(userConfig) {
    config = { ...config, ...userConfig };
    const container = d3.select(config.container);

    container.selectAll('*').remove();
    tooltip = d3.select('#tooltip');

    config.innerWidth = config.width - config.margin.left - config.margin.right;
    config.innerHeight = config.height - config.margin.top - config.margin.bottom;

    // Generate unique gradient ID
    gradientId = `heatmap-gradient-${config.container.replace('#', '')}-${Math.random().toString(36).substr(2, 9)}`;

    svg = container.append('svg')
      .attr('viewBox', `0 0 ${config.width} ${config.height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .style('width', '100%')
      .style('height', '100%')
      .style('display', 'block');

    g = svg.append('g')
      .attr('transform', `translate(${config.margin.left},${config.margin.top})`);

    // Scales
    xScale = d3.scaleBand()
      .domain(columns)
      .range([0, config.innerWidth])
      .padding(0.02);

    yScale = d3.scaleBand()
      .domain([...columns].reverse())
      .range([0, config.innerHeight])
      .padding(0.02);

    // Diverging color scale for correlation (-1 to 1)
    colorScale = d3.scaleLinear()
      .domain([-1, 0, 1])
      .range([
        getComputedStyle(document.documentElement).getPropertyValue('--color-corr-neg').trim(),
        getComputedStyle(document.documentElement).getPropertyValue('--color-corr-zero').trim(),
        getComputedStyle(document.documentElement).getPropertyValue('--color-corr-pos').trim()
      ])
      .interpolate(d3.interpolateRgb);

    // Create gradient for legend
    createGradient();

    // Cells group
    g.append('g')
      .attr('class', 'heatmap-cells');

    // Text group
    g.append('g')
      .attr('class', 'heatmap-text');

    // X axis labels (top)
    g.append('g')
      .attr('class', 'axis x-axis')
      .attr('transform', 'translate(0,0)')
      .call(d3.axisTop(xScale).tickFormat(c => columnLabels[c]).tickSize(0).tickPadding(10))
      .selectAll('text')
      .style('text-anchor', 'start')
      .attr('transform', 'rotate(-45)')
      .attr('dx', '-0.5em')
      .attr('dy', '0.5em');

    // Y axis labels (left)
    g.append('g')
      .attr('class', 'axis y-axis')
      .call(d3.axisLeft(yScale).tickFormat(c => columnLabels[c]).tickSize(0).tickPadding(10));

    // Color legend
    const legendWidth = 20;
    const legendHeight = config.innerHeight * 0.6;
    const legendX = config.innerWidth + 30;
    const legendY = (config.innerHeight - legendHeight) / 2;

    const legendGroup = g.append('g')
      .attr('class', 'color-legend')
      .attr('transform', `translate(${legendX}, ${legendY})`);

    legendGroup.append('rect')
      .attr('width', legendWidth)
      .attr('height', legendHeight)
      .style('fill', `url(#${gradientId})`)
      .attr('stroke', getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim())
      .attr('stroke-width', 0.5);

    // Legend axis
    const legendScale = d3.scaleLinear()
      .domain([-1, 1])
      .range([legendHeight, 0]);

    const legendAxis = d3.axisRight(legendScale)
      .ticks(5)
      .tickSize(6)
      .tickFormat(d => d === 0 ? '0' : (d > 0 ? `+${d}` : d));

    legendGroup.append('g')
      .attr('class', 'axis legend-axis')
      .attr('transform', `translate(${legendWidth}, 0)`)
      .call(legendAxis);

    legendGroup.append('text')
      .attr('class', 'legend-label')
      .attr('text-anchor', 'middle')
      .attr('x', legendWidth / 2)
      .attr('y', -10)
      .text('Correlation');

    return chart;
  }

  /**
   * Create gradient definition
   */
  function createGradient() {
    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient')
      .attr('id', gradientId)
      .attr('x1', '0%')
      .attr('y1', '100%')
      .attr('x2', '0%')
      .attr('y2', '0%');

    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', colorScale(-1));
    gradient.append('stop')
      .attr('offset', '50%')
      .attr('stop-color', colorScale(0));
    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', colorScale(1));
  }

  /**
   * Update chart with new data
   */
  function update(newData) {
    data = newData;
    correlationData = DataLoader.getCorrelationMatrix(data);

    updateCells();
    updateText();

    return chart;
  }

  /**
   * Update heatmap cells
   */
  function updateCells() {
    const cellsGroup = g.select('.heatmap-cells');

    // Create cell data
    const cellData = [];
    correlationData.columns.forEach((col1, i) => {
      correlationData.columns.forEach((col2, j) => {
        cellData.push({
          x: col1,
          y: col2,
          value: correlationData.matrix[i][j],
          i, j
        });
      });
    });

    const cells = cellsGroup.selectAll('.heatmap-cell')
      .data(cellData, d => `${d.x}-${d.y}`);

    // Exit
    cells.exit()
      .transition().duration(200)
      .attr('width', 0)
      .attr('height', 0)
      .remove();

    // Enter
    const enter = cells.enter()
      .append('rect')
      .attr('class', 'heatmap-cell')
      .attr('x', d => xScale(d.x))
      .attr('y', d => yScale(d.y))
      .attr('width', 0)
      .attr('height', 0)
      .attr('fill', d => colorScale(d.value))
      .on('mouseover', handleMouseOver)
      .on('mousemove', handleMouseMove)
      .on('mouseout', handleMouseOut);

    // Update + Enter
    cells.merge(enter)
      .transition().duration(300)
      .attr('x', d => xScale(d.x))
      .attr('y', d => yScale(d.y))
      .attr('width', xScale.bandwidth())
      .attr('height', yScale.bandwidth())
      .attr('fill', d => colorScale(d.value));
  }

  /**
   * Update correlation text labels
   */
  function updateText() {
    const textGroup = g.select('.heatmap-text');

    const cellData = [];
    correlationData.columns.forEach((col1, i) => {
      correlationData.columns.forEach((col2, j) => {
        cellData.push({
          x: col1,
          y: col2,
          value: correlationData.matrix[i][j],
          i, j
        });
      });
    });

    const texts = textGroup.selectAll('.heatmap-text-label')
      .data(cellData, d => `${d.x}-${d.y}`);

    // Exit
    texts.exit()
      .transition().duration(200)
      .style('opacity', 0)
      .remove();

    // Enter
    const enter = texts.enter()
      .append('text')
      .attr('class', 'heatmap-text heatmap-text-label')
      .attr('x', d => xScale(d.x) + xScale.bandwidth() / 2)
      .attr('y', d => yScale(d.y) + yScale.bandwidth() / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-family', getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim())
      .attr('font-size', '0.75rem')
      .style('opacity', 0)
      .text(d => {
        if (d.i === d.j) return '1.00';
        return d.value.toFixed(2);
      });

    // Determine text color based on background
    enter.each(function(d) {
      const bgColor = d3.color(colorScale(d.value));
      const luminance = (0.299 * bgColor.r + 0.587 * bgColor.g + 0.114 * bgColor.b) / 255;
      d3.select(this).attr('fill', luminance > 0.5 ? '#212529' : '#FFFFFF');
    });

    // Update + Enter
    texts.merge(enter)
      .transition().duration(300)
      .attr('x', d => xScale(d.x) + xScale.bandwidth() / 2)
      .attr('y', d => yScale(d.y) + yScale.bandwidth() / 2)
      .style('opacity', 1)
      .text(d => {
        if (d.i === d.j) return '1.00';
        return d.value.toFixed(2);
      });
  }

  /**
   * Mouse over handler
   */
  function handleMouseOver(event, d) {
    if (d.i === d.j) return; // Don't show tooltip for diagonal

    const col1 = columnLabels[d.x];
    const col2 = columnLabels[d.y];

    const html = `
      <div class="tooltip-title">Correlation</div>
      <div class="tooltip-row"><span class="tooltip-label">${col1} vs ${col2}:</span><span class="tooltip-value">${d.value.toFixed(3)}</span></div>
      <div class="tooltip-row"><span class="tooltip-label">Strength:</span><span class="tooltip-value">${getCorrelationStrength(d.value)}</span></div>
    `;

    tooltip.html(html)
      .classed('visible', true)
      .style('left', `${event.clientX + 15}px`)
      .style('top', `${event.clientY - 10}px`);

    // Highlight cell
    d3.select(event.currentTarget)
      .attr('stroke', getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim())
      .attr('stroke-width', 2);

    if (config.onHover) {
      config.onHover(d);
    }
  }

  /**
   * Mouse move handler
   */
  function handleMouseMove(event, d) {
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
   * Mouse out handler
   */
  function handleMouseOut(event, d) {
    tooltip.classed('visible', false);

    d3.select(event.currentTarget)
      .attr('stroke', 'none')
      .attr('stroke-width', 0);

    if (config.onHover) {
      config.onHover(null);
    }
  }

  /**
   * Get correlation strength label
   */
  function getCorrelationStrength(r) {
    const absR = Math.abs(r);
    if (absR >= 0.7) return r > 0 ? 'Strong positive' : 'Strong negative';
    if (absR >= 0.5) return r > 0 ? 'Moderate positive' : 'Moderate negative';
    if (absR >= 0.3) return r > 0 ? 'Weak positive' : 'Weak negative';
    return 'Negligible';
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
    yScale.range([0, config.innerHeight]);

    g.attr('transform', `translate(${config.margin.left},${config.margin.top})`);

    // Update axes
    g.select('.x-axis').call(d3.axisTop(xScale).tickFormat(c => columnLabels[c]).tickSize(0).tickPadding(10));
    g.select('.y-axis').call(d3.axisLeft(yScale).tickFormat(c => columnLabels[c]).tickSize(0).tickPadding(10));

    // Update legend position
    const legendWidth = 20;
    const legendHeight = config.innerHeight * 0.6;
    const legendX = config.innerWidth + 30;
    const legendY = (config.innerHeight - legendHeight) / 2;
    g.select('.color-legend').attr('transform', `translate(${legendX}, ${legendY})`);

    // Recreate gradient with new colors (in case theme changed)
    const defs = svg.select('defs');
    if (!defs.empty()) {
      defs.selectAll('*').remove();
      createGradient();
    } else {
      svg.append('defs');
      createGradient();
    }

    if (data.length > 0) update(data);
  }

  // Public API
  const chart = {
    init,
    update,
    resize
  };

  return chart;
}

// Export factory function
const HeatmapChart = createHeatmapChart;

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HeatmapChart;
}