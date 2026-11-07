"""Characterisation of evidence generation without fabricated verification."""
from scripts.evidence_report import extract_claims, render_evidence


def test_claim_extraction_ignores_code_and_keeps_visible_claims():
    markdown = "# Heading\n\nThis capability works.\n\n```python\nprint('code')\n```\n\n* Speech may be rejected.\n"
    claims = extract_claims(markdown)
    assert len(claims) == 2
    assert all("print(" not in claim["text"] for claim in claims)


def test_missing_evidence_never_claims_verified():
    claims = extract_claims("This capability works.\n")
    report = render_evidence(claims, {}, commit="abc123", date="2026-11-06")
    assert "| NOT VERIFIED |" in report
    assert "| VERIFIED |" not in report


def test_incomplete_evidence_is_not_accepted():
    claims = extract_claims("Measured statement.\n")
    fake = {
        claims[0]["id"]: {"exit_code": 0, "command": "pytest",
                          "date": "2026-11-06", "commit": "wrong"}
    }
    report = render_evidence(claims, fake, commit="abc123", date="2026-11-06")
    assert "| NOT VERIFIED |" in report


def test_valid_record_is_scoped_to_same_commit():
    claims = extract_claims("Unit tests passed.\n")
    record = {
        claims[0]["id"]: {
            "exit_code": 0, "command": "npm run test:shared",
            "date": "2026-11-06", "commit": "abc123",
            "evidence_url": "https://github.com/example/run"
        }
    }
    report = render_evidence(claims, record, commit="abc123", date="2026-11-06")
    assert "| VERIFIED |" in report
