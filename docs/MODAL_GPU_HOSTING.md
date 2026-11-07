# CDLI Kenyan English and Kiswahili Whisper: GPU hosting plan

Status: DEPLOYED FOR PILOT TESTING on 2026-11-07 in the `ulla39254` Modal
workspace (`https://ulla39254--sauti-adapt-cdli-gpu-transcribe.us-east.modal.run`).
Verified there: bearer auth (wrong token gets 401), English and Kiswahili
transcription of real 18-30 s clips, 46 s audio split into windows, silence
returning an empty transcript, and `503` for a personalized key with no
adapter. NOT VERIFIED: recognition accuracy for Sauti co-designers, and any
personalized adapter (none has been trained). The Hugging Face Hub hosts the
weights; a Hub model page is not automatically an available shared API.

## Recommended topology

```text
Browser, user consent and recording
    -> Next.js on Vercel (/api/compare)
    -> Private FastAPI on a durable hosting service (/v1/compare)
       |-- authenticated user and consent checks
       |-- personal Wav2Vec2 prototype (CPU, on speech service)
       |-- HTTPS + bearer token to Modal GPU for either:
           |-- cdli/whisper-large-v3_finetuned_kenyan_english_nonstandard_speech_v1.0
           |-- cdli/whisper-large-v3_finetuned_kenyan_swahili_nonstandard_speech_v1.0
       -> normalized transcript to explicit, allowlisted intent
       -> comparison results only, NEVER a Controller action
```

The normal `/v1/recognize` path **is unchanged**: it only executes a
previously validated personal command model via the real AI4A11y Controller.
Research comparisons can not activate commands. Mixed-language input is an
exploratory test, not a guarantee that either checkpoint recognizes switching.

## Why Modal rather than a generic HF inference API?

Hugging Face's model repository is a source of weights. Inference Providers
are only callable for models served by participating providers, which has not
been verified for these exact CDLI checkpoints. Dedicated Hugging Face
Inference Endpoints are a viable paid alternative. Modal offers explicit
control of the English and Kiswahili Transformers pipelines, a GPU worker
that holds both models, an encrypted HTTP hop protected by a service credential, and idle
scale-down during an early pilot. A model call downloads and caches its exact
Hub revision into a Modal Volume. No personal voice recording is stored by
this GPU worker.

Do not copy pretrained weights into Git, Vercel, Railway, or your laptop.
Before using a real person's speech, verify the models' license/terms and
participant privacy arrangements, data transfer locations, access restrictions,
processor contracts and Kenyan data protection requirements. Consent does not
automatically waive ODPC registration.

## Modal deployment without running the app locally

1. Create a Modal account and confirm billing, region, privacy and budget
   controls. Create a Modal secret named `sauti-gpu-auth` with environment
   variable `SAUTI_GPU_BEARER_TOKEN`, a long random credential. It must be
   in the same workspace and environment (`main`) as the app; the deploy
   fails if it is missing, and a different value there is the usual cause of
   `401 Invalid service authorization`. The endpoint uses this one bearer
   token only: no Modal proxy auth and no per-team tokens.

2. Create a Modal API token for deployment. Add `MODAL_TOKEN_ID` and
   `MODAL_TOKEN_SECRET` to GitHub's `speech-gpu` Actions environment
   secrets. Restrict that environment to authorized maintainers and reviewed
   branches. Do not commit API tokens.

3. Review and merge the cloud comparison pull request after CI passes. Then
   run **GitHub Actions > Deploy CDLI Whisper GPUs to Modal > Run workflow**.
   This deploys `ml/modal/server.py` through CI. There is no need to install
   or run the app on your Windows computer.

4. Modal will report the HTTPS endpoint URL for `transcribe`. One GPU
   container (L4, or A10G when no L4 is free) holds **both** CDLI checkpoints
   (about 6 GB in fp16) and serves every model key, so comparing English and
   Kiswahili never starts a second container. Hugging Face revisions are
   pinned in `MODEL_REVISIONS`; the first start downloads each checkpoint
   into the `sauti-adapt-cdli-cache` volume, later starts read it with no
   network call. To deploy by hand instead of CI:

```bash
cd ml/modal
MODAL_PROFILE=<workspace profile> uv run --with modal --with "fastapi>=0.115,<1" modal deploy server.py
```

5. Configure ONLY the private FastAPI speech service host with:

```env
SAUTI_MODAL_URL=https://<the-real-deployed-modal-endpoint>
SAUTI_MODAL_BEARER_TOKEN=<the-same-secret-value-as-on-Modal>
SAUTI_COMPARE_ENABLED=true
```

   Keep `SAUTI_API_TOKEN`, `SAUTI_TOKEN_PEPPER`, `SAUTI_ACCOUNTS`,
   `SAUTI_STORAGE_KEY`, `SAUTI_PRIVATE_DIR`, `SAUTI_REQUIRE_TERMS`,
   `SAUTI_PRIVACY_CONTACT` and persistent recording storage configured.
   Those credentials and personal audio must never be placed in public
   GitHub Actions logs or `NEXT_PUBLIC_` variables.

6. On Vercel, use the Next.js app root and set `SPEECH_API_URL` and
   `SPEECH_API_TOKEN`. The `/api/compare` proxy forwards authenticated,
   explicitly consented requests to the private speech service, which then
   calls Modal with a separate service credential.

7. On your deployed website, open **Check recognition > Compare recognition
   models**, select **Compare all three**, choose spoken language including
   **English and Kiswahili mixed**, provide the expected command and
   optional correct transcript, consent to that comparison, and record once.
   Review outputs and false activations. No AI4A11y action should execute.

8. For deployed HTTP smoke tests, `playwright.cloud.config.ts` is distinct
   from the regular mock-mode tests. With an approved test URL and a
   disposable test account, GitHub CI can run `npm run test:e2e:cloud`
   after a separate workflow is configured. Never run mutating tests against
   a real person's stored profile.

## Calling the endpoint directly (team testing)

Anyone holding `SAUTI_GPU_BEARER_TOKEN` can call the endpoint, and every call
is billed to the hosting workspace. Share it only with the team, through a
password manager or another private channel, never in chat, email or a
repository. Replace the secret value (and the speech API's
`SAUTI_MODAL_BEARER_TOKEN`) after a test round with outside people.

Request format: `POST`, `Authorization: Bearer <token>`,
`Content-Type: application/octet-stream`, `X-Sauti-Model: english` or
`swahili`, and a body of raw 16 kHz mono float32 little-endian samples,
0.3 to 120 seconds. WAV or MP3 files are not accepted.

```bash
ffmpeg -i clip.wav -ac 1 -ar 16000 -f f32le clip.f32
curl -sS -L --max-time 300 "$URL" \
  -H "Authorization: Bearer $SAUTI_GPU_BEARER_TOKEN" \
  -H "X-Sauti-Model: swahili" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @clip.f32
```

- Keep `-L` and do **not** add `-X POST`. During a slow cold start Modal
  answers `303` and the result must be fetched with a `GET`; `-X POST`
  re-sends a POST and fails with `400 bad redirect method`. Python
  `requests` and `urllib` follow the redirect correctly by default.
- The response holds `transcript`, `revision`, `device`, `audio_seconds`,
  `windows` and `inference_ms`. Outputs are research transcriptions, not
  validated accuracy.
- `personalized_english` / `personalized_swahili` return `503` until a
  participant adapter is installed in the `sauti-adapt-private-adapters`
  volume.

| Status | Meaning |
|---|---|
| 200 | Transcribed (silence gives an empty transcript) |
| 401 | Missing or wrong bearer token |
| 413 | Audio empty or over 120 s (a trailing partial float32 sample of 1-3 bytes is dropped, not rejected) |
| 415 | `Content-Type` is not `application/octet-stream` |
| 422 | Unknown `X-Sauti-Model` |
| 503 | Personalized adapter not installed |

## Long speech and output length

Whisper hears at most 30 s at a time. Longer audio (up to 120 s) is split at
the quietest point in the last 5 s of each window, transcribed as one batch
and joined. Each window may produce up to 440 new tokens (Whisper's decoder
ceiling), scaled at 15 tokens per second of audio so a hallucination loop on
silence cannot run to the limit; real speech never reaches that rate.
Windows below the speech API's silence floor (RMS 0.002) are skipped.

The speech API still limits clips to `SAUTI_MAX_CLIP_SECONDS` (default 5 s,
at most 30 s), so longer descriptions only reach this endpoint when called
directly until that limit is changed with the participant's agreement.

## Warm windows (avoiding cold starts)

Outside a warm window the GPU container shuts down after 5 idle minutes and
the next request waits for a cold start. During a test session, open a warm
window instead:

```bash
cd ml/modal
MODAL_PROFILE=<workspace profile> uv run --with modal python warm.py on      # 10 h (default, max 12)
MODAL_PROFILE=<workspace profile> uv run --with modal python warm.py off
MODAL_PROFILE=<workspace profile> uv run --with modal python warm.py status
```

While a window is open, `min_containers=1`, so the container never scales
down however long it is idle. `enforce_warm_window` in `server.py` runs every
2 minutes: it releases the GPU when the window ends (a forgotten session stops
billing on its own) and restores the warm container after a redeploy, which
resets autoscaling. A deploy always costs one cold start, so avoid deploying
during a session.

## Performance and cost

Measured on 2026-11-07 (A10G, Kenya to Modal us-east):

| Request | Time |
|---|---|
| Warm, 18-30 s real clip | 3.7-4.9 s total, under 1 s of GPU time |
| Warm, 46 s clip (2 windows) | about 7 s total, 2.4 s of GPU time |
| Cold start, weights cached | about 15-17 s |
| Cold start before these changes | 105 s, or a 300 s timeout while waiting for an L4 |

Most of a warm request is network transfer (about 2 MB of float32 audio for
30 s), not GPU time. The container serves one request at a time
(`max_containers=1`), which also caps GPU spend.

Modal's pricing page lists L4 at about $0.80 and A10G at about $1.10 per
active GPU-hour, plus billed CPU and RAM. A 10-hour warm window therefore
costs roughly $8-11. Weight storage is charged separately (listed
$0.09/GiB-month). Rates may change. Apply spending limits before a team demo.

Links:
* https://modal.com/docs/guide/model-weights
* https://modal.com/docs/guide/continuous-deployment
* https://modal.com/docs/guide/webhooks
* https://modal.com/pricing
* https://huggingface.co/docs/inference-endpoints/pricing
* https://huggingface.co/cdli/whisper-large-v3_finetuned_kenyan_english_nonstandard_speech_v1.0
* https://huggingface.co/cdli/whisper-large-v3_finetuned_kenyan_swahili_nonstandard_speech_v1.0
