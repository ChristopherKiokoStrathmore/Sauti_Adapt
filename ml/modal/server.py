"""CDLI Kenyan atypical speech Whisper inference on Modal GPUs.

Only the trusted Sauti speech API should call this endpoint. Audio is
transient: accepted request bodies are used for GPU inference and discarded.
Model weights are downloaded directly from Hugging Face into a Modal Volume.

One GPU container serves every model key: both CDLI base models stay loaded
together, and any installed personalized LoRA adapter is switched per request.
That means one cold start instead of one per model.

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
import contextlib
import hmac
import json
import os
import time
from pathlib import Path

import modal
from fastapi import Request

APP_NAME = "sauti-adapt-cdli-gpu"

MODEL_IDS = {
    "english": "cdli/whisper-large-v3_finetuned_kenyan_english_nonstandard_speech_v1.0",
    "swahili": "cdli/whisper-large-v3_finetuned_kenyan_swahili_nonstandard_speech_v1.0",
}
# Pinned Hugging Face commits. Startup reads these from the volume cache with
# no network call. Change them deliberately: private adapter manifests are
# checked against these exact revisions.
MODEL_REVISIONS = {
    "english": "bf30914177cf7f40b9b6d0c8aa3e38c37ea59cc4",
    "swahili": "644252d2258ad6ef6b5f8b1d65cccb8fbbd6cf86",
}
LANGUAGE_CODES = {"english": "en", "swahili": "sw"}

# Private LoRA artifacts must be transferred from authorized storage.
# A pilot adapter is never published through this source repository.
PILOT_KEYS = {
    "personalized_english": ("english", "en-KE"),
    "personalized_swahili": ("swahili", "sw-KE"),
}
ALL_KEYS = (*MODEL_IDS, *PILOT_KEYS)

SAMPLE_RATE = 16_000
MIN_SAMPLES = 4_800                    # 0.3 s
MAX_SECONDS = 120                      # longer descriptions are split into windows
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
pilot_adapters = modal.Volume.from_name("sauti-adapt-private-adapters", create_if_missing=True)
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
)
api_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi>=0.115,<1")


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
    volumes={"/models": weights, "/private_adapters": pilot_adapters},
    timeout=300,                 # per request
    startup_timeout=900,         # model loading, separate from request time
    scaledown_window=300,
    max_containers=1,
)
class CDLIWhisper:
    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

        started = time.monotonic()
        self.torch = torch
        self.device = torch.cuda.get_device_name(0)
        self.processors, self.models, self.snapshots = {}, {}, {}
        for base_key, model_id in MODEL_IDS.items():
            snapshot = self._snapshot(model_id, MODEL_REVISIONS[base_key])
            self.snapshots[base_key] = snapshot
            self.processors[base_key] = AutoProcessor.from_pretrained(snapshot, trust_remote_code=False)
            self.models[base_key] = AutoModelForSpeechSeq2Seq.from_pretrained(
                snapshot, torch_dtype=torch.float16, low_cpu_mem_usage=True,
                use_safetensors=True, trust_remote_code=False,
                attn_implementation="sdpa",
            ).to("cuda").eval()

        # Personalized adapters are optional. A missing or invalid adapter
        # disables only that personalized key (fail closed per request); the
        # base models keep working.
        self.adapters = {}
        for pilot_key, (base_key, language_key) in PILOT_KEYS.items():
            try:
                self._attach_adapter(base_key, language_key)
                self.adapters[pilot_key] = base_key
            except RuntimeError as exc:
                print(f"adapter {pilot_key} unavailable: {exc}")
        print(f"loaded on {self.device} in {time.monotonic() - started:.1f}s; "
              f"personalized={sorted(self.adapters)}", flush=True)

    @staticmethod
    def _snapshot(model_id: str, revision: str) -> str:
        from huggingface_hub import snapshot_download
        from huggingface_hub.errors import LocalEntryNotFoundError

        try:
            return snapshot_download(repo_id=model_id, revision=revision, local_files_only=True)
        except LocalEntryNotFoundError:
            path = snapshot_download(repo_id=model_id, revision=revision)
            weights.commit()
            return path

    def _attach_adapter(self, base_key: str, language_key: str) -> None:
        # This is a research transcription adapter, not a released command
        # recognizer. The HTTP caller never receives weights.
        root = Path("/private_adapters/pilot")
        adapter_dir = root / language_key / "best_adapter"
        manifest_file = root / "model_manifest.json"
        model_id = MODEL_IDS[base_key]
        if not manifest_file.is_file():
            raise RuntimeError("private participant model manifest has not been installed")
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        entry = manifest.get(language_key, {})
        if (entry.get("base_model") != model_id
                or entry.get("base_revision") != MODEL_REVISIONS[base_key]
                or not entry.get("personalized_metrics")
                or entry.get("release_status") not in ("RESEARCH_ONLY", "COMMAND_EVALUATED_REVIEW_REQUIRED")):
            raise RuntimeError("private model manifest does not match the pinned CDLI base")
        if not (adapter_dir / "adapter_model.safetensors").is_file() or not (adapter_dir / "adapter_config.json").is_file():
            raise RuntimeError("private personalized adapter is incomplete")
        config = json.loads((adapter_dir / "adapter_config.json").read_text(encoding="utf-8"))
        if config.get("base_model_name_or_path") not in (model_id, str(self.snapshots[base_key])):
            raise RuntimeError("LoRA adapter does not match the base model")
        from peft import PeftModel
        self.models[base_key] = PeftModel.from_pretrained(
            self.models[base_key], str(adapter_dir), is_trainable=False,
        ).eval()

    @modal.method()
    def transcribe(self, model_key: str, audio_bytes: bytes) -> dict:
        import numpy as np

        if model_key not in ALL_KEYS:
            raise ValueError("Unknown CDLI checkpoint.")
        if not audio_bytes or len(audio_bytes) > MAX_BYTES or len(audio_bytes) % 4:
            raise ValueError("Invalid audio payload.")
        audio = np.frombuffer(audio_bytes, dtype="<f4")
        if not (MIN_SAMPLES <= audio.size <= MAX_SAMPLES) or not np.isfinite(audio).all():
            raise ValueError(f"Expected finite 16 kHz mono audio, 0.3 to {MAX_SECONDS} seconds.")

        personalized = model_key in PILOT_KEYS
        base_key = PILOT_KEYS[model_key][0] if personalized else model_key
        if personalized and model_key not in self.adapters:
            return {"model": model_key, "unavailable": "Personalized adapter is not installed."}
        model = self.models[base_key]
        has_adapter = base_key in self.adapters.values()
        # A base request on a model carrying an adapter runs with it switched off.
        adapter_context = model.disable_adapter() if has_adapter and not personalized else contextlib.nullcontext()

        started = time.monotonic()
        windows = split_into_windows(audio)
        # Whisper invents text for silence, so silent windows are skipped.
        windows = [w for w in windows if float(np.sqrt(np.mean(w.astype(np.float64) ** 2))) >= MIN_RMS]
        result = {
            "model": model_key,
            "revision": MODEL_REVISIONS[base_key],
            "transcript": "",
            "device": self.device,
            "personalized": personalized,
            "research_only": True,
            "audio_seconds": round(audio.size / SAMPLE_RATE, 2),
            "windows": len(windows),
        }
        if not windows:
            result["inference_ms"] = round((time.monotonic() - started) * 1000)
            return result
        longest_seconds = max(w.size for w in windows) / SAMPLE_RATE
        max_new_tokens = min(MAX_NEW_TOKENS, max(MIN_NEW_TOKENS, round(longest_seconds * TOKENS_PER_SECOND)))
        inputs = self.processors[base_key](
            windows, sampling_rate=SAMPLE_RATE, return_tensors="pt",
            return_attention_mask=True,
        )
        kwargs = {}
        if "attention_mask" in inputs:
            kwargs["attention_mask"] = inputs.attention_mask.to("cuda")
        with self.torch.inference_mode(), adapter_context:
            ids = model.generate(
                inputs.input_features.to("cuda", dtype=self.torch.float16),
                language=LANGUAGE_CODES[base_key], task="transcribe",
                num_beams=1, do_sample=False,
                max_new_tokens=max_new_tokens, **kwargs,
            )
        texts = self.processors[base_key].batch_decode(ids, skip_special_tokens=True)
        result["transcript"] = " ".join(t.strip() for t in texts if t.strip())
        result["inference_ms"] = round((time.monotonic() - started) * 1000)
        return result


@app.function(
    image=api_image,
    secrets=[modal.Secret.from_name("sauti-gpu-auth")],
    timeout=900,   # covers a cold start (GPU queue + model load) plus inference
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
    if request.headers.get("content-type", "").split(";")[0] != "application/octet-stream":
        raise HTTPException(status_code=415, detail="Expected 16 kHz float32 mono audio.")
    audio = await request.body()
    if len(audio) > MAX_BYTES or not audio or len(audio) % 4:
        raise HTTPException(status_code=413, detail="Invalid audio size.")
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
