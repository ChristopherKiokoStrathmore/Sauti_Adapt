"""Statistical evidence helpers for reproducible speech command benchmarks.

Use with consented labelled clips or public proxy audio only. These utilities
do not perform a dataset download, model inference or any speech processing.
"""
from __future__ import annotations

import random
import statistics
from typing import Sequence

from sauti_ml.release_gate import unknown_far_upper_bound


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        raise ValueError("No values.")
    sorted_values = sorted(values)
    position = (len(sorted_values) - 1) * percentile
    low = int(position)
    high = min(len(sorted_values) - 1, low + 1)
    return sorted_values[low] + (sorted_values[high] - sorted_values[low]) * (position - low)


def bootstrap_mean_ci(values: Sequence[float], *, seed: int = 42,
                      draws: int = 2000) -> dict:
    if not values or draws < 100:
        raise ValueError("At least one observation and 100 bootstrap draws required.")
    nums = [float(x) for x in values]
    if any(x != x or x in (float('inf'), float('-inf')) for x in nums):
        raise ValueError("Non-finite benchmark values.")
    rng = random.Random(seed)
    n = len(nums)
    samples = [
        statistics.fmean(nums[rng.randrange(n)] for _ in range(n))
        for _ in range(draws)
    ]
    return {
        "mean": round(statistics.fmean(nums), 8),
        "lower_95": round(_percentile(samples, 0.025), 8),
        "upper_95": round(_percentile(samples, 0.975), 8),
        "bootstrap_draws": draws,
        "seed": seed,
    }


def summarise_trials(trials: Sequence[dict], *, seed: int = 42) -> dict:
    """Summarise measured repeats. Empty input is not evidence of success."""
    if not trials:
        return {
            "status": "NOT VERIFIED", "trial_count": 0,
            "unknown_count": 0, "unknown_false_accepts": 0,
            "unknown_upper_95": 1.0, "known_recall": None,
            "latency_ms": None,
        }
    recalls = []
    latency = []
    total_unknown = 0
    total_false = 0
    for trial in trials:
        known = trial["total_known"]
        if type(known) is not int or known < 1:
            raise ValueError("Each trial must contain known commands.")
        correct = trial["correct_known"]
        if type(correct) is not int or not 0 <= correct <= known:
            raise ValueError("Invalid accepted count.")
        unknown = trial["unknown_count"]
        false = trial["unknown_false_accepts"]
        unknown_far_upper_bound(false, unknown)
        recalls.append(correct / known)
        total_unknown += unknown
        total_false += false
        latency.extend(float(n) for n in trial.get("latency_ms", []))
    summary = {
        "status": "SYNTHETIC_OR_PROXY_NOT_ATYPICAL_EVIDENCE",
        "trial_count": len(trials),
        "known_recall": bootstrap_mean_ci(recalls, seed=seed),
        "unknown_count": total_unknown,
        "unknown_false_accepts": total_false,
        "unknown_observed_false_accept_rate": total_false / total_unknown if total_unknown else None,
        "unknown_upper_95": unknown_far_upper_bound(total_false, total_unknown),
        "latency_ms": None,
        "disclaimer": "Typical speech proxies cannot measure atypical speech recognition performance.",
    }
    if latency:
        summary["latency_ms"] = {
            "p50": round(_percentile(latency, 0.5), 3),
            "p95": round(_percentile(latency, 0.95), 3),
        }
    return summary
