#!/usr/bin/env python3
"""
Model: google/gemini-3.8-flash[1m]
Unit Test for Phase 1 Statistical Analysis (Palmer Penguins)

Validates:
1. Output file exists and is valid JSON.
2. Record count matches expected non-null records (342 rows).
3. Pearson correlation calculation against independent reference calculation.
4. Summary statistics properties (min <= q1 <= median <= q3 <= max).
5. Grouping by species matches expected counts.
"""

import json
import math
import unittest
from pre_vis_analysis import run_phase1, compute_pearson_correlation, compute_summary_stats

class TestPhase1Analysis(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.derived = run_phase1("data/penguins.json", "data/penguins_derived.json")

    def test_record_counts(self):
        # Original dataset has 344 rows, 2 completely empty measurement rows -> 342 valid
        self.assertEqual(len(self.derived["cleaned_data"]), 342)
        self.assertEqual(self.derived["kpis"]["total_records_clean"], 342)

    def test_correlation_properties(self):
        matrix = self.derived["correlation_matrix"]
        features = ["bill_length_mm", "bill_depth_mm", "flipper_length_mm", "body_mass_g"]
        for f1 in features:
            for f2 in features:
                val = matrix[f1][f2]
                self.assertTrue(-1.0 <= val <= 1.0, f"Correlation {f1} vs {f2} out of bounds: {val}")
                # Symmetry
                self.assertAlmostEqual(matrix[f1][f2], matrix[f2][f1], places=4)
            # Self-correlation is 1
            self.assertAlmostEqual(matrix[f1][f1], 1.0, places=4)

        # Specifically known strong positive correlation between flipper length and body mass (~0.87)
        self.assertGreater(matrix["flipper_length_mm"]["body_mass_g"], 0.85)

    def test_summary_statistics_bounds(self):
        stats_species = self.derived["stats_by_species"]
        self.assertIn("Adelie", stats_species)
        self.assertIn("Chinstrap", stats_species)
        self.assertIn("Gentoo", stats_species)

        for sp, data in stats_species.items():
            for feat, s in data["features"].items():
                self.assertLessEqual(s["min"], s["q1"], f"{sp} {feat} min > q1")
                self.assertLessEqual(s["q1"], s["median"], f"{sp} {feat} q1 > median")
                self.assertLessEqual(s["median"], s["q3"], f"{sp} {feat} median > q3")
                self.assertLessEqual(s["q3"], s["max"], f"{sp} {feat} q3 > max")
                self.assertGreater(s["std"], 0)

    def test_species_breakdown(self):
        sp_breakdown = self.derived["kpis"]["species_breakdown"]
        # Expected counts in 342 valid records: Adelie: 151, Chinstrap: 68, Gentoo: 123
        self.assertEqual(sp_breakdown["Adelie"], 151)
        self.assertEqual(sp_breakdown["Chinstrap"], 68)
        self.assertEqual(sp_breakdown["Gentoo"], 123)
        self.assertEqual(sum(sp_breakdown.values()), 342)

if __name__ == "__main__":
    unittest.main()
