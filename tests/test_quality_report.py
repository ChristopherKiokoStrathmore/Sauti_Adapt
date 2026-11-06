"""Characterisation tests for truthful quality evidence reporting."""

import unittest

from scripts.quality_report import REQUIRED_GATES, render_report


class QualityReportTests(unittest.TestCase):
    def test_missing_runs_are_not_verified(self):
        report = render_report("abc123", "2026-11-06", {})
        for gate in REQUIRED_GATES:
            self.assertIn(f"| {gate} | NOT VERIFIED |", report)
        self.assertNotIn("| PASS |", report)

    def test_only_successful_measured_exit_is_verified(self):
        evidence = {
            "pytest": {"exit_code": 0, "source": "GitHub Actions"},
            "test:shared": {"exit_code": 1, "source": "GitHub Actions"},
        }
        report = render_report("abc123", "2026-11-06", evidence)
        self.assertIn("| pytest | PASS |", report)
        self.assertIn("| test:shared | FAIL |", report)
        self.assertIn("| test:extension | NOT VERIFIED |", report)

    def test_report_never_echoes_arbitrary_log_data(self):
        report = render_report("abc123", "2026-11-06", {
            "pytest": {"exit_code": 0, "stdout": "PARTICIPANT_PRIVATE_DATA",
                       "source": "GitHub Actions", "token": "SECRET"},
        })
        self.assertNotIn("PARTICIPANT_PRIVATE_DATA", report)
        self.assertNotIn("SECRET", report)

    def test_unknown_gate_not_silently_promoted(self):
        report = render_report("abc123", "2026-11-06", {
            "bogus": {"exit_code": 0, "source": "manual"},
        })
        self.assertIn("| pytest | NOT VERIFIED |", report)
        self.assertNotIn("bogus", report)


if __name__ == "__main__":
    unittest.main()
