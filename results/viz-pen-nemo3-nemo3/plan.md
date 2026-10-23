# Penguin Data Dashboard Plan

## Data Overview
The dataset contains **344 penguin observations** across 3 species:
- **Adelie**: 152 observations
- **Gentoo**: 124 observations
- **Chinstrap**: 68 observations

Each observation includes:
- `species` (categorical): Adelie, Gentoo, Chinstrap
- `bill_length_mm` (continuous): ~32-59mm
- `bill_depth_mm` (continuous): ~13-21mm
- `flipper_length_mm` (continuous): ~172-231mm
- `body_mass_g` (continuous): ~2700-6300g
- `sex` (binary): 0 (female), 1 (male)

---

## Dashboard Layout

### 1. **Header / Summary Stats Row**
- Total penguins: 344
- Species count cards (3 cards with counts)
- Average body mass by species (bar indicators)

### 2. **Main Visualization Area** (2×2 grid)

#### Top-Left: **Scatter Plot Matrix / Pair Plot**
- X: bill_length_mm, Y: bill_depth_mm
- Color by species
- Shape by sex
- Tooltip: all measurements on hover
- Brush/selection to filter other charts

#### Top-Right: **Body Mass Distribution**
- Violin plots or ridgeline plot by species
- Overlaid with box plots showing quartiles
- Split by sex (side-by-side or overlaid)

#### Bottom-Left: **Flipper vs Bill Length Scatter**
- X: flipper_length_mm, Y: bill_length_mm
- Color by species
- Regression lines per species
- Confidence bands

#### Bottom-Right: **Correlation Heatmap**
- 5×5 correlation matrix (all numeric variables)
- Color scale: diverging (blue-white-red)
- Annotate with correlation values

### 3. **Interactive Controls Panel** (Sidebar or top bar)
- **Species filter**: Multi-select checkboxes (All / Adelie / Gentoo / Chinstrap)
- **Sex filter**: Radio (All / Male / Female)
- **Measurement selector**: Dropdown to choose which variables for scatter axes
- **Reset button**: Clear all filters

### 4. **Detail View / Data Table** (Collapsible bottom section)
- Paginated, sortable table of filtered data
- Column visibility toggles
- Export to CSV button

---

## Technical Implementation

### Stack
- **D3.js** (v7+) for all visualizations
- **Vanilla JS** (no framework needed)
- **CSS Custom Properties** for theming (light/dark)

### File Structure
```
/dashboard/
├── index.html
├── css/
│   ├── main.css
│   └── themes.css
├── js/
│   ├── data.js          # Data loading & preprocessing
│   ├── charts/
│   │   ├── scatter.js
│   │   ├── violin.js
│   │   ├── heatmap.js
│   │   └── table.js
│   ├── controls.js      # Filter/selection logic
│   └── main.js          # Dashboard orchestration
└── data/
    └── penguins.json
```

### Key D3 Patterns
- **Reusable chart components** with `update(data)` pattern
- **Cross-filtering** via shared selection state (event bus or global store)
- **Responsive SVG** with `viewBox` and `resize` observer
- **Accessible**: ARIA labels, keyboard navigation, focus management

### Color Scheme (from dataviz skill palette)
- Species: categorical palette (3 distinct hues)
- Sex: subtle variation (opacity/shape, not hue)
- Sequential: body mass (light→dark)
- Diverging: correlations

---

## Interaction Design

| Interaction | Behavior |
|-------------|----------|
| Hover point | Highlight same individual across all charts; show tooltip |
| Click point | Pin tooltip; show detail card |
| Brush scatter | Filter all other views to selection |
| Species checkbox | Add/remove species from all views |
| Sex radio | Filter by sex across all views |
| Axis dropdown | Re-render scatter with new variables |
| Table sort | Sort data table; highlight row in charts |

---

## Accessibility Checklist
- [ ] Semantic HTML structure
- [ ] Color contrast ratios (WCAG AA)
- [ ] Keyboard-navigable controls
- [ ] Screen-reader announcements for filter changes
- [ ] Focus visible states
- [ ] Reduced motion support

---

## Performance Considerations
- Debounce filter updates (150ms)
- Virtualize table for large datasets
- Use Canvas for scatter if >1000 points (not needed here)
- Lazy-load chart modules

---

## Milestones

1. **Setup & Data Layer** (Day 1)
   - Project scaffold, data loading, type definitions
   - Basic HTML structure with CSS Grid layout

2. **Core Charts** (Day 2-3)
   - Scatter plot with brushing
   - Violin/box plot
   - Correlation heatmap
   - Data table

3. **Interactivity & Polish** (Day 4)
   - Cross-filtering wiring
   - Controls panel
   - Theming (light/dark)
   - Accessibility audit

4. **Testing & Deploy** (Day 5)
   - Cross-browser test
   - Mobile responsiveness
   - Publish as artifact

---

## Success Criteria
- All 344 penguins visible and filterable
- Sub-100ms interaction response
- Works on mobile (375px) and desktop (1440px+)
- Light/dark mode respected
- Keyboard-only operable
- Zero console errors