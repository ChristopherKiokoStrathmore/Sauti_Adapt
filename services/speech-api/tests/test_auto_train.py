"""Auto-split training, demo policy and silence trimming. Artificial tones, not human speech."""
import json
import time
from io import BytesIO
from uuid import uuid4
import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

import sauti_ml.api as module
from sauti_ml.audio import trim_silence
from sauti_ml.contracts import Intent, Language
from sauti_ml.layer_sweep import leave_one_out_accuracy
from sauti_ml.storage import profile_dir, store_enrollment
from sauti_ml.train import auto_partition, run_auto

USER_ID = '11111111-1111-4111-8111-111111111111'
client = TestClient(module.app)


class FakeEncoder:
    model_id = 'test-frequency-encoder'

    def embed(self, audio):
        freq = np.fft.rfftfreq(len(audio), 1 / 16000)
        peak = freq[np.argmax(np.abs(np.fft.rfft(audio)))]
        for ix, f in enumerate((220, 330, 440)):
            if abs(peak - f) < 12:
                v = np.zeros(3, dtype=np.float32)
                v[ix] = 1
                return v
        return np.array([-1, -1, -1], dtype=np.float32) / np.sqrt(3)


def tone(freq, phase):
    return (.1 * np.sin(2 * np.pi * freq * np.arange(16000) / 16000 + phase)).astype(np.float32)


def fill(pid, per_command=5, unknowns=10):
    """One single recording session: no train/calibration/test roles chosen by the person."""
    sid = str(uuid4())
    for intent, f in [(Intent.SCROLL_DOWN, 220), (Intent.SCROLL_UP, 330), (Intent.GO_BACK, 440)]:
        for ix in range(per_command):
            store_enrollment(pid, sid, intent, Language.KENYAN_ENGLISH, tone(f, .17 * ix), user_id=USER_ID)
    for ix in range(unknowns):
        store_enrollment(pid, sid, Intent.UNKNOWN, Language.KENYAN_ENGLISH, tone(720, .13 * ix), user_id=USER_ID)


def test_trim_silence_removes_padding_but_keeps_speech():
    speech = tone(300, 0)[:8000]
    padded = np.concatenate([np.zeros(12000, np.float32), speech, np.zeros(12000, np.float32)])
    trimmed = trim_silence(padded)
    assert len(speech) <= len(trimmed) < len(padded) * .6


def test_trim_silence_leaves_silence_and_short_clips_alone():
    assert trim_silence(np.zeros(16000, np.float32)).shape == (16000,)
    short = tone(300, 0)[:1000]
    assert trim_silence(short).shape == short.shape


def test_auto_partition_is_disjoint_and_deterministic(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('SAUTI_DEMO_MODE', 'true')
    pid = str(uuid4())
    fill(pid)
    from sauti_ml.storage import load_manifest
    entries = load_manifest(pid)
    a = auto_partition(entries)
    b = auto_partition(entries)
    ids = [{e['recording_id'] for e in part} for part in a]
    assert ids == [{e['recording_id'] for e in part} for part in b]
    assert not (ids[0] & ids[1]) and not (ids[0] & ids[2]) and not (ids[1] & ids[2])
    assert sum(len(i) for i in ids) == len(entries)


def test_demo_mode_releases_demo_grade_model_from_one_session(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('SAUTI_DEMO_MODE', 'true')
    pid = str(uuid4())
    fill(pid)
    report = run_auto(pid, encoder=FakeEncoder(), result_kind='artificial-fixture')
    assert report['status'] == 'demo-validation-passed'
    assert report['demo_grade'] is True and report['accuracy_claim'] is False
    assert report['release_evidence']['executable'] is True


def test_normal_mode_still_refuses_the_same_small_evidence(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.delenv('SAUTI_DEMO_MODE', raising=False)
    pid = str(uuid4())
    fill(pid)
    with pytest.raises(ValueError):
        run_auto(pid, encoder=FakeEncoder())


def _setup_api(monkeypatch, tmp_path, demo=True):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('SPEECH_MODE', 'prototype')
    if demo:
        monkeypatch.setenv('SAUTI_DEMO_MODE', 'true')
    else:
        monkeypatch.delenv('SAUTI_DEMO_MODE', raising=False)
    monkeypatch.setattr(module, 'model_encoder', lambda: FakeEncoder())
    module._train_jobs.clear()


def auth():
    return {'x-api-key': 'test-secret', 'x-sauti-user': USER_ID, 'x-sauti-user-token': 'test-user-token'}


def wav_of(freq):
    out = BytesIO()
    sf.write(out, tone(freq, 0), 16000, format='WAV', subtype='PCM_16')
    return out.getvalue()


def test_train_endpoint_in_mock_mode_is_refused(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.delenv('SPEECH_MODE', raising=False)
    resp = client.post('/v1/train', json={'profile_id': str(uuid4())}, headers=auth())
    assert resp.status_code == 409


def test_train_then_recognise_end_to_end_with_demo_policy(monkeypatch, tmp_path):
    _setup_api(monkeypatch, tmp_path)
    pid = str(uuid4())
    fill(pid)
    (profile_dir(pid) / 'owner').write_text(USER_ID + '\n', encoding='utf8')
    assert client.post('/v1/train', json={'profile_id': pid}, headers=auth()).status_code == 202
    for _ in range(100):
        status = client.get(f'/v1/train/{pid}', headers=auth()).json()
        if status['state'] != 'running':
            break
        time.sleep(.05)
    assert status['state'] == 'ready', status
    assert status['demo_grade'] is True and status['accuracy_claim'] is False
    ok = client.post('/v1/recognize', data={'profile_id': pid, 'language': 'en-KE'},
                     files={'audio': ('a.wav', wav_of(220), 'audio/wav')}, headers=auth())
    assert ok.json()['status'] == 'accepted' and ok.json()['intent'] == 'SCROLL_DOWN'
    unknown = client.post('/v1/recognize', data={'profile_id': pid, 'language': 'en-KE'},
                          files={'audio': ('a.wav', wav_of(720), 'audio/wav')}, headers=auth())
    assert unknown.json()['status'] == 'rejected'


def test_demo_release_is_not_executable_once_demo_mode_is_off(monkeypatch, tmp_path):
    _setup_api(monkeypatch, tmp_path)
    pid = str(uuid4())
    fill(pid)
    (profile_dir(pid) / 'owner').write_text(USER_ID + '\n', encoding='utf8')
    run_auto(pid, encoder=FakeEncoder(), result_kind='artificial-fixture')
    monkeypatch.delenv('SAUTI_DEMO_MODE')
    resp = client.post('/v1/recognize', data={'profile_id': pid, 'language': 'en-KE'},
                       files={'audio': ('a.wav', wav_of(220), 'audio/wav')}, headers=auth())
    assert resp.json()['status'] == 'rejected'


def test_training_requires_the_owner(monkeypatch, tmp_path):
    _setup_api(monkeypatch, tmp_path)
    pid = str(uuid4())
    fill(pid)
    (profile_dir(pid) / 'owner').write_text('22222222-2222-4222-8222-222222222222\n', encoding='utf8')
    assert client.post('/v1/train', json={'profile_id': pid}, headers=auth()).status_code == 403


def test_leave_one_out_ranks_a_separable_layer_above_noise():
    rng = np.random.default_rng(1)
    labels = ['a'] * 5 + ['b'] * 5
    good = np.vstack([np.tile([1, 0], (5, 1)), np.tile([0, 1], (5, 1))]) + rng.normal(0, .05, (10, 2))
    bad = rng.normal(0, 1, (10, 2))
    norm = lambda m: m / np.linalg.norm(m, axis=1, keepdims=True)
    assert leave_one_out_accuracy(norm(good), labels) > leave_one_out_accuracy(norm(bad), labels)


def test_first_account_gets_the_pilot_profile_and_later_ones_do_not(monkeypatch, tmp_path):
    from sauti_ml.auth import reset_rate_limits
    reset_rate_limits()
    module._pilot_issued.clear()
    pilot = '181959fd-c1b9-40b6-b880-c6d0993f88c7'
    for key, value in {'SAUTI_API_TOKEN': 'test-secret', 'SAUTI_PRIVATE_DIR': str(tmp_path),
                       'SAUTI_TOKEN_PEPPER': 'test-private-pepper', 'SAUTI_AUTO_PROVISION': 'true',
                       'SAUTI_REQUIRE_TERMS': 'true', 'SAUTI_PRIVACY_CONTACT': 'privacy@example.org',
                       'SAUTI_PILOT_PROFILE_ID': pilot}.items():
        monkeypatch.setenv(key, value)
    body = {'age': 23, 'consent': True, 'terms_version': '2026-11-v1'}
    first = client.post('/v1/participants', json=body, headers={'x-api-key': 'test-secret'}).json()
    second = client.post('/v1/participants', json=body, headers={'x-api-key': 'test-secret'}).json()
    assert first['profile_id'] == pilot
    assert second['profile_id'] != pilot
