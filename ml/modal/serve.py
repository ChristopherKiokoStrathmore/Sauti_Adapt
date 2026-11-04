"""CDLI Kenyan atypical speech Whisper inference on Modal GPUs.

Only the trusted Sauti speech API should call this endpoint. Audio is
transient: accepted request bodies are used for GPU inference and discarded.
Model weights are downloaded directly from Hugging Face into a Modal Volume.

Deployment prerequisites:
  - Modal account / billing
  - Modal Secret 'sauti-gpu-auth' with SAUTI_GPU_BEARER_TOKEN
  - Check CDLI checkpoint usage permissions and personal data hosting terms.
Run through a trusted CI workflow, not in the user's Windows shell.
"""
import hmac
import os

import modal
from fastapi import Request

MODEL_IDS = {
    "english": "cdli/whisper-large-v3_finetuned_kenyan_english_nonstandard_speech_v1.0",
    "swahili": "cdli/whisper-large-v3_finetuned_kenyan_swahili_nonstandard_speech_v1.0",
}

app = modal.App("sauti-adapt-cdli-gpu")
weights = modal.Volume.from_name("sauti-adapt-cdli-cache", create_if_missing=True)

gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch>=2.3,<3", "transformers>=4.45,<5", "huggingface_hub>=0.28,<1",
        "accelerate>=1.0,<2", "safetensors>=0.5,<1", "numpy>=1.26,<3"
    )
    .env({"HF_HOME": "/models"})
)
api_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi>=0.115,<1")


@app.cls(
    image=gpu_image,
    gpu="L4",
    volumes={"/models": weights},
    timeout=300,
    scaledown_window=300,
    max_containers=1,
)
class CDLIWhisper:
    model_key: str = modal.parameter()

    @modal.enter()
    def load(self):
        import torch
        from huggingface_hub import model_info, snapshot_download
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

        if self.model_key not in MODEL_IDS:
            raise ValueError("Unknown CDLI checkpoint.")
        self.torch = torch
        model_id = MODEL_IDS[self.model_key]
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
                language="en" if self.model_key == "english" else "sw",
                task="transcribe", num_beams=1, do_sample=False,
                max_new_tokens=128, **kwargs,
            )
        transcript = self.processor.batch_decode(ids, skip_special_tokens=True)[0].strip()
        return {
            "model": self.model_key,
            "revision": self.revision,
            "transcript": transcript,
            "device": "L4",
        }


@app.function(
    image=api_image,
    secrets=[modal.Secret.from_name("sauti-gpu-auth")],
    timeout=300,
)
@modal.fastapi_endpoint(method="POST")
async def transcribe(request: Request):
    from fastapi import HTTPException

    expected = os.environ.get("SAUTI_GPU_BEARER_TOKEN", "")
    supplied = request.headers.get("authorization", "")
    if not expected or not hmac.compare_digest(supplied, "Bearer " + expected):
        raise HTTPException(status_code=401, detail="Invalid service authorization.")
    model_key = request.headers.get("x-sauti-model", "")
    if model_key not in MODEL_IDS:
        raise HTTPException(status_code=422, detail="Unknown model.")
    if request.headers.get("content-type", "").split(";")[0] != "application/octet-stream":
        raise HTTPException(status_code=415, detail="Expected 16 kHz float32 mono audio.")
    audio = await request.body()
    if len(audio) > 2_000_000 or not audio or len(audio) % 4:
        raise HTTPException(status_code=413, detail="Invalid audio size.")
    # Each model_key has a separate Modal container pool; the weights stay
    # loaded while that pool is warm. Comparison results never execute actions.
    return await CDLIWhisper(model_key=model_key).transcribe.remote.aio(audio)
