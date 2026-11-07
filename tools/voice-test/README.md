# Sauti voice test

A one-button page for testing the speech model. Each attempt shows three things:

1. **Expected:** a sentence for the person to read aloud (the five commands plus everyday sentences, in English or Kiswahili; editable on the page).
2. **What the microphone picked up:** the recording to play back, and, if switched on, what Chrome's standard speech recognition heard (this sends the audio to Google, so it is off by default).
3. **What Sauti understood:** the transcript from the Sauti model.

Columns 2 and 3 show a word-match score against the expected sentence. Previous attempts can be downloaded as a CSV for the testing evidence.

## Run it (Windows PowerShell)

```
cd tools/voice-test
$env:SAUTI_ENDPOINT = "https://<your-endpoint>.modal.run"
$env:SAUTI_TOKEN = "<the bearer token>"
python serve.py
```

Open http://127.0.0.1:8765 in Chrome and allow the microphone.

## How it works

- The page records audio, converts it to 16 kHz mono, and sends it to the local helper (`serve.py`).
- The helper forwards it to the endpoint with the token, so the token never reaches the browser and the endpoint needs no CORS changes.
- Default format is raw float32, which is what the Modal Whisper endpoint (`ml/modal/serve.py`) expects. For an endpoint that takes WAV files, set `$env:SAUTI_FORMAT = "wav"`.
- English and Kiswahili buttons choose the model (`X-Sauti-Model: english` or `swahili`).
- Recordings are limited to 30 seconds and are not saved by the page or the helper.

Never commit the token. It belongs in the terminal session or a local `.env`, not in these files.
