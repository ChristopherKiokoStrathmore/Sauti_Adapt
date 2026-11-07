import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from finetuned_models import folder_fingerprint, folder_problems  # noqa: E402


def make_folder(tmp_path: Path, *names: str, name: str = "english") -> Path:
    folder = tmp_path / name
    folder.mkdir()
    for file_name in names:
        (folder / file_name).write_text("{}" if file_name.endswith(".json") else "weights")
    return folder


def test_complete_hugging_face_folder_has_no_problems(tmp_path):
    folder = make_folder(tmp_path, "config.json", "model.safetensors", "tokenizer.json",
                         "tokenizer_config.json")
    assert folder_problems(folder) == []


def test_preprocessor_and_generation_config_are_optional(tmp_path):
    # These fall back to the stored CDLI copies in server.py.
    folder = make_folder(tmp_path, "config.json", "model.safetensors", "tokenizer.json")
    assert folder_problems(folder) == []


def test_missing_weights_are_reported(tmp_path):
    # The file listing seen so far: config and tokenizer, no weights.
    folder = make_folder(tmp_path, "config.json", "tokenizer_config.json", "tokenizer.json")
    assert folder_problems(folder) == ["missing model weights (model.safetensors)"]


def test_pickled_weights_are_refused_with_conversion_hint(tmp_path):
    folder = make_folder(tmp_path, "config.json", "pytorch_model.bin", "tokenizer.json")
    [problem] = folder_problems(folder)
    assert "safe_serialization=True" in problem


def test_sharded_weights_need_their_shards(tmp_path):
    folder = make_folder(tmp_path, "config.json", "model.safetensors.index.json", "tokenizer.json")
    assert any("shard" in p for p in folder_problems(folder))
    (folder / "model-00001-of-00002.safetensors").write_text("w")
    assert folder_problems(folder) == []


def test_missing_config_and_tokenizer_are_reported(tmp_path):
    folder = make_folder(tmp_path, "model.safetensors")
    problems = folder_problems(folder)
    assert "missing config.json" in problems
    assert any("tokenizer" in p for p in problems)


def test_missing_folder_is_reported(tmp_path):
    [problem] = folder_problems(tmp_path / "swahili")
    assert "does not exist" in problem


def test_fingerprint_is_stable_and_changes_with_a_new_upload(tmp_path):
    folder = make_folder(tmp_path, "config.json", "model.safetensors", "tokenizer.json")
    first = folder_fingerprint(folder)
    assert first == folder_fingerprint(folder) and len(first) == 16
    (folder / "model.safetensors").write_text("different weights, different size")
    assert folder_fingerprint(folder) != first
