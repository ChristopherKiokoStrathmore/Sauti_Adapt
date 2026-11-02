from io import BytesIO
from pathlib import Path
from uuid import uuid4
import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient
from sauti_ml.api import app

client = TestClient(app)


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
                       files={'audio': ('test.wav', wav(), 'audio/wav')}, headers={'x-api-key': 'test-secret'})
    assert resp.status_code == 200
    assert resp.json()['status'] == 'rejected'
    assert resp.json()['intent'] == 'UNKNOWN'


def test_enroll_requires_consent(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    data = payload() | {'session_id': str(uuid4()), 'intent': 'SCROLL_DOWN', 'consent': 'false'}
    resp = client.post('/v1/enroll', data=data,
                       files={'audio': ('test.wav', wav(), 'audio/wav')}, headers={'x-api-key': 'test-secret'})
    assert resp.status_code == 403
    assert not list(tmp_path.rglob('*.wav'))


def test_enroll_and_delete_require_the_api_token(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    data = payload() | {'session_id': str(uuid4()), 'intent': 'SCROLL_DOWN', 'consent': 'true', 'session_role': 'train'}
    missing = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')})
    assert missing.status_code == 401
    wrong = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers={'x-api-key': 'nope'})
    assert wrong.status_code == 401
    assert not list(tmp_path.rglob('*.wav'))
    stored = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers={'x-api-key': 'test-secret'})
    assert stored.status_code == 200, stored.text
    profile = stored.json()['profile_id']
    denied = client.delete(f'/v1/profile/{profile}')
    assert denied.status_code == 401
    assert list(tmp_path.rglob('*.wav'))
    removed = client.delete(f'/v1/profile/{profile}', headers={'x-api-key': 'test-secret'})
    assert removed.status_code == 200, removed.text
    assert removed.json()['deleted'] is True
    assert not list(tmp_path.rglob('*.wav'))


def test_enrollment_stays_off_without_the_flag(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.delenv('ALLOW_ENROLLMENT', raising=False)
    data = payload() | {'session_id': str(uuid4()), 'intent': 'SCROLL_UP', 'consent': 'true'}
    resp = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers={'x-api-key': 'test-secret'})
    assert resp.status_code == 403
    assert not list(tmp_path.rglob('*.wav'))


def test_private_dir_inside_the_repo_is_refused(monkeypatch):
    repo = Path(__file__).resolve().parents[3]
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(repo / 'services' / 'speech-api' / 'private'))
    data = payload() | {'session_id': str(uuid4()), 'intent': 'GO_BACK', 'consent': 'true'}
    resp = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers={'x-api-key': 'test-secret'})
    assert resp.status_code == 503
    assert not list((repo / 'services' / 'speech-api' / 'private').rglob('*.wav'))


def test_one_clip_can_be_deleted_without_removing_the_profile(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    profile = str(uuid4())
    session = str(uuid4())
    headers = {'x-api-key': 'test-secret'}
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
                       files={'audio': ('test.wav', wav(), 'audio/wav')}, headers={'x-api-key': 'test-secret'})
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
    model = PrototypeModel([[1,0,0],[0,1,0],[0,0,1]],
                           ['SCROLL_DOWN','SCROLL_UP','GO_BACK'],
                           ['en-KE','en-KE','sw-KE'], .95, .1, 'test-v1', 'test-encoder')
    model.save(profile_dir(pid))
    monkeypatch.setattr(module, 'model_encoder', lambda: FakeEncoder())
    resp = client.post('/v1/recognize', data={'profile_id':pid,'language':'en-KE'},
                       files={'audio':('test.wav',wav(),'audio/wav')}, headers={'x-api-key':'test-secret'})
    assert resp.status_code == 200, resp.text
    assert resp.json()['status']=='accepted'
    assert resp.json()['intent']=='SCROLL_DOWN'
