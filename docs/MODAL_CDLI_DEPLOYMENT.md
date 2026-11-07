# Modal CDLI inference deployment

## Current scope

The existing Sauti FastAPI `POST /v1/compare` endpoint already forwards
opt-in speech comparison requests to a private Modal Whisper GPU endpoint.
This branch hardens the URL and audio contract and adds mocked integration
tests for Kenyan English, Kiswahili, unknown speech, model mismatch and
participant-specific access control. It does not change `/v1/recognize`
or grant permission to dispatch AI4A11y Controller actions.

Architecture:

Browser (Next.js) -> authenticated Next.js `/api/compare` ->
Railway FastAPI `/v1/compare` -> authenticated Modal GPU ->
transcript -> safe comparison JSON.

No private participant audio, model weights, bearer tokens or raw transcripts
are committed to the repository or sent to application logs.

## Railway variables

Set these using Railway's protected environment controls:

```text
SAUTI_MODAL_URL=https://ulla39254--sauti-adapt-cdli-gpu-transcribe.us-east.modal.run
SAUTI_MODAL_BEARER_TOKEN=<newly rotated secret, not the shared old value>
SAUTI_COMPARE_ENABLED=true
SAUTI_PERSONALIZED_COMPARE_ENABLED=false
```

Enable participant-specific comparison only after confirming that the
deployed Modal model actually loads the private adapters for the authorised
profile, the person has consented to this specific external service, and
`SAUTI_PILOT_PROFILE_ID` is set to that profile. Model names alone are
not evidence that a LoRA adapter has been loaded.

Do not place the Modal bearer token in Vercel or a NEXT_PUBLIC variable.
Vercel needs only the existing `SPEECH_API_URL` and
`SPEECH_API_TOKEN` to reach Railway.

## Testing

```sh
python -m pytest services/speech-api/tests/test_modal_cdli_integration.py -q
python -m pytest services/speech-api/tests -q
npm run test:shared
npm run test:extension
npm run typecheck:web
npm run typecheck:extension
npm run build:web
npm run build:extension
npm run test:e2e
```

The mocked tests do not establish live Modal reachability or transcription
quality. Before enabling comparison for a real participant, run a supervised
consented test with non-sensitive approved recordings. Verify English and
Kiswahili transcripts, cold-start latency, model revision, error handling
and absence of executed Controller actions. Record WER/CER only with
actual reference transcripts.

## Outstanding evidence

* Live authenticated Modal HTTP round trip: NOT VERIFIED
* Whether private adapters are loaded in the Modal image: NOT VERIFIED
* Kenyan English transcription accuracy: NOT VERIFIED
* Kiswahili transcription accuracy: NOT VERIFIED
* End-to-end browser comparison on deployed Railway: NOT VERIFIED
* Real participant consent for this external processing: NOT VERIFIED
* Production Controller activation by this GPU model: DISABLED

The credential previously pasted into the conversation should be rotated
before production configuration.
