"""CDLI Kenyan atypical speech Whisper inference on Modal GPUs.

Callers are the trusted Sauti speech API and named partner teams, each with
its own bearer token (see sauti_gpu_auth.py). The endpoint also requires
Modal proxy auth (Modal-Key / Modal-Secret headers). Partners may only use the
public CDLI base models, never a participant's personalized adapter. Audio is
transient: accepted request bodies are used for GPU inference and discarded.
Model weights are downloaded directly from Hugging Face into a Modal Volume.

Deploy: modal deploy ml/modal/server.py

Deployment prerequisites:
  - Modal account / billing
  - Modal Secret 'sauti-gpu-auth' with SAUTI_GPU_BEARER_TOKEN
  - Modal Secret 'sauti-gpu-partner-auth' with SAUTI_GPU_PARTNER_TOKENS
    ("team-a:<token>,team-b:<token>"; may be empty to disable partners)
  - Modal proxy auth tokens (dashboard > Settings > Proxy Auth Tokens), one per caller
  - Optional deploy-time SAUTI_GPU_MAX_CONTAINERS (1-4, default 1) per model
  - Check CDLI checkpoint usage permissions and personal data hosting terms.
Run through a trusted CI workflow, not in the user's Windows shell.
"""
import json
import os
from pathlib import Path

import modal
from fastapi import Request

from sauti_gpu_auth import SPEECH_API_LABEL, authorized_caller

MODEL_IDS = {
    "english": "cdli/whisper-large-v3_finetuned_kenyan_english_nonstandard_speech_v1.0",
    "swahili": "cdli/whisper-large-v3_finetuned_kenyan_swahili_nonstandard_speech_v1.0",
}

# Private LoRA artifacts must be transferred from authorized storage.
# A pilot adapter is never published through this source repository.
PILOT_KEYS = {
    "personalized_english": ("english", "en-KE"),
    "personalized_swahili": ("swahili", "sw-KE"),
}

# GPU containers per model key. Read at deploy time; raise only with a budget.
MAX_CONTAINERS = int(os.environ.get("SAUTI_GPU_MAX_CONTAINERS", "1"))
if not 1 <= MAX_CONTAINERS <= 4:
    raise ValueError("SAUTI_GPU_MAX_CONTAINERS must be between 1 and 4.")

app = modal.App("sauti-adapt-cdli-gpu")
weights = modal.Volume.from_name("sauti-adapt-cdli-cache", create_if_missing=True)
pilot_adapters = modal.Volume.from_name("sauti-adapt-private-adapters", create_if_missing=True)

gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch>=2.3,<3", "transformers>=4.45,<5", "huggingface_hub>=0.28,<1",
        "accelerate>=1.0,<2", "safetensors>=0.5,<1", "numpy>=1.26,<3",
        "peft==0.17.1"
    )
    .env({"HF_HOME": "/models"})
    .add_local_python_source("sauti_gpu_auth")
)
api_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("fastapi>=0.115,<1")
    .add_local_python_source("sauti_gpu_auth")
)


@app.cls(
    image=gpu_image,
    gpu="L4",
    volumes={"/models": weights, "/private_adapters": pilot_adapters},
    timeout=300,
    scaledown_window=300,
    max_containers=MAX_CONTAINERS,
)
class CDLIWhisper:
    model_key: str = modal.parameter()

    @modal.enter()
    def load(self):
        import torch
        from huggingface_hub import model_info, snapshot_download
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

        if self.model_key not in (*MODEL_IDS, *PILOT_KEYS):
            raise ValueError("Unknown CDLI checkpoint.")
        self.personalized = self.model_key in PILOT_KEYS
        base_key, language_key = PILOT_KEYS[self.model_key] if self.personalized else (self.model_key, None)
        self.torch = torch
        model_id = MODEL_IDS[base_key]
        self.revision = model_info(model_id).sha
        # Snapshot pinned to the resolved repository SHA. HF caches weights in
        # the Modal Volume; no manual model upload or download is necessary.
        snapshot = snapshot_download(repo_id=model_id, revision=self.revision)
        weights.commit()
        self.processor = AutoProcessor.from_pretrained(snapshot, trust_remote_code=False)
        self.model = AutoModelForSpeechSeq2Seq.from_pretrained(
            snapshot, torch_dtype=torch.float16, low_cpu_mem_usage=True,
            use_safetensors=True, trust_remote_code=False,
        ).to("cuda")
        if self.personalized:
            # This is a research transcription adapter, not a released
            # command recognizer. The HTTP caller never receives weights.
            root = Path("/private_adapters/pilot")
            adapter_dir = root / language_key / "best_adapter"
            manifest_file = root / "model_manifest.json"
            if not manifest_file.is_file():
                raise RuntimeError("Private participant model manifest has not been installed.")
            manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
            entry = manifest.get(language_key, {})
            if (entry.get("base_model") != model_id
                    or entry.get("base_revision") != self.revision
                    or not entry.get("personalized_metrics")
                    or entry.get("release_status") not in ("RESEARCH_ONLY", "COMMAND_EVALUATED_REVIEW_REQUIRED")):
                raise RuntimeError("Private model manifest does not match the pinned CDLI base.")
            if not (adapter_dir / "adapter_model.safetensors").is_file() or not (adapter_dir / "adapter_config.json").is_file():
                raise RuntimeError("Private personalized adapter is incomplete.")
            config = json.loads((adapter_dir / "adapter_config.json").read_text(encoding="utf-8"))
            if config.get("base_model_name_or_path") not in (model_id, str(snapshot)):
                raise RuntimeError("LoRA adapter does not match the base model.")
            from peft import PeftModel
            self.model = PeftModel.from_pretrained(self.model, str(adapter_dir), is_trainable=False)
        self.model.eval()

    @modal.method()
    def transcribe(self, audio_bytes: bytes) -> dict:
        import numpy as np

        if not audio_bytes or len(audio_bytes) > 2_000_000 or len(audio_bytes) % 4:
            raise ValueError("Invalid audio payload.")
        audio = np.frombuffer(audio_bytes, dtype="<f4")
        if not (4_800 <= audio.size <= 480_000) or not np.isfinite(audio).all():
            raise ValueError("Expected finite 16 kHz mono audio, 0.3 to 30 seconds.")
        inputs = self.processor(
            audio, sampling_rate=16000, return_tensors="pt",
            return_attention_mask=True,
        )
        inputs_cuda = inputs.input_features.to("cuda", dtype=self.torch.float16)
        kwargs = {}
        if "attention_mask" in inputs:
            kwargs["attention_mask"] = inputs.attention_mask.to("cuda")
        with self.torch.inference_mode():
            ids = self.model.generate(
                inputs_cuda,
                language="en" if self.model_key in ("english", "personalized_english") else "sw",
                task="transcribe", num_beams=1, do_sample=False,
                max_new_tokens=128, **kwargs,
            )
        transcript = self.processor.batch_decode(ids, skip_special_tokens=True)[0].strip()
        return {
            "model": self.model_key,
            "revision": self.revision,
            "transcript": transcript,
            "device": "L4",
            "personalized": self.personalized,
            "research_only": True,
        }


@app.function(
    image=api_image,
    secrets=[
        modal.Secret.from_name("sauti-gpu-auth"),
        modal.Secret.from_name("sauti-gpu-partner-auth"),
    ],
    timeout=300,
)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
async def transcribe(request: Request):
    from fastapi import HTTPException

    caller = authorized_caller(
        request.headers.get("authorization", ""),
        os.environ.get("SAUTI_GPU_BEARER_TOKEN", ""),
        os.environ.get("SAUTI_GPU_PARTNER_TOKENS", ""),
    )
    if caller is None:
        raise HTTPException(status_code=401, detail="Invalid service authorization.")
    model_key = request.headers.get("x-sauti-model", "")
    allowed = (*MODEL_IDS, *PILOT_KEYS) if caller == SPEECH_API_LABEL else tuple(MODEL_IDS)
    if model_key not in allowed:
        raise HTTPException(status_code=422, detail="Unknown model.")
    if request.headers.get("content-type", "").split(";")[0] != "application/octet-stream":
        raise HTTPException(status_code=415, detail="Expected 16 kHz float32 mono audio.")
    audio = await request.body()
    if len(audio) > 2_000_000 or not audio or len(audio) % 4:
        raise HTTPException(status_code=413, detail="Invalid audio size.")
    # Usage accounting only: caller label, model and size. Never audio or tokens.
    print(f"caller={caller} model={model_key} audio_bytes={len(audio)}")
    # Each model_key has a separate Modal container pool; the weights stay
    # loaded while that pool is warm. Comparison results never execute actions.
    return await CDLIWhisper(model_key=model_key).transcribe.remote.aio(audio)
