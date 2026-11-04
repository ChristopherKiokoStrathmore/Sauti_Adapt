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
    monkeypatch.setenv('SAUTI_TOKEN_PEPPER', 'pepper-in-health-test')
    monkeypatch.delenv('SPEECH_MODE', raising=False)
    monkeypatch.delenv('ALLOW_ENROLLMENT', raising=False)
    resp = client.get('/health')
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {'status', 'mode', 'enrollment_enabled'}
    assert body == {'status': 'ok', 'mode': 'mock', 'enrollment_enabled': False}
    assert 'secret-in-health-test' not in resp.text
    assert 'pepper-in-health-test' not in resp.text


def test_unset_speech_mode_and_enrollment_fail_closed(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.delenv('SPEECH_MODE', raising=False)
    monkeypatch.delenv('ALLOW_ENROLLMENT', raising=False)
    health = client.get('/health')
    assert health.json()['mode'] == 'mock'
    assert health.json()['enrollment_enabled'] is False
    enrolled = client.post('/v1/enroll', data=payload() | {'session_id': str(uuid4()), 'intent': 'SCROLL_DOWN', 'consent': 'true'},
                           files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert enrolled.status_code == 403
    assert enrolled.status_code != 200
    recognized = client.post('/v1/recognize', data=payload(), files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert recognized.status_code == 200
    assert recognized.json()['status'] == 'rejected'
    assert recognized.json()['intent'] == 'UNKNOWN'
    assert not list(tmp_path.rglob('*.wav'))


def test_unauthorized_requests_never_succeed(monkeypatch):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    audio = {'audio': ('test.wav', wav(), 'audio/wav')}
    cases = [
        ({}, 401),
        ({'x-api-key': 'wrong-key', 'x-sauti-user': USER_ID, 'x-sauti-user-token': USER_TOKEN}, 401),
        ({'x-api-key': 'test-secret', 'x-sauti-user': USER_ID}, 401),
        ({'x-api-key': 'test-secret', 'x-sauti-user': USER_ID, 'x-sauti-user-token': 'wrong-token'}, 401),
        ({'x-api-key': 'test-secret', 'x-sauti-user': '33333333-3333-4333-8333-333333333333', 'x-sauti-user-token': 'no-such-user'}, 401),
        ({'x-api-key': 'test-secret', 'x-sauti-user': 'not-a-uuid', 'x-sauti-user-token': USER_TOKEN}, 422),
    ]
    for headers, status in cases:
        resp = client.post('/v1/recognize', data=payload(), files=audio, headers=headers)
        assert resp.status_code == status, (headers, resp.status_code, resp.text)
        assert resp.status_code != 200


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
    manifest = next(tmp_path.rglob('manifest.jsonl'))
    assert not manifest.read_bytes().lstrip().startswith(b'{')
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
    import json as js
    from sauti_ml.auth import token_digest
    monkeypatch.setenv('SAUTI_ACCOUNTS', js.dumps({
        USER_ID: token_digest(USER_TOKEN),
        other: token_digest('other-token'),
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
    monkeypatch.setenv('SAUTI_IP_RATE_LIMIT_PER_MINUTE', '2')
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


def _recognize_as(headers):
    return client.post('/v1/recognize', data=payload(), files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=headers)


def test_failures_do_not_lock_the_same_user_on_another_ip(monkeypatch, tmp_path):
    """Failed checks are per user UUID and source IP. Successes do not use that bucket."""
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('SAUTI_AUTH_FAIL_LIMIT_PER_MINUTE', '3')
    monkeypatch.setenv('SAUTI_IP_RATE_LIMIT_PER_MINUTE', '100')
    from sauti_ml.auth import reset_rate_limits
    reset_rate_limits()
    attacker = {**auth(), 'x-sauti-user-token': 'wrong', 'x-sauti-client-ip': '203.0.113.10'}
    for _ in range(3):
        assert _recognize_as(attacker).status_code == 401
    locked_right_token = {**auth(), 'x-sauti-client-ip': '203.0.113.10'}
    assert _recognize_as(locked_right_token).status_code == 429
    from_other_ip = {**auth(), 'x-sauti-client-ip': '203.0.113.20'}
    other = _recognize_as(from_other_ip)
    assert other.status_code == 200, other.text
    assert other.json()['status'] == 'rejected'


def test_valid_traffic_is_not_limited_by_the_failure_bucket(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('SAUTI_AUTH_FAIL_LIMIT_PER_MINUTE', '5')
    monkeypatch.setenv('SAUTI_IP_RATE_LIMIT_PER_MINUTE', '80')
    from sauti_ml.auth import reset_rate_limits
    reset_rate_limits()
    for _ in range(31):
        resp = _recognize_as(auth())
        assert resp.status_code == 200, resp.text


def test_client_ip_header_is_trusted_only_with_the_api_key(monkeypatch):
    from starlette.requests import Request
    from sauti_ml.auth import trusted_client_ip
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')

    def request(headers, host='192.0.2.8'):
        scope = {
            'type': 'http', 'method': 'POST', 'path': '/', 'query_string': b'',
            'headers': [(key.lower().encode(), value.encode()) for key, value in headers.items()],
            'client': (host, 1234),
        }
        return Request(scope)

    spoofed = {'x-sauti-client-ip': '203.0.113.50', 'x-api-key': 'not-the-key'}
    assert trusted_client_ip(request(spoofed)) == '192.0.2.8'
    honored = {'x-sauti-client-ip': '203.0.113.50', 'x-api-key': 'test-secret'}
    assert trusted_client_ip(request(honored)) == '203.0.113.50'
    assert trusted_client_ip(request({'x-api-key': 'test-secret'})) == '192.0.2.8'


def test_junk_user_ids_do_not_grow_the_failure_table(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('SAUTI_IP_RATE_LIMIT_PER_MINUTE', '500')
    from sauti_ml.auth import rate_limit_bucket_count, reset_rate_limits
    reset_rate_limits()
    for index in range(200):
        headers = {**auth(), 'x-sauti-user': f'not-a-uuid-{index}', 'x-sauti-user-token': 'guess'}
        assert _recognize_as(headers).status_code == 422
    assert rate_limit_bucket_count() == 1


def test_other_user_cannot_enroll_or_recognize_and_expired_clips_stay(monkeypatch, tmp_path):
    import os, time
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    monkeypatch.setenv('SAUTI_RETENTION_DAYS', '1')
    data = payload() | {'session_id': str(uuid4()), 'intent': 'SCROLL_DOWN', 'consent': 'true'}
    stored = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert stored.status_code == 200, stored.text
    profile = stored.json()['profile_id']
    old = next(tmp_path.rglob('*.wav'))
    os.utime(old, (time.time() - 3 * 86400, time.time() - 3 * 86400))
    other = '22222222-2222-4222-8222-222222222222'
    from sauti_ml.auth import token_digest
    import json as js
    monkeypatch.setenv('SAUTI_ACCOUNTS', js.dumps({
        USER_ID: token_digest(USER_TOKEN),
        other: token_digest('other-token'),
    }))
    headers = {'x-api-key': 'test-secret', 'x-sauti-user': other, 'x-sauti-user-token': 'other-token'}
    denied = client.post('/v1/enroll', data=data | {'profile_id': profile}, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=headers)
    assert denied.status_code == 403
    assert old.exists()
    recognized = client.post('/v1/recognize', data={'profile_id': profile, 'language': 'en-KE'},
                             files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=headers)
    assert recognized.status_code == 403
    assert old.exists()
    missing = client.post('/v1/recognize', data=payload(), files={'audio': ('test.wav', wav(), 'audio/wav')})
    assert missing.status_code == 401


def test_expired_clip_removes_its_embedding_and_keeps_the_released_model(monkeypatch, tmp_path):
    import hashlib, os, time
    from sauti_ml.storage import read_private_bytes
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    monkeypatch.setenv('SAUTI_RETENTION_DAYS', '1')
    data = payload() | {'session_id': str(uuid4()), 'intent': 'SCROLL_DOWN', 'consent': 'true'}
    stored = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert stored.status_code == 200, stored.text
    audio = next(tmp_path.rglob('*.wav'))
    raw = read_private_bytes(audio)
    key = hashlib.sha256(b'facebook/wav2vec2-base|' + raw).hexdigest()
    profile = audio.parent.parent
    cache = profile / 'feature-cache'
    cache.mkdir(mode=0o700)
    embedding = cache / f'{key}.npy'
    embedding.write_bytes(b'derived-embedding')
    model = profile / 'model.json'
    model.write_bytes(b'kept-released-model')
    os.utime(audio, (time.time() - 3 * 86400, time.time() - 3 * 86400))
    again = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert again.status_code == 200, again.text
    assert not audio.exists()
    assert not embedding.exists()
    assert model.read_bytes() == b'kept-released-model'


def test_sweep_removes_expired_clips_and_unauthorized_enroll_deletes_nothing(monkeypatch, tmp_path):
    import os, time
    from sauti_ml.storage import purge_expired_profiles
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    monkeypatch.setenv('SAUTI_RETENTION_DAYS', '1')
    data = payload() | {'session_id': str(uuid4()), 'intent': 'UNDO', 'consent': 'true'}
    stored = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert stored.status_code == 200, stored.text
    audio = next(tmp_path.rglob('*.wav'))
    os.utime(audio, (time.time() - 3 * 86400, time.time() - 3 * 86400))
    before = list(tmp_path.rglob('*.wav'))
    no_consent = client.post('/v1/enroll', data=data | {'consent': 'false'}, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert no_consent.status_code == 403
    wrong = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers={**auth(), 'x-sauti-user-token': 'wrong'})
    assert wrong.status_code == 401
    assert list(tmp_path.rglob('*.wav')) == before
    assert audio.exists()
    assert purge_expired_profiles() >= 1
    assert not audio.exists()
    assert purge_expired_profiles() == 0


def test_enroll_stores_tone_retention_and_terms_and_purge_honours_it(monkeypatch, tmp_path):
    import json, os, time
    from sauti_ml.storage import load_manifest, purge_expired_folder, profile_dir
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    monkeypatch.setenv('SAUTI_RETENTION_DAYS', '30')
    base = payload() | {'session_id': str(uuid4()), 'intent': 'SCROLL_DOWN', 'consent': 'true', 'session_role': 'train'}
    ok = client.post('/v1/enroll', data=base | {'tone': 'happy', 'retention_days': '180', 'terms_version': '2026-11'},
                     files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert ok.status_code == 200, ok.text
    short = client.post('/v1/enroll', data=base | {'tone': 'neutral'},
                        files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert short.status_code == 200
    rows = load_manifest(base['profile_id'])
    kept = next(r for r in rows if r.get('tone') == 'happy')
    assert kept['retention_days'] == 180 and kept['terms_version'] == '2026-11' and kept['consented_at']
    # Age every clip to 60 days: the 30-day default clip expires, the 180-day clip stays.
    folder = profile_dir(base['profile_id'])
    old = time.time() - 60 * 86400
    for wav_file in (folder / 'audio').glob('*.wav'):
        os.utime(wav_file, (old, old))
    assert purge_expired_folder(folder) == 1
    assert [r.get('tone') for r in load_manifest(base['profile_id'])] == ['happy']


def test_enroll_rejects_unknown_tone_and_bad_retention(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    base = payload() | {'session_id': str(uuid4()), 'intent': 'SCROLL_DOWN', 'consent': 'true', 'session_role': 'train'}
    for extra in ({'tone': 'angry-ish'}, {'retention_days': '99999'}):
        resp = client.post('/v1/enroll', data=base | extra,
                           files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
        assert resp.status_code == 422
    assert not list(tmp_path.rglob('*.wav'))


def test_required_terms_are_enforced_for_pilot(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('ALLOW_ENROLLMENT', 'true')
    monkeypatch.setenv('SAUTI_REQUIRE_TERMS', 'true')
    monkeypatch.setenv('SAUTI_TERMS_VERSION', '2026-11-v1')
    base = payload() | {'session_id': str(uuid4()), 'intent': 'SCROLL_DOWN', 'consent': 'true'}
    for terms_version in (None, '2026-01-old'):
        data = base | ({'terms_version': terms_version} if terms_version else {})
        response = client.post('/v1/enroll', data=data, files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
        assert response.status_code == 403
    accepted = client.post('/v1/enroll', data=base | {'terms_version': '2026-11-v1', 'improvement_consent': 'true'},
                           files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=auth())
    assert accepted.status_code == 200, accepted.text
    from sauti_ml.storage import load_manifest
    assert load_manifest(base['profile_id'])[0]['improvement_consent'] is True
