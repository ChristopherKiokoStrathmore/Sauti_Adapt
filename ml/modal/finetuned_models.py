"""Checks for fine-tuned Whisper model folders stored in a Modal Volume.

Kept free of Modal, torch and transformers imports so it can be unit tested
in CI. server.py calls these before loading a folder onto the GPU, so a
half-uploaded or wrongly exported model fails with a clear reason instead of
a transformers stack trace.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

REQUIRED_FILES = ("config.json",)
# safetensors only: pickled pytorch_model.bin files can run code when loaded.
WEIGHT_FILES = ("model.safetensors", "model.safetensors.index.json")
TOKENIZER_FILES = ("tokenizer.json", "vocab.json")
# Optional: when absent, the matching CDLI base model's copy is used.
FEATURE_EXTRACTOR_FILE = "preprocessor_config.json"
GENERATION_CONFIG_FILE = "generation_config.json"


def folder_problems(folder: Path) -> list[str]:
    """Return what is missing from a model folder; empty means loadable."""
    if not folder.is_dir():
        return [f"folder {folder} does not exist in the volume"]
    names = {p.name for p in folder.iterdir() if p.is_file()}
    problems = [f"missing {name}" for name in REQUIRED_FILES if name not in names]
    if not names & set(WEIGHT_FILES):
        if "pytorch_model.bin" in names:
            problems.append("weights are pytorch_model.bin; re-save with "
                            "model.save_pretrained(path, safe_serialization=True)")
        else:
            problems.append("missing model weights (model.safetensors)")
    if "model.safetensors.index.json" in names and not any(
            n.startswith("model-") and n.endswith(".safetensors") for n in names):
        problems.append("model.safetensors.index.json present but its shard files are missing")
    if not names & set(TOKENIZER_FILES):
        problems.append("missing tokenizer (tokenizer.json)")
    return problems


def has_file(folder: Path, name: str) -> bool:
    return (folder / name).is_file()


def folder_fingerprint(folder: Path) -> str:
    """Short identifier for exactly which upload is being served.

    Hashes config.json and every file's name and size. It changes when a
    different model is uploaded, without reading gigabytes of weights at
    startup.
    """
    digest = hashlib.sha256()
    digest.update((folder / "config.json").read_bytes())
    for path in sorted(p for p in folder.iterdir() if p.is_file()):
        digest.update(f"{path.name}:{path.stat().st_size}\n".encode())
    return digest.hexdigest()[:16]
