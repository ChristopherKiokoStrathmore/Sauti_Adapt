"""Generate a quality report from measured exit codes, never inferred success.

Run after dependencies, official toolkit and Chromium are installed:
    python scripts/quality_report.py --run --evidence evidence.json --output QUALITY_REPORT.md

Render a report from previously captured evidence:
    python scripts/quality_report.py --evidence evidence.json --output QUALITY_REPORT.md

The evidence file contains only command names, exit codes and timings. Standard
output, participant information and credentials are never written to it.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
import time

REQUIRED_GATES = (
    "pytest", "test:shared", "test:extension",
    "typecheck:web", "typecheck:extension",
    "build:web", "build:extension",
    "test:headway", "typecheck:headway", "build:headway",
    "Playwright e2e",
)
COMMANDS = {
    "pytest": [sys.executable, "-m", "pytest", "services/speech-api/tests",
               "ml/lab/tests", "tests/test_quality_report.py", "-q"],
    "test:shared": ["npm", "run", "test:shared"],
    "test:extension": ["npm", "run", "test:extension"],
    "typecheck:web": ["npm", "run", "typecheck:web"],
    "typecheck:extension": ["npm", "run", "typecheck:extension"],
    "build:web": ["npm", "run", "build:web"],
    "build:extension": ["npm", "run", "build:extension"],
    "test:headway": ["npm", "run", "test:headway"],
    "typecheck:headway": ["npm", "run", "typecheck:headway"],
    "build:headway": ["npm", "run", "build:headway"],
    "Playwright e2e": ["xvfb-run", "-a", "npm", "run", "test:e2e"],
}


def render_report(commit: str, date: str, results: dict) -> str:
    """Make unsupported evidence explicit, and never include raw tool output."""
    safe_sha = "".join(c for c in commit if c in "0123456789abcdef")[:40] or "unknown"
    lines = [
        "# Sauti Adapt quality report",
        "",
        f"Generated UTC: {date}",
        f"Source commit: \`{safe_sha}\`",
        "",
        "Only an executed command with an exit code of zero is PASS.",
        "Missing runs are NOT VERIFIED. FAIL means a command ran and exited nonzero;",
        "it does not establish that product code is at fault.",
        "",
        "| Gate | Status | Exit code | Duration (s) |",
        "| --- | --- | --- | --- |",
    ]
    for gate in REQUIRED_GATES:
        result = results.get(gate, {})
        code = result.get("exit_code") if isinstance(result, dict) else None
        status = "PASS" if code == 0 else ("FAIL" if isinstance(code, int) else "NOT VERIFIED")
        elapsed = result.get("duration_seconds") if isinstance(result, dict) else None
        duration = f"{elapsed:.2f}" if isinstance(elapsed, (int, float)) and elapsed >= 0 else "n/a"
        lines.append(f"| {gate} | {status} | {code if isinstance(code, int) else 'n/a'} | {duration} |")
    lines.extend([
        "",
        "## Scope and limitations",
        "",
        "These are software and integration checks, not clinical or speech accuracy evidence.",
        "No participant audio, trained weights, access tokens or raw command logs are recorded.",
        "Deployment, live co-designer tests and real command false-accept rates are NOT VERIFIED",
        "by this report unless evidenced separately.",
        "",
    ])
    return "\n".join(lines)


def execute_gates(root: Path) -> dict:
    results = {}
    for gate in REQUIRED_GATES:
        command = COMMANDS[gate]
        started = time.monotonic()
        try:
            completed = subprocess.run(command, cwd=root, capture_output=True,
                                       timeout=1800, check=False)
            result = {"exit_code": int(completed.returncode)}
        except subprocess.TimeoutExpired:
            result = {"exit_code": 124}
        except OSError:
            result = {"exit_code": 127}
        result["duration_seconds"] = round(time.monotonic() - started, 3)
        results[gate] = result
        print(f"{gate}: " + ("PASS" if result["exit_code"] == 0 else
              f"FAIL (exit {result['exit_code']})"), flush=True)
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true", help="Execute all gates in this checkout")
    parser.add_argument("--evidence", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=Path("QUALITY_REPORT.md"))
    parser.add_argument("--commit", default=os.environ.get("GITHUB_SHA", "unknown"))
    parser.add_argument("--date", default=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    args = parser.parse_args()
    if args.run:
        root = Path(__file__).resolve().parents[1]
        results = execute_gates(root)
        if args.evidence:
            args.evidence.parent.mkdir(parents=True, exist_ok=True)
            args.evidence.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    elif args.evidence and args.evidence.is_file():
        results = json.loads(args.evidence.read_text(encoding="utf-8"))
    else:
        results = {}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render_report(args.commit, args.date, results), encoding="utf-8")
    if args.run:
        return int(any(entry["exit_code"] != 0 for entry in results.values()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
