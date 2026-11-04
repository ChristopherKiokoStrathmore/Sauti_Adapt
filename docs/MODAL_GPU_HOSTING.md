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
   variable `SAUTI_GPU_BEARER_TOKEN`, a long random credential.

2. Create a Modal API token for deployment. Add `MODAL_TOKEN_ID` and
   `MODAL_TOKEN_SECRET` to GitHub's `speech-gpu` Actions environment
   secrets. Restrict that environment to authorized maintainers and reviewed
   branches. Do not commit API tokens.

3. Review and merge the cloud comparison pull request after CI passes. Then
   run **GitHub Actions > Deploy CDLI Whisper GPUs to Modal > Run workflow**.
   This deploys `ml/modal/serve.py` through CI. There is no need to install
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
