/**
 * Violin/Box Plot Chart Component
 * Penguin Data Dashboard
 * Shows body mass distribution by species and sex - Factory pattern
 */

function createViolinChart() {
  'use strict';

  let config = {
    container: null,
    width: 0,
    height: 0,
    margin: { top: 30, right: 20, bottom: 50, left: 60 },
    valueColumn: 'body_mass_g',
    onHover: null,
    onClick: null
  };

  let svg = null;
  let g = null;
  let yScale = null;
  let xScale = null;
  let yAxis = null;
  let data = [];
  let tooltip = null;
  let highlightedElement = null;

  // Species colors
  const speciesColors = DataLoader.speciesColors;
  const sexLabels = DataLoader.sexLabels;

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
      .domain(['Adelie', 'Gentoo', 'Chinstrap'])
      .range([0, config.innerWidth])
      .padding(0.3);

    yScale = d3.scaleLinear();

    // Y axis
    yAxis = g.append('g')
      .attr('class', 'axis y-axis');

    // Y axis label
    g.append('text')
      .attr('class', 'y-axis-label')
      .attr('text-anchor', 'middle')
      .attr('transform', 'rotate(-90)')
      .attr('x', -config.innerHeight / 2)
      .attr('y', -45)
      .text('Body Mass (g)');

    // Grid
    g.append('g')
      .attr('class', 'grid y-grid');

    // Legend
    const legend = g.append('g')
      .attr('class', 'legend')
      .attr('transform', `translate(${config.innerWidth - 120}, -25)`);

    // Female legend
    legend.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', 12)
      .attr('height', 12)
      .attr('fill', 'none')
      .attr('stroke', getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim())
      .attr('stroke-width', 1.5);

    legend.append('text')
      .attr('class', 'legend-label')
      .attr('x', 18)
      .attr('y', 9)
      .text('Female');

    // Male legend
    legend.append('rect')
      .attr('x', 0)
      .attr('y', 18)
      .attr('width', 12)
      .attr('height', 12)
      .attr('fill', getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim())
      .attr('stroke', 'none');

    legend.append('text')
      .attr('class', 'legend-label')
      .attr('x', 18)
      .attr('y', 27)
      .text('Male');

    // Violins group
    g.append('g')
      .attr('class', 'violins-group');

    // Box plots group
    g.append('g')
      .attr('class', 'boxplots-group');

    return chart;
  }

  /**
   * Update chart with new data
   */
  function update(newData) {
    data = newData;

    // Get violin data split by sex
    const violinData = getCombinedViolinData();

    updateScales(violinData);
    updateAxes();
    updateViolins(violinData);
    updateBoxPlots(violinData);

    return chart;
  }

  /**
   * Get combined violin data for all species and sexes
   */
  function getCombinedViolinData() {
    const species = ['Adelie', 'Gentoo', 'Chinstrap'];
    const result = [];

    species.forEach(sp => {
      const spData = data.filter(d => d.species === sp);
      [0, 1].forEach(sex => {
        const sexData = spData.filter(d => d.sex === sex);
        if (sexData.length === 0) return;

        const violin = DataLoader.getViolinData(sexData, 'species', config.valueColumn)[0];
        if (violin) {
          violin.species = sp;
          violin.sex = sex;
          violin.sexLabel = sexLabels[sex];
          violin.color = speciesColors[sp];
          result.push(violin);
        }
      });
    });

    return result;
  }

  /**
   * Update scales
   */
  function updateScales(violinData) {
    const allValues = data.map(d => d[config.valueColumn]).filter(v => !isNaN(v));
    const padding = (d3.max(allValues) - d3.min(allValues)) * 0.05 || 100;

    yScale.domain([d3.max(allValues) + padding, d3.min(allValues) - padding])
      .range([0, config.innerHeight]);
  }

  /**
   * Update axes
   */
  function updateAxes() {
    const tickCount = Math.min(8, Math.max(4, config.innerHeight / 50));

    yAxis.transition().duration(300)
      .call(d3.axisLeft(yScale).ticks(tickCount).tickSize(-config.innerWidth).tickPadding(8)
        .tickFormat(d => d3.format(',')(d)));

    g.select('.y-grid')
      .transition().duration(300)
      .call(d3.axisLeft(yScale).ticks(tickCount).tickSize(-config.innerWidth).tickFormat(''));
  }

  /**
   * Update violin plots
   */
  function updateViolins(violinData) {
    const violinsGroup = g.select('.violins-group');

    const violins = violinsGroup.selectAll('.violin-group')
      .data(violinData, d => `${d.species}-${d.sex}`);

    // Exit
    violins.exit()
      .transition().duration(200)
      .style('opacity', 0)
      .remove();

    // Enter
    const enter = violins.enter()
      .append('g')
      .attr('class', d => `violin-group species-${d.species.toLowerCase()} sex-${d.sex}`)
      .attr('transform', d => `translate(${xScale(d.species) + xScale.bandwidth() / 2}, 0)`)
      .style('opacity', 0);

    // Violin shape
    enter.append('path')
      .attr('class', 'violin-path')
      .attr('fill', d => d.color)
      .attr('opacity', 0.4)
      .attr('stroke', 'none');

    // Update + Enter
    violins.merge(enter)
      .transition().duration(300)
      .attr('transform', d => `translate(${xScale(d.species) + xScale.bandwidth() / 2}, 0)`)
      .style('opacity', 1);

    // Update violin paths
    const maxDensity = Math.max(...violinData.flatMap(v => v.density.map(d => d.scaledY || 0)));
    const violinWidth = xScale.bandwidth() * 0.4;

    violinsGroup.selectAll('.violin-path')
      .data(violinData, d => `${d.species}-${d.sex}`)
      .join('path')
      .attr('class', 'violin-path')
      .attr('fill', d => d.color)
      .attr('opacity', 0.4)
      .attr('d', d => {
        if (!d.density || d.density.length === 0) return '';
        const left = d3.line()
          .x(d => -violinWidth * (d.scaledY || 0))
          .y(d => yScale(d.x))
          .curve(d3.curveCatmullRom);

        const right = d3.line()
          .x(d => violinWidth * (d.scaledY || 0))
          .y(d => yScale(d.x))
          .curve(d3.curveCatmullRom);

        const sortedDensity = [...d.density].sort((a, b) => a.x - b.x);
        const leftPath = left(sortedDensity);
        const rightPath = right([...sortedDensity].reverse());
        return `M${leftPath}L${rightPath}Z`;
      });
  }

  /**
   * Update box plots
   */
  function updateBoxPlots(violinData) {
    const boxGroup = g.select('.boxplots-group');

    const boxes = boxGroup.selectAll('.box-plot-group')
      .data(violinData, d => `${d.species}-${d.sex}`);

    // Exit
    boxes.exit()
      .transition().duration(200)
      .style('opacity', 0)
      .remove();

    // Enter
    const enter = boxes.enter()
      .append('g')
      .attr('class', d => `box-plot-group species-${d.species.toLowerCase()} sex-${d.sex}`)
      .attr('transform', d => `translate(${xScale(d.species) + xScale.bandwidth() / 2}, 0)`)
      .style('opacity', 0);

    // Box
    enter.append('rect')
      .attr('class', 'box-plot-box')
      .attr('x', d => d.sex === 0 ? -8 : 0)
      .attr('width', 8)
      .attr('rx', 1)
      .attr('ry', 1)
      .attr('fill', d => d.color)
      .attr('opacity', 0.5)
      .attr('stroke', d => d.color)
      .attr('stroke-width', 1.5);

    // Median line
    enter.append('line')
      .attr('class', 'box-plot-median')
      .attr('x1', d => d.sex === 0 ? -8 : 0)
      .attr('x2', d => d.sex === 0 ? 0 : 8);

    // Whiskers
    enter.append('line')
      .attr('class', 'box-plot-whisker')
      .attr('x1', d => d.sex === 0 ? -4 : 4)
      .attr('x2', d => d.sex === 0 ? -4 : 4);

    enter.append('line')
      .attr('class', 'box-plot-whisker')
      .attr('x1', d => d.sex === 0 ? -4 : 4)
      .attr('x2', d => d.sex === 0 ? -4 : 4);

    // Whisker caps
    enter.append('line')
      .attr('class', 'box-plot-whisker-cap')
      .attr('x1', d => d.sex === 0 ? -6 : 2)
      .attr('x2', d => d.sex === 0 ? -2 : 6);

    enter.append('line')
      .attr('class', 'box-plot-whisker-cap')
      .attr('x1', d => d.sex === 0 ? -6 : 2)
      .attr('x2', d => d.sex === 0 ? -2 : 6);

    // Outliers
    enter.append('g')
      .attr('class', 'box-plot-outliers');

    // Update + Enter
    boxes.merge(enter)
      .transition().duration(300)
      .attr('transform', d => `translate(${xScale(d.species) + xScale.bandwidth() / 2}, 0)`)
      .style('opacity', 1);

    // Update box positions and dimensions
    boxGroup.selectAll('.box-plot-box')
      .data(violinData, d => `${d.species}-${d.sex}`)
      .join('rect')
      .attr('class', 'box-plot-box')
      .attr('x', d => d.sex === 0 ? -8 : 0)
      .attr('width', 8)
      .attr('y', d => d.stats ? yScale(d.stats.q3) : 0)
      .attr('height', d => d.stats ? yScale(d.stats.q1) - yScale(d.stats.q3) : 0)
      .attr('fill', d => d.color)
      .attr('opacity', 0.5)
      .attr('stroke', d => d.color)
      .attr('stroke-width', 1.5)
      .attr('rx', 1)
      .attr('ry', 1);

    // Update median
    boxGroup.selectAll('.box-plot-median')
      .data(violinData, d => `${d.species}-${d.sex}`)
      .join('line')
      .attr('class', 'box-plot-median')
      .attr('x1', d => d.sex === 0 ? -8 : 0)
      .attr('x2', d => d.sex === 0 ? 0 : 8)
      .attr('y1', d => d.stats ? yScale(d.stats.median) : 0)
      .attr('y2', d => d.stats ? yScale(d.stats.median) : 0)
      .attr('stroke', getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim())
      .attr('stroke-width', 2)
      .attr('stroke-linecap', 'round');

    // Update whiskers
    boxGroup.selectAll('.box-plot-whisker')
      .data(violinData.flatMap(d => d.stats ? [
        { ...d, type: 'lower', y: yScale(d.stats.lowerWhisker) },
        { ...d, type: 'upper', y: yScale(d.stats.upperWhisker) }
      ] : []))
      .join('line')
      .attr('class', 'box-plot-whisker')
      .attr('x1', d => d.sex === 0 ? -4 : 4)
      .attr('x2', d => d.sex === 0 ? -4 : 4)
      .attr('y1', d => d.type === 'lower' ? d.y : (d.stats ? yScale(d.stats.q1) : 0))
      .attr('y2', d => d.type === 'upper' ? d.y : (d.stats ? yScale(d.stats.q3) : 0))
      .attr('stroke', getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim())
      .attr('stroke-width', 1);

    // Update whisker caps
    boxGroup.selectAll('.box-plot-whisker-cap')
      .data(violinData.flatMap(d => d.stats ? [
        { ...d, type: 'lower', y: yScale(d.stats.lowerWhisker) },
        { ...d, type: 'upper', y: yScale(d.stats.upperWhisker) }
      ] : []))
      .join('line')
      .attr('class', 'box-plot-whisker-cap')
      .attr('x1', d => d.sex === 0 ? -6 : 2)
      .attr('x2', d => d.sex === 0 ? -2 : 6)
      .attr('y1', d => d.y)
      .attr('y2', d => d.y)
      .attr('stroke', getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim())
      .attr('stroke-width', 1);

    // Update outliers
    const outlierGroups = boxGroup.selectAll('.box-plot-outliers')
      .data(violinData, d => `${d.species}-${d.sex}`);

    outlierGroups.join('g')
      .attr('class', 'box-plot-outliers')
      .selectAll('.box-plot-outlier')
      .data(d => d.stats ? d.stats.outliers.map(v => ({ value: v, color: d.color, sex: d.sex })) : [])
      .join('circle')
      .attr('class', 'box-plot-outlier')
      .attr('cx', d => d.sex === 0 ? -4 : 4)
      .attr('cy', d => yScale(d.value))
      .attr('r', 2.5)
      .attr('fill', d => d.color)
      .attr('opacity', 0.6);
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

    yAxis.attr('transform', 'translate(0,0)');
    g.select('.y-grid').attr('transform', 'translate(0,0)');
    g.select('.y-axis-label').attr('x', -config.innerHeight / 2);
    g.select('.legend').attr('transform', `translate(${config.innerWidth - 120}, -25)`);

    if (data.length > 0) update(data);
  }

  /**
   * Set highlight from external source
   */
  function setHighlight(species, sex) {
    g.selectAll('.violin-group, .box-plot-group')
      .classed('highlighted', d => d.species === species && d.sex === sex);
  }

  /**
   * Clear external highlight
   */
  function clearHighlight() {
    g.selectAll('.violin-group, .box-plot-group').classed('highlighted', false);
  }

  // Public API
  const chart = {
    init,
    update,
    resize,
    setHighlight,
    clearHighlight
  };

  return chart;
}

// Export factory function
const ViolinChart = createViolinChart;

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ViolinChart;
}