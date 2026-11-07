"""Service credential checks for the Modal GPU endpoint. No Modal import."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sauti_gpu_auth import SPEECH_API_LABEL, authorized_caller, parse_partner_tokens  # noqa: E402

SPEECH = "s" * 40
TEAM_A = "a" * 40
TEAM_B = "b" * 40
PARTNERS = f"team-a:{TEAM_A}, team-b:{TEAM_B}"


def test_speech_api_and_each_partner_are_identified():
    assert authorized_caller("Bearer " + SPEECH, SPEECH, PARTNERS) == SPEECH_API_LABEL
    assert authorized_caller("Bearer " + TEAM_A, SPEECH, PARTNERS) == "team-a"
    assert authorized_caller("Bearer " + TEAM_B, SPEECH, PARTNERS) == "team-b"


def test_unknown_missing_or_unprefixed_tokens_are_rejected():
    for header in ("", "Bearer ", "Bearer " + "x" * 40, TEAM_A, "bearer " + TEAM_A, "Bearer " + TEAM_A + " "):
        assert authorized_caller(header, SPEECH, PARTNERS) is None


def test_revoking_one_partner_leaves_others_and_speech_api_working():
    remaining = f"team-b:{TEAM_B}"
    assert authorized_caller("Bearer " + TEAM_A, SPEECH, remaining) is None
    assert authorized_caller("Bearer " + TEAM_B, SPEECH, remaining) == "team-b"
    assert authorized_caller("Bearer " + SPEECH, SPEECH, remaining) == SPEECH_API_LABEL


def test_no_partners_configured_means_speech_api_only():
    assert authorized_caller("Bearer " + TEAM_A, SPEECH, "") is None
    assert authorized_caller("Bearer " + SPEECH, SPEECH, "") == SPEECH_API_LABEL


def test_malformed_partner_config_fails_closed_for_partners_only():
    broken = f"team-a:{TEAM_A},oops"
    assert authorized_caller("Bearer " + TEAM_A, SPEECH, broken) is None
    assert authorized_caller("Bearer " + SPEECH, SPEECH, broken) == SPEECH_API_LABEL


def test_partner_cannot_reuse_speech_api_token_to_get_its_privileges():
    # A partner entry holding the speech API token must not create a partner
    # identity, and the token still maps to the speech API.
    assert authorized_caller("Bearer " + SPEECH, SPEECH, f"team-a:{SPEECH}") == SPEECH_API_LABEL


def test_short_or_empty_tokens_are_never_accepted():
    assert authorized_caller("Bearer short", "short", "") is None
    assert authorized_caller("Bearer ", "", "") is None


@pytest.mark.parametrize("spec", [
    "team-a",                                   # no token
    f"Team-A:{TEAM_A}",                         # uppercase label
    "team-a:short",                             # token too short
    f"team-a:{TEAM_A},team-a:{TEAM_B}",         # duplicate label
    f"team-a:{TEAM_A},team-b:{TEAM_A}",         # shared token
    f"{SPEECH_API_LABEL}:{TEAM_A}",             # reserved label
])
def test_parse_rejects_malformed_partner_specs(spec):
    with pytest.raises(ValueError):
        parse_partner_tokens(spec)
