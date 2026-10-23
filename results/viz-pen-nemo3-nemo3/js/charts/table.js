/**
 * Data Table Chart Component
 * Penguin Data Dashboard
 * Sortable, paginated table with CSV export - Factory pattern
 */

function createDataTable() {
  'use strict';

  let config = {
    container: null,
    pageSize: 25,
    currentPage: 1,
    sortColumn: null,
    sortDirection: 'asc',
    onRowHover: null,
    onRowClick: null
  };

  let data = [];
  let filteredData = [];
  let highlightedIndex = null;

  // Column definitions
  const columns = [
    { key: 'species', label: 'Species', type: 'string' },
    { key: 'bill_length_mm', label: 'Bill Length (mm)', type: 'number', format: d => d.toFixed(1) },
    { key: 'bill_depth_mm', label: 'Bill Depth (mm)', type: 'number', format: d => d.toFixed(1) },
    { key: 'flipper_length_mm', label: 'Flipper Length (mm)', type: 'number', format: d => d.toFixed(1) },
    { key: 'body_mass_g', label: 'Body Mass (g)', type: 'number', format: d => d.toLocaleString() },
    { key: 'sex', label: 'Sex', type: 'category', format: d => DataLoader.sexLabels[d] }
  ];

  /**
   * Initialize the table
   */
  function init(userConfig) {
    config = { ...config, ...userConfig };
    const container = d3.select(config.container);

    // Table element already exists in HTML, just bind events
    bindEvents();

    return table;
  }

  /**
   * Bind table events
   */
  function bindEvents() {
    const table = d3.select('#data-table');

    // Sort headers
    table.selectAll('th[data-sort]')
      .on('click', handleSort)
      .on('keydown', handleSortKeydown);

    // Row events - use event delegation
    table.select('tbody')
      .on('mouseover', 'tr', handleRowMouseOver)
      .on('mouseout', 'tr', handleRowMouseOut)
      .on('click', 'tr', handleRowClick);

    // Pagination
    d3.select('#prev-page').on('click', () => goToPage(config.currentPage - 1));
    d3.select('#next-page').on('click', () => goToPage(config.currentPage + 1));
    d3.select('#page-size').on('change', handlePageSizeChange);

    // Export
    d3.select('#export-csv').on('click', exportCSV);
  }

  /**
   * Handle sort click
   */
  function handleSort(event) {
    const th = d3.select(event.currentTarget);
    const column = th.attr('data-sort');

    if (config.sortColumn === column) {
      config.sortDirection = config.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      config.sortColumn = column;
      config.sortDirection = 'asc';
    }

    config.currentPage = 1;
    render();
    announceSortChange(column, config.sortDirection);
  }

  /**
   * Handle sort keyboard
   */
  function handleSortKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSort(event);
    }
  }

  /**
   * Announce sort change for screen readers
   */
  function announceSortChange(column, direction) {
    const label = columns.find(c => c.key === column)?.label || column;
    const dirText = direction === 'asc' ? 'ascending' : 'descending';
    const announcement = `Sorted by ${label}, ${dirText}`;

    // Create or update live region
    let liveRegion = d3.select('#sort-announcement');
    if (liveRegion.empty()) {
      liveRegion = d3.select('body').append('div')
        .attr('id', 'sort-announcement')
        .attr('role', 'status')
        .attr('aria-live', 'polite')
        .attr('aria-atomic', 'true')
        .style('position', 'absolute')
        .style('left', '-9999px');
    }
    liveRegion.text(announcement);
  }

  /**
   * Handle page size change
   */
  function handlePageSizeChange(event) {
    config.pageSize = +event.target.value;
    config.currentPage = 1;
    render();
  }

  /**
   * Go to specific page
   */
  function goToPage(page) {
    const totalPages = Math.ceil(filteredData.length / config.pageSize);
    if (page < 1 || page > totalPages) return;
    config.currentPage = page;
    render();
  }

  /**
   * Update table with new data
   */
  function update(newData) {
    filteredData = newData;
    config.currentPage = 1;
    render();
    return table;
  }

  /**
   * Render table
   */
  function render() {
    // Apply sorting
    if (config.sortColumn) {
      const colDef = columns.find(c => c.key === config.sortColumn);
      filteredData.sort((a, b) => {
        let valA = a[config.sortColumn];
        let valB = b[config.sortColumn];

        if (colDef.type === 'number') {
          valA = +valA;
          valB = +valB;
        } else if (colDef.type === 'category') {
          valA = String(valA);
          valB = String(valB);
        }

        if (valA < valB) return config.sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return config.sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    // Update sort indicators
    updateSortIndicators();

    // Paginate
    const totalPages = Math.max(1, Math.ceil(filteredData.length / config.pageSize));
    config.currentPage = Math.min(config.currentPage, totalPages);

    const start = (config.currentPage - 1) * config.pageSize;
    const end = start + config.pageSize;
    const pageData = filteredData.slice(start, end);

    // Render rows
    const tbody = d3.select('#table-body');
    const rows = tbody.selectAll('tr')
      .data(pageData, d => d._index);

    // Exit
    rows.exit().remove();

    // Enter
    const enter = rows.enter()
      .append('tr')
      .attr('tabindex', 0)
      .attr('data-index', d => d._index);

    // Update + Enter
    rows.merge(enter)
      .attr('data-index', d => d._index)
      .classed('highlighted', d => d._index === highlightedIndex)
      .html(d => columns.map(col => {
        const value = d[col.key];
        const formatted = col.format ? col.format(value) : value;
        const className = col.key === 'species' ? 'species-cell' : (col.key === 'sex' ? 'sex-cell' : '');
        return `<td class="${className}" data-column="${col.key}">${formatted}</td>`;
      }).join(''));

    // Update pagination
    updatePagination(totalPages);

    // Update filtered count
    updateFilteredCount();
  }

  /**
   * Update sort indicator icons
   */
  function updateSortIndicators() {
    d3.selectAll('#data-table th[data-sort]')
      .attr('aria-sort', 'none')
      .each(function() {
        const th = d3.select(this);
        const col = th.attr('data-sort');
        if (col === config.sortColumn) {
          th.attr('aria-sort', config.sortDirection === 'asc' ? 'ascending' : 'descending');
        }
      });
  }

  /**
   * Update pagination controls
   */
  function updatePagination(totalPages) {
    d3.select('#prev-page').property('disabled', config.currentPage <= 1);
    d3.select('#next-page').property('disabled', config.currentPage >= totalPages);
    d3.select('#page-info').text(`Page ${config.currentPage} of ${totalPages}`);
  }

  /**
   * Update filtered count display
   */
  function updateFilteredCount() {
    const total = DataLoader.getRawData().length;
    const showing = filteredData.length;
    d3.select('#filtered-count').text(`Showing ${showing.toLocaleString()} of ${total.toLocaleString()} penguins`);
  }

  /**
   * Export to CSV
   */
  function exportCSV() {
    const csv = DataLoader.exportToCSV(filteredData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `penguins-filtered-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /**
   * Handle row mouse over
   */
  function handleRowMouseOver(event, d) {
    highlightedIndex = d._index;
    d3.select(event.currentTarget).classed('highlighted', true);

    if (config.onRowHover) {
      config.onRowHover(d, d._index);
    }
  }

  /**
   * Handle row mouse out
   */
  function handleRowMouseOut(event, d) {
    highlightedIndex = null;
    d3.select(event.currentTarget).classed('highlighted', false);

    if (config.onRowHover) {
      config.onRowHover(null, null);
    }
  }

  /**
   * Handle row click
   */
  function handleRowClick(event, d) {
    if (config.onRowClick) {
      config.onRowClick(d, d._index);
    }
  }

  /**
   * Set external highlight
   */
  function setHighlight(index) {
    highlightedIndex = index;
    d3.selectAll('#table-body tr')
      .classed('highlighted', d => d._index === index);

    // Scroll to row if not visible
    const row = d3.select(`#table-body tr[data-index="${index}"]`).node();
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /**
   * Clear external highlight
   */
  function clearHighlight() {
    highlightedIndex = null;
    d3.selectAll('#table-body tr').classed('highlighted', false);
  }

  /**
   * Get current page data
   */
  function getPageData() {
    const start = (config.currentPage - 1) * config.pageSize;
    const end = start + config.pageSize;
    return filteredData.slice(start, end);
  }

  /**
   * Get total filtered count
   */
  function getFilteredCount() {
    return filteredData.length;
  }

  // Public API
  const table = {
    init,
    update,
    updateFilteredCount,
    setHighlight,
    clearHighlight,
    getPageData,
    getFilteredCount,
    goToPage,
    exportCSV
  };

  return table;
}

// Export factory function
const DataTable = createDataTable;

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DataTable;
}