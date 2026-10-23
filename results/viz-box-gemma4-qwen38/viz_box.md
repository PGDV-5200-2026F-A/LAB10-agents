# Data Visualization Dashboard Plan: Object Detection Analysis

**Model Name:** Gemma 4
**Source Data:** `data/stops2boxes.json`
**Goal:** Design a comprehensive, interactive dashboard to analyze object detection statistics from the provided dataset.

---

## 📊 High-Level Overview

This dashboard aims to provide a holistic view of the objects detected across the dataset. It will transition raw bounding box and detection data into actionable insights regarding object prevalence, detection confidence, and spatial concentration.

**Target User:** Data Scientists, Researchers, Product Managers evaluating detection model performance.
**Primary Metrics:** Object Count, Average Detection Probability, Object Type Frequency, Spatial Density.

---

## 🔬 1. Data Processing and Pre-analysis

The initial phase is critical for ensuring data quality and preparing raw detections into aggregated, chart-ready metrics.

### A. Schema Assumptions (Crucial Pre-step)
We assume the JSON structure is an array of objects, and each object contains at least the following fields (or their equivalents):
*   `object_type`: String identifier for the detected object (e.g., "car", "person", "stop sign").
*   `probability`: Float representing the confidence/probability of the detection (0.0 to 1.0).
*   `bbox`: A structure or array containing bounding box coordinates (e.g., `[x_min, y_min, x_max, y_max]`).
*   `image_id` / `stop_id`: Unique identifier linking detections to a specific image or location.
*   `timestamp` (Optional): For time-series analysis.

### B. Cleaning and Validation Steps
1.  **Schema Validation:** Validate that all records conform to the expected schema. Filter out records with missing critical fields (`object_type`, `probability`, `bbox`).
2.  **Data Type Coercion:** Ensure `probability` is a float and bounding box coordinates are numerical.
3.  **Bounding Box Calculation:** Calculate derived metrics from the bounding box:
    *   `area`: $(x_{max} - x_{min}) \times (y_{max} - y_{min})$.
    *   `normalized_area`: $\text{area} / \text{Image Resolution Area}$ (If image resolution is available; otherwise, use raw area).
4.  **Filtering:** Filter out detections with extremely low confidence scores (e.g., `probability < 0.2`) unless the goal is to analyze model weaknesses.
5.  **Aggregation:** Group the raw detections by `object_type` and `image_id` to prepare summary statistics.

### C. Derived Data Structures
The analysis will rely on three core derived datasets:
1.  **`df_frequency`**: Counts of `object_type`.
2.  **`df_probability_stats`**: Aggregated statistics (Mean, Median, Standard Deviation) of `probability` per `object_type`.
3.  **`df_spatial_stats`**: Aggregated metrics (Average `area`, Max `area`, etc.) and counts per `object_type` or per `stop_id`.

---

## 📈 2. Visualization Choices

We will implement three primary views corresponding to the requested insights, plus a detail/filter view.

### 1. Object Frequency Analysis
*   **Chart Type:** Horizontal Bar Chart.
*   **Variables:**
    *   **X-axis:** Count (Total occurrences of each object type).
    *   **Y-axis:** `object_type` (Categorical).
*   **Rationale:** Bar charts are ideal for comparing discrete counts across categories. Using horizontal orientation handles long object names better.
*   **Interactivity:** Tooltip showing the exact count. This view will act as the primary filter control for other charts.

### 2. Object Probability Analysis
*   **Chart Type:** Grouped Bar Chart or Box Plot (depending on granularity).
*   **Variables:**
    *   **If focusing on type comparison:** Use a **Box Plot** to show the distribution of `probability` for each `object_type`. This is superior to a simple mean/median bar chart as it reveals the variability in model confidence.
    *   **X-axis:** `object_type`.
    *   **Y-axis:** `probability`.
    *   **Grouping:** Separate boxes/groups for different types.
*   **Rationale:** Box plots communicate the spread (variance) of probabilities, which is often more informative than just the average.
*   **Interactivity:** When an `object_type` is selected in the Frequency Chart, the corresponding box plot group highlights or filters, and a summary card shows the mean/median/std dev.

### 3. Other Statistics (Spatial Distribution & Ratios)
This section will contain two complementary visualizations:

#### A. Spatial Density Heatmap (Primary Visual)
*   **Chart Type:** World Map (if location data is present) or 2D Density Heatmap (if coordinates are normalized or aggregated by grid).
*   **Variables:**
    *   **X/Y-axis:** Normalized spatial coordinates derived from the bounding boxes.
    *   **Color/Intensity:** Density (Count of detections per spatial area).
*   **Rationale:** Quickly shows where objects are physically concentrated within the image space, revealing potential blind spots or hotspots in detection coverage.
*   **Interactivity:** Tooltip displaying object type and total count at that location.

#### B. Summary Metrics Dashboard (KPI Cards)
*   **Chart Type:** KPI Cards (Key Performance Indicators).
*   **Variables:**
    *   **Total Unique Objects:** Count of unique `object_type`.
    *   **Overall Average Probability:** Mean of all detection `probability`.
    *   **Most Frequent Object:** The top `object_type` by count.
    *   **Total Detections:** Total number of entries in the dataset.
*   **Rationale:** Provides immediate, digestible high-level context for the entire dataset.

---

## 📐 3. Dashboard Layout Proposal

The layout should follow a natural reading flow, moving from high-level summaries to categorical breakdowns, and finally to detailed spatial evidence.

**Proposed Structure (3-Column Grid Layout with Header KPIs):**

| Component | Size | Placement | Content Focus |
| :--- | :--- | :--- | :--- |
| **Header KPIs** | 1 Row (Full Width) | Top Banner | Total Detections, Avg. Probability, Unique Objects, etc. |
| **Object Frequency** | 1/3 Column | Left Panel | Horizontal Bar Chart (Filter Source) |
| **Object Probability** | 1/3 Column | Middle Panel | Box Plot of Confidence (Uses Frequency Filter) |
| **Spatial Density Map** | 1/3 Column | Right Panel | Heatmap/Density Plot (Showcase of location) |
| **Detail/Filter View** | 2/3 Width (Below the 3 main charts) | Bottom Section | **Detail View:** Interactive Scatter plot or histogram showing the distribution of `area` vs. `probability` (colored by `object_type`). |

---

## 💡 4. Implementation Details

### A. Suggested Technologies
*   **Frontend Framework:** React or Vue (for component modularity and state management).
*   **Visualization Library:** Plotly.js or D3.js (Plotly is recommended for faster dashboard prototyping and handling statistical plots like Box Plots).
*   **State Management:** Redux or Context API (To manage global filtering state, especially linking the Frequency chart filter to the Probability and Detail views).
*   **Backend/Data Processing:** Python (Pandas/NumPy) for pre-calculating metrics and serving an optimized API endpoint (e.g., Flask/FastAPI) to the frontend.

### B. Interaction Logic (The Core Experience)
1.  **Global Filtering:** The `object_type` selection in the **Frequency Chart** must be the primary filter. Selecting a bar instantly updates:
    *   The **Box Plot** (shows distribution only for the selected type).
    *   The **Detail/Filter View** (filters the scatter plot data to only the selected type).
2.  **Tooltips:** Every visualization must use rich tooltips to display granular data points (e.g., clicking a bar shows the count; hovering on the map shows the object type and local density).
3.  **Zoom/Pan:** The **Spatial Density Map** should be interactive, allowing users to zoom and pan across the image space.
4.  **Filtering by Probability:** A secondary slider filter should be implemented at the bottom, allowing the user to set a minimum acceptable detection probability (e.g., "Show detections with probability > 0.5"). This filter should apply globally to all downstream charts.

### C. Reproducibility Notes
*   The dashboard must load all raw data detections (or a representative sample if too large) into memory for client-side filtering efficiency.
*   Client-side calculations for area and basic statistics are preferred to reduce API load, while complex aggregations (e.g., global means) can be pre-calculated on the backend.
*   All chart configurations (axis labels, color palettes, data sources) must be defined as constants within the component structure.