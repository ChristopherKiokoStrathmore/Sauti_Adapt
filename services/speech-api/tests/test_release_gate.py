"""Characterisation of release safety using synthetic counts only.

These tests contain no recordings and do not support any accuracy claim.
"""
import math
from sauti_ml.release_gate import GatePolicy, assess_release, unknown_far_upper_bound


def test_zero_out_of_thirty_has_nonzero_upper_bound():
    upper = unknown_far_upper_bound(0, 30)
    assert 0.09 < upper < 0.10


def test_five_clean_unknowns_is_not_enough():
    gate = assess_release(
        5, 0, 5, 0, known_wrong=0, missing_commands=[],
        policy=GatePolicy(),
    )
    assert gate.status == 'blocked'
    assert gate.executable is False
    assert gate.unknown_total == 10


def test_thirty_clean_unknowns_passes_math_gate():
    gate = assess_release(
        15, 0, 15, 0, known_wrong=0, missing_commands=[],
        policy=GatePolicy(),
    )
    assert gate.status == 'pilot-validation-passed'
    assert gate.executable is True


def test_one_false_activation_cannot_release():
    gate = assess_release(
        15, 0, 15, 1, known_wrong=0, missing_commands=[],
        policy=GatePolicy(weak_evidence=True),
    )
    assert gate.status == 'blocked'
    assert gate.executable is False


def test_weak_mode_is_labelled_and_cannot_execute():
    gate = assess_release(
        5, 0, 5, 0, known_wrong=0, missing_commands=[],
        policy=GatePolicy(weak_evidence=True),
    )
    assert gate.status == 'pilot-validation-weak-evidence'
    assert gate.executable is False


def test_missing_accepted_command_stays_blocked():
    gate = assess_release(
        15, 0, 15, 0, known_wrong=0,
        missing_commands=['READ_PAGE|sw-KE'], policy=GatePolicy(weak_evidence=True),
    )
    assert gate.status == 'blocked'


def test_nonzero_unknown_accept_rate_is_not_rounded_to_zero():
    upper = unknown_far_upper_bound(1, 300)
    assert upper > (1 / 300)
    assert math.isfinite(upper)


def test_invalid_sample_counts_are_rejected():
    import pytest
    with pytest.raises(ValueError):
        unknown_far_upper_bound(2, 1)
    with pytest.raises(ValueError):
        assess_release(-1, 0, 10, 0, known_wrong=0, missing_commands=[])
