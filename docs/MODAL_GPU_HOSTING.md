# CDLI Kenyan English and Kiswahili Whisper: GPU hosting plan

Status: CODE PREPARED ON A REVIEW BRANCH. No Modal GPU endpoint has been
deployed or validated in this repository. The Hugging Face Hub hosts the
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
control of the English and Kiswahili Transformers pipelines, per-model GPU
workers, an encrypted HTTP hop protected by a service credential, and idle
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
   variable `SAUTI_GPU_BEARER_TOKEN`, a long random credential. Also create
   `sauti-gpu-partner-auth` with `SAUTI_GPU_PARTNER_TOKENS` (it may be empty;
   see "Sharing the endpoint with another team" below). The deploy fails if
   either secret is missing. In the Modal dashboard under **Settings > Proxy
   Auth Tokens**, create a proxy auth token for the speech API.

2. Create a Modal API token for deployment. Add `MODAL_TOKEN_ID` and
   `MODAL_TOKEN_SECRET` to GitHub's `speech-gpu` Actions environment
   secrets. Restrict that environment to authorized maintainers and reviewed
   branches. Do not commit API tokens.

3. Review and merge the cloud comparison pull request after CI passes. Then
   run **GitHub Actions > Deploy CDLI Whisper GPUs to Modal > Run workflow**.
   This deploys `ml/modal/server.py` through CI. There is no need to install
   or run the app on your Windows computer.

4. Modal will report the HTTPS endpoint URL for `transcribe`. Its GPU
   workers run on an L4 GPU. The English and Kiswahili model keys have
   separate worker pools. The first invocation may download around 6 GB
   of weights for each checkpoint and may take noticeably longer. Subsequent
   calls use the cached weights and warm containers when available. Both
   checkpoints can be compared sequentially without both permanently
   occupying GPU memory.

5. Configure ONLY the private FastAPI speech service host with:

```env
SAUTI_MODAL_URL=https://<the-real-deployed-modal-endpoint>
SAUTI_MODAL_BEARER_TOKEN=<the-same-secret-value-as-on-Modal>
SAUTI_MODAL_PROXY_KEY=<wk-... proxy auth token ID for the speech API>
SAUTI_MODAL_PROXY_SECRET=<ws-... proxy auth token secret for the speech API>
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

## Sharing the endpoint with another team

The endpoint is a public HTTPS URL, protected by two independent credentials.
Every caller needs both:

1. **Modal proxy auth** (`Modal-Key` / `Modal-Secret` headers). Modal checks
   these before any container starts. Create one proxy auth token per team
   in the Modal dashboard under **Settings > Proxy Auth Tokens**, and delete
   it to revoke that team.
2. **A per-team bearer token** (`Authorization: Bearer ...`). The endpoint
   checks it and logs the team label, model and audio size per request (never
   audio or tokens), so usage can be attributed.

Partners can use only the public `english` and `swahili` CDLI base models.
A participant's `personalized_*` adapter answers only the speech API's token,
and any other caller gets `422 Unknown model`.

Before you grant access, agree in writing with the team on: the model terms
(the CDLI model cards state no license, so confirm permitted use with CDLI),
whose speech they will send, consent, Kenyan data protection obligations,
and who pays for GPU time. Sauti's consent and deletion workflow does not
cover audio another team sends.

### Add a team

```bash
# One token per team. Labels: lowercase letters, digits, '-'.
TEAM_TOKEN=$(python -c "import secrets; print(secrets.token_urlsafe(48))")
# --force replaces the whole value, so list EVERY team that should keep access:
modal secret create sauti-gpu-partner-auth --force \
  SAUTI_GPU_PARTNER_TOKENS="team-a:$TEAM_TOKEN"
modal deploy ml/modal/server.py   # running containers pick up secrets on redeploy
```

Send the team its bearer token and proxy auth token through a password
manager share or another secure channel, never in chat, email or a repository.
Keep your own record of which label owns which token.

### Revoke a team

Delete its proxy auth token in the Modal dashboard. Access stops immediately.
Then remove its entry from `SAUTI_GPU_PARTNER_TOKENS` and redeploy. The speech
API and other teams are unaffected. A malformed partner list disables all
partner access but never the speech API, so check the entries after an edit.

### What to send the partner team

- The endpoint URL, and their proxy auth token ID (`wk-...`) and secret (`ws-...`).
- Their bearer token.
- Request format: `POST`, `Content-Type: application/octet-stream`,
  `X-Sauti-Model: english` or `swahili`, and a body of raw 16 kHz mono
  float32 little-endian samples, 0.3 to 30 seconds. WAV or MP3 files are
  not accepted.

```python
import librosa, requests
audio, _ = librosa.load("clip.wav", sr=16000, mono=True)
r = requests.post(URL, data=audio.astype("<f4").tobytes(), timeout=600, headers={
    "Modal-Key": PROXY_KEY, "Modal-Secret": PROXY_SECRET,
    "Authorization": f"Bearer {TOKEN}",
    "X-Sauti-Model": "swahili",
    "Content-Type": "application/octet-stream"})
r.raise_for_status()
print(r.json()["transcript"])
```

- The first call after an idle period can take minutes while the GPU starts.
- Outputs are research transcriptions, not validated accuracy.

### Capacity

By default each model has one GPU container, which handles requests one at a
time, so a busy partner slows down Sauti comparisons. To allow more, deploy
with `SAUTI_GPU_MAX_CONTAINERS=2` (accepted range 1 to 4). This raises the
maximum GPU spend, so set a Modal spending limit first.

## Performance and cost

Start on one Modal L4 worker per selected CDLI model with the default
scale-to-zero configuration. This avoids paying for two continuously warm GPUs,
but introduces cold starts. The very first request also downloads weights,
and a three-model comparison can be much slower than a one-model inference.
Benchmark duration, memory and GPU costs with 5-second clips and different
speakers before changing the service timeout or warming both models.

The Modal public pricing page currently lists L4 at $0.000222 per GPU-second
(about $0.80 per active GPU-hour), plus billed CPU and RAM. Weight storage is
charged separately (listed $0.09/GiB-month). Rates may change. Apply spending
limits before enabling a team demo.

Links:
* https://modal.com/docs/guide/model-weights
* https://modal.com/docs/guide/continuous-deployment
* https://modal.com/docs/guide/webhooks
* https://modal.com/pricing
* https://huggingface.co/docs/inference-endpoints/pricing
* https://huggingface.co/cdli/whisper-large-v3_finetuned_kenyan_english_nonstandard_speech_v1.0
* https://huggingface.co/cdli/whisper-large-v3_finetuned_kenyan_swahili_nonstandard_speech_v1.0
