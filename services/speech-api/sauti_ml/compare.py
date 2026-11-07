"""Opt-in, comparison-only model inference. Never dispatches Controller actions.

Separate from the safe production /v1/recognize endpoint. Requires authenticated
user, explicit per-request consent and SAUTI_COMPARE_ENABLED=true.
"""
from __future__ import annotations

import gc
import hmac
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
    'personalized_english': 'cdli/whisper-large-v3_finetuned_kenyan_english_nonstandard_speech_v1.0',
    'personalized_swahili': 'cdli/whisper-large-v3_finetuned_kenyan_swahili_nonstandard_speech_v1.0',
}
BASE_MODEL_KEYS = ('prototype', 'english', 'swahili')
PILOT_MODEL_KEYS = ('personalized_english', 'personalized_swahili')
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


def character_errors(reference: str, hypothesis: str) -> tuple[int, int]:
    """Levenshtein character errors on the same normalized text as WER."""
    a, b = normalize(reference), normalize(hypothesis)
    previous = list(range(len(b) + 1))
    for i, char in enumerate(a, 1):
        row = [i]
        for j, other in enumerate(b, 1):
            row.append(min(row[-1] + 1, previous[j] + 1, previous[j - 1] + (char != other)))
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
    """Call the private Modal GPU inference service. The API never loads Whisper.

    The Modal endpoint returns a transcript only. Mapping to allowed Sauti
    commands stays within the authenticated Python speech API.
    """
    import urllib.error
    import urllib.request
    import numpy as np

    address = os.environ.get('SAUTI_MODAL_URL', '').strip()
    token = os.environ.get('SAUTI_MODAL_BEARER_TOKEN', '').strip()
    proxy_key = os.environ.get('SAUTI_MODAL_PROXY_KEY', '').strip()
    proxy_secret = os.environ.get('SAUTI_MODAL_PROXY_SECRET', '').strip()
    if not address or not token:
        return {'status': 'unavailable', 'intent': None,
                'error': 'Modal CDLI GPU endpoint is not configured.'}
    # The endpoint requires Modal proxy auth in addition to the service bearer.
    if not proxy_key or not proxy_secret:
        return {'status': 'unavailable', 'intent': None,
                'error': 'Modal proxy auth token is not configured.'}
    if not address.startswith('https://'):
        return {'status': 'unavailable', 'intent': None,
                'error': 'Modal GPU endpoint must use HTTPS.'}
    payload = np.asarray(samples, dtype='<f4').tobytes()
    request = urllib.request.Request(
        address, data=payload, method='POST',
        headers={
            'Authorization': 'Bearer ' + token,
            'Modal-Key': proxy_key,
            'Modal-Secret': proxy_secret,
            'X-Sauti-Model': key,
            'Content-Type': 'application/octet-stream',
        },
    )
    # For small pilot clips, a cold GPU startup may be slow. No retry:
    # an automatic repeat could inadvertently process audio twice.
    try:
        with urllib.request.urlopen(request, timeout=145) as result:
            if result.status != 200:
                raise RuntimeError('Model inference is unavailable.')
            data = json.loads(result.read(100_000))
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError('GPU endpoint request failed.') from exc
    if not isinstance(data, dict) or data.get('model') != key or not isinstance(data.get('transcript'), str):
        raise ValueError('Invalid Modal GPU response.')
    transcript = data['transcript'].strip()
    intent = mapped_intent(transcript)
    return {'status': 'rejected' if intent == 'UNKNOWN' else 'accepted',
            'intent': intent, 'transcript': transcript,
            'revision': data.get('revision'), 'device': data.get('device'),
            'personalized': data.get('personalized') is True}

def infer_one(samples, profile_id: str, key: str) -> dict:
    if key == 'prototype':
        return personal_prediction(samples, profile_id)
    if key in PILOT_MODEL_KEYS:
        pilot_profile = os.environ.get('SAUTI_PILOT_PROFILE_ID', '').strip()
        if (os.environ.get('SAUTI_PERSONALIZED_COMPARE_ENABLED') != 'true'
                or not pilot_profile
                or not hmac.compare_digest(profile_id, pilot_profile)):
            return {'status': 'unavailable', 'intent': None,
                    'error': 'This personalized model is not enabled for this profile.'}
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
    # The default comparison never includes a participant-specific model.
    keys = list(BASE_MODEL_KEYS) if selection == 'all' else [selection]
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
                character_count_errors, characters = character_errors(reference, row['transcript'])
                row['cer'] = round(character_count_errors / characters, 4) if characters else None
            rows.append(row)
    return {'results': rows, 'selection': selection, 'language': language,
            'executed_action': False,
            'warning': 'Exploratory comparison only; models are not mutually calibrated and no commands are executed.'}
