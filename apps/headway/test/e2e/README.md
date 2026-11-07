# Headway end-to-end tests (WP0)

Real Chrome for Testing, Headway loaded unpacked, the side panel driven through Playwright,
against local **fixture sites**. Nothing touches a real government site: real eCitizen shows a
Cloudflare check to automated browsers, and login, forms and payments are tested on fixtures only.
Never automate a real eCitizen login.

## Run

```bash
# from the repo root
npm run e2e:headway

# or from apps/headway
npm run e2e
```

`npm run e2e` first runs `ensure-build.mjs`, which rebuilds `dist/` when it is missing or older
than `src/` or `manifest.json`, then runs `node --test test/e2e/*.test.mjs` one file at a time.
Each file starts its own fixture server, mock API and browser on free localhost ports.

| Mode | How | Speech API | Planner |
|---|---|---|---|
| Mock (default) | `npm run e2e` | in-process mock (`startMockApi`) | rule-based, deterministic |
| Live | `E2E_LIVE=1 npm run e2e` | your local server at `http://127.0.0.1:8000` (start it first) | real Gemini |

Mock mode needs no network and no keys. In live mode the panel calls your real server, which
uses real speech models and Gemini; timeouts are longer, and the "planner was called" checks
that read the mock's request log are skipped.

Options (environment variables):

- `HEADWAY_CHROME=/path/to/chrome`: browser to use. Otherwise Playwright's own Chromium if
  installed, else the newest `~/Library/Caches/ms-playwright/chromium-*/` Chrome for Testing
  (`~/.cache/ms-playwright` on Linux). Install one with `npx playwright install chromium`.
- `HEADWAY_HEADED=1`: show the browser.
- `HEADWAY_MOCK_TRANSCRIPT="..."`: what the mock `/v1/extension/compare` "hears" by default.

### What the mock is, and is not

`startMockApi()` implements `GET /v1/extension/config` (single user, pilot profile
`00000000-0000-4000-8000-000000000002`), `POST /v1/extension/agent/plan` and
`POST /v1/extension/compare`, with CORS for `chrome-extension://` origins.

- The planner (`mockPlan`) returns v1 plans for scroll / back / read / search / open, and for v2
  requests (with `affordances`) a `click` when one affordance name best matches her words, or a
  `clarify` with 2–3 options when several tie. Pay, transfer, money, send and delete → `none`.
- `/compare` returns a **fixed** transcript from model id
  `cdli/whisper-large-v3_finetuned_kenyan_english_nonstandard_speech_v1.0`. It does not listen to
  the audio. Voice tests in mock mode prove the listen → upload → act path, not recognition.
  No accuracy can be claimed from these tests in either mode.
- `api.requests` logs every call (path, JSON body, or byte length for audio) so tests can assert
  what the extension sent, for example that no password reached the planner.

### The side panel as a tab

Automation can't open a side panel as a side panel, so the runner opens `dist/sidepanel.html` as
a tab and shims `chrome.tabs.query` in that page to return the website tab (matched by origin).
`h.goto(url)` moves the website tab and re-points the shim. This is a test shim only.

### Fake microphone

`makeWav(text, { name, voice })` makes a 16 kHz mono WAV with macOS `say` + `afconvert`, padded
with 0.5 s of silence before and 6 s after (Chrome loops the file, and the panel's end-of-speech
wait needs a quiet gap). Files go to `test/e2e/.tmp/`, which is git-ignored: never commit audio.
Pass it as `launchHeadway({ wav })`; Chrome gets `--use-file-for-fake-audio-capture`. Where `say`
is missing (Linux CI) `makeWav` returns `null` and voice tests skip.

## Add a scenario test

1. Pick the scenario ID from `docs/harness/SCENARIOS.md` and write the test first.
2. Create `test/e2e/<area>.test.mjs`:

```js
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { launchHeadway, startServers } from './lib.mjs';

describe('C3: "open the certificate one" asks with numbered choices', () => {
  let servers, h;
  before(async () => {
    servers = await startServers();
    h = await launchHeadway({ siteUrl: servers.fixtures.url + '/ambiguous/', apiBase: servers.apiBase });
    await h.enable();
  });
  after(async () => { await h?.close(); await servers?.stop(); });

  test('offers three choices and clicks nothing', async () => {
    const r = await h.instruct('open the certificate one');
    assert.equal(r.choices.length, 3);
    assert.equal(await h.site.textContent('#picked'), 'Nothing chosen yet');
  });
});
```

3. Assert outcomes (the page changed or didn't, confirm enabled or not, what the API received)
   rather than exact status wording, which changes often. Every "must not" column is an assertion.

Helpers returned by `launchHeadway()`:

| Helper | Does |
|---|---|
| `instruct(text)` | types into `#agent-instruction`, presses the do/plan button, waits until the panel finishes; returns `{ status, canConfirm, choices }` |
| `confirm()` | presses `#agent-confirm`, waits; same return shape |
| `speak()` | presses `#agent-record` (Speak), waits through listening and transcription; same return shape |
| `enable()` / `disable()` | the panel's Enable / Disable current website buttons |
| `waitStatus(regex)` / `settle()` / `status()` | read `#agent-status` |
| `scrollY()` / `scrollSettled()` | website scroll position (the latter waits for smooth scrolling to stop) |
| `goto(url)` | navigate the website tab and re-point the active-tab shim |
| `site`, `panel`, `context`, `errors` | Playwright pages/context; `errors` collects panel page errors |

Also exported from `lib.mjs`: `startFixtureServer`, `startMockApi`, `mockPlan`, `startServers`,
`findChrome`, `makeWav`, `LIVE`.

## Fixture inventory

All in `test/fixtures/sites/`, plain HTML/CSS, no external requests (`fixtures.test.mjs` checks).
Every page says "TEST FIXTURE — not a real government site" in its `<title>` and footer.

| Page | What it has | Scenarios | Scrolls at 1100×800 |
|---|---|---|---|
| `ecitizen-like/index.html` | header **Sign in** and **Register** buttons; 8 service tile links (Passport, Driving License, KRA Services, Birth Certificate, Certificate of Good Conduct, Affordable Housing, Register a Business, Marriage Certificate); agencies list | R1, R4, C1, C2, C3, P1 | yes |
| `ecitizen-like/login.html` | "Email address or ID number", "Password", "Remember for 30 days", **Sign In** submit, **Login with OTP**, **Sign in with Digital ID**, "Forgot Password" link; GET → `result.html` | F1–F4, C4 | yes |
| `ecitizen-like/good-conduct.html` | ID number (`inputmode="numeric"`), County select (Nairobi, Mombasa, Kisumu, Nakuru, Kiambu), "I agree to the terms", **Pay KSh 1,050** submit; GET → `result.html` | F1, F2, F5–F9 | yes |
| `ecitizen-like/result.html` | "Submitted" and the query values; any name containing `password` shows "(hidden)" | F8 | no: a confirmation page, short by design |
| `stubborn/index.html` | **Skip** button that only accepts `event.isTrusted` clicks: "Clicked (trusted)" / "Ignored synthetic click" | C5 | yes |
| `ambiguous/index.html` | links "Certificate of Good Conduct", "Birth Certificate", "Marriage Certificate"; buttons **Sign in**, **Sign up**; `#picked` shows what was activated | C3, C4 | yes |

## Tests today

- `fixtures.test.mjs`: every fixture loads with Headway installed, is marked, scrolls, makes no
  external request, and behaves as the scenarios need; plus unit checks of the mock planner.
- `smoke.test.mjs`: single-user connect hides the id/token fields; a typed instruction on a
  non-enabled site is refused; enable; "shuka chini" scrolls; "transfer all my money" does nothing
  and leaves confirm disabled; no panel page errors.
- `voice.test.mjs`: Speak without consent is refused and uploads nothing; with consent, the fake
  microphone audio is uploaded and the (mock) transcript scrolls the page.
