# Headway Voice extension only pilot

There is **no website UI** for the pilot. Load the unpacked Chrome extension from
`apps/headway` and perform all onboarding and agent interactions in its Chrome
side panel. The existing AI4A11y voice onboarding and toolkit profile remain in
the extension. Vercel is not part of this runtime flow.

## The actual runtime route

```text
Chrome Headway Voice sidepanel
   |  (user-initiated capture, consent, participant token)
   +--> Railway POST /v1/extension/compare
   |       +--> private Modal GPU English / Kiswahili fine tuned Whisper
   |       <-- transcript + reported model_id and revision
   |
   +--> Railway POST /v1/extension/agent/plan
   |       +--> private Gemini API key held only on Railway
   |       <-- ONE validated suggested action
   |
   +--> Sidepanel shows transcript and planned action; user confirms
   +--> Headway tab APIs (search, HTTPS navigation)
         OR official AI4A11y Controller in authorized content script
         (scroll, read page, go back)
```

Gemini never runs scripts or directly calls the user's browser. The extension
does not contain the Gemini API key or Railway's service API token. Only the
participant's own existing personal ID and access token are used, and those are
not persisted by the agent panel.

## Building on feature/headway-voice

```bash
git checkout feature/headway-voice
git pull origin feature/headway-voice
python scripts/bootstrap_toolkit.py
npm install
npm run check:headway
```

Chrome: `chrome://extensions` > Developer Mode > Load unpacked >
choose `apps/headway`. The manifest is at that directory root and references
`dist` files. If it was already loaded, select Reload on the extension card.

In the Headway sidepanel:
1. Open a normal HTTPS website and select **Enable current website**.
2. Enter the provisioned participant user UUID and personal token.
3. Test typed text: **Search Google for Strathmore University** >
   **Ask Gemini to plan** > review > **Confirm and execute**.
4. For voice, add the participant's **private profile UUID**, select the English
   or Swahili model, give explicit audio/transcript consent, and record.
5. Voice requests are rejected if the GPU response does not identify the
   selected `sauti-adapt-finetuned-model/english` or `/swahili`.
6. Changing a tab, website, session or the site allowlist invalidates the
   pending approval. Websites opened by the agent are not automatically enabled.

## Backend deployment requirement

The Railway `speech-api` must run a commit containing the two
`/v1/extension/*` endpoints from this branch; merely having them on GitHub
does **not** deploy them to Railway if the service tracks `main`.

The Railway service keeps `GEMINI_API_KEY`, `SAUTI_TOKEN_PEPPER`,
`SAUTI_MODAL_BEARER_TOKEN` and `SAUTI_API_TOKEN` privately in Variables.
`SAUTI_COMPARE_ENABLED=true` is required for the speech comparison pilot.
The new extension endpoints use personal-token authentication and scoped
CORS for `chrome-extension://` origins. No static shared API key is exposed.

Only search, public HTTPS navigation, scrolling, reading and back navigation
are supported. Clicking arbitrary elements, submitting forms, payments,
message sending and unattended multi-step execution are not implemented.
Model accuracy on unseen speech and the loaded GPU checkpoint identity need
separate participant-approved live verification.
