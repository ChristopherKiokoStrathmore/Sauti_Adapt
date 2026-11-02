# Changelog

## Unreleased

- Bootstrap verifies upstream AI4A11y commit `7cf5006dbab9e328fadf54b654147c6bca44113d` and exits non-zero on a different SHA, a dirty checkout, or missing Controller files. The clone stays gitignored.
- Next.js typecheck calls the real `createController` / `createDomReceiver`. TypeScript's inference from `operator = null` is suppressed at that call site only. `handle()` results are narrowed before reading `pending`.
- Recorded provenance and upstream notes in `vendor/README.md`.
- Baseline on this checkout, with no product change: speech API tests 16 passed, shared command tests 2 passed, web typecheck passed, and both the extension and Next.js builds passed. Mock mode still returns `rejected` / `UNKNOWN` and does not execute speech.
- Docs and UI state that the app path freezes `facebook/wav2vec2-base` and uses per-command prototypes. It does not fine-tune, the notebook is not wired in, and no accuracy is claimed.
- "Read this page aloud" speaks the on-screen text with `speechSynthesis`. That speech is not recorded or uploaded, and Stop speaking cancels it. "Undo last setting" is labeled as a display-setting undo only.
- Training reports correct, rejected, incorrect, and unknown false accepts per language and per command-language. Release requires a correct activation for every command in each enrolled language. Tests use artificial tones or vectors, not human speech.
- Clip length and the listen control are configurable. Defaults are one toggle button and a 5 second auto-stop. The server still enforces its cap. Final values must be agreed with the participant. Recording starts only from the button.
- The PWA injects upstream `CONTROLLER_CSS` so toolkit text-size and contrast rules render. It still does not mount the stock speech widget. Playwright checks real `handle()` markers from the pinned toolkit and that mock-mode audio is rejected.
