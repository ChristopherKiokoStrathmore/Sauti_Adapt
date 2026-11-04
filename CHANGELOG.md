# Changelog

## Unreleased

- Head pointer precision (Research/001). The pointer snaps to any clickable, not only links, measured to the target's edge, and the snapped target is framed. Mouth click freezes the pointer as the mouth starts to open and clicks once per opening; Nutshell re-clicked every 800 ms while the mouth stayed open. A picker with large numbered tiles appears when a click lands between small targets. The follow rate depends on distance, and the side panel adds Pointer speed and Steadiness. A target test page is in `apps/extension/Research/`. 19 tests pass. Not yet measured with a person.
- `apps/extension` is now **Headway**, a TypeScript rebuild of Nutshell (head-pointer browsing and on-device link summaries). It replaces the Sauti voice extension. Its e2e specs (`e2e/extension.spec.ts`, `e2e/binding.spec.ts`, `e2e/extension-sites.mjs`) are removed, and `build:extension` / `typecheck:extension` now target the `headway` workspace. Other docs that describe the Sauti extension are not updated yet.
- Headway's own code is all TypeScript under `strict`. Readability and Human.js come from typed npm packages instead of vendored files; Human 3.3.6 is byte-identical to Nutshell's copy. WebGazer and clmtrackr were vendored but never referenced, so they were dropped.
- The manifest sits at the extension root and points into `dist/`. The unused `webNavigation` permission was removed. Only the six Human models the config loads are shipped (dist 34 MB → 18 MB, confirmed by watching network requests on a live page).
- Nutshell bugs found while typing, and fixed:
  - The gaze tooltip's bullet regex `[\*-•]` was a character range that matched letters, so lines such as "I think…" became bullets. There is now one shared, tested formatter.
  - In "panel" mode, YouTube summaries never reached the side panel: the code compared against `'sidepanel'`, which is not a mode, and sent `action` where the panel listens on `type`.
  - On X, mousing out of a non-link tweet ran `delete` on `null` and threw.
  - The HUD and an empty camera box showed on every page even with tracking off.
  - Two dots appeared on the page: the head pointer, plus a dwell dot drawn at the link's centre, which matched the pointer once both used the brand colour. There is now one pointer. Dwell progress is a ring that fills around it, and the snapped link gets a thin frame.
  - Fetch error text went into the tooltip as raw HTML; it is escaped now.
- Human.js config notes (no behaviour change): `attention/description/antispoof/liveness: false` are now `{ enabled: false }`. `filter.temporalSmoothing` does not exist in Human 3.3.6 and was silently ignored, so it was removed.
- New identity: the h mark, wordmark and icons are in `~/Documents/headway-brand` (outside the repo). The side panel, tooltips, scroll and navigation zones, dwell ring and calibration dialogs were redesigned with one accent colour. Status shows as glyph plus word.
- Checks: strict typecheck passes, 12 node tests pass, and the build passes. The unpacked extension was loaded in Chromium for Testing: the hover pipeline reached the summariser, and Human.js loaded with a fake camera. Not verified: real Gemini Nano output, tracking with a real face, live YouTube and X capture.

- Bootstrap verifies upstream AI4A11y commit `7cf5006dbab9e328fadf54b654147c6bca44113d` and exits non-zero on a different SHA, a dirty checkout, or missing Controller files. The clone stays gitignored.
- Next.js typecheck calls the real `createController` / `createDomReceiver`. A module declaration types `operator` as the documented ability-model object, so the `operator = null` default no longer forces a cast. `handle()` results are narrowed before reading `pending`.
- Recorded provenance and upstream notes in `vendor/README.md`.
- Baseline on this checkout, with no product change: speech API tests 16 passed, shared command tests 2 passed, web typecheck passed, and both the extension and Next.js builds passed. Mock mode still returns `rejected` / `UNKNOWN` and does not execute speech.
- Docs and UI state that the app path freezes `facebook/wav2vec2-base` and uses per-command prototypes. It does not fine-tune, the notebook is not wired in, and no accuracy is claimed.
- "Read this page aloud" speaks the on-screen text with `speechSynthesis`. That speech is not recorded or uploaded, and Stop speaking cancels it. "Undo last setting" is labeled as a display-setting undo only.
- Training reports correct, rejected, incorrect, and unknown false accepts per language and per command-language. Release requires a correct activation for every command in each enrolled language. Tests use artificial tones or vectors, not human speech.
- Clip length and the listen control are configurable. Defaults are one toggle button and a 5 second auto-stop. The server still enforces its cap. Final values must be agreed with the participant. Recording starts only from the button.
- The PWA injects upstream `CONTROLLER_CSS` so toolkit text-size and contrast rules render. It still does not mount the stock speech widget. Playwright checks real `handle()` markers from the pinned toolkit and that mock-mode audio is rejected.
- The extension controls a website only after the person enables that origin. Chrome host permissions for the speech API do not enable control. Disable removes the origin. The content script rejects by default.
- Enrollment stores consented clips only when `ALLOW_ENROLLMENT=true` and `SAUTI_PRIVATE_DIR` is outside the git repository. The person can delete one clip or the whole profile. Withdrawal works even when new enrollment is off.
- `scripts/train_profile.py` runs prototype training once private sessions exist. The report adds per-language confusion counts and latency. Fixture tests are labelled `artificial-fixture`. Real co-designer results are not verified.
- `docs/RESEARCH.md` records a future frozen-encoder head and a Whisper comparison. Neither is implemented. Gated Kenyan corpora stay unused until rights are verified.
- Personal access tokens replace the shared demo passphrase. Private audio and models are encrypted, requests are rate limited and size limited, origins are checked, and audit lines omit audio and tokens. `docs/DEPLOYMENT.md` describes Vercel plus a separate API host. Nothing was deployed.
