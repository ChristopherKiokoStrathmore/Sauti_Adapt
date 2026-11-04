# Sauti Adapt: GPU-independent pilot readiness (priorities 1–4)

**Status:** Engineering hardening only. No participant test or production speech accuracy is claimed. Modal remains blocked by billing; do not substitute a mock transcript for live recognition.

## 1. Onboarding and recording

1. Use a disposable test account on the deployed Vercel site. Verify that the configured privacy contact and terms version match the private Railway service.
2. Confirm `ALLOW_ENROLLMENT=true`, `SAUTI_REQUIRE_TERMS=true`, a private encrypted `SAUTI_PRIVATE_DIR` on **persistent storage**, and a valid `SAUTI_STORAGE_KEY` on Railway. Do not put participant audio on ephemeral container disk.
3. Enroll one known command in each language, in distinct train, calibration and untouched test sessions. Confirm that the API returns `status: stored`, and that the UI can play the captured audio locally.
4. Deny consent and confirm no upload. Test wrong account, invalid token, storage unavailable, oversized WAV and an expired consent version; all must fail without creating a recording.
5. Delete a recording and verify its encrypted WAV is gone and the existing release record is invalidated. Delete the profile and confirm all private artifacts are removed. Check a Railway restart does not erase consented clips.

**Go/no-go:** All negative tests reject; storage persists; deletion works. No real participant should enroll before storage and privacy requirements are independently reviewed.

## 2. Personal recognition and calibration

The frozen `facebook/wav2vec2-base` encoder with per-command prototypes is not trained continuously. Existing `sauti_ml.train` needs offline/worker execution and a separate train, calibration and test set. Do not claim `SPEECH_MODE=prototype` is live unless a validated private `evaluation.json` exists. If a contributing clip is withdrawn or expires, the release is invalidated and must be re-evaluated.

Record command variations in speaking rate, pitch, fatigue and noise with explicit permission. Do not tune thresholds on the untouched final test set.

**Go/no-go:** Validated release exists, wrong commands and unknown speech are rejected, and the untouched test contains no observed false activations. This is a pilot gate, not an accuracy guarantee.

## 3. Model comparison

The separate `/v1/compare` route requires explicit consent and cannot execute browser actions. It reports exact command mapping, WER and CER when a reference transcript is supplied, and elapsed time per model. Keep CDLI results as **unavailable** until Modal is deployed; do not interpret missing inference as zero accuracy. Evaluate English, Kiswahili and mixed speech independently.

Use at least a few speakers and a fixed, consented evaluation set. Track false activations per utterance, accepted command recall, WER, CER and latency. A single clip or similarity score cannot select the best model for everyone.

**Go/no-go:** Comparison never triggers the controller; metrics are reproducible; missing GPU is explicitly reported.

## 4. AI4A11y command integration

The project wraps the pinned **official** toolkit, rather than modifying its upstream source. The extension allows commands only on explicitly enabled origins, verifies page identity before execution and checks the allowlist. This patch suppresses duplicate *approved voice* actions during execution and for a short interval afterward. Manual Controller test buttons are deliberately unaffected.

Use the deployed demo page and extension on a disposable test profile to check:
* Manual scroll up/down and read page through the actual controller.
* Rejected recognition causes no page movement.
* Disabled origin, navigation during inference, revoked permission and unknown command cause no action.
* Rapid duplicate accepted voice results trigger at most one action.

**Go/no-go:** Every blocked case remains blocked; allowed actions work only on enabled sites. Do not call this system-wide Windows Voice Access integration.

## Deployment order

1. Review and merge this PR after Python, JavaScript and E2E CI checks pass.
2. Confirm Vercel and Railway deployments and server-side environment settings.
3. Run the above **nonparticipant** cloud smoke tests.
4. Resolve Modal billing later, deploy CDLI workers and run model comparison separately.
5. Conduct a supervised participant pilot only after consent, retention, storage, threat model and accessibility review.

Never paste API tokens, card details or identifiable voice recordings into GitHub issues or logs.
