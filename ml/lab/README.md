# Sauti model lab

A local testing panel for the existing personal command model and the two CDLI
Whisper models requested for the project. The panel has a model selector, a
**Test selected model** button, and a **Compare all three** button. All selected
models receive the same decoded recording. This is an experimental comparison;
it does not change the speech API, PWA, or Chrome extension and never executes
browser actions.

## Start on Windows

Use Python 3.11 or 3.12 and Git. From the repository root in PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python -m pip install -r ml/lab/requirements.txt
.\.venv\Scripts\python scripts/run_model_lab.py
```

Open http://127.0.0.1:8501. No Node installation, toolkit checkout, extension
build, or cloud deployment is needed for this independent lab.

On macOS or Linux:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r ml/lab/requirements.txt
.venv/bin/python scripts/run_model_lab.py
```

The launcher binds to loopback. This is a single person desktop experiment;
do not expose it as a public or shared service. Run one lab process at a time.

## Your first comparison

1. Select **Whisper Kenyan English** or **Whisper Kenyan Kiswahili**.
2. Choose the language actually spoken in the clip and consent to local processing.
3. Record a phrase or upload a WAV file. Use 0.3 to 5 seconds by default.
4. Label the intended command. Choose `UNKNOWN` for unrelated speech.
5. Optionally type the correct transcript. Without it, no WER is calculated.
6. Press **Test selected model**. Then use **Compare all three** on that same clip.
7. Repeat on fresh clips, including unrelated speech and difficult conditions.

Start with your own voice for the engineering check. It cannot establish
performance on a participant's atypical speech. For that, use their consented
recordings and useful commands, and keep a separate final evaluation set after
model selection.

| Choice | What is tested | Preparation |
| --- | --- | --- |
| Sauti personal model | Frozen Wav2Vec2 embeddings and your validated command prototypes | Enroll and train the personal baseline |
| Whisper Kenyan English | CDLI English transcription followed by exact phrase mapping | Download the pretrained checkpoint on the first run |
| Whisper Kenyan Kiswahili | CDLI Swahili transcription followed by exact phrase mapping | Download the pretrained checkpoint on the first run |

The Whisper language is fixed to `en` or `sw`, with transcription, greedy
decoding, and no sampling, matching the decoding approach described in the
model cards. Each run resolves the model repository revision once and uses that
same revision for weights and processor. The export records this revision.

The model files are approximately 6.2 GB per Whisper checkpoint. Allow room for
both cached checkpoints, Python dependencies, and runtime memory. A compatible
CUDA GPU is preferable for interactive testing; CPU execution is supported but
can be slow. The lab uses FP16 on CUDA and FP32 on CPU. It keeps one backend
resident per browser session and releases it when another model is loaded.
Selecting a button alone does not download weights; running it does.

Audio inference runs locally. Model loading downloads weights from Hugging Face;
the lab does not send recordings to a hosted inference service. If access fails,
check the selected model's access conditions and your local Hugging Face login.
No gated speech dataset is downloaded by this lab. Dataset access and model
access are separate permissions. Check permitted use before redistributing or
deploying a model.

## Train the personal baseline

Open **Train personal baseline**. The lab creates its own private profile. It
does not import the deployed service's credentials or change its authentication.
Record Scroll down, Scroll up, and Go back in each language you want to test.

| Session | Each of the three commands | Unrelated phrases | One language total |
| --- | --- | --- | --- |
| Training | 3 | 0 required | 9 |
| Calibration | 2 | 5 | 11 |
| Untouched test | 2 | 5 | 11 |

That is 31 clips for one language. This lab asks for 5 unrelated phrases per
language in each evaluation session, so a bilingual experiment uses 62 clips.
The underlying repository trainer's unknown minimum is 5 per session overall;
the lab deliberately asks for language coverage as well.

Take a break and start a distinct recording session for each split. Save each
clip once with the correct session, command, and language. Duplicate uploads are
rejected. The existing trainer also detects identical processed audio across
splits. Uploading a clip does not automatically train a model.

Press **Train and validate personal model** after the count table is complete.
The existing trainer extracts real embeddings, chooses its threshold on
calibration, and evaluates the untouched test. The lab does not lower its
threshold or fabricate release files. A model is available for comparison only
with a matching successful release record.

Each experiment can use its test session once. If training fails its release
checks, inspect the failure, reset using the explicit delete control, and collect
a fresh experiment. Do not repeatedly tune on the same test set. Use new clips
in the comparison tab rather than the recordings used to train or release the
personal model.

Local enrollment files and model artifacts are kept outside Git in
`~/SautiAdaptLab/private`. The settings file at `~/SautiAdaptLab/settings.json`
holds the local storage key and experiment identifiers. Keep this directory
private and retain the key while its encrypted recordings are needed. Set
`SAUTI_LAB_DIR` to another absolute directory outside the clone if required.
The delete control removes the current profile's recordings, model, and cached
features. This lab is not a multiuser production storage service.

## Read the results correctly

1. **Command correctness** compares the predicted command or rejection with your
   supplied label. An unrelated phrase activating a command is a false
   activation. A software or download error is never a correct rejection.
2. **Word error rate** is only for Whisper because the personal model produces
   command labels, not text. It uses NFKC, case folding, punctuation to spaces,
   and word edit distance. It is not the model cards' Whisper BasicTextNormalizer
   protocol. WER can exceed 1. Corpus WER pools word errors and reference words;
   it does not average per clip percentages.
3. **Recognition seconds** excludes model loading and download time. The first
   inference can still include device warmup. **Load seconds** is shown separately.
4. **Similarity** in the detailed export belongs only to the prototype. It is
   not a probability or a shared score for ranking unlike models.
5. **Language mismatch** flags using the English checkpoint on Swahili or vice
   versa. Those rows are visible but excluded from the per language summary.

Do not rank English versus Kiswahili by comparing their published WER values:
the cards evaluate different language datasets. Compare each language's model
with the personal baseline on the same fresh recordings and equal test sets.
Use the selector for exploration; reserve another untouched set for a final
comparison after selecting models and phrase mappings.

The Whisper phrase mapper accepts only complete listed phrases. Negations such
as "do not scroll down", extra clauses, and unsupported paraphrases reject.
This policy is intentionally narrow and is separate from transcription quality.
A plausible transcript can still be wrong, so the lab never connects predictions
to the Controller. A successful exploratory result does not promote a model to
the production API.

Comparison results remain in the browser session until cleared or explicitly
exported. The JSON export contains transcripts, reference text, labels, model
revision, timing, and clip hashes; it contains no raw audio or credentials. Keep
exports private. Rerunning a model on a clip replaces its observation rather
than increasing the sample count. Changing that clip's labels invalidates its
older comparison rows.

## Validation and current limits

```bash
python -m pip install -r ml/lab/requirements-test.txt
python -m pytest ml/lab/tests services/speech-api/tests -q
```

Tests use artificial audio and fake backends to check phrase rejection,
comparison fairness, error isolation, metric denominators, encrypted enrollment,
release verification, one use of the test session, model unloading, and UI
startup. They do not download full speech models or measure speech accuracy.
Real CDLI weight loading, microphone capture, GPU performance, and participant
results still need a local trial. Nothing is deployed by these commands.

Sources:

* https://huggingface.co/cdli/whisper-large-v3_finetuned_kenyan_english_nonstandard_speech_v1.0
* https://huggingface.co/cdli/whisper-large-v3_finetuned_kenyan_swahili_nonstandard_speech_v1.0
* https://huggingface.co/docs/transformers/v4.57.1/en/model_doc/whisper
* https://docs.streamlit.io/develop/api-reference/widgets/st.audio_input
