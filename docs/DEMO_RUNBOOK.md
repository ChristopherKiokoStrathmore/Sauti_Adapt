# Working demo runbook (voice navigation for a participant with cerebral palsy)

Status: engineering path implemented and unit tested with artificial tones. Recognition of real atypical speech is **NOT VERIFIED**. Do not state an accuracy figure to judges.

## Why the app said "mock"
1. `SPEECH_MODE` was `mock` (the default). In mock mode `/v1/recognize` rejects every recording.
2. Even in `prototype` mode, nothing in the app could train a model, so the answer was `NO_VALIDATED_PERSONAL_MODEL`.
3. The release gate then wanted at least 30 unrelated-speech clips.

## Switch it on
Speech API host (needs about 2 GB RAM for torch and wav2vec2, and a persistent volume):

```
SPEECH_MODE=prototype
ALLOW_ENROLLMENT=true
SAUTI_DEMO_MODE=true
SAUTI_PRIVATE_DIR=/data            # volume, outside the repo
SAUTI_STORAGE_KEY=<Fernet key>
SAUTI_API_TOKEN=<secret>  SAUTI_TOKEN_PEPPER=<secret>  SAUTI_ACCOUNTS=<json>
SAUTI_ALLOWED_ORIGINS=https://sauti-adapt.vercel.app
```
The Docker image bakes `facebook/wav2vec2-base`. `fly.toml` still ships `SPEECH_MODE=mock`: change it there if you deploy with Fly.

Vercel: `SPEECH_API_URL`, `SPEECH_API_TOKEN` (same as `SAUTI_API_TOKEN`). Redeploy.

Check: open `/api/admin/status`. Expect `mode: prototype` and `demoMode: true`.

## Run it (about 15 minutes with the participant)
1. Use the participant's own device, microphone and room, the same ones used on stage.
2. Choose 3 to 5 commands. Set clip length to 3 seconds. Use the toggle recording button, not hold-to-talk, if holding is hard.
3. Record 5 examples of each command, then 10 unrelated utterances (other words, humming, a cough, background talk) under Unknown speech.
4. Step 4: press **Build my voice model**. Wait about a minute.
5. If it says blocked, the message names what is missing. Record more of those and rebuild.
6. Say a command. Accepted commands go to the pinned AI4A11y Controller. Anything uncertain is rejected and nothing runs.

## Rehearse before the judges
- Run `python -m sauti_ml.layer_sweep --profile-id <uuid>` on the rehearsal recordings. If another layer scores clearly higher, set `SAUTI_ENCODER_LAYER` to it, retrain.
- Rehearse with the same person on the same day. Fatigue and a different microphone both change the result.
- Keep the "Optional demo without speaking" buttons as the fallback. Say plainly which part is live.

## What to tell judges
- Personal prototypes on a frozen speech encoder, a handful of commands, fails closed.
- Demo-grade checks on the participant's own held-back clips. Not a validated release. No accuracy claim.
- Consent, encrypted storage, retention and deletion are real and tested.
