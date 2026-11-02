# Sauti Adapt | Team 4 | End-to-end engineering starter

**Research prototype, not a completed accessibility product.** One personalized speech understanding core, two client surfaces (Next.js PWA and Chrome extension), a real upstream AI4A11y Controller, and a private Python inference service. Future Android adapter is intentionally NOT claimed as implemented.

## 1. What is already in this repository?

| Layer | Implementation | Status |
| --- | --- | --- |
| Canonical command mapping | `packages/shared` | Implemented; unit tests run |
| Next.js PWA | `apps/web` | Implemented as source; needs npm installation and real toolkit checkout to build |
| PWA enrollment | `apps/web/components/SautiDashboard.tsx` | Consented WAV collection with hackathon gate |
| Chrome MV3 sidepanel | `apps/extension` | Source complete; requires build + Chrome verification |
| Official AI4A11y Controller | `scripts/bootstrap_toolkit.py` | Pinned upstream import; requires network to download |
| API and audio validation | `services/speech-api` | Implemented and tested locally |
| Real personalized prototype training | `sauti_ml/train.py` | Runnable once consented audio, model weights and separate calibration and test sessions are available |
| Fine-tuned speech encoder | Research next stage | Not implemented or validated in this starter |
| Android adapter | Product roadmap | Not implemented |

## 2. First run: required software

* Git, Node.js 22, npm, Python 3.11 or 3.12, and a current Chrome browser.
* A machine with network access for npm, official toolkit Git clone, and model downloads.
* 8 GB+ available RAM is recommended for experimenting with large speech encoders; measure real requirements for your selected model.

### Clone and fetch the OFFICIAL toolkit

```bash
# Start in this repository root
python scripts/bootstrap_toolkit.py
npm install
```

The bootstrap script clones and verifies revision `7cf5006dbab9e328fadf54b654147c6bca44113d` of https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit. A different revision should be treated as a dependency change requiring rerunning integration tests.

### Start Python service

```bash
cd services/speech-api
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env                 # On Windows, use Copy-Item
# Edit .env and set a unique SAUTI_API_TOKEN
# Export .env values into your process environment (or use the Python dotenv runner)
uvicorn sauti_ml.api:app --host 127.0.0.1 --port 8000 --reload
```

**Important:** Uvicorn does not automatically load `.env`. Recommended easy alternative for local runs:

```bash
pip install python-dotenv
python -m dotenv -f .env run -- uvicorn sauti_ml.api:app --host 127.0.0.1 --port 8000 --reload
```

Start with `SPEECH_MODE=mock`. This mode **rejects** speech; it is not a fake recognizer.

### Start Next.js PWA

```bash
# Open a second terminal at repo root
cp apps/web/.env.example apps/web/.env.local
# Configure matching SPEECH_API_TOKEN, SPEECH_API_URL, and different DEMO_ACCESS_CODE
npm run dev:web
```

Open `http://localhost:3000`. Enter your demo access code. The Controller test buttons operate the demo article through the OFFICIAL toolkit without model downloads. Microphone inference in mock mode returns `MODEL_NOT_READY` and executes nothing.

## 3. Build and load Chrome extension

```bash
npm run build:extension
```

In Chrome, open `chrome://extensions`, enable Developer Mode and select **Load unpacked**. Select `apps/extension/dist`. Click the extension icon to open the Side Panel.

1. Set the PWA origin to `http://localhost:3000` (or your authorized `.vercel.app` preview).
2. Enter the demo access code and copy the profile UUID shown by the PWA.
3. On a normal test website, select **Enable current website**, then grant the requested permission.
4. Start and stop recording. The extension calls `/api/recognize`, rejects uncertain results and only injects the official Controller if the site is authorized.

With `SPEECH_MODE=mock`, this will **not** take any page action. To test page actions while the model is unavailable, use the Controller test buttons in the PWA. When a validated model is available, switch the API to `SPEECH_MODE=prototype`.

The sample manifest authorizes API requests only to localhost and `.vercel.app`; update permitted API origins if you deploy to a custom domain. Cross-site control requires a site permission grant. Chrome internal pages are not supported.

## 4. Ethical enrollment and real training

**Never collect speech just to fill a dataset. Begin with your co-designer's chosen useful commands and informed consent.**

The PWA supports recorded examples and sessions. Each page reload creates a new recording session. The server stores only consented examples in `services/speech-api/private/profiles/<UUID>/` when `ALLOW_ENROLLMENT=true`.

For initial pilot training, collect at least three examples per command and language in training sessions, at least two examples per command and language in a **separate calibration session**, at least two more in an untouched final test session, and five unknown/unrelated utterances in each of the calibration and test sessions. More varied consented data and stronger test sets are needed for rigorous evaluation.

Identify the calibration and test session UUIDs in the **private** `manifest.jsonl`, not in public logs. Then run:

```bash
cd services/speech-api
pip install -r requirements-ml.txt
# Ensure SAUTI_PRIVATE_DIR points to the SAME private folder as the API
python -m sauti_ml.train --profile-id YOUR_PROFILE_UUID --calibration-session CALIBRATION_SESSION_UUID --test-session TEST_SESSION_UUID
```

The trainer:

* Loads preprocessed, consented audio.
* Downloads a pretrained `facebook/wav2vec2-base` audio encoder if needed.
* Extracts and caches normalized speech embeddings privately.
* Builds prototypes per intended command and language.
* Selects a conservative similarity threshold using calibration and unknown examples, then independently tests on untouched session.
* Refuses to release a model when its basic observed safety tests fail.
* Saves `model.json`, `prototypes.npz` and `evaluation.json` privately after the independent final test passes.

Only after reviewing the evaluation and involving the co-designer should you set `SPEECH_MODE=prototype` and restart the API. **The similarity score is not a calibrated probability.** No accuracy on real Kenyan atypical speech is asserted by this starter.

## 5. Running quality gates

```bash
pip install -r services/speech-api/requirements-dev.txt
python -m pytest services/speech-api/tests -q
npm run test:shared
npm run typecheck:web
npm run build:extension
npm run build:web
```

The last three commands require `npm install` and the toolkit checkout. For a real deployment, add Playwright end-to-end tests to exercise the PWA/extension in actual Chrome.

## 6. GitHub and Vercel

1. Create a GitHub repository called `sauti-adapt` and push this project.
2. Create `feature/frontend`, `feature/speech-api`, `feature/ml`, `feature/toolkit`, and `feature/testing` branches.
3. Connect a Vercel project to this monorepo. Set **Root Directory** to `apps/web`.
4. Set the Vercel Build Command to `cd ../.. && python scripts/bootstrap_toolkit.py && npm install && npm run build:web` **only after verifying Vercel build root/relative path behavior**. It may be simpler to use repository root as Vercel root and build output `apps/web/.next`; test the deployment configuration in preview before merging.
5. Configure `SPEECH_API_URL`, `SPEECH_API_TOKEN` and `DEMO_ACCESS_CODE` in Vercel project environment settings. Do not prefix private values with `NEXT_PUBLIC_`.
6. Deploy the FastAPI service separately where model weights and CPU/GPU requirements fit. Do not assume Vercel Functions are suitable for persistent large models. Store personal artifacts privately on durable storage.
7. The Chrome extension is built as an artifact with `npm run build:extension` and loaded unpacked for the hackathon. It is not deployed to Vercel as a website.

## 7. What to give Codex

Read `CODEX_START_HERE.md` and `AGENTS.md`. Open the repository in Codex and paste the assignment from `CODEX_START_HERE.md`. Ask Codex to begin with the official toolkit bootstrap, build repairs and one vertical slice, not to build a disconnected new app.

## 8. Read this before presenting

* PWA is for enrollment and same-page demonstration, not system-wide phone control.
* Chrome extension supports websites granted by the user. It does not control all pages without limits.
* Android requires a later native adapter with the Android AccessibilityService permissions, policy and testing.
* Personalized voice inference requires real, consented recordings. No real co-designer results are bundled.
* A pass in a tiny evaluation session does not guarantee safe use in the wild.
* Full privacy controls, persistent storage, model cards, user deletion workflows, monitoring and per-user authentication are still required before a real release.

## References

* Official Controller design: https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit/blob/main/controller/DESIGN.md
* Controller protocol: https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit/blob/main/controller/PROTOCOL.md
* Controller demo: https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit/blob/main/controller/demo/index.html
* Kenyan atypical speech resource: https://huggingface.co/datasets/cdli/kenyan_english_nonstandard_speech_v1.0
* Kiswahili atypical speech resource: https://huggingface.co/datasets/cdli/kenyan_swahili_nonstandard_speech_v1.0
* These datasets may require access approval and impose specific use conditions. They are not downloaded by this repository.
