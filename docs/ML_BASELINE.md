# Personal prototype baseline

The app path freezes `facebook/wav2vec2-base` and stores one prototype per command and language. It does not fine-tune the encoder. The notebook under `ml/notebooks` is not part of this path. No accuracy is claimed.

Real co-designer recordings are **NOT VERIFIED**. This repository does not contain participant speech. Do not treat fixture tests as recognition performance.

## What the trainer does

`services/speech-api/sauti_ml/train.py` runs only when someone starts it. Uploading a clip does not train a model.

1. Read consented clips from `SAUTI_PRIVATE_DIR` (a directory outside the git clone).
2. Keep training, calibration, and untouched-test sessions separate, and refuse identical audio across those splits.
3. Embed clips with the frozen pretrained encoder. Tests may pass a fake encoder; that path is an artificial fixture.
4. Build one normalized prototype for each command in each language that was enrolled.
5. Choose a similarity threshold on the calibration session only. Unknown clips and wrong-command accepts must stay at zero, and every enrolled command must activate in each language it was enrolled in.
6. Score the untouched test session once. The same rules apply. The test session is not used to pick the threshold.
7. Write `model.json`, `prototypes.npz`, and `evaluation.json` only if those checks pass. `evaluation.json` includes:
   - correct accepts, rejections, wrong-command accepts, and unknown false accepts per language
   - the same counts per command and language
   - a per-language confusion map (`confusion_by_language`)
   - `latency_seconds` for that run
   - `accuracy_claim: false`

`confidence` in the API is a bounded cosine similarity, not a probability.

## One command, after real sessions exist

```bash
export SAUTI_PRIVATE_DIR=/absolute/path/outside/the/repo
python scripts/train_profile.py PROFILE_UUID CALIBRATION_SESSION_UUID TEST_SESSION_UUID
```

The encoder weights download only if a real `SpeechEncoder` runs. Install `services/speech-api/requirements-ml.txt` before that. If the sessions are missing, the command exits non-zero and does not invent a score.

Automated tests call `run(..., result_kind='artificial-fixture')` with sine tones or hand-written vectors. Those results are fixtures.

An optional later experiment, including a trainable head and a Whisper comparison, is described in `docs/RESEARCH.md`. It is not wired in and it is not a released model. The gated Kenyan speech datasets are not used.
