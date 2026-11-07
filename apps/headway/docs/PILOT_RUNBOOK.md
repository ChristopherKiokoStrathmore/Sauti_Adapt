# Session with Faridah: runbook

For the person running a supervised Headway session on one laptop (local single-user mode).

## Before she arrives (10 minutes)

1. **Build the extension**
   ```sh
   cd Sauti_Adapt
   python scripts/bootstrap_toolkit.py && npm install && npm run check:headway
   ```
   In Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → `apps/headway`. If it's already loaded, press **Reload**.

2. **Start the speech API on this laptop.** It holds the Gemini proxy key and the Modal token in `services/speech-api/.env`, which is git-ignored.
   ```sh
   cd services/speech-api && set -a && . ./.env && set +a && .venv/bin/uvicorn sauti_ml.api:app --host 127.0.0.1 --port 8000
   ```
   `.env` needs these settings:
   - `SAUTI_LOCAL_SINGLE_USER=true`
   - `SAUTI_COMPARE_ENABLED=true`
   - `SAUTI_MAX_CLIP_SECONDS=30`
   - `SAUTI_MODAL_URL` and `SAUTI_MODAL_BEARER_TOKEN`
   - `GEMINI_API_KEY`: her team's `hk_…` token
   - `GEMINI_API_BASE=https://ai4a11y.lovable.app/api/public/gemini`
   - `GEMINI_MODEL=gemini-3.8-flash`
   - `SAUTI_PRIVATE_DIR`: a folder outside the repo

   `hk_` tokens expire after 12 hours unused. Get a fresh one from the team page if Gemini answers 401.

3. **Start the onboarding speech helper.** Voice setup uses it for the Sauti readings.
   ```sh
   cd tools/voice-test && SAUTI_PORT=8790 python3 serve.py
   ```

4. **Keep the GPU warm for the session.** Without this, the first command waits for a cold start of about 15–25 s.
   ```sh
   cd ml/modal && MODAL_PROFILE=ulla39254 uv run --with modal python warm.py on 3
   ```
   Run `warm.py off` afterwards.

5. **Check:** open the Headway side panel. "AI Browser Agent" should say *Connected to the speech server on this laptop*.

## With her

1. **Consent first**, in her words. Explain what is recorded, where it goes (Modal for speech, Gemini for meaning, never passwords), and that she can stop or delete everything at any time.
2. **Voice setup:** side panel → **Teach Headway my voice**. Let her go at her pace; breaks are built in. She chooses her trigger, her commands, and when Headway should ask before acting.
3. **Using it:** open a website (Google, then eCitizen). She says **"enable this website"** (or press Enable), then presses **Speak** or her key, **Alt + Shift + H**, and talks. Headway waits for her own pause length before it decides she has finished.

## What she can say today

| English | Kiswahili | Does |
|---|---|---|
| "Open eCitizen" | "Fungua eCitizen" | opens the site (then "enable this website") |
| "Scroll down" / "Scroll up" | "Shuka chini" / "Panda juu" | scrolls |
| "Go back" | "Rudi nyuma" | back |
| "Read this to me" | "Nisomee" | reads the page aloud |
| "Click Good Conduct", "Click sign in" | "Bonyeza sign in" | presses it; several matches → numbered choices on the page |
| "I need a police clearance" | – | Gemini works out it means Certificate of Good Conduct |
| "One" / "Two" / "Three" | "Moja" / "Mbili" / "Tatu" | picks a numbered choice |
| "Click ID number", then "Type one two three…" | "Andika moja mbili tatu…" | types digits; read back as "ending in 7 8" |
| "Choose Nairobi", "Tick I agree" | "Chagua Nairobi" | dropdowns and checkboxes |
| "Click pay" / "Submit" | "Tuma" / "Lipa" | **always asks first**, reading the real button label |
| "Yes" / "No" | "Ndiyo" / "Hapana" | answers that question |
| "Enter my password" | "Weka nenosiri" | never dictated: points to Chrome's saved password, OTP or Digital ID |
| "Stop" | "Simama" | stops speech and listening |

## Known limits (say so if they come up)

- eCitizen's login uses her real account: she types or uses saved passwords herself. Headway never handles passwords.
- Each new website needs "enable this website" once.
- Payments, transfers and sending messages are refused by design.
- The speech model is the CDLI Kenyan English / Kiswahili model. Her personal model isn't trained yet.
- Nothing has been tested with Faridah before this session. Note what fails, in her words, in `apps/headway/Research/`.

## Afterwards

Run `warm.py off`. Stop both servers with Ctrl+C. If she asks, delete her data from the side panel ("Forget my voice profile", "Delete my recordings").
