# Paste this instruction into Codex in the Sauti Adapt GitHub repository

You are the senior full stack and ML engineer for Sauti Adapt, Team 4, an AI for Accessibility hackathon project. Start by studying AGENTS.md and docs/ARCHITECTURE.md, then inspect every component of the existing monorepo. Do not create a separate toy app. The provided project is the source of truth.

## Goal
Deliver a fully integrated, accessible PWA + Chrome Manifest V3 sidepanel extension using a PRIVATE personalized Kenyan English/Kiswahili speech recognizer and the REAL AI for Accessibility Toolkit Controller. User speech should yield a canonical command; validation should reject uncertain inputs; the official Controller must call a ControlPort receiver to operate the active permitted website. Leave Android as a separately documented future adapter unless the primary demo passes all acceptance criteria.

## Execute these work packages in order

1. **Bootstrap and verify actual upstream**. Use `python scripts/bootstrap_toolkit.py`. Verify SHA `7cf5006dbab9e328fadf54b654147c6bca44113d`. Read upstream `controller/createController.js`, `controller/web/dom-receiver.js`, `controller/mount/index.js`, `controller/DESIGN.md`, and `controller/PROTOCOL.md`. Correct path/bundler issues in Next.js and esbuild without copying the toolkit into a fake class. Record package/commit provenance.
2. **Run baseline tests**. `pip install -r services/speech-api/requirements-dev.txt`, `python -m pytest services/speech-api/tests -q`; `npm install`, `npm run test:shared`, `npm run typecheck:web`, `npm run build:extension`, `npm run build:web`. Fix any failures. Do not mark a build verified unless you ran it.
3. **End-to-end integration smoke test**. Launch FastAPI with `SPEECH_MODE=mock` and Next.js. Demonstrate that clicking the Controller test buttons uses the *real* `controller.handle()` and changes the demo DOM. Verify that audio in mock mode always rejects. Add Playwright tests that fail if a mock Controller is substituted.
4. **Chrome extension integration**. Load `apps/extension/dist` in Chrome as an unpacked extension. Open the sidepanel, grant site permission, prove command dispatch through bundled upstream Controller on two unrelated test websites, and verify no action on an unapproved website. Confirm microphone permissions, extension cross-origin API routing and refusal on `chrome://` pages. Fix any gaps.
5. **Private enrollment pipeline**. Provide accessible enrollment with user's chosen preferred commands and languages, explicit informed consent, separate recording sessions, private storage and a deletion pathway. Never export voice data into source control. Confirm secure defaults and test authorization.
6. **ML baseline and personalization**. Use `SPEECH_MODE=prototype` only after legitimate enrollment data exists. Run actual pretrained encoder embeddings, speaker-dependent prototype training (`python -m sauti_ml.train`), calibration and untouched test and unknown input rejection. Compare Kenyan English and Kiswahili performance separately. Do not invent results. Record confusion matrix, false activations, task completion and latency.
7. **Model research improvements**. Build an OPTIONAL, audited experiment using a frozen audio encoder and trainable classifier head. If data allows, test selective encoder fine tuning with parameter efficiency. Do not promote an unvalidated model. Verify rights before using the gated Kenyan atypical speech corpora. Avoid train/test leakage and underpowered claims.
8. **Final deployment**. Connect Vercel PWA to an appropriately provisioned API. Replace shared demo passphrase with per-user authorization, encrypted private model storage, retention/deletion policy, rate limiting, request limits, origin policy, and server side audit controls before public use. Confirm installability and accessibility on real devices.

## Acceptance criteria
- At least five co-designer chosen commands (or fewer, if agreed by the person) and an explicit `UNKNOWN` rejection path.
- Real official AI4A11y Controller, with tests and upstream provenance.
- PWA captures consented audio and safely calls backend without leaking credentials.
- Extension's content script dispatches the same canonical command to the real toolkit on multiple permitted websites.
- No background recording, no unauthorized website control, no fake accuracy or speech examples.
- Clear deployment document, reproducible setup, tests, issues list, and short co-designer demonstration script.

## Interaction protocol
Work in small reviewed PRs. Before coding, summarize evidence and note unresolved environmental constraints. Implement the most important vertical slice first. If GitHub repo access is provided, create focused changes there. Do not fabricate build outcomes, sample recordings or co-designer results. At the end of every PR, report exact tests run, failures, privacy risks and remaining work.
