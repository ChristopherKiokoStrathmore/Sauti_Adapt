"""Map visible README claims to measured evidence or NOT VERIFIED.

A claim is VERIFIED only with a matching source commit, command, date, exit
code zero and a GitHub Actions URL. No result is inferred from wording.
Untrusted evidence files must be reviewed before publishing an external claim.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess


def extract_claims(markdown: str) -> list[dict]:
    claims = []
    fenced = False
    for line_number, raw in enumerate(markdown.splitlines(), 1):
        value = raw.strip()
        if value.startswith(("~~~", "```")):
            fenced = not fenced
            continue
        if (not value or fenced or value.startswith(("#", "<!--", "---"))
                or re.fullmatch(r"\|?[\s:|-]+\|?", value)):
            continue
        # Include each visible prose, list or table row. A line with multiple
        # claims must be split in the README, otherwise the whole line shares
        # one evidence decision.
        digest = hashlib.sha256(f"{line_number}:{value}".encode("utf8")).hexdigest()[:12]
        claims.append({"id": digest, "line": line_number, "text": value})
    return claims


def _safe(value: object) -> str:
    text = str(value)
    return text.replace("|", "\\|").replace("\n", " ").replace("\r", " ")[:300]


def render_evidence(claims: list[dict], evidence: dict, *, commit: str,
                    date: str) -> str:
    lines = [
        "# Sauti Adapt README evidence register",
        "",
        f"Generated UTC: {date}",
        f"Source commit: `{commit}`",
        "",
        "Every candidate README claim is NOT VERIFIED by default.",
        "A zero exit code for a unit test does not independently verify",
        "real speech accuracy, safety, usability or legal compliance.",
        "",
        "| README line | Claim | Status | Verification evidence |",
        "| --- | --- | --- | --- |",
    ]
    for claim in claims:
        proof = evidence.get(claim["id"], {}) if isinstance(evidence, dict) else {}
        supported = (
            isinstance(proof, dict)
            and type(proof.get("exit_code")) is int and proof["exit_code"] == 0
            and proof.get("commit") == commit
            and isinstance(proof.get("command"), str)
            and bool(proof["command"].strip())
            and isinstance(proof.get("date"), str)
            and bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", proof["date"]))
            and isinstance(proof.get("evidence_url"), str)
            and proof["evidence_url"].startswith("https://github.com/")
        )
        status = "VERIFIED" if supported else "NOT VERIFIED"
        detail = (
            _safe(proof["command"]) + " on " + _safe(proof["date"]) + " [" +
            "GitHub Actions](" + _safe(proof["evidence_url"]) + ")"
            if supported else "No matching executed evidence for this exact README statement."
        )
        lines.append(
            f"| {claim['line']} | {_safe(claim['text'])} | {status} | {detail} |"
        )
    lines.extend([
        "",
        f"Candidate lines examined: {len(claims)}.",
        "Automated evidence mapping is not a manual legal or accessibility review.",
        "No participant recordings, weights, tokens or individual transcripts are retained.",
        "",
    ])
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--readme", type=Path, default=Path("README.md"))
    parser.add_argument("--output", type=Path, default=Path("docs/EVIDENCE.md"))
    parser.add_argument("--evidence", type=Path)
    args = parser.parse_args()
    try:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    except Exception:
        commit = "NOT VERIFIED"
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    proof = json.loads(args.evidence.read_text(encoding="utf8")) if args.evidence else {}
    claims = extract_claims(args.readme.read_text(encoding="utf8"))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render_evidence(claims, proof, commit=commit, date=date),
                           encoding="utf8")
    print(f"Recorded {len(claims)} candidate README claims. Missing evidence stays NOT VERIFIED.")


if __name__ == "__main__":
    main()
