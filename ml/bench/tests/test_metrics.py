"""Synthetic characterisation tests for benchmark mathematics."""
from ml.bench.metrics import bootstrap_mean_ci, summarise_trials
from sauti_ml.release_gate import unknown_far_upper_bound


def test_bootstrap_constant_trials_have_exact_interval():
    summary = bootstrap_mean_ci([0.6] * 20, seed=3, draws=300)
    assert summary["mean"] == 0.6
    assert summary["lower_95"] == summary["upper_95"] == 0.6


def test_bootstrap_deterministic_and_bounded():
    samples = [0, 1, 0, 1, 1]
    assert bootstrap_mean_ci(samples, seed=123) == bootstrap_mean_ci(samples, seed=123)
    result = bootstrap_mean_ci(samples, seed=123)
    assert 0 <= result["lower_95"] <= result["upper_95"] <= 1


def test_trial_summary_reports_exact_unknown_bound_and_latency():
    rows = [
        {"correct_known": 3, "total_known": 5, "unknown_false_accepts": 0,
         "unknown_count": 15, "latency_ms": [12, 16]},
        {"correct_known": 4, "total_known": 5, "unknown_false_accepts": 0,
         "unknown_count": 15, "latency_ms": [14, 24]},
    ]
    report = summarise_trials(rows, seed=3)
    assert report["unknown_count"] == 30
    assert report["unknown_false_accepts"] == 0
    assert report["unknown_upper_95"] == unknown_far_upper_bound(0, 30)
    assert report["latency_ms"]["p50"] == 15.0
    assert report["latency_ms"]["p95"] >= 20
    assert report["status"] == "SYNTHETIC_OR_PROXY_NOT_ATYPICAL_EVIDENCE"


def test_empty_benchmark_is_not_verified():
    result = summarise_trials([], seed=1)
    assert result["status"] == "NOT VERIFIED"
    assert result["unknown_upper_95"] == 1.0
