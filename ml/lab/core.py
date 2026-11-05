"""Comparison logic with no model downloads until a run is requested."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import gc
import hashlib
import json
from pathlib import Path
import re
import sys
import time
import unicodedata

SERVICE = Path(__file__).resolve().parents[2] / 'services' / 'speech-api'
if str(SERVICE) not in sys.path:
    sys.path.insert(0, str(SERVICE))

from sauti_ml.audio import decode_wav
from sauti_ml.contracts import Intent


@dataclass(frozen=True)
class ModelSpec:
    label: str
    model_id: str
    language: str | None


MODELS = {
    'prototype': ModelSpec('Sauti personal model', 'facebook/wav2vec2-base', None),
    'english': ModelSpec('Whisper Kenyan English',
        'cdli/whisper-large-v3_finetuned_kenyan_english_nonstandard_speech_v1.0', 'en-KE'),
    'swahili': ModelSpec('Whisper Kenyan Kiswahili',
        'cdli/whisper-large-v3_finetuned_kenyan_swahili_nonstandard_speech_v1.0', 'sw-KE'),
}
PHRASES = {
    'en-KE': {
        'scroll down': 'SCROLL_DOWN', 'scroll up': 'SCROLL_UP', 'go back': 'GO_BACK',
        'read this': 'READ_PAGE', 'read this page aloud': 'READ_PAGE',
        'undo': 'UNDO', 'undo last setting': 'UNDO',
    },
    'sw-KE': {
        'shuka chini': 'SCROLL_DOWN', 'panda juu': 'SCROLL_UP', 'rudi nyuma': 'GO_BACK',
        'soma ukurasa kwa sauti': 'READ_PAGE', 'tengua mpangilio': 'UNDO',
    },
}


def normalize(text: str) -> str:
    text = unicodedata.normalize('NFKC', text).casefold()
    return ' '.join(re.sub(r'[^\w\s]', ' ', text, flags=re.UNICODE).split())


def transcript_intent(text: str, language: str) -> str:
    # Exact whole utterances only. Substrings such as "do not scroll down" reject.
    return PHRASES.get(language, {}).get(normalize(text), 'UNKNOWN')


def word_errors(reference: str, hypothesis: str) -> tuple[int, int]:
    ref, hyp = normalize(reference).split(), normalize(hypothesis).split()
    previous = list(range(len(hyp) + 1))
    for i, word in enumerate(ref, 1):
        current = [i]
        for j, other in enumerate(hyp, 1):
            current.append(min(current[-1] + 1, previous[j] + 1,
                               previous[j - 1] + (word != other)))
        previous = current
    return previous[-1], len(ref)


def released_profile(profile_id: str):
    from sauti_ml.storage import profile_dir
    from sauti_ml.prototype import PrototypeModel
    folder = profile_dir(profile_id)
    if not (folder / 'model.json').is_file() or not (folder / 'evaluation.json').is_file():
        return None
    model = PrototypeModel.load(folder)
    release = json.loads((folder / 'evaluation.json').read_text(encoding='utf8'))
    expected = model.content_version()
    if (not isinstance(release, dict) or release.get('status') != 'pilot-validation-passed'
            or release.get('model_version') != expected or model.version != expected):
        raise ValueError('Personal model has no matching successful release record.')
    return model


class WhisperBackend:
    def __init__(self, spec: ModelSpec):
        import torch
        from huggingface_hub import model_info
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
        self.torch = torch
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        self.dtype = torch.float16 if self.device == 'cuda' else torch.float32
        # Resolve once so model and processor always use the same exact revision.
        self.revision = model_info(spec.model_id).sha
        self.processor = AutoProcessor.from_pretrained(
            spec.model_id, revision=self.revision, trust_remote_code=False)
        self.model = AutoModelForSpeechSeq2Seq.from_pretrained(
            spec.model_id, revision=self.revision, torch_dtype=self.dtype,
            low_cpu_mem_usage=True, use_safetensors=True, trust_remote_code=False,
        ).to(self.device)
        self.model.eval()
        self.language = 'en' if spec.language == 'en-KE' else 'sw'

    def predict(self, samples):
        inputs = self.processor(samples, sampling_rate=16000, return_tensors='pt',
                                return_attention_mask=True)
        features = inputs.input_features.to(self.device, dtype=self.dtype)
        kwargs = {}
        if 'attention_mask' in inputs:
            kwargs['attention_mask'] = inputs.attention_mask.to(self.device)
        with self.torch.inference_mode():
            ids = self.model.generate(
                features, language=self.language, task='transcribe',
                num_beams=1, do_sample=False, max_new_tokens=128, **kwargs)
        return self.processor.batch_decode(ids, skip_special_tokens=True)[0].strip()


def build_backend(key: str):
    if key == 'prototype':
        from sauti_ml.encoder import SpeechEncoder
        return SpeechEncoder(MODELS[key].model_id)
    return WhisperBackend(MODELS[key])


def explain_failure(exc: Exception) -> str:
    # Do not send raw download exceptions, tokens, or private file paths to the UI.
    if 'out of memory' in str(exc).lower() or isinstance(exc, MemoryError):
        return 'Insufficient memory. Close other model processes or use a machine with more memory.'
    if isinstance(exc, (ImportError, ModuleNotFoundError)):
        return 'Install the lab requirements in the Python environment running this app.'
    if any(s in type(exc).__name__ for s in ('Hub', 'HTTP', 'Gated', 'Repository', 'Connect')):
        return 'Model download failed. Check connectivity and Hugging Face access for this model.'
    return 'Model run failed. Check model access, dependencies, and the personal model configuration.'


class Engine:
    """Keep only one large backend resident. UI switching alone does not download."""
    def __init__(self, factory=build_backend):
        self.factory = factory
        self.active_key = None
        self.backend = None

    def unload(self):
        self.backend = None
        self.active_key = None
        gc.collect()
        torch = sys.modules.get('torch')
        if torch is not None and torch.cuda.is_available():
            torch.cuda.empty_cache()

    def activate(self, key):
        if self.active_key == key and self.backend is not None:
            return 0.0
        self.unload()
        started = time.perf_counter()
        self.backend = self.factory(key)
        self.active_key = key
        return time.perf_counter() - started

    def run(self, key, samples, profile_id):
        spec = MODELS[key]
        row = dict(model=key, model_label=spec.label, model_id=spec.model_id,
                   model_revision=None, model_version=None, device=None, status='unavailable',
                   transcript=None, intent=None, similarity=None,
                   load_seconds=None, inference_seconds=None, error=None)
        try:
            personal = released_profile(profile_id) if key == 'prototype' else None
            if key == 'prototype' and personal is None:
                row['error'] = 'Train and validate a personal model in the enrollment tab first.'
                return row
            row['load_seconds'] = round(self.activate(key), 4)
            row['device'] = str(self.backend.device)
            started = time.perf_counter()
            if key == 'prototype':
                if self.backend.model_id != personal.encoder_id:
                    raise ValueError('Encoder version mismatch.')
                prediction = personal.predict(self.backend.embed(samples))
                row.update(status=prediction.status, intent=prediction.intent.value,
                           similarity=prediction.confidence, model_version=prediction.model_version,
                           model_revision=getattr(self.backend.model.config, '_commit_hash', None))
            else:
                text = self.backend.predict(samples)
                intent = transcript_intent(text, spec.language)
                row.update(transcript=text, intent=intent, model_revision=self.backend.revision,
                           status='rejected' if intent == 'UNKNOWN' else 'accepted')
            row['inference_seconds'] = round(time.perf_counter() - started, 4)
        except Exception as exc:
            row.update(status='error', intent=None, error=explain_failure(exc),
                       error_type=type(exc).__name__)
            self.unload()
        return row


def compare(payload, keys, engine, profile_id, language, reference='', expected=None):
    if language not in PHRASES:
        raise ValueError('Choose Kenyan English or Kiswahili.')
    if expected is not None:
        Intent(expected)
    if not keys or any(key not in MODELS for key in keys):
        raise ValueError('Choose an available model.')
    samples = decode_wav(payload)
    clip_id = hashlib.sha256(payload).hexdigest()
    rows = []
    for key in keys:
        # A backend cannot mutate the next model's input.
        row = engine.run(key, samples.copy(), profile_id)
        row.update(clip_id=clip_id, language=language, expected_intent=expected,
                   reference=reference, language_match=MODELS[key].language in (None, language),
                   command_correct=None, false_activation=None,
                   word_errors=None, reference_words=None, wer=None)
        if row['status'] in ('accepted', 'rejected'):
            if expected is not None:
                predicted = row['intent'] if row['status'] == 'accepted' else 'UNKNOWN'
                row['command_correct'] = predicted == expected
                row['false_activation'] = row['status'] == 'accepted' and predicted != expected
            if row['transcript'] is not None and normalize(reference):
                errors, words = word_errors(reference, row['transcript'])
                row.update(word_errors=errors, reference_words=words, wer=errors / words)
        rows.append(row)
    return rows


def merge_results(history, rows):
    # Repeating a clip replaces that model's observation instead of inflating sample size.
    contexts = {r['clip_id']: (r['language'], r['expected_intent'], r['reference']) for r in rows}
    updated = {
        (r['clip_id'], r['model']): r for r in history
        if r['clip_id'] not in contexts
        or contexts[r['clip_id']] == (r['language'], r['expected_intent'], r['reference'])
    }
    for row in rows:
        updated[row['clip_id'], row['model']] = row
    return list(updated.values())


def summarize(rows):
    groups = defaultdict(list)
    for row in rows:
        if row['language_match']:
            groups[row['model_label'], row['language']].append(row)
    output = []
    for (model, language), group in sorted(groups.items()):
        valid = [r for r in group if r['status'] in ('accepted', 'rejected')]
        labelled = [r for r in valid if r['command_correct'] is not None]
        words = sum(r['reference_words'] or 0 for r in valid)
        output.append({
            'Model': model, 'Language': language, 'Completed clips': len(valid),
            'Unavailable or errors': len(group) - len(valid),
            'Labelled clips': len(labelled),
            'Correct commands or rejections': sum(r['command_correct'] for r in labelled),
            'False activations': sum(r['false_activation'] for r in labelled),
            'Known commands rejected': sum(r['expected_intent'] != 'UNKNOWN' and r['status'] == 'rejected' for r in labelled),
            'Unknown clips': sum(r['expected_intent'] == 'UNKNOWN' for r in labelled),
            'Corpus WER': sum(r['word_errors'] or 0 for r in valid) / words if words else None,
        })
    return output
