"""Opt-in, comparison-only model inference. Never dispatches Controller actions.

Separate from the safe production /v1/recognize endpoint. Requires authenticated
user, explicit per-request consent and SAUTI_COMPARE_ENABLED=true.
"""
from __future__ import annotations

import gc
import json
import os
import re
import threading
import time
import unicodedata
from pathlib import Path

from .contracts import Intent
from .prototype import PrototypeModel
from .storage import profile_dir, read_private_bytes

MODEL_IDS = {
    'prototype': 'facebook/wav2vec2-base',
    'english': 'cdli/whisper-large-v3_finetuned_kenyan_english_nonstandard_speech_v1.0',
    'swahili': 'cdli/whisper-large-v3_finetuned_kenyan_swahili_nonstandard_speech_v1.0',
}
PHRASES = {
    'scroll down': 'SCROLL_DOWN', 'move down': 'SCROLL_DOWN',
    'scroll up': 'SCROLL_UP', 'move up': 'SCROLL_UP',
    'go back': 'GO_BACK', 'read this': 'READ_PAGE',
    'read this page aloud': 'READ_PAGE', 'undo': 'UNDO',
    'undo last setting': 'UNDO',
    'shuka chini': 'SCROLL_DOWN', 'panda juu': 'SCROLL_UP',
    'rudi nyuma': 'GO_BACK', 'soma ukurasa kwa sauti': 'READ_PAGE',
    'tengua mpangilio': 'UNDO',
    # Explicit, fully matched mixed-language phrases: not substring heuristics.
    'move down kidogo': 'SCROLL_DOWN',
    'move up kidogo': 'SCROLL_UP',
    'shuka chini please': 'SCROLL_DOWN',
    'panda juu please': 'SCROLL_UP',
}

_LOCK = threading.Lock()


def normalize(text: str) -> str:
    s = unicodedata.normalize('NFKC', text).casefold()
    return ' '.join(re.sub(r'[^\w\s]', ' ', s).split())


def mapped_intent(transcript: str) -> str:
    return PHRASES.get(normalize(transcript), 'UNKNOWN')


def word_errors(reference: str, hypothesis: str) -> tuple[int, int]:
    a, b = normalize(reference).split(), normalize(hypothesis).split()
    previous = list(range(len(b) + 1))
    for i, word in enumerate(a, 1):
        row = [i]
        for j, other in enumerate(b, 1):
            row.append(min(row[-1] + 1, previous[j] + 1, previous[j - 1] + (word != other)))
        previous = row
    return previous[-1], len(a)


def personal_prediction(samples, profile_id: str) -> dict:
    folder = profile_dir(profile_id)
    if not (folder / 'model.json').is_file() or not (folder / 'evaluation.json').is_file():
        return {'status': 'unavailable', 'intent': None, 'error': 'Personal model has not passed validation.'}
    model = PrototypeModel.load(folder)
    release = json.loads((folder / 'evaluation.json').read_text(encoding='utf8'))
    expected = model.content_version()
    if (not isinstance(release, dict) or release.get('status') != 'pilot-validation-passed'
            or release.get('model_version') != expected or model.version != expected):
        return {'status': 'unavailable', 'intent': None, 'error': 'Personal model release record is invalid.'}
    from .api import model_encoder
    encoder = model_encoder()
    if encoder.model_id != model.encoder_id:
        return {'status': 'unavailable', 'intent': None, 'error': 'Personal encoder version mismatch.'}
    output = model.predict(encoder.embed(samples))
    return {'status': output.status, 'intent': output.intent.value,
            'similarity': output.confidence, 'model_version': output.model_version,
            'transcript': None}


def whisper_prediction(samples, key: str) -> dict:
    import torch
    from huggingface_hub import model_info
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

    if os.environ.get('SAUTI_COMPARE_GPU_ONLY', 'true') == 'true' and not torch.cuda.is_available():
        return {'status': 'unavailable', 'intent': None,
                'error': 'Whisper comparison requires a configured GPU worker.'}
    model_id = MODEL_IDS[key]
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    dtype = torch.float16 if device == 'cuda' else torch.float32
    revision = model_info(model_id).sha
    processor = AutoProcessor.from_pretrained(model_id, revision=revision, trust_remote_code=False)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        model_id, revision=revision, torch_dtype=dtype,
        low_cpu_mem_usage=True, use_safetensors=True, trust_remote_code=False,
    ).to(device)
    try:
        model.eval()
        inputs = processor(samples, sampling_rate=16000, return_tensors='pt',
                           return_attention_mask=True)
        features = inputs.input_features.to(device, dtype=dtype)
        kwargs = {}
        if 'attention_mask' in inputs:
            kwargs['attention_mask'] = inputs.attention_mask.to(device)
        with torch.inference_mode():
            ids = model.generate(
                features, language='en' if key == 'english' else 'sw',
                task='transcribe', num_beams=1, do_sample=False, max_new_tokens=128, **kwargs)
        transcript = processor.batch_decode(ids, skip_special_tokens=True)[0].strip()
        intent = mapped_intent(transcript)
        return {'status': 'rejected' if intent == 'UNKNOWN' else 'accepted',
                'intent': intent, 'transcript': transcript, 'revision': revision,
                'device': device}
    finally:
        del model
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def infer_one(samples, profile_id: str, key: str) -> dict:
    if key == 'prototype':
        return personal_prediction(samples, profile_id)
    return whisper_prediction(samples, key)


def compare_models(samples, profile_id: str, selection: str, language: str,
                   expected_intent: str | None = None, reference: str = '') -> dict:
    if selection not in (*MODEL_IDS, 'all'):
        raise ValueError('Unknown comparison model.')
    if language not in ('en-KE', 'sw-KE', 'mixed'):
        raise ValueError('Expected English, Kiswahili or mixed language.')
    if expected_intent is not None:
        Intent(expected_intent)
    if len(reference) > 280:
        raise ValueError('Reference transcript is too long.')
    keys = list(MODEL_IDS) if selection == 'all' else [selection]
    rows = []
    # Lock prevents simultaneous GPU model loads within this process.
    # Use a dedicated single-worker GPU service in the pilot.
    with _LOCK:
        for key in keys:
            row = {'model': key, 'model_id': MODEL_IDS[key],
                   'status': 'unavailable', 'intent': None, 'transcript': None,
                   'load_and_inference_seconds': None}
            start = time.perf_counter()
            try:
                row.update(infer_one(samples.copy(), profile_id, key))
            except Exception as exc:
                row['status'] = 'error'
                row['intent'] = None
                # Never put raw HF errors, paths or access tokens in the browser.
                row['error'] = 'Model backend unavailable. Check GPU, model access and service logs.'
                row['error_type'] = type(exc).__name__
            row['load_and_inference_seconds'] = round(time.perf_counter() - start, 3)
            row['reference_language'] = language
            if expected_intent is not None and row['status'] in ('accepted', 'rejected'):
                predicted = row['intent'] if row['status'] == 'accepted' else 'UNKNOWN'
                row['correct_intent'] = predicted == expected_intent
                row['false_activation'] = row['status'] == 'accepted' and predicted != expected_intent
            if reference.strip() and row.get('transcript') is not None:
                errors, words = word_errors(reference, row['transcript'])
                row['wer'] = round(errors / words, 4) if words else None
            rows.append(row)
    return {'results': rows, 'selection': selection, 'language': language,
            'executed_action': False,
            'warning': 'Exploratory comparison only; models are not mutually calibrated and no commands are executed.'}
