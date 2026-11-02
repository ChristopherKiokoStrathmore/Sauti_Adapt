import json
from io import BytesIO
from pathlib import Path
from uuid import uuid4
import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient
from sauti_ml.api import app

client = TestClient(app)
USER_ID = '11111111-1111-4111-8111-111111111111'
USER_TOKEN = 'test-user-token'


def auth(api_key='test-secret'):
    return {'x-api-key': api_key, 'x-sauti-user': USER_ID, 'x-sauti-user-token': USER_TOKEN}


def wav():
    x = np.sin(2 * np.pi * 260 * np.arange(16000) / 16000) * .1
    out = BytesIO()
    sf.write(out, x, 16000, format='WAV', subtype='PCM_16')
    return out.getvalue()


def payload():
    return {'profile_id': str(uuid4()), 'language': 'en-KE'}


def test_health_does_not_expose_secrets(monkeypatch):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'secret-in-health-test')
    resp = client.get('/health')
    assert resp.status_code == 200
    assert 'secret-in-health-test' not in resp.text


def test_missing_auth_rejected(monkeypatch):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    resp = client.post('/v1/recognize', data=payload(), files={'audio': ('test.wav', wav(), 'audio/wav')})
    assert resp.status_code == 401


def test_mock_mode_rejects_audio_not_fabricates_intent(monkeypatch):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SPEECH_MODE', 'mock')
    resp = client.post('/v1/recognize', data=payload(),
                       files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert resp.status_code == 200
    assert resp.json()['status'] == 'rejected'
    assert resp.json()['intent'] == 'UNKNOWN'


def test_enroll_requires_consent(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    data = payload() | {'session_id': str(uuid4()), 'intent': 'SCROLL_DOWN', 'consent': 'false'}
    resp = client.post('/v1/enroll', data=data,
                       files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert resp.status_code == 403
    assert not list(tmp_path.rglob('*.wav'))


def test_enroll_and_delete_require_the_api_token(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    data = payload() | {'session_id': str(uuid4()), 'intent': 'SCROLL_DOWN', 'consent': 'true', 'session_role': 'train'}
    missing = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')})
    assert missing.status_code == 401
    wrong = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers={**auth(), 'x-api-key': 'nope'})
    assert wrong.status_code == 401
    assert not list(tmp_path.rglob('*.wav'))
    stored = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert stored.status_code == 200, stored.text
    profile = stored.json()['profile_id']
    denied = client.delete(f'/v1/profile/{profile}')
    assert denied.status_code == 401
    assert list(tmp_path.rglob('*.wav'))
    removed = client.delete(f'/v1/profile/{profile}', headers=auth())
    assert removed.status_code == 200, removed.text
    assert removed.json()['deleted'] is True
    assert not list(tmp_path.rglob('*.wav'))


def test_enrollment_stays_off_without_the_flag(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.delenv('ALLOW_ENROLLMENT', raising=False)
    data = payload() | {'session_id': str(uuid4()), 'intent': 'SCROLL_UP', 'consent': 'true'}
    resp = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert resp.status_code == 403
    assert not list(tmp_path.rglob('*.wav'))


def test_private_dir_inside_the_repo_is_refused(monkeypatch):
    repo = Path(__file__).resolve().parents[3]
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(repo / 'services' / 'speech-api' / 'private'))
    data = payload() | {'session_id': str(uuid4()), 'intent': 'GO_BACK', 'consent': 'true'}
    resp = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert resp.status_code == 503
    assert not list((repo / 'services' / 'speech-api' / 'private').rglob('*.wav'))


def test_one_clip_can_be_deleted_without_removing_the_profile(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    profile = str(uuid4())
    session = str(uuid4())
    headers = auth()
    ids = []
    for intent in ('SCROLL_DOWN', 'SCROLL_UP'):
        data = {'profile_id': profile, 'language': 'sw-KE', 'session_id': session, 'intent': intent, 'consent': 'true', 'session_role': 'calibration'}
        resp = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=headers)
        assert resp.status_code == 200, resp.text
        ids.append(resp.json()['recording_id'])
    gone = client.delete(f'/v1/profile/{profile}/recordings/{ids[0]}', headers=headers)
    assert gone.status_code == 200
    assert gone.json()['recordings_removed'] == 1
    assert len(list(tmp_path.rglob('*.wav'))) == 1


def test_consent_records_private_clip(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    data = payload() | {'session_id': str(uuid4()), 'intent': 'SCROLL_DOWN', 'consent': 'true'}
    resp = client.post('/v1/enroll', data=data,
                       files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert resp.status_code == 200, resp.text
    assert len(list(tmp_path.rglob('*.wav'))) == 1


def test_validated_model_dispatches_only_known_command(monkeypatch, tmp_path):
    from sauti_ml.prototype import PrototypeModel
    from sauti_ml.storage import profile_dir
    import sauti_ml.api as module
    class FakeEncoder:
        model_id = 'test-encoder'
        def embed(self, audio):
            return np.array([1,0,0], dtype=np.float32)
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('SPEECH_MODE', 'prototype')
    pid = str(uuid4())
    vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    labels = ['SCROLL_DOWN', 'SCROLL_UP', 'GO_BACK']
    languages = ['en-KE', 'en-KE', 'sw-KE']
    model = PrototypeModel(vectors, labels, languages, .95, .1, 'placeholder', 'test-encoder')
    model = PrototypeModel(vectors, labels, languages, .95, .1, model.content_version(), 'test-encoder')
    folder = profile_dir(pid)
    model.save(folder, released=True)
    (folder / 'owner').write_text(USER_ID + '\n', encoding='utf8')
    (folder / 'evaluation.json').write_text(json.dumps({
        'status': 'pilot-validation-passed', 'model_version': model.version, 'accuracy_claim': False,
    }), encoding='utf8')
    monkeypatch.setattr(module, 'model_encoder', lambda: FakeEncoder())
    resp = client.post('/v1/recognize', data={'profile_id':pid,'language':'en-KE'},
                       files={'audio':('test.wav',wav(),'audio/wav')}, headers=auth())
    assert resp.status_code == 200, resp.text
    assert resp.json()['status']=='accepted'
    assert resp.json()['intent']=='SCROLL_DOWN'


def test_save_without_a_release_record_does_not_run(monkeypatch, tmp_path):
    from sauti_ml.prototype import PrototypeModel
    from sauti_ml.storage import profile_dir
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('SPEECH_MODE', 'prototype')
    pid = str(uuid4())
    folder = profile_dir(pid)
    PrototypeModel([[1, 0, 0]], ['SCROLL_DOWN'], ['en-KE'], .5, 0, 'unreleased', 'test-encoder').save(folder, released=True)
    (folder / 'owner').write_text(USER_ID + '\n', encoding='utf8')
    resp = client.post('/v1/recognize', data={'profile_id': pid, 'language': 'en-KE'},
                       files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert resp.status_code == 200, resp.text
    assert resp.json()['status'] == 'rejected'
    assert resp.json()['intent'] == 'UNKNOWN'
    assert resp.json()['reason'] == 'UNAVAILABLE_OR_INVALID_MODEL'


def _released_prototype(version=None):
    from sauti_ml.prototype import PrototypeModel
    vectors = [[1, 0, 0]]
    labels = ['SCROLL_DOWN']
    languages = ['en-KE']
    draft = PrototypeModel(vectors, labels, languages, .5, 0, 'placeholder', 'test-encoder')
    chosen = draft.content_version() if version is None else version
    return PrototypeModel(vectors, labels, languages, .5, 0, chosen, 'test-encoder')


def _recognize(pid):
    return client.post('/v1/recognize', data={'profile_id': pid, 'language': 'en-KE'},
                       files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())


def _prepare_profile(tmp_path, model, evaluation):
    from sauti_ml.storage import profile_dir
    pid = str(uuid4())
    folder = profile_dir(pid)
    model.save(folder, released=True)
    (folder / 'owner').write_text(USER_ID + '\n', encoding='utf8')
    (folder / 'evaluation.json').write_text(evaluation, encoding='utf8')
    return pid


def test_default_save_is_rejected(monkeypatch, tmp_path):
    from sauti_ml.storage import profile_dir
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('SPEECH_MODE', 'prototype')
    model = _released_prototype()
    pid = str(uuid4())
    folder = profile_dir(pid)
    model.save(folder)
    (folder / 'owner').write_text(USER_ID + '\n', encoding='utf8')
    (folder / 'evaluation.json').write_text(json.dumps({
        'status': 'pilot-validation-passed', 'model_version': model.content_version(),
    }), encoding='utf8')
    resp = _recognize(pid)
    assert resp.status_code == 200, resp.text
    assert resp.json()['status'] == 'rejected'
    assert resp.json()['reason'] == 'UNAVAILABLE_OR_INVALID_MODEL'


def test_bad_release_status_is_rejected(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('SPEECH_MODE', 'prototype')
    model = _released_prototype()
    pid = _prepare_profile(tmp_path, model, json.dumps({
        'status': 'not-released', 'model_version': model.content_version(),
    }))
    resp = _recognize(pid)
    assert resp.status_code == 200, resp.text
    assert resp.json()['status'] == 'rejected'
    assert resp.json()['reason'] == 'UNAVAILABLE_OR_INVALID_MODEL'


def test_mismatched_release_version_is_rejected(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('SPEECH_MODE', 'prototype')
    model = _released_prototype()
    pid = _prepare_profile(tmp_path, model, json.dumps({
        'status': 'pilot-validation-passed', 'model_version': 'sauti-prototype-v1',
    }))
    resp = _recognize(pid)
    assert resp.status_code == 200, resp.text
    assert resp.json()['status'] == 'rejected'
    assert resp.json()['reason'] == 'UNAVAILABLE_OR_INVALID_MODEL'


def test_hardcoded_version_does_not_accept_a_different_model(monkeypatch, tmp_path):
    from sauti_ml.prototype import PrototypeModel
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('SPEECH_MODE', 'prototype')
    model = PrototypeModel([[1, 0, 0]], ['SCROLL_DOWN'], ['en-KE'], .5, 0, 'sauti-prototype-v1', 'test-encoder')
    pid = _prepare_profile(tmp_path, model, json.dumps({
        'status': 'pilot-validation-passed', 'model_version': 'sauti-prototype-v1',
    }))
    resp = _recognize(pid)
    assert resp.status_code == 200, resp.text
    assert resp.json()['status'] == 'rejected'
    assert resp.json()['reason'] == 'UNAVAILABLE_OR_INVALID_MODEL'


def test_non_object_release_record_is_rejected(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('SPEECH_MODE', 'prototype')
    model = _released_prototype()
    pid = _prepare_profile(tmp_path, model, '[]')
    resp = _recognize(pid)
    assert resp.status_code == 200, resp.text
    assert resp.json()['status'] == 'rejected'
    assert resp.json()['reason'] == 'UNAVAILABLE_OR_INVALID_MODEL'


def test_stored_audio_is_encrypted_and_audit_omits_the_token(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    data = payload() | {'session_id': str(uuid4()), 'intent': 'SCROLL_DOWN', 'consent': 'true', 'session_role': 'train'}
    resp = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert resp.status_code == 200, resp.text
    clip = next(tmp_path.rglob('*.wav'))
    assert not clip.read_bytes().startswith(b'RIFF')
    log = (tmp_path / 'audit.log').read_text(encoding='utf8')
    assert 'test-user-token' not in log
    assert 'enroll' in log
    assert 'RIFF' not in log


def test_other_user_cannot_delete_a_profile(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    data = payload() | {'session_id': str(uuid4()), 'intent': 'UNDO', 'consent': 'true'}
    stored = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert stored.status_code == 200, stored.text
    other = '22222222-2222-4222-8222-222222222222'
    import hashlib, json as js
    monkeypatch.setenv('SAUTI_ACCOUNTS', js.dumps({
        USER_ID: __import__('hashlib').sha256(USER_TOKEN.encode()).hexdigest(),
        other: hashlib.sha256(b'other-token').hexdigest(),
    }))
    denied = client.delete(f"/v1/profile/{stored.json()['profile_id']}", headers={
        'x-api-key': 'test-secret', 'x-sauti-user': other, 'x-sauti-user-token': 'other-token'})
    assert denied.status_code == 403
    assert list(tmp_path.rglob('*.wav'))


def test_old_clips_are_purged_and_requests_are_rate_limited(monkeypatch, tmp_path):
    import os, time
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    monkeypatch.setenv('SAUTI_RETENTION_DAYS', '1')
    monkeypatch.setenv('SAUTI_RATE_LIMIT_PER_MINUTE', '2')
    from sauti_ml.auth import reset_rate_limits
    reset_rate_limits()
    data = payload() | {'session_id': str(uuid4()), 'intent': 'SCROLL_DOWN', 'consent': 'true'}
    first = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert first.status_code == 200, first.text
    old = next(tmp_path.rglob('*.wav'))
    os.utime(old, (time.time() - 3 * 86400, time.time() - 3 * 86400))
    second = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert second.status_code == 200, second.text
    assert not old.exists()
    limited = client.post('/v1/recognize', data=payload(), files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert limited.status_code == 429
