# Sauti Adapt: controlled live voice pilot

This is an engineering setup guide, not legal approval or proof of participant accuracy.

## 1. Clean local Windows checkout safely

The uploaded `sauti-live.patch` was made against GitHub main at `29d069c`. It does not match your edited Windows checkout. The patch's contents have been incorporated into the separate GitHub pull request. Do NOT try to apply it again after merging.

From PowerShell inside `C:\DEV\SAUTI YANGU\Sauti_Adapt`:

```powershell
git status --short
git stash push --include-untracked -m "sauti-local-before-live-pilot"
git fetch origin main
git switch main
git pull --ff-only origin main
git status --short
```

Only run the stash command when you intend to set aside **all** current tracked and untracked changes. Check that it completed successfully before continuing. Do not use `git clean -fd` or `git reset --hard` to resolve rejected hunks. Your original changes remain recoverable with `git stash list` and `git stash show -p stash@{0}`. Ignored files, such as local secrets, may remain.

**Do this after reviewing and merging the pull request**, so that the new main includes the live pilot code.

## 2. Compliance gates for human voices

The service processes recordings that may reveal sensitive disability or voice-characteristic data. Consent is not an ODPC registration exemption. Before recording real participants: identify the controller, publish a real privacy contact, determine mandatory registration and DPIA obligations with a Kenyan data protection professional, identify storage location and cross-border transfer safeguards, and obtain separate approval for research or model improvement. The current pilot form is restricted to adults until a verifiable child/guardian process exists.

Frontend Vercel variable (public contact, not a secret):

```env
NEXT_PUBLIC_SAUTI_PRIVACY_CONTACT=privacy@example.org
```

Replace the example address with a working address you control. The frontend disables enrollment until this is configured. Any change to the consent wording requires reviewing and bumping `TERMS_VERSION` in `apps/web/components/SautiDashboard.tsx` and `SAUTI_TERMS_VERSION` on the API together.

## 3. Speech API configuration on a persistent host

The web frontend and Python model **must run on separate hosts**. Deploy `services/speech-api` as a Docker service with at least enough RAM to run the CPU Wav2Vec2 encoder. Keep a persistent volume attached at `/data`; ephemeral container storage will lose recordings and personalized models.

Configure the following server-side variables in Railway or another Docker host. Do not commit values:

```env
SAUTI_PRIVATE_DIR=/data
SAUTI_API_TOKEN=<strong-random-service-secret>
SAUTI_TOKEN_PEPPER=<separate-random-secret>
SAUTI_STORAGE_KEY=<Fernet-encryption-key>
SAUTI_ACCOUNTS={"<user-uuid>":"<HMAC-SHA256-of-personal-token>"}
SAUTI_ALLOWED_ORIGINS=https://<your-vercel-hostname>
SAUTI_RETENTION_DAYS=30
SAUTI_MAX_RETENTION_DAYS=365
SAUTI_PURGE_INTERVAL_SECONDS=3600
SAUTI_REQUIRE_TERMS=true
SAUTI_TERMS_VERSION=2026-11-v1
SPEECH_MODE=prototype
ALLOW_ENROLLMENT=true
```

The sample `.env.example` and Fly defaults remain in safe mock/disabled mode. Enable the pilot only on an authorized and secured environment after the privacy, storage, and participant safeguards are ready. In Railway, variable edits are staged; review and deploy them.

Important: `SPEECH_MODE=prototype` enables the inference code path but **does not create a trained personal model**. Before a model passes the evaluation checks, recognition will safely reject with `NO_VALIDATED_PERSONAL_MODEL`.

The Dockerfile installs CPU PyTorch and the Transformers dependencies and pre-fetches the frozen `facebook/wav2vec2-base` encoder. Build time and memory requirements can be substantial.

## 4. Connect Vercel

Use root directory `apps/web` and the existing monorepo `apps/web/vercel.json`. Set these Vercel environment variables:

```env
SPEECH_API_URL=https://<your-speech-api-hostname>
SPEECH_API_TOKEN=<same-service-secret-as-SAUTI_API_TOKEN>
NEXT_PUBLIC_SAUTI_PRIVACY_CONTACT=privacy@example.org
```

Do not prefix `SPEECH_API_TOKEN` with `NEXT_PUBLIC_`. The browser provides an individual user UUID and personal token; Next.js proxies to the speech service with a separate server credential. If /api/health says preview-only, the proxy is not configured. Network errors, mismatched tokens, or missing account HMACs will block enrollment.

## 5. Onboard and calibrate the voice

1. In the frontend, open Preferences, choose English or Kiswahili and commands. A participant may naturally say **"move up"** while enrolling it as `SCROLL_UP`, and **"move down"** while enrolling it as `SCROLL_DOWN`. The recognizer learns *the command label* from their samples. It does not need to transcribe the spoken words. Use a consistent phrase until validated.
2. In Permission, read the terms, pick a retention period, confirm that the participant is an adult, and explicitly authorize storage. Optional future improvement consent is separate and recorded.
3. In Voice samples, record at least **three training clips per command**, then at least **two calibration clips** and **two separate untouched-test clips** per command, plus **five unknown/non-command samples** in each of calibration and untouched test. Use distinct session IDs and natural variation in pace, intensity, and emotion. Listening back to the latest clip happens locally in the browser tab.
4. Train using the command generated in the onboarding screen from inside the deployed speech service's working directory:

```bash
python -m sauti_ml.train --profile-id <profile-uuid> --calibration-session <calibration-uuid> --test-session <test-uuid>
```

The process builds per-command prototypes, selects a threshold using calibration only, validates against the untouched-test samples, then writes `model.json` and `evaluation.json` when it passes. It must have access to the same persistent volume that stores samples. Keep output and evaluation results private.

5. In Recognition, record a **new** utterance. Accepted commands map to `scroll up` / `scroll down` and go into the real AI4A11y Controller, which acts on the demo page. Rejected speech must do nothing.
6. Build the browser extension with `npm run build:extension`, load `apps/extension/dist` as an unpacked extension in Chrome, provide the same profile and credentials, and explicitly allow each test website. The website alone cannot install or verify the extension.

## 6. Verification before real users

```bash
python scripts/bootstrap_toolkit.py
npm install
npm run test:shared
npm run test:extension
npm run typecheck:web
npm run typecheck:extension
npm run build:web
npm run build:extension
python -m pytest services/speech-api/tests -q
```

A passing software test does not establish speech accuracy or usability. Test voice commands with the participant and collect consented results on accepted commands, false activations, false rejections, latency, language, and the effect of fatigue or different vocal tones. Never bypass the model's fail-closed release checks to force activation.

## 7. What this does not do

Windows 11 Voice Access is a separate native accessibility system. Sauti currently controls the PWA demo region and websites expressly permitted through the Chrome extension. It does **not** intercept Windows Voice Access, control arbitrary desktop applications, diagnose or treat cerebral palsy, perform continuous automatic fine-tuning, or offer verified real-world recognition accuracy. The optional CDLI Whisper model-comparison lab was in unmerged PR #7; it is not included in this pilot deployment.
