# Phase 0 baseline, 6 November 2026

## Source and scope

Checked main source reference: `7e67a5ca1a1746e9d3e804df20bfec8e562ccb68`.
This baseline is limited to remote source inspection and local environment
availability checks. It does not claim successful software gates.

## Commands actually attempted

| Command | Exit code | Observed result |
| --- | --- | --- |
| `git ls-remote https://github.com/ChristopherKiokoStrathmore/Sauti_Adapt.git HEAD` | 128 | Could not resolve host `github.com` from the available local runtime |
| `git --version` | 0 | 2.47.3 |
| `python --version` | 0 | 3.13.5 |
| `node --version` | 0 | v22.16.0 |
| `npm --version` | 0 | 10.9.2 |
| Check for root `package.json` in available working tree | 1 | No executable full repository checkout is mounted |
| Check for `services/speech-api/requirements-dev.txt` | 1 | No executable full repository checkout is mounted |

## Quality baseline

For the stated main SHA, these exact commands have **NOT VERIFIED** results
in the accessible local environment:

| Gate | Command | Status |
| --- | --- | --- |
| Python API, lab and reporting tests | `python -m pytest services/speech-api/tests ml/lab/tests tests/test_quality_report.py -q` | NOT VERIFIED |
| Shared unit tests | `npm run test:shared` | NOT VERIFIED |
| Extension unit tests | `npm run test:extension` | NOT VERIFIED |
| Web typecheck | `npm run typecheck:web` | NOT VERIFIED |
| Extension typecheck | `npm run typecheck:extension` | NOT VERIFIED |
| Web build | `npm run build:web` | NOT VERIFIED |
| Extension build | `npm run build:extension` | NOT VERIFIED |
| Headway tests, typecheck and build | `npm run check:headway` | NOT VERIFIED |
| Playwright | `xvfb-run -a npm run test:e2e` | NOT VERIFIED |

## Evidence generation

`scripts/quality_report.py` captures real exit codes and elapsed time,
but not command stdout, participant data or secrets. The new GitHub Actions
workflow `.github/workflows/quality-evidence.yml` installs the verified
toolkit SHA and runtime dependencies, then runs every gate and uploads
`QUALITY_REPORT.md` and `quality-evidence.json` as artefacts.

A workflow being configured is not evidence that it executed. Inspect the
actual PR checks and attached artefact before claiming a pass. Do not copy
failing CI evidence into a verified README claim.

## Source observations, not execution results

* `README.md` inaccurately claimed `apps/headway` was untouched.
  `CHANGELOG.md` records Headway moves and source changes.
* `.github/workflows/quality.yml` previously used `npm install` in the
  JavaScript and e2e jobs, unlike the Headway job which used `npm ci`.
* The previous `QUALITY_REPORT.md` described an earlier archive environment,
  not the current source commit or current quality gate runs.
* Dockerfile used a floating `python:3.11-slim` base before this phase.
* The root project licence was not selected. No `LICENSE` or `NOTICE`
  must be drafted without explicit owner approval.

No live speech recognition, participant command calibration, external
data transfer or completed deployment is established by this baseline.
