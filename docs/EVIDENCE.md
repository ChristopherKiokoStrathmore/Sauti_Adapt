# Sauti Adapt README evidence register

Source README: main commit `7e67a5ca1a1746e9d3e804df20bfec8e562ccb68`
Date: 2026-11-06

All visible candidate claims are **NOT VERIFIED** until an exact executed source, command and date is supplied. This is not a speech accuracy or legal compliance report.

| README line | Claim | Status |
| --- | --- | --- |
| 5 | Sauti Adapt now includes an **optional Headway control** on the homepage and through voice onboarding. Participants can explicitly enable their camera to try a head controlled virtual pointer, dwell clicking, and calibrated mouth gesture selection. The final onboarding  | NOT VERIFIED |
| 7 | This is **not** an installed Chrome extension: browser controls are limited to safe interactions on Sauti Adapt itself. To reach unrelated external sites, Headway must be installed separately with Chrome permissions. The future Chrome Web Store path remains available at | NOT VERIFIED |
| 9 | The teammate maintained extension under `apps/headway/**` is untouched. Web integration imports its compatible pure mouth gesture and pointer motion modules but cannot automatically execute extension specific Chrome API changes. See [Headway Web Demo architecture and va | NOT VERIFIED |
| 11 | **Research prototype, not a completed accessibility product.** One personalized speech understanding core, two client surfaces (Next.js PWA and Chrome extension), a real upstream AI4A11y Controller, and a private Python inference service. Future Android adapter is inten | NOT VERIFIED |
| 15 | \| Layer \| Implementation \| Status \| | NOT VERIFIED |
| 17 | \| Canonical command mapping \| `packages/shared` \| Implemented; unit tests run \| | NOT VERIFIED |
| 18 | \| Next.js PWA \| `apps/web` \| Implemented as source; needs npm installation and real toolkit checkout to build \| | NOT VERIFIED |
| 19 | \| PWA enrollment \| `apps/web/components/SautiDashboard.tsx` \| Consented WAV collection with hackathon gate \| | NOT VERIFIED |
| 20 | \| Chrome MV3 sidepanel \| `apps/extension` \| Source complete; requires build + Chrome verification \| | NOT VERIFIED |
| 21 | \| Official AI4A11y Controller \| `scripts/bootstrap_toolkit.py` \| Pinned upstream import; requires network to download \| | NOT VERIFIED |
| 22 | \| API and audio validation \| `services/speech-api` \| Implemented and tested locally \| | NOT VERIFIED |
| 23 | \| Frozen Wav2Vec2 plus prototypes \| `sauti_ml/encoder.py`, `sauti_ml/train.py` \| The app path freezes `facebook/wav2vec2-base` and stores one prototype per command and language. It does not fine-tune. No accuracy is claimed. \| | NOT VERIFIED |
| 24 | \| Notebook experiments \| `ml/notebooks` \| Not imported by the API, the PWA, or the extension \| | NOT VERIFIED |
| 25 | \| Android adapter \| Product roadmap \| Not implemented \| | NOT VERIFIED |
| 29 | The independent [model lab](ml/lab/README.md) provides a selector for the current | NOT VERIFIED |
| 30 | personal baseline and the CDLI Kenyan English and Kiswahili Whisper checkpoints. | NOT VERIFIED |
| 31 | Record once, test one model, or compare all three on the same clip. The lab also | NOT VERIFIED |
| 32 | collects consented examples for the existing personal trainer. It is a local | NOT VERIFIED |
| 33 | experiment and does not execute page actions or change the production recognizer. | NOT VERIFIED |
| 40 | Full setup, recording requirements, metric definitions, and verification limits | NOT VERIFIED |
| 41 | are in the lab guide. Real speech performance is not established by software tests. | NOT VERIFIED |
| 45 | * Git, Node.js 22, npm, Python 3.11 or 3.12, and a current Chrome browser. | NOT VERIFIED |
| 46 | * A machine with network access for npm, official toolkit Git clone, and model downloads. | NOT VERIFIED |
| 47 | * 8 GB+ available RAM is recommended for experimenting with large speech encoders; measure real requirements for your selected model. | NOT VERIFIED |
| 57 | The bootstrap script clones and verifies revision `7cf5006dbab9e328fadf54b654147c6bca44113d` of https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit. A different revision should be treated as a dependency change requiring rerunning integration | NOT VERIFIED |
| 73 | **Important:** Uvicorn does not automatically load `.env`. Recommended easy alternative for local runs: | NOT VERIFIED |
| 80 | Start with `SPEECH_MODE=mock`. This mode **rejects** speech; it is not a fake recognizer. | NOT VERIFIED |
| 91 | Open `http://localhost:3000`. Enter the personal user ID and access token. The Controller test buttons operate the demo article through the OFFICIAL toolkit without model downloads. Microphone inference in mock mode returns `MODEL_NOT_READY` and executes nothing. | NOT VERIFIED |
| 99 | In Chrome, open `chrome://extensions`, enable Developer Mode and select **Load unpacked**. Select `apps/extension/dist`. Click the extension icon to open the Side Panel. | NOT VERIFIED |
| 101 | 1. Set the PWA origin to `http://localhost:3000` (or your authorized `.vercel.app` preview). | NOT VERIFIED |
| 102 | 2. Enter the personal user ID, access token, and the profile UUID shown by the PWA. | NOT VERIFIED |
| 103 | 3. On a normal test website, select **Enable current website**, then grant the requested permission. | NOT VERIFIED |
| 104 | 4. Start and stop recording. The extension calls `/api/recognize`, rejects uncertain results and only injects the official Controller if the site is authorized. | NOT VERIFIED |
| 106 | With `SPEECH_MODE=mock`, this will **not** take any page action. To test page actions while the model is unavailable, use the Controller test buttons in the PWA. When a validated model is available, switch the API to `SPEECH_MODE=prototype`. | NOT VERIFIED |
| 108 | The sample manifest authorizes API requests only to localhost and `.vercel.app`; update permitted API origins if you deploy to a custom domain. Cross-site control requires a site permission grant. Chrome internal pages are not supported. | NOT VERIFIED |
| 112 | **Never collect speech just to fill a dataset. Begin with your co-designer's chosen useful commands and informed consent.** | NOT VERIFIED |
| 114 | The PWA supports recorded examples and sessions. Start a new session in the enrollment form for training, calibration, and the untouched test. The server stores only consented examples under `SAUTI_PRIVATE_DIR` (outside this repository) when `ALLOW_ENROLLMENT=true`. | NOT VERIFIED |
| 116 | For initial pilot training, collect at least three examples per command and language in training sessions, at least two examples per command and language in a **separate calibration session**, at least two more in an untouched final test session, and five unknown/unrela | NOT VERIFIED |
| 118 | Identify the calibration and test session UUIDs in the **private** `manifest.jsonl`, not in public logs. Then run: | NOT VERIFIED |
| 127 | The trainer: | NOT VERIFIED |
| 129 | * Loads preprocessed, consented audio. | NOT VERIFIED |
| 130 | * Downloads a frozen pretrained `facebook/wav2vec2-base` encoder if needed. Its weights are not updated. This is not fine-tuning. | NOT VERIFIED |
| 131 | * Does not import or run `ml/notebooks`. | NOT VERIFIED |
| 132 | * Extracts and caches normalized speech embeddings privately. | NOT VERIFIED |
| 133 | * Builds one prototype per intended command and language. | NOT VERIFIED |
| 134 | * Selects a conservative similarity threshold using calibration and unknown examples, then independently tests on an untouched session. | NOT VERIFIED |
| 135 | * Reports correct accepts, rejections, wrong-command accepts, and unknown false accepts for Kenyan English and Kiswahili, and for each command in each language. | NOT VERIFIED |
| 136 | * Refuses to release a model unless every enrolled command activates in each language it was enrolled in, and unless no false activation was observed. Those counts are not an accuracy claim. | NOT VERIFIED |
| 137 | * Saves `model.json`, `prototypes.npz` and `evaluation.json` privately after the independent final test passes. | NOT VERIFIED |
| 139 | Only after reviewing the evaluation and involving the co-designer should you set `SPEECH_MODE=prototype` and restart the API. **The similarity score is not a calibrated probability.** No accuracy on real Kenyan atypical speech is asserted by this starter. | NOT VERIFIED |
| 141 | Recording starts only when the person presses the microphone control. The default control is one toggle button, with an optional auto-stop at 5 seconds. Separate start and stop buttons are available. The server enforces `SAUTI_MAX_CLIP_SECONDS` (default 5; invalid setti | NOT VERIFIED |
| 155 | The build commands require `npm install` and the toolkit checkout. `npm run test:e2e` installs Playwright's Chromium and starts the mock speech API plus the Next.js app. It checks the real Controller, not a substitute, and checks that mock-mode audio is rejected. | NOT VERIFIED |
| 159 | 1. Create a GitHub repository called `sauti-adapt` and push this project. | NOT VERIFIED |
| 160 | 2. Create `feature/frontend`, `feature/speech-api`, `feature/ml`, `feature/toolkit`, and `feature/testing` branches. | NOT VERIFIED |
| 161 | 3. Connect a Vercel project to this monorepo. Set **Root Directory** to `apps/web`. | NOT VERIFIED |
| 162 | 4. Set the Vercel Build Command to `cd ../.. && python scripts/bootstrap_toolkit.py && npm install && npm run build:web` **only after verifying Vercel build root/relative path behavior**. It may be simpler to use repository root as Vercel root and build output `apps/web | NOT VERIFIED |
| 163 | 5. Follow `docs/DEPLOYMENT.md` for Vercel and the separate speech-api host. Do not prefix private values with `NEXT_PUBLIC_`. | NOT VERIFIED |
| 164 | 6. Deploy the FastAPI service separately where model weights and CPU/GPU requirements fit. Do not assume Vercel Functions are suitable for persistent large models. Store personal artifacts privately on durable storage. | NOT VERIFIED |
| 165 | 7. The Chrome extension is built as an artifact with `npm run build:extension` and loaded unpacked for the hackathon. It is not deployed to Vercel as a website. | NOT VERIFIED |
| 169 | Read `CODEX_START_HERE.md` and `AGENTS.md`. Open the repository in Codex and paste the assignment from `CODEX_START_HERE.md`. Ask Codex to begin with the official toolkit bootstrap, build repairs and one vertical slice, not to build a disconnected new app. | NOT VERIFIED |
| 173 | * PWA is for enrollment and same-page demonstration, not system-wide phone control. | NOT VERIFIED |
| 174 | * Chrome extension supports websites granted by the user. It does not control all pages without limits. | NOT VERIFIED |
| 175 | * Android requires a later native adapter with the Android AccessibilityService permissions, policy and testing. | NOT VERIFIED |
| 176 | * Personalized voice inference requires real, consented recordings. No real co-designer results are bundled. | NOT VERIFIED |
| 177 | * A pass in a tiny evaluation session does not guarantee safe use in the wild. | NOT VERIFIED |
| 178 | * Full privacy controls, persistent storage, model cards, user deletion workflows, monitoring and per-user authentication are still required before a real release. | NOT VERIFIED |
| 182 | * Official Controller design: https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit/blob/main/controller/DESIGN.md | NOT VERIFIED |
| 183 | * Controller protocol: https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit/blob/main/controller/PROTOCOL.md | NOT VERIFIED |
| 184 | * Controller demo: https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit/blob/main/controller/demo/index.html | NOT VERIFIED |
| 185 | * Kenyan atypical speech resource: https://huggingface.co/datasets/cdli/kenyan_english_nonstandard_speech_v1.0 | NOT VERIFIED |
| 186 | * Kiswahili atypical speech resource: https://huggingface.co/datasets/cdli/kenyan_swahili_nonstandard_speech_v1.0 | NOT VERIFIED |
| 187 | * These datasets may require access approval and impose specific use conditions. They are not downloaded by this repository. | NOT VERIFIED |

For fresh claim IDs and evidence reconciliation, run `python scripts/evidence_report.py` in a checked out repository. Claims without matched, run-specific GitHub Actions evidence remain NOT VERIFIED.
