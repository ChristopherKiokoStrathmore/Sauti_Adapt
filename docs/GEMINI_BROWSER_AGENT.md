# Gemini browser agent pilot

This feature provides a human-confirmed, one-action-at-a-time browser agent
for speech accessibility. It does **not** provide unattended browsing,
form submission, arbitrary clicking, financial transactions or autonomous
multi-step navigation. The official AI4A11y Controller remains the only
executor of scroll, go-back and read-page actions.

## Architecture

1. User grants the website in the unpacked Chrome extension and supplies
   their existing personal user ID, access token and profile ID.
2. A typed request goes to Vercel `POST /api/agent/plan`.
3. For voice, the participant explicitly consents to comparison and records.
   Vercel `/api/compare` -> Railway `/v1/compare` -> the private Modal
   Whisper GPU. The extension takes the **transcript**, not the command
   comparison label. A speech transcript may be inaccurate and is shown for
   human review. Compare-only mode never triggers an action.
4. The transcript/request goes to Vercel `/api/agent/plan` and authenticated
   Railway `/v1/agent/plan`. Railway calls Gemini with the secret server
   `GEMINI_API_KEY` and allows only ONE safe planned action.
5. The user reviews the proposed action. A click on "Confirm and execute"
   rechecks the current tab, its document nonce, enabled website, personal
   token and Chrome host permission.
6. AI4A11y executes a supported local command; browser navigation and Google
   search use Chrome tabs. A newly opened website must be separately enabled.

No audio, participant IDs, tokens, site DOM or private models go to Gemini.
Only the instruction/transcript and a truncated page URL are sent. Models
and speech recordings stay on the established consented speech path.

## Deployment

In Railway service `speech-api` production Variables set
`GEMINI_API_KEY` to the AI Studio key. Optional: set
`GEMINI_MODEL=gemini-3.5-flash-lite` or another available model supporting
the generateContent API. Never use NEXT_PUBLIC variables for this secret.
On deployment, verify Railway runtime health and then the new Vercel
`/api/agent/plan` proxy exists (unauthenticated callers get 401, not 404).

Check that `SPEECH_MODE=prototype`, `SAUTI_DEMO_MODE=true`, and
`SAUTI_COMPARE_ENABLED=true` are configured for the supervised demo.
None of those flags establishes speech model accuracy or confirms the
uploaded fine-tuned Whisper weights loaded successfully on Modal. Inspect
`model_id` and `revision` in a private inference response before claiming
that the fine-tuned model is served.

## Chrome Developer Mode installation

Run from the repository root:

```bash
python scripts/bootstrap_toolkit.py
npm install
npm run build:extension
```

Open `chrome://extensions`, enable Developer Mode, choose "Load unpacked",
and select `apps/extension/dist`. The panel defaults to
`https://sauti-adapt.vercel.app`. Chrome extension origin requests to
`/api/recognize`, `/api/compare` and `/api/agent/plan` are supported,
but still require a valid personal access token. A random Chrome extension
cannot bypass that auth or obtain the backend Gemini credential.

Open an ordinary HTTPS website, click "Enable current website", and
supply the pilot participant's authenticated session in the sidepanel.

* First verify typed: "Search Google for Strathmore University" -> inspect
  the Gemini plan -> Confirm and execute -> new Google search results page.
* Then test "Scroll down" -> confirm -> real AI4A11y scroll.
* Finally test voice with explicit participant comparison consent, correct
  selected language model and profile ID. Confirm the **transcript** and
  proposal before any action.
* Verify cancellation, unsupported actions, page/tab changes during model
  inference, wrong token and rejected website permissions all prevent action.

The newly navigated website is NOT automatically enabled. Its Chrome host
permission and Sauti allowlist must be granted separately.

## Security boundaries and present limitations

The planner returns only `search_web`, `open_url`, `scroll`, `read_page`,
`go_back`, or `none`. User confirmation is required for every action.
No execute endpoint exists on Railway or Vercel. Gemini cannot invoke Chrome
APIs directly. This is not Gemini Computer Use.

The extension's current prototype login uses manually entered personal
tokens; no refresh or revocation is added here. The feature does not change
the separate command recognizer's release policy. Real atypical-speech
accuracy and real-world false action rates remain to be measured.

Only proceed to multi-step planning or DOM clicking after tests with the
co-designer and narrow action authorization rules have passed.
