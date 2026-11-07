# Headway Harness: work packages

Claim a package by putting your name and branch in its row (WORKFLOW.md §3). Keep this file
current in every harness PR.

Status: **Todo** · **Claimed** · **In review** · **Done**

| WP | What | Depends on | Owner | Branch / PR | Status |
|---|---|---|---|---|---|
| 0 | Foundations: fixture sites + e2e runner | – | | | Todo |
| 1 | ChromeControlPort v2 + affordance map | 0 | | | Todo |
| 2 | Safety: risk, confirmation, secrets, numbers | 1 | | | Todo |
| 3 | Understanding: grammar v2 + Gemini lane v2 | 1 | | | Todo |
| 4 | Listening runtime + panel in use | 0 | | | Todo |
| 5 | Learning loop: corrections → Librarian | 3, 4 | | | Todo |
| 6 | Eval harness on her recordings | 1, 3, 4 | | | Todo |
| 7 | Upstream PRs to the AI4A11y toolkit | 1, 3, voice (#29) | | | Todo |
| – | Voice onboarding + `fields.voice` | – | Brian | [#29](https://github.com/ChristopherKiokoStrathmore/Sauti_Adapt/pull/29) | In review |

---

## WP0 · Foundations

**Folders:** `apps/headway/test/fixtures/sites/`, `apps/headway/test/e2e/`, root `package.json` scripts.

- Static fixture sites served on localhost by the test runner:
  - `ecitizen-like/`: home with service tiles; login with ID number, password, OTP and Digital ID buttons; a service form with a county select, an agree checkbox and a "Pay KSh 1,050" submit; a result page
  - `stubborn/`: a button that ignores synthetic clicks
  - `ambiguous/`: three "Certificate" tiles; "Sign in" and "Sign up"
- `npm run e2e:headway`: Playwright with Chrome for Testing, Headway loaded unpacked, a fake microphone from a WAV (`--use-file-for-fake-audio-capture`), and helpers to send a transcript straight into the pipeline (skipping speech) for fast tests.
- CI: add `e2e:headway` to `.github/workflows/headway-hackathon.yml`.

**Done when:** the runner loads Headway, opens each fixture page, and a sample test passes on CI.

## WP1 · ChromeControlPort v2 + affordance map

**Folders:** `apps/headway/src/toolkit-next/platforms/chrome/`, `apps/headway/src/content/affordances.ts`.
**Scenarios:** N1–N4, N6, R1, R3, C1, C4 (returns `ambiguous`), C5, F5, F6.

- Implements the SPEC §4.1 contract and the §4.2 catalogue, plus the known-sites list (§4.5).
- The affordance map: accessible names, kinds, ids stable per `pageVersion` (MutationObserver), viewport flag, `formSubmit`.
- Scored whole-word matching; `ambiguous` instead of first match.
- Adds the `search` permission (manifest test updated).

## WP2 · Safety

**Folders:** `apps/headway/src/harness/safety/`, `src/toolkit-next/controller/numbers.ts`.
**Scenarios:** F1–F4, F7–F9, X4.

- `check(intent, affordances, setup)` → run / confirm(real label) / refuse(reason), from SPEC §5.1, including D2.
- Secret mode (SPEC §5.2): field detection; no transcript to Gemini, history or logs; masked read-back; takes not saved.
- Spike: can an extension accept Chrome's saved-password autofill by voice? Write it up in Research/.
- Numbers grammar, English and Kiswahili.

## WP3 · Understanding

**Folders:** `apps/headway/src/toolkit-next/controller/` (grammar v2, Gemini lane v2), relay endpoint for Gemini.
**Scenarios:** N1, N5, R4, C2, C3, C4, P1–P3, X3.

- Grammar v2: Kiswahili, `extend()` for aliases and site phrases, exact after normalisation.
- Gemini lane v2 (SPEC §4.3): tool declarations from `actionSchemas`; affordances as untrusted labels; `call` / `plan` / `clarify` / `none`; validation; Nano first, cloud through the relay.
- Plan runner: one step at a time, observe, stop on a changed page.
- Records which path ran, for history and eval.

## WP4 · Listening runtime + panel in use

**Folders:** `apps/headway/src/listen/` (offscreen document), `apps/headway/src/sidepanel/`.
**Scenarios:** X1, and the Ready / Listening / Working / Did you mean / Check before sending screens (design frames 11–15).

- Offscreen mic (`offscreen` permission), started by her trigger with the panel open or closed; her `listening` settings from `fields.voice`; one request in flight; Stop.
- Sauti through the relay; Chrome standard recognition only if she consented.
- Feedback by her choice: `tts` (permission), earcons, text and live region.
- Numbered choices on the page and in the panel for clarify (overlay drawn by the content script).

## WP5 · Learning loop

**Folders:** `apps/headway/src/harness/learn/`.
**Scenarios:** N5, X5.

- A "Did you mean" pick with "Remember" becomes a Librarian **proposal**; accepting it adds an alias or site phrase.
- "My commands" screen: see, edit and delete aliases and site phrases.

## WP6 · Eval harness

**Folders:** `apps/headway/eval/`.

- Replays recorded takes (IndexedDB export, or `~/Downloads/Sauti_Voice_Recordings` on a consenting machine) through LISTEN → WRITE → UNDERSTAND against fixture pages, with nothing acted on for real.
- Report per scenario: pass/fail, path, latency, cut-offs, wrong actions (must be 0).
- `npm run eval:headway`; output is a local HTML report, never uploaded.

## WP7 · Upstream to the toolkit

- PRs to AI-for-Accessibility-Toolkit:
  - voice profile (`core/voice.js`, a `voice` profile field)
  - ControlPort v2 and the Chrome control port
  - grammar v2
  - Gemini lane v2
  - confirmation from explicit preference instead of an inferred "motor" profile
- Raise D1 (affordance names to the model) and D2 (always confirm submit) with the maintainers.
- After each merge: bump the pin and delete the Headway copy (WORKFLOW.md §8).
