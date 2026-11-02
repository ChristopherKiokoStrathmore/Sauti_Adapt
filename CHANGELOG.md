# Changelog

## Unreleased

- Bootstrap verifies upstream AI4A11y commit `7cf5006dbab9e328fadf54b654147c6bca44113d` and exits non-zero on a different SHA, a dirty checkout, or missing Controller files. The clone stays gitignored.
- Next.js typecheck calls the real `createController` / `createDomReceiver`. TypeScript's inference from `operator = null` is suppressed at that call site only. `handle()` results are narrowed before reading `pending`.
- Recorded provenance and upstream notes in `vendor/README.md`.
- Baseline on this checkout, with no product change: speech API tests 16 passed, shared command tests 2 passed, web typecheck passed, and both the extension and Next.js builds passed. Mock mode still returns `rejected` / `UNKNOWN` and does not execute speech.
