"""Artificial fixtures check software behavior, never speech accuracy."""
from io import BytesIO
import json
import os
from pathlib import Path
from types import SimpleNamespace
from contextlib import nullcontext
import sys

import numpy as np
import pytest
import soundfile as sf

from ml.lab import core, profile


def tone(frequency=220):
    out = BytesIO()
    samples = .1 * np.sin(2 * np.pi * frequency * np.arange(16000) / 16000)
    sf.write(out, samples, 16000, format='WAV', subtype='PCM_16')
    return out.getvalue()


@pytest.mark.parametrize(('phrase', 'language', 'expected'), [
    ('Scroll down!', 'en-KE', 'SCROLL_DOWN'),
    ('SHUKA CHINI.', 'sw-KE', 'SCROLL_DOWN'),
    ('Do not scroll down', 'en-KE', 'UNKNOWN'),
    ('Please explain scroll down', 'en-KE', 'UNKNOWN'),
    ('scroll down and go back', 'en-KE', 'UNKNOWN'),
    ('usishuke chini', 'sw-KE', 'UNKNOWN'),
    ('shuka chini', 'en-KE', 'UNKNOWN'),
    ('', 'en-KE', 'UNKNOWN'),
])
def test_whole_phrase_mapping(phrase, language, expected):
    assert core.transcript_intent(phrase, language) == expected


def test_word_errors_support_empty_hypothesis_and_more_than_100_percent():
    assert core.word_errors('scroll down', '') == (2, 2)
    assert core.word_errors('go', 'one two three four') == (4, 1)
    assert core.word_errors('GO BACK!', 'go back') == (0, 2)


class RecordingEngine:
    def __init__(self):
        self.inputs = []

    def run(self, key, samples, profile_id):
        self.inputs.append(samples.copy())
        samples[:] = 0
        return {'model': key, 'model_label': core.MODELS[key].label,
                'status': 'rejected' if key == 'swahili' else 'accepted',
                'intent': 'UNKNOWN' if key == 'swahili' else 'SCROLL_DOWN',
                'transcript': None if key == 'prototype' else 'scroll down'}


def test_compare_uses_same_clip_without_input_mutation_or_fake_baseline_wer():
    runner = RecordingEngine()
    rows = core.compare(tone(), list(core.MODELS), runner, 'unused', 'en-KE',
                        'scroll down', 'SCROLL_DOWN')
    assert all(np.array_equal(runner.inputs[0], x) for x in runner.inputs)
    assert len({r['clip_id'] for r in rows}) == 1
    assert rows[0]['wer'] is None
    assert rows[1]['wer'] == 0
    assert rows[1]['command_correct'] is True
    assert rows[2]['language_match'] is False
    assert len(core.summarize(rows)) == 2


def test_unknown_false_activation_and_unlabelled_clips():
    rows = core.compare(tone(), ['english'], RecordingEngine(), 'unused', 'en-KE', expected='UNKNOWN')
    assert rows[0]['command_correct'] is False
    assert rows[0]['false_activation'] is True
    rows = core.compare(tone(), ['english'], RecordingEngine(), 'unused', 'en-KE')
    assert rows[0]['command_correct'] is None
    assert rows[0]['wer'] is None


def test_reruns_deduplicate_and_changed_ground_truth_invalidates_old_rows():
    rows = core.compare(tone(), ['prototype', 'english'], RecordingEngine(), 'unused', 'en-KE')
    assert len(core.merge_results(rows, rows)) == 2
    changed = core.compare(tone(), ['english'], RecordingEngine(), 'unused', 'sw-KE', expected='UNKNOWN')
    merged = core.merge_results(rows, changed)
    assert len(merged) == 1
    assert merged[0]['language'] == 'sw-KE'


def test_errors_are_never_counted_as_correct_unknown_rejections():
    class Failed:
        def run(self, *args):
            return {'model': 'english', 'model_label': 'English', 'status': 'error',
                    'transcript': None, 'intent': None}
    rows = core.compare(tone(), ['english'], Failed(), 'unused', 'en-KE', expected='UNKNOWN')
    result = core.summarize(rows)[0]
    assert result['Unavailable or errors'] == 1
    assert result['Labelled clips'] == 0
    assert result['Correct commands or rejections'] == 0


def test_engine_loads_lazily_and_releases_previous_backend():
    loaded = []
    engine = None
    def factory(key):
        assert engine.backend is None
        loaded.append(key)
        return SimpleNamespace(device='cpu', revision='fixture', predict=lambda samples: 'scroll down')
    engine = core.Engine(factory)
    assert loaded == []
    samples = np.ones(16000)
    engine.run('english', samples, 'unused')
    engine.run('english', samples, 'unused')
    engine.run('swahili', samples, 'unused')
    assert loaded == ['english', 'swahili']
    assert engine.active_key == 'swahili'
    engine.unload()
    assert engine.backend is None


def test_one_failed_download_does_not_prevent_other_models():
    def factory(key):
        if key == 'english':
            raise MemoryError('out of memory')
        return SimpleNamespace(device='cpu', revision='fixture', predict=lambda samples: 'rudi nyuma')
    rows = core.compare(tone(), ['english', 'swahili'], core.Engine(factory), 'unused', 'sw-KE')
    assert rows[0]['status'] == 'error'
    assert rows[1]['intent'] == 'GO_BACK'


@pytest.fixture
def experiment(tmp_path, monkeypatch):
    monkeypatch.setenv('SAUTI_LAB_DIR', str(tmp_path / 'lab'))
    # Ensure changes made by the profile helper are restored after the test.
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', '')
    monkeypatch.setenv('SAUTI_STORAGE_KEY', '')
    return profile.open_experiment()


def test_missing_personal_model_is_unavailable_without_loading_weights(experiment):
    _, settings = experiment
    engine = core.Engine(lambda _: pytest.fail('No weights should load'))
    row = engine.run('prototype', np.ones(16000), settings['profile_id'])
    assert row['status'] == 'unavailable'
    assert row['intent'] is None


def test_consent_encryption_duplicate_rejection_and_reset(experiment):
    path, settings = experiment
    with pytest.raises(ValueError, match='Consent'):
        profile.enroll(path, settings, tone(), 'train', 'SCROLL_DOWN', 'en-KE', False)
    profile.enroll(path, settings, tone(), 'train', 'SCROLL_DOWN', 'en-KE', True)
    from sauti_ml.storage import profile_dir
    folder = profile_dir(settings['profile_id'])
    assert not next((folder / 'audio').glob('*.wav')).read_bytes().startswith(b'RIFF')
    with pytest.raises(ValueError, match='already stored'):
        profile.enroll(path, settings, tone(), 'test', 'SCROLL_DOWN', 'en-KE', True)
    assert profile.readiness(settings)[0] is False
    original = settings['profile_id']
    profile.reset_experiment(path, settings)
    assert not folder.exists()
    assert original != settings['profile_id']
    assert len(profile.entries(settings)) == 0


def test_storage_root_inside_repo_is_rejected(monkeypatch):
    monkeypatch.setenv('SAUTI_LAB_DIR', str(core.SERVICE.parents[1] / 'private'))
    with pytest.raises(ValueError, match='outside'):
        profile.open_experiment()


def test_used_test_session_cannot_be_retrained_or_enrolled(experiment):
    path, settings = experiment
    settings['test_used'] = True
    with pytest.raises(ValueError, match='already been used'):
        profile.train_once(path, settings)
    with pytest.raises(ValueError, match='closed'):
        profile.enroll(path, settings, tone(), 'train', 'SCROLL_DOWN', 'en-KE', True)


def test_release_record_must_match_actual_model(experiment):
    from sauti_ml.storage import profile_dir
    from sauti_ml.prototype import PrototypeModel, model_content_version
    _, settings = experiment
    vectors = np.eye(3, dtype=np.float32)
    labels = list(profile.COMMANDS)
    langs = ['en-KE'] * 3
    version = model_content_version(vectors, labels, langs, .7, .05, 'fixture')
    model = PrototypeModel(vectors, labels, langs, .7, .05, version, 'fixture')
    folder = profile_dir(settings['profile_id'])
    model.save(folder, released=True)
    release = folder / 'evaluation.json'
    release.write_text(json.dumps({'status': 'pilot-validation-passed', 'model_version': 'tampered'}))
    with pytest.raises(ValueError, match='matching'):
        core.released_profile(settings['profile_id'])
    release.write_text(json.dumps({'status': 'pilot-validation-passed', 'model_version': version}))
    assert core.released_profile(settings['profile_id']).version == version


@pytest.mark.parametrize(('key', 'decode_language'), [('english', 'en'), ('swahili', 'sw')])
def test_whisper_adapter_uses_one_revision_and_explicit_transcription(monkeypatch, key, decode_language):
    calls = []
    class Tensor:
        def to(self, *args, **kwargs):
            return self
    class Inputs(dict):
        input_features = Tensor()
        attention_mask = Tensor()
    class Processor:
        @classmethod
        def from_pretrained(cls, model_id, **kwargs):
            calls.append(('processor', model_id, kwargs))
            return cls()
        def __call__(self, samples, **kwargs):
            assert kwargs['sampling_rate'] == 16000
            assert kwargs['return_attention_mask'] is True
            return Inputs(attention_mask=self)
        def batch_decode(self, ids, **kwargs):
            assert kwargs['skip_special_tokens'] is True
            return [' fixture text ']
    class Model:
        @classmethod
        def from_pretrained(cls, model_id, **kwargs):
            calls.append(('model', model_id, kwargs))
            return cls()
        def to(self, *args, **kwargs):
            return self
        def eval(self):
            return self
        def generate(self, features, **kwargs):
            assert kwargs['language'] == decode_language
            assert kwargs['task'] == 'transcribe'
            assert kwargs['num_beams'] == 1
            assert kwargs['do_sample'] is False
            assert 'attention_mask' in kwargs
            return [1]
    monkeypatch.setitem(sys.modules, 'torch', SimpleNamespace(
        cuda=SimpleNamespace(is_available=lambda: False),
        float32='fp32', float16='fp16', inference_mode=nullcontext))
    monkeypatch.setitem(sys.modules, 'huggingface_hub', SimpleNamespace(
        model_info=lambda model_id: SimpleNamespace(sha='resolved-revision')))
    monkeypatch.setitem(sys.modules, 'transformers', SimpleNamespace(
        AutoModelForSpeechSeq2Seq=Model, AutoProcessor=Processor))
    backend = core.WhisperBackend(core.MODELS[key])
    assert backend.predict(np.ones(16000)) == 'fixture text'
    assert all(call[1] == core.MODELS[key].model_id for call in calls)
    assert all(call[2]['revision'] == 'resolved-revision' for call in calls)
    assert all(call[2]['trust_remote_code'] is False for call in calls)
    assert calls[1][2]['use_safetensors'] is True
