# Phase 0 implementation report, pending PR verification

Branch: `feature/phase-0-baseline-hygiene`
Base main SHA: `7e67a5ca1a1746e9d3e804df20bfec8e562ccb68`
Date: 6 November 2026

## Changes included

* Characterisation tests for conservative quality report rendering.
* `scripts/quality_report.py` to run gates and produce an auditable
  commit-stamped Markdown report and minimal JSON evidence.
* `docs/BASELINE.md` and a baseline `QUALITY_REPORT.md`, without false PASS.
* README correction for previously changed Headway sources.
* Explicit phase governance in root `AGENTS.md`.
* `npm ci` and dependency caches in normal CI.
* A PR workflow to install dependencies, run and capture every requested
  Python, JavaScript, Headway, build and Playwright gate.
* Security workflows for Gitleaks, CodeQL, pip-audit and npm audit.
* Dependabot updates for npm, pip, GitHub Actions and Docker.
* Python Docker image pinned to a published multi-platform image digest.
* Speech API cryptography version constraint raised to 50.0.2 after the
  first measured pip-audit detected a known vulnerability in version 49.0.0.

## Run evidence

Local git remote command: exit 128, DNS resolution failure.
No complete repository checkout available in this execution environment.
All local product test outcomes are **NOT VERIFIED**.
Initial PR checks for the preceding revision: normal Python, JavaScript,
Headway and Playwright quality jobs PASSED; model lab PASSED; Gitleaks,
CodeQL Python and CodeQL JavaScript PASSED; npm audit PASSED.
First pip-audit FAILED on cryptography 49.0.0, vulnerability
PYSEC-2026-3552, with 50.0.0 reported as a fixed version. The new
cryptography constraint uses 50.0.2. The full security rerun after this
change is **NOT VERIFIED** until its own checks finish.
The duplicate full-gates evidence workflow has not yet completed its
report artefact, so its overall outcome is **NOT VERIFIED**.
Do not interpret source inspection as runtime success.

## Tests added

* `tests/test_quality_report.py` checks missing-evidence rejection,
  explicit zero-exit PASS, nonzero FAIL, and suppression of raw output.
* No existing command recognition or AI4A11y execution behaviour changed.

## Blocked or deferred

* Root `LICENSE` is intentionally not created. The owner must select
  the project licence.
* The requested legal `NOTICE` is deferred pending permission to
  draft licensing notices and verification of third-party terms.
* `package-lock.json` is unchanged because `npm ci` could not run
  against a full checkout locally. CI must validate the lockfile; any
  regeneration must follow a reproducible dependency install.
* Docker base image build and pull are **NOT VERIFIED** until CI or
  deployment reports a successful build.
* The cryptography 50.0.2 migration needs a green fresh API test run and
  repeat pip-audit; prior tests on the older constraints do not prove it.
* Real microphone tests, co-designer benchmarking, consent and external
  GPU-hosted inference are out of Phase 0 and **NOT VERIFIED**.
* `apps/headway/**` source is unchanged and reserved for a separately
  reviewed PR.
* CI security scanner results are **NOT VERIFIED**, and existing
  dependency findings may require distinct remediation PRs.


## Measured PR validation and security finding

GitHub Actions run 42226307377: Python, JavaScript, Headway and
Playwright e2e jobs all PASS on the tested PR revision.
Model lab run 42226307331: PASS.
Security run 42226307363: Gitleaks PASS, npm audit PASS,
CodeQL Python PASS, CodeQL JavaScript and TypeScript PASS.
Speech API pip-audit PASS after raising the cryptography minimum.
**ML lab pip-audit FAIL**: Transformers 4.57.6 from
`services/speech-api/requirements-ml.txt` has nine reported advisory
entries including PYSEC-2026-3929 and PYSEC-2026-4174. Several fixes
require Transformers 5.x and some advisories did not list a fixed
version in the audit output. Do not hide or waive this failure.

A Transformers major upgrade requires a separate change with real
Wav2Vec2 and Whisper inference compatibility checks. A passing unit
test alone cannot establish compatibility with loaded model weights.
Until then the security gate and a production-safe release remain BLOCKED.

## Release boundary

This is a Phase 0 PR only. Do not merge or start Phase 1 until the
owner has reviewed the evidence, accepted outstanding risks and approved
progression. This PR is not a new accessibility product release.
