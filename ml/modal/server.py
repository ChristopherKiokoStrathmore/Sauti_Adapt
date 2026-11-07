"""Fine-tuned Kenyan atypical speech Whisper inference on Modal GPUs.

Only the trusted Sauti speech API should call this endpoint. Audio is
transient: accepted request bodies are used for GPU inference and discarded.

The GPU serves two fine-tuned Whisper models, uploaded to the Modal Volume
'sauti-adapt-finetuned-model' (folders /english and /swahili), under the
request keys 'english' and 'swahili'. One GPU container holds both, so there
is one cold start instead of one per model.

The CDLI base checkpoints are no longer served. Their weights stay stored in
the 'sauti-adapt-cdli-cache' volume (do not delete it): a fine-tuned folder
without its own preprocessor_config.json or generation_config.json borrows
the CDLI copy, and serving CDLI again needs no new download.

Deployment prerequisites:
  - Modal account / billing
  - Modal Secret 'sauti-gpu-auth' with SAUTI_GPU_BEARER_TOKEN
  - Check CDLI checkpoint usage permissions and personal data hosting terms.

Keeping the GPU warm for a test session (see warm.py):
  python warm.py on       # keep one container loaded for 10 hours (default)
  python warm.py on 6     # or any number of hours up to 12
  python warm.py off      # release it now
While a window is open min_containers=1, so the container never scales down,
however long it sits idle (scaledown_window only applies outside a window).
enforce_warm_window releases the GPU when the window ends, so a forgotten
session cannot keep billing.
"""
import hmac
import os
import time
from pathlib import Path

import modal
from fastapi import Request

APP_NAME = "sauti-adapt-cdli-gpu"

# CDLI base checkpoints: stored in the 'sauti-adapt-cdli-cache' volume, not
# served. Pinned Hugging Face commits; read from the volume cache with no
# network call. Used only for config files a fine-tuned folder lacks.
CDLI_MODEL_IDS = {
    "english": "cdli/whisper-large-v3_finetuned_kenyan_english_nonstandard_speech_v1.0",
    "swahili": "cdli/whisper-large-v3_finetuned_kenyan_swahili_nonstandard_speech_v1.0",
}
CDLI_REVISIONS = {
    "english": "bf30914177cf7f40b9b6d0c8aa3e38c37ea59cc4",
    "swahili": "644252d2258ad6ef6b5f8b1d65cccb8fbbd6cf86",
}

# Fine-tuned models served on the GPU. Each folder is a full Hugging Face
# Whisper export (config.json, model.safetensors, tokenizer files) uploaded
# with: modal volume put sauti-adapt-finetuned-model <local dir> /<folder>
FINETUNED_VOLUME_NAME = "sauti-adapt-finetuned-model"
FINETUNED_ROOT = Path("/finetuned")
SERVED_MODELS = {
    # key: volume folder, Whisper language code, CDLI model for missing configs
    "english": {"folder": "english", "language": "en", "fallback": "english"},
    "swahili": {"folder": "swahili", "language": "sw", "fallback": "swahili"},
}

# Personalized LoRA adapters were trained on the CDLI base models, which are
# no longer served, so these keys answer 503 rather than attach an adapter to
# a model it was not trained for. Kept so callers get a clear answer.
PILOT_KEYS = ("personalized_english", "personalized_swahili")
ALL_KEYS = (*SERVED_MODELS, *PILOT_KEYS)

SAMPLE_RATE = 16_000
MIN_SAMPLES = 4_800                    # 0.3 s
# Long recordings are split into 30 s windows and transcribed BATCH_WINDOWS at
# a time, so GPU memory stays flat however long the audio is. The ceiling is
# bounded by the request timeouts below, not by memory.
MAX_SECONDS = 30 * 60                  # 30 minutes
BATCH_WINDOWS = 8                      # 30 s windows per generate() call (4 min of audio)
MAX_SAMPLES = MAX_SECONDS * SAMPLE_RATE
MAX_BYTES = MAX_SAMPLES * 4            # float32
WINDOW_SAMPLES = 30 * SAMPLE_RATE      # Whisper hears at most 30 s at a time
CUT_SEARCH_SAMPLES = 5 * SAMPLE_RATE   # cut long audio at the quietest point in the last 5 s
FRAME_SAMPLES = 1_600                  # 0.1 s energy frames for choosing the cut
# Whisper's decoder holds 448 positions and the prompt uses 4
# (<|startoftranscript|>, language, task, <|notimestamps|>). This is the
# model's ceiling per 30 s window, far above what 30 s of speech produces.
MAX_NEW_TOKENS = 440
# Output budget scales with audio length so a hallucination loop on a short
# or quiet clip cannot run to 440 tokens. 15 tokens/s is roughly 3x fast
# Kiswahili speech, so real sentences are never cut; 30 s still gets 440.
TOKENS_PER_SECOND = 15
MIN_NEW_TOKENS = 24
# Same silence floor as the speech API (services/speech-api/sauti_ml/audio.py).
MIN_RMS = 0.002

WARM_WINDOW_MAX_HOURS = 12

app = modal.App(APP_NAME)
weights = modal.Volume.from_name("sauti-adapt-cdli-cache", create_if_missing=True)
# No create_if_missing: a misspelt name must fail the deploy, not silently
# create an empty volume with no models in it.
finetuned = modal.Volume.from_name(FINETUNED_VOLUME_NAME)
warm_window = modal.Dict.from_name("sauti-adapt-warm-window", create_if_missing=True)

gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch>=2.3,<3", "transformers>=4.45,<5", "huggingface_hub>=0.28,<1",
        "accelerate>=1.0,<2", "safetensors>=0.5,<1", "numpy>=1.26,<3",
        "peft==0.17.1",
        "fastapi>=0.115,<1",
    )
    .env({"HF_HOME": "/models"})
    .add_local_python_source("finetuned_models")
)
api_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")              # decodes WAV/MP3/M4A/OGG/WebM/FLAC uploads on CPU
    .pip_install("fastapi>=0.115,<1")
    .add_local_python_source("audio_input")
)


def split_into_windows(audio):
    """Split audio longer than 30 s at quiet points so words are not cut."""
    import numpy as np

    windows, start = [], 0
    while audio.size - start > WINDOW_SAMPLES:
        search_from = start + WINDOW_SAMPLES - CUT_SEARCH_SAMPLES
        frames = audio[search_from:start + WINDOW_SAMPLES].reshape(-1, FRAME_SAMPLES)
        quietest = int(np.argmin((frames ** 2).mean(axis=1)))
        cut = search_from + quietest * FRAME_SAMPLES + FRAME_SAMPLES // 2
        windows.append(audio[start:cut])
        start = cut
    windows.append(audio[start:])
    # A sliver left after the last cut is silence by construction; Whisper
    # tends to invent a word for pure silence, so drop it.
    return [w for w in windows if w.size >= MIN_SAMPLES] or windows[:1]


@app.cls(
    image=gpu_image,
    gpu=["L4", "A10G"],          # L4 first; A10G only when no L4 is free
    volumes={"/models": weights, str(FINETUNED_ROOT): finetuned},
    timeout=1200,                # per request; 30 min of audio is 60 windows
    startup_timeout=900,         # model loading, separate from request time
    scaledown_window=300,
    max_containers=1,
)
class CDLIWhisper:
    # Class name kept so warm.py and enforce_warm_window (which look it up by
    # name) keep working. It now serves the fine-tuned models in SERVED_MODELS.

    @modal.enter()
    def load(self):
        import torch
        from transformers import (
            AutoConfig, AutoFeatureExtractor, AutoModelForSpeechSeq2Seq, AutoTokenizer,
            GenerationConfig, WhisperProcessor,
        )
        from finetuned_models import (
            FEATURE_EXTRACTOR_FILE, GENERATION_CONFIG_FILE,
            folder_fingerprint, folder_problems, has_file,
        )

        started = time.monotonic()
        self.torch = torch
        self.device = torch.cuda.get_device_name(0)
        self.processors, self.models, self.revisions, self.unavailable = {}, {}, {}, {}
        for key, spec in SERVED_MODELS.items():
            folder = FINETUNED_ROOT / spec["folder"]
            problems = folder_problems(folder)
            if problems:
                # Fail closed for this key only; the other model keeps serving.
                self.unavailable[key] = "; ".join(problems)
                print(f"model {key} unavailable: {self.unavailable[key]}", flush=True)
                continue
            fallback = self._cdli_snapshot(spec["fallback"])
            extractor_source = folder if has_file(folder, FEATURE_EXTRACTOR_FILE) else fallback
            processor = WhisperProcessor(
                feature_extractor=AutoFeatureExtractor.from_pretrained(extractor_source),
                tokenizer=AutoTokenizer.from_pretrained(folder, trust_remote_code=False),
            )
            model = AutoModelForSpeechSeq2Seq.from_pretrained(
                folder, torch_dtype=torch.float16, low_cpu_mem_usage=True,
                use_safetensors=True, trust_remote_code=False,
                attn_implementation="sdpa",
            )
            if model.config.num_mel_bins != processor.feature_extractor.feature_size:
                raise RuntimeError(
                    f"{key}: model expects {model.config.num_mel_bins} mel bins but the feature "
                    f"extractor gives {processor.feature_extractor.feature_size}; upload the "
                    f"model's own {FEATURE_EXTRACTOR_FILE}.")
            if not has_file(folder, GENERATION_CONFIG_FILE):
                # Whisper needs language/task token ids from the generation
                # config. Borrowing the CDLI copy is only safe for the same
                # vocabulary (whisper-large-v3 has one more token than others).
                fallback_config = GenerationConfig.from_pretrained(fallback)
                fallback_vocab = AutoConfig.from_pretrained(fallback).vocab_size
                if model.config.vocab_size != fallback_vocab:
                    raise RuntimeError(
                        f"{key}: no {GENERATION_CONFIG_FILE} and the vocabulary differs from "
                        f"whisper-large-v3; upload the model's own {GENERATION_CONFIG_FILE}.")
                model.generation_config = fallback_config
            self.models[key] = model.to("cuda").eval()
            self.processors[key] = processor
            self.revisions[key] = folder_fingerprint(folder)
        print(f"loaded {sorted(self.models)} on {self.device} in "
              f"{time.monotonic() - started:.1f}s; unavailable={sorted(self.unavailable)}", flush=True)

    @staticmethod
    def _cdli_snapshot(base_key: str) -> str:
        """Local path of a stored CDLI checkpoint (downloaded once if missing)."""
        from huggingface_hub import snapshot_download
        from huggingface_hub.errors import LocalEntryNotFoundError

        model_id, revision = CDLI_MODEL_IDS[base_key], CDLI_REVISIONS[base_key]
        try:
            return snapshot_download(repo_id=model_id, revision=revision, local_files_only=True)
        except LocalEntryNotFoundError:
            path = snapshot_download(repo_id=model_id, revision=revision)
            weights.commit()
            return path

    @modal.method()
    def transcribe(self, model_key: str, audio_bytes: bytes) -> dict:
        import numpy as np

        if model_key not in ALL_KEYS:
            raise ValueError("Unknown model.")
        if model_key in PILOT_KEYS:
            return {"model": model_key, "unavailable":
                    "Personalized adapters need the CDLI base model, which is not served."}
        if model_key not in self.models:
            # Details (missing files) are in the container log, not the response.
            return {"model": model_key, "unavailable":
                    "This fine-tuned model is not installed or is incomplete."}
        # float32 samples are 4 bytes; drop a trailing partial sample (1-3 bytes).
        audio_bytes = audio_bytes[: len(audio_bytes) - len(audio_bytes) % 4]
        if not audio_bytes or len(audio_bytes) > MAX_BYTES:
            raise ValueError("Invalid audio payload.")
        audio = np.frombuffer(audio_bytes, dtype="<f4")
        if not (MIN_SAMPLES <= audio.size <= MAX_SAMPLES) or not np.isfinite(audio).all():
            raise ValueError(f"Expected finite 16 kHz mono audio, 0.3 to {MAX_SECONDS} seconds.")

        model, processor = self.models[model_key], self.processors[model_key]
        started = time.monotonic()
        windows = split_into_windows(audio)
        # Whisper invents text for silence, so silent windows are skipped.
        windows = [w for w in windows if float(np.sqrt(np.mean(w.astype(np.float64) ** 2))) >= MIN_RMS]
        result = {
            "model": model_key,
            "model_id": f"{FINETUNED_VOLUME_NAME}/{SERVED_MODELS[model_key]['folder']}",
            "revision": self.revisions[model_key],
            "transcript": "",
            "device": self.device,
            "personalized": False,
            "research_only": True,
            "audio_seconds": round(audio.size / SAMPLE_RATE, 2),
            "windows": len(windows),
        }
        if not windows:
            result["inference_ms"] = round((time.monotonic() - started) * 1000)
            return result
        texts = []
        for first in range(0, len(windows), BATCH_WINDOWS):
            batch = windows[first:first + BATCH_WINDOWS]
            longest_seconds = max(w.size for w in batch) / SAMPLE_RATE
            max_new_tokens = min(MAX_NEW_TOKENS, max(MIN_NEW_TOKENS, round(longest_seconds * TOKENS_PER_SECOND)))
            inputs = processor(
                batch, sampling_rate=SAMPLE_RATE, return_tensors="pt",
                return_attention_mask=True,
            )
            kwargs = {}
            if "attention_mask" in inputs:
                kwargs["attention_mask"] = inputs.attention_mask.to("cuda")
            with self.torch.inference_mode():
                ids = model.generate(
                    inputs.input_features.to("cuda", dtype=self.torch.float16),
                    language=SERVED_MODELS[model_key]["language"], task="transcribe",
                    num_beams=1, do_sample=False,
                    max_new_tokens=max_new_tokens, **kwargs,
                )
            texts.extend(processor.batch_decode(ids, skip_special_tokens=True))
        result["transcript"] = " ".join(t.strip() for t in texts if t.strip())
        result["inference_ms"] = round((time.monotonic() - started) * 1000)
        return result


@app.function(
    image=api_image,
    secrets=[modal.Secret.from_name("sauti-gpu-auth")],
    timeout=2400,  # covers a cold start (GPU queue + model load) plus 30 min of audio
    memory=4096,   # holds a large upload plus its decoded float32 samples
)
@modal.fastapi_endpoint(method="POST")
async def transcribe(request: Request):
    from fastapi import HTTPException

    expected = os.environ.get("SAUTI_GPU_BEARER_TOKEN", "")
    supplied = request.headers.get("authorization", "")
    if not expected or not hmac.compare_digest(supplied, "Bearer " + expected):
        raise HTTPException(status_code=401, detail="Invalid service authorization.")
    model_key = request.headers.get("x-sauti-model", "")
    if model_key not in ALL_KEYS:
        raise HTTPException(status_code=422, detail="Unknown model.")
    # Imported here, not at module level: only api_image ships audio_input.
    import asyncio
    from audio_input import AudioInputError, prepare_audio

    body = await request.body()
    # Raw float32 passes straight through; any other audio format is decoded
    # with ffmpeg to 16 kHz mono float32, off the event loop.
    try:
        audio = await asyncio.to_thread(
            prepare_audio, request.headers.get("content-type"), body,
            sample_rate=SAMPLE_RATE, min_samples=MIN_SAMPLES, max_seconds=MAX_SECONDS,
        )
    except AudioInputError as error:
        raise HTTPException(status_code=error.status, detail=error.detail) from None
    # One container pool serves every model key, so switching between base and
    # personalized models never triggers another cold start. Comparison
    # results never execute actions.
    result = await CDLIWhisper().transcribe.remote.aio(model_key, audio)
    if result.get("unavailable"):
        raise HTTPException(status_code=503, detail=result["unavailable"])
    return result


@app.function(image=api_image, schedule=modal.Period(minutes=2))
def enforce_warm_window():
    """Keep one GPU container loaded only while a warm window is open.

    Runs every 2 minutes. A redeploy resets autoscaling to min_containers=0,
    so this restores the warm container within 2 minutes of a deploy. It also
    releases the GPU once the window ends.
    """
    until = float(warm_window.get("until", 0) or 0)
    warm = time.time() < until
    modal.Cls.from_name(APP_NAME, "CDLIWhisper")().update_autoscaler(min_containers=1 if warm else 0)
    print(f"warm={warm} minutes_left={max(0, round((until - time.time()) / 60))}")
