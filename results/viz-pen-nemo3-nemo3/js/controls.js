/**
 * Controls Module
 * Penguin Data Dashboard
 * Handles filter UI, debouncing, and event emission
 */

const Controls = (function() {
  'use strict';

  // Filter state
  let state = {
    species: ['Adelie', 'Gentoo', 'Chinstrap'],
    sex: 'all',
    xAxis: 'flipper_length_mm',
    yAxis: 'bill_depth_mm',
    theme: 'light'
  };

  // Callbacks
  let onFilterChange = null;
  let onAxisChange = null;
  let onThemeChange = null;
  let onReset = null;

  // Debounce timer
  let debounceTimer = null;
  const DEBOUNCE_MS = 150;

  // DOM elements
  let elements = {};

  /**
   * Initialize controls
   */
  function init(callbacks = {}) {
    onFilterChange = callbacks.onFilterChange || null;
    onAxisChange = callbacks.onAxisChange || null;
    onThemeChange = callbacks.onThemeChange || null;
    onReset = callbacks.onReset || null;

    cacheElements();
    bindEvents();
    restoreState();
    updateUI();
  }

  /**
   * Cache DOM elements
   */
  function cacheElements() {
    elements = {
      speciesCheckboxes: document.querySelectorAll('input[name="species"]'),
      sexRadios: document.querySelectorAll('input[name="sex"]'),
      xAxisSelect: document.getElementById('x-axis'),
      yAxisSelect: document.getElementById('y-axis'),
      themeRadios: document.querySelectorAll('input[name="theme"]'),
      resetBtn: document.getElementById('reset-filters'),
      toggleTableBtn: document.getElementById('toggle-table'),
      tableContainer: document.getElementById('data-table-container')
    };
  }

  /**
   * Bind event listeners
   */
  function bindEvents() {
    // Species checkboxes
    elements.speciesCheckboxes.forEach(checkbox => {
      checkbox.addEventListener('change', debouncedFilterChange);
      checkbox.addEventListener('keydown', handleCheckboxKeydown);
    });

    // Sex radios
    elements.sexRadios.forEach(radio => {
      radio.addEventListener('change', debouncedFilterChange);
    });

    // Axis selects
    elements.xAxisSelect.addEventListener('change', handleAxisChange);
    elements.yAxisSelect.addEventListener('change', handleAxisChange);

    // Theme radios
    elements.themeRadios.forEach(radio => {
      radio.addEventListener('change', handleThemeChange);
    });

    // Reset button
    elements.resetBtn.addEventListener('click', handleReset);

    // Table toggle
    elements.toggleTableBtn.addEventListener('click', toggleTable);
  }

  /**
   * Debounced filter change handler
   */
  function debouncedFilterChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      updateStateFromUI();
      emitFilterChange();
    }, DEBOUNCE_MS);
  }

  /**
   * Handle axis change (immediate)
   */
  function handleAxisChange() {
    const newX = elements.xAxisSelect.value;
    const newY = elements.yAxisSelect.value;

    if (newX === newY) {
      // Prevent same axis - swap the other one
      const otherSelect = event.target === elements.xAxisSelect ? elements.yAxisSelect : elements.xAxisSelect;
      const otherValue = otherSelect.value;

      if (event.target === elements.xAxisSelect) {
        elements.yAxisSelect.value = state.xAxis;
      } else {
        elements.xAxisSelect.value = state.yAxis;
      }

      // Show brief error feedback
      showAxisError(event.target);
      return;
    }

    state.xAxis = newX;
    state.yAxis = newY;

    if (onAxisChange) {
      onAxisChange(newX, newY);
    }
  }

  /**
   * Show axis error feedback
   */
  function showAxisError(select) {
    const originalBorder = select.style.borderColor;
    select.style.borderColor = '#B2182B';
    setTimeout(() => {
      select.style.borderColor = originalBorder;
    }, 1000);
  }

  /**
   * Handle theme change
   */
  function handleThemeChange(event) {
    state.theme = event.target.value;
    document.documentElement.setAttribute('data-theme', state.theme);
    localStorage.setItem('penguin-dashboard-theme', state.theme);

    if (onThemeChange) {
      onThemeChange(state.theme);
    }
  }

  /**
   * Handle reset button
   */
  function handleReset() {
    state = {
      species: ['Adelie', 'Gentoo', 'Chinstrap'],
      sex: 'all',
      xAxis: 'flipper_length_mm',
      yAxis: 'bill_depth_mm',
      theme: state.theme // Keep current theme
    };

    updateUI();

    if (onReset) {
      onReset();
    }
  }

  /**
   * Toggle table visibility
   */
  function toggleTable() {
    const isCollapsed = elements.tableContainer.classList.toggle('collapsed');
    elements.toggleTableBtn.textContent = isCollapsed ? 'Expand Table' : 'Collapse Table';
    elements.toggleTableBtn.setAttribute('aria-expanded', !isCollapsed);
  }

  /**
   * Handle checkbox keydown for accessibility
   */
  function handleCheckboxKeydown(event) {
    if (event.key === ' ') {
      event.preventDefault();
      event.target.click();
    }
  }

  /**
   * Update internal state from UI
   */
  function updateStateFromUI() {
    state.species = Array.from(elements.speciesCheckboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value);

    state.sex = Array.from(elements.sexRadios)
      .find(r => r.checked)?.value || 'all';

    state.xAxis = elements.xAxisSelect.value;
    state.yAxis = elements.yAxisSelect.value;
  }

  /**
   * Update UI from internal state
   */
  function updateUI() {
    // Species checkboxes
    elements.speciesCheckboxes.forEach(cb => {
      cb.checked = state.species.includes(cb.value);
    });

    // Sex radios
    elements.sexRadios.forEach(r => {
      r.checked = r.value === state.sex;
    });

    // Axis selects
    elements.xAxisSelect.value = state.xAxis;
    elements.yAxisSelect.value = state.yAxis;

    // Theme radios
    elements.themeRadios.forEach(r => {
      r.checked = r.value === state.theme;
    });
    document.documentElement.setAttribute('data-theme', state.theme);
  }

  /**
   * Restore state from localStorage
   */
  function restoreState() {
    const savedTheme = localStorage.getItem('penguin-dashboard-theme');
    if (savedTheme) {
      state.theme = savedTheme;
    }

    // Could restore other filters from localStorage if desired
  }

  /**
   * Emit filter change event
   */
  function emitFilterChange() {
    if (onFilterChange) {
      onFilterChange({
        species: state.species,
        sex: state.sex
      });
    }
  }

  /**
   * Get current filter state
   */
  function getState() {
    return { ...state };
  }

  /**
   * Set filter state programmatically
   */
  function setState(newState) {
    state = { ...state, ...newState };
    updateUI();
  }

  /**
   * Set callback for filter changes
   */
  function setOnFilterChange(callback) {
    onFilterChange = callback;
  }

  /**
   * Set callback for axis changes
   */
  function setOnAxisChange(callback) {
    onAxisChange = callback;
  }

  /**
   * Set callback for theme changes
   */
  function setOnThemeChange(callback) {
    onThemeChange = callback;
  }

  /**
   * Set callback for reset
   */
  function setOnReset(callback) {
    onReset = callback;
  }

  // Public API
  return {
    init,
    getState,
    setState,
    setOnFilterChange,
    setOnAxisChange,
    setOnThemeChange,
    setOnReset
  };
})();

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Controls;
}