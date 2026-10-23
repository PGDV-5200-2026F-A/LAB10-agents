<!-- Plan by gemma4:e4b -->
## Dashboard Plan: Penguins Data Visualization

### 📋 Context
This plan outlines the creation of a comprehensive, interactive data dashboard using the `data/penguins.json` dataset. The goal is to provide multiple, interconnected views—including scatter plots, histograms, bar/box plots, and a covariance analysis—to enable deep comparative analysis of the penguin species. The dashboard must adhere to industry best practices for data visualization, ensuring the output is deterministic, highly accessible, and reproducible.

### 🎯 Recommended Approach: Two-Phase Process

The entire dashboard creation will be structured into two mandatory phases to ensure data integrity and visualization quality:

**Phase 1: Data Preparation and Statistical Analysis (The Pre-Visualization Script)**
This step will run *before* any plotting and is critical for generating the inputs for the visual components.
1.  **Data Ingestion:** Load `data/penguins.json`.
2.  **Feature Engineering:** Calculate the necessary aggregated data:
    *   **Correlation Matrix:** Calculate the Pearson correlation matrix for the four continuous numerical features: `bill_length_mm`, `bill_depth_mm`, `flipper_length_mm`, and `body_mass_g`. This matrix will form the core data for the covariance analysis section.
    *   **Aggregation:** Calculate summary statistics (mean, median, standard deviation) for continuous variables, grouped by categorical variables (`species` and `sex`), to drive the Bar/Box plot data.
3.  **Output:** The output of this phase will be a structured data object (or temporary JSON file) containing all the derived statistical inputs, which will then be passed to the visualization stage.

**Phase 2: Visualization Generation (Using the `d3` Skill)**
The `d3` skill will be utilized to consume the processed data from Phase 1 and render the dashboard components.

1.  **Scatter Plot:** Visualize the relationship between key continuous variables (e.g., `flipper_length_mm` vs. `body_mass_g`). Grouping and coloring must utilize `species` and `sex` for maximum dimension storytelling.
2.  **Distribution Plot (Histogram/Box):** Display the distribution of critical measurements (e.g., `bill_length_mm`) separated by `species` to show variance and central tendencies.
3.  **Bar/KPI Plots:** Present the aggregated data from Phase 1 (e.g., average measurements per species/sex) in clear bar charts or key performance indicator (KPI) cards.
4.  **Covariance Visualization:** A dedicated section to visualize the correlation matrix output from Phase 1, potentially using a heatmap or a scatter plot matrix, to communicate the strength and direction of linear relationships.

### 🛠️ Critical Files and Reuse
*   **Source Data:** `data/penguins.json`
*   **Key Utility:** The `d3` skill is the core technology and follows the necessary conventions for modular, accessible, and deterministic output (HTML/CSS/JS separation).
*   **Reuse:** The structure provided by the `d3` skill for handling interactivity (tooltips, selections) and modularity will be strictly followed to ensure the dashboard is reusable and professional.

### ✅ Verification Plan
To verify the dashboard:
1.  **Unit Test:** Write a script that runs Phase 1 on `data/penguins.json` and confirms the calculated correlation matrix matches expected statistical values.
2.  **Integration Test:** Pass the derived data object (from Phase 1) into the `d3` skill call structure.
3.  **End-to-End Test:** Execute the resulting dashboard artifact in a browser environment and manually verify:
    *   All required plots (scatter, histogram, bar/box, covariance) are present and correctly colored/grouped.
    *   Interactions (hovering over points, filtering by species/sex) work as expected with no visual glitches.
    *   The code is clean, adheres to the `d3` skill's output conventions, and is fully documented regarding the data transformations applied in Phase 1.
