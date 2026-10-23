# MODEL: gemma4:e4b

import pandas as pd
import json
import numpy as np
import os

# Define paths
INPUT_CSV = 'data/ansur-full.csv'
OUTPUT_JSON = 'ansur/ansur_data.json'
COVARIANCE_OUTPUT = 'ansur/covariance_matrix.json'

def load_and_clean_data(csv_path):
    """
    Loads the CSV data, handles missing values, and filters to numerical columns.
    """
    print("Loading data from CSV...")
    # Read the data, allowing for missing values (NaN)
    df = pd.read_csv(csv_path, sep=',', header=None)

    # The CSV structure shows fields without headers in the first row,
    # but the second row contains the headers. Let's fix the header structure.
    # The provided sample implies the first row is a mix of metadata/empty data,
    # and the second row is the header. We will re-read it properly.

    # Assuming the provided CSV format is:
    # Row 1: Index/Placeholder
    # Row 2: Headers
    # Row 3 onwards: Data
    try:
        df = pd.read_csv(csv_path, sep=',', header=1)
        print("Data loaded successfully.")
    except Exception as e:
        print(f"Error reading CSV: {e}")
        return None

    # Identify numerical columns for analysis
    numerical_cols = df.select_dtypes(include=np.number).columns

    # Handle missing values by imputation (mean for simplicity in this large dataset context)
    # For comprehensive analysis, a more complex strategy might be needed, but mean imputation
    # is a standard preprocessing step for initial dashboards.
    print("Handling missing values...")
    df_cleaned = df.fillna(df.mean(numeric_only=True))

    # Convert the data (including all columns) to a list of dictionaries for JSON output
    data_list = df_cleaned.to_dict(orient='records')

    print(f"Data loaded and cleaned. Total records: {len(data_list)}")
    return data_list, df_cleaned, numerical_cols

def perform_statistical_analysis(df, numerical_cols):
    """
    Calculates descriptive statistics and the covariance matrix.
    """
    print("Performing statistical analysis...")

    # 1. Descriptive Statistics
    desc_stats = df[numerical_cols].describe().to_dict()

    # 2. Covariance Matrix
    # Drop rows/columns with NaN if any were missed, though fillna should handle it.
    cov_matrix = df[numerical_cols].cov().to_dict()

    print("Statistical analysis complete.")
    return desc_stats, cov_matrix

def save_artifacts(data_list, covariance_matrix):
    """
    Saves the processed data and statistical outputs to the designated 'ansur/' directory.
    """
    os.makedirs('ansur', exist_ok=True)

    # Save Data to JSON
    with open('ansur/ansur_data.json', 'w') as f:
        json.dump(data_list, f, indent=4)
    print("Data successfully saved to ansur/ansur_data.json")

    # Save Covariance Matrix
    with open('ansur/covariance_matrix.json', 'w') as f:
        json.dump(covariance_matrix, f, indent=4)
    print("Covariance matrix successfully saved to ansur/covariance_matrix.json")


def main():
    # Step 1: Load and Clean Data
    data_list, df_cleaned, numerical_cols = load_and_clean_data(INPUT_CSV)

    if df_cleaned is None:
        print("Aborting due to data loading failure.")
        return

    # Step 2: Statistical Analysis
    desc_stats, cov_matrix = perform_statistical_analysis(df_cleaned, numerical_cols)

    # Step 3: Save Artifacts
    save_artifacts(data_list, cov_matrix)

if __name__ == "__main__":
    main()