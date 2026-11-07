"""Conservative release evidence for voice command recognition.

Synthetic counts in unit tests must never be presented as speech benchmarks.
One-sided Clopper-Pearson 95 percent upper bounds quantify remaining uncertainty.
A weak-evidence result is always non-executable.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import math
import os
from scipy.stats import beta


def unknown_far_upper_bound(false_accepts: int, unknown_count: int,
                            confidence: float = 0.95) -> float:
    """Exact one-sided binomial upper confidence limit."""
    if (type(false_accepts) is not int or type(unknown_count) is not int
            or unknown_count < 0 or not 0 <= false_accepts <= unknown_count
            or not 0 < confidence < 1):
        raise ValueError("Invalid counts or confidence.")
    if unknown_count == 0 or false_accepts == unknown_count:
        return 1.0
    value = float(beta.ppf(confidence, false_accepts + 1,
                           unknown_count - false_accepts))
    if not math.isfinite(value):
        raise ValueError("Undefined confidence bound.")
    return value


@dataclass(frozen=True)
class GatePolicy:
    minimum_unknown_count: int = 30
    maximum_upper_false_accept_rate: float = 0.10
    confidence: float = 0.95
    weak_evidence: bool = False

    def __post_init__(self):
        if type(self.minimum_unknown_count) is not int or self.minimum_unknown_count < 1:
            raise ValueError("Minimum unknown count must be positive.")
        if not 0 < self.maximum_upper_false_accept_rate < 1:
            raise ValueError("Maximum upper false accept rate must be between zero and one.")
        if not 0 < self.confidence < 1:
            raise ValueError("Confidence must be between zero and one.")


@dataclass(frozen=True)
class ReleaseDecision:
    status: str
    executable: bool
    reason: str
    unknown_total: int
    unknown_false_accepts: int
    unknown_false_accept_upper_bound: float
    policy: GatePolicy

    def as_dict(self) -> dict:
        result = asdict(self)
        return result


def assess_release(calibration_unknown: int, calibration_false_accepts: int,
                   test_unknown: int, test_false_accepts: int, *,
                   known_wrong: int, missing_commands: list[str],
                   policy: GatePolicy | None = None) -> ReleaseDecision:
    """Apply a gate without using test clips to select a threshold or margin.

    The upper bound combines negative evaluation counts. Separate calibration
    and held-out test results must be reported alongside the combined bound.
    """
    policy = policy or GatePolicy()
    for sample in (calibration_unknown, calibration_false_accepts,
                   test_unknown, test_false_accepts, known_wrong):
        if type(sample) is not int or sample < 0:
            raise ValueError("Counts must be non-negative integers.")
    total = calibration_unknown + test_unknown
    errors = calibration_false_accepts + test_false_accepts
    upper = unknown_far_upper_bound(errors, total, policy.confidence)
    if (calibration_false_accepts > calibration_unknown
            or test_false_accepts > test_unknown):
        raise ValueError("False accepts exceed number of negatives.")

    def result(status: str, reason: str, executable: bool = False) -> ReleaseDecision:
        return ReleaseDecision(status, executable, reason, total, errors, upper, policy)

    if known_wrong or errors:
        return result("blocked", "Observed a false command activation.")
    if missing_commands:
        return result("blocked", "Missing verified command activation.")
    if total < policy.minimum_unknown_count:
        if policy.weak_evidence:
            return result("pilot-validation-weak-evidence",
                          "Insufficient unknown examples. Research-only: no actions.")
        return result("blocked", "Too few unknown examples for release.")
    if upper > policy.maximum_upper_false_accept_rate:
        if policy.weak_evidence:
            return result("pilot-validation-weak-evidence",
                          "Uncertainty upper bound exceeds pilot limit. No actions.")
        return result("blocked", "Unknown false-accept upper bound exceeds limit.")
    return result("pilot-validation-passed", "Pilot evidence gate passed.", True)


DEMO_STATUS = "demo-validation-passed"
PILOT_STATUS = "pilot-validation-passed"


def demo_mode() -> bool:
    """Demo-grade mode for supervised demonstrations. Never a validated release."""
    return os.environ.get("SAUTI_DEMO_MODE", "").strip().lower() == "true"


def training_policy() -> GatePolicy:
    if demo_mode():
        return GatePolicy(
            minimum_unknown_count=int(os.environ.get("SAUTI_DEMO_MIN_UNKNOWN", "10")),
            maximum_upper_false_accept_rate=float(os.environ.get("SAUTI_DEMO_MAX_UNKNOWN_FAR_UPPER", "0.30")),
        )
    return GatePolicy(
        minimum_unknown_count=int(os.environ.get("SAUTI_MIN_UNKNOWN_COUNT", "30")),
        maximum_upper_false_accept_rate=float(os.environ.get("SAUTI_MAX_UNKNOWN_FAR_UPPER", "0.10")),
        weak_evidence=os.environ.get("SAUTI_ALLOW_WEAK_EVIDENCE", "").lower() == "true",
    )


def recognition_requirements() -> tuple[int, float, frozenset]:
    """Evidence the API demands at recognition time: (min unknown clips, max FAR upper bound, statuses)."""
    if demo_mode():
        return (max(5, int(os.environ.get("SAUTI_DEMO_MIN_UNKNOWN", "10"))),
                min(0.40, float(os.environ.get("SAUTI_DEMO_MAX_UNKNOWN_FAR_UPPER", "0.30"))),
                frozenset({PILOT_STATUS, DEMO_STATUS}))
    return (max(30, int(os.environ.get("SAUTI_MIN_UNKNOWN_COUNT", "30"))),
            min(0.10, float(os.environ.get("SAUTI_MAX_UNKNOWN_FAR_UPPER", "0.10"))),
            frozenset({PILOT_STATUS}))
