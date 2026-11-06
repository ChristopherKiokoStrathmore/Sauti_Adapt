# Sauti Adapt quality report

Generated UTC: 2026-11-06
Source commit: `7e67a5ca1a1746e9d3e804df20bfec8e562ccb68`

Only an executed command with an exit code of zero is PASS.
Missing runs are NOT VERIFIED. FAIL means a command ran and exited nonzero;
it does not establish that product code is at fault.

| Gate | Status | Exit code | Duration (s) |
| --- | --- | --- | --- |
| pytest | NOT VERIFIED | n/a | n/a |
| test:shared | NOT VERIFIED | n/a | n/a |
| test:extension | NOT VERIFIED | n/a | n/a |
| typecheck:web | NOT VERIFIED | n/a | n/a |
| typecheck:extension | NOT VERIFIED | n/a | n/a |
| build:web | NOT VERIFIED | n/a | n/a |
| build:extension | NOT VERIFIED | n/a | n/a |
| test:headway | NOT VERIFIED | n/a | n/a |
| typecheck:headway | NOT VERIFIED | n/a | n/a |
| build:headway | NOT VERIFIED | n/a | n/a |
| Playwright e2e | NOT VERIFIED | n/a | n/a |

## Scope and limitations

These are software and integration checks, not clinical or speech accuracy evidence.
No participant audio, trained weights, access tokens or raw command logs are recorded.
Deployment, live co-designer tests and real command false-accept rates are NOT VERIFIED
by this report unless evidenced separately.

The local baseline lacks an executable full checkout. This file is the unverified
baseline snapshot. The `Phase quality evidence` workflow runs
`python scripts/quality_report.py --run` in CI and uploads a report containing
measured exit codes, timing and the evaluated commit SHA. Do not mistake this
baseline placeholder for the CI evidence artefact.
