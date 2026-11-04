"""No model weights are downloaded by the cloud comparison API unit tests."""
from io import BytesIO
from uuid import uuid4

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from sauti_ml.api import app
from sauti_ml.compare import character_errors, compare_models, mapped_intent, normalize, word_errors

CLIENT = TestClient(app)
USER_ID = '11111111-1111-4111-8111-111111111111'
HEADERS = {
    'x-api-key': 'test-secret',
    'x-sauti-user': USER_ID,
    'x-sauti-user-token': 'test-user-token',
}


def wav():
    t = np.arange(16000) / 16000
    out = BytesIO()
    sf.write(out, .1 * np.sin(2 * np.pi * 220 * t), 16000, format='WAV', subtype='PCM_16')
    return out.getvalue()


def test_exact_whitelisted_commands_and_mixed_language_are_safe():
    assert mapped_intent('MOVE DOWN!') == 'SCROLL_DOWN'
    assert mapped_intent('shuka chini') == 'SCROLL_DOWN'
    assert mapped_intent('move down kidogo') == 'SCROLL_DOWN'
    assert mapped_intent('do not move down') == 'UNKNOWN'
    assert mapped_intent('usishuke chini') == 'UNKNOWN'
    assert mapped_intent('scroll up and go back') == 'UNKNOWN'
    assert normalize('  Move,  DOWN!  ') == 'move down'
    assert word_errors('move down', 'move up') == (1, 2)
    assert character_errors('move down', 'move up') == (4, 9)


def test_comparison_runs_three_models_and_never_executes(monkeypatch):
    import sauti_ml.compare as cmp
    calls = []

    def fake_run(samples, profile_id, key):
        calls.append((profile_id, key, samples.copy()))
        return {'status': 'accepted', 'intent': 'SCROLL_DOWN', 'transcript': 'move down'}

    monkeypatch.setattr(cmp, 'infer_one', fake_run)
    result = compare_models(np.ones(20, dtype=np.float32), str(uuid4()), 'all', 'mixed',
                            'SCROLL_DOWN', 'move down')
    assert [row['model'] for row in result['results']] == ['prototype', 'english', 'swahili']
    assert len(calls) == 3
    assert all(row['correct_intent'] and not row['false_activation'] for row in result['results'])
    assert all(row['wer'] == 0 and row['cer'] == 0 for row in result['results'])
    assert result['executed_action'] is False
    assert calls[0][2] is not calls[1][2]


def test_compare_requires_server_switch_and_explicit_consent(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    data = {'profile_id': str(uuid4()), 'language': 'mixed', 'model': 'all'}
    files = {'audio': ('test.wav', wav(), 'audio/wav')}

    monkeypatch.delenv('SAUTI_COMPARE_ENABLED', raising=False)
    res = CLIENT.post('/v1/compare', data=data | {'compare_consent': 'true'},
                      files=files, headers=HEADERS)
    assert res.status_code == 403

    monkeypatch.setenv('SAUTI_COMPARE_ENABLED', 'true')
    res = CLIENT.post('/v1/compare', data=data, files=files, headers=HEADERS)
    assert res.status_code == 403


def test_compare_endpoint_safe_no_controller_action(monkeypatch, tmp_path):
    import sauti_ml.compare as cmp
    monkeypatch.setenv('SAUTI_API_TOKEN', 'test-secret')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('SAUTI_COMPARE_ENABLED', 'true')
    monkeypatch.setenv('SAUTI_REQUIRE_TERMS', 'true')
    monkeypatch.setenv('SAUTI_PRIVACY_CONTACT', 'privacy@example.org')

    def fake_compare(samples, profile_id, selection, language, expected=None, reference=''):
        return {'results': [{'model': 'english', 'status': 'rejected', 'intent': 'UNKNOWN'}],
                'executed_action': False}

    monkeypatch.setattr(cmp, 'compare_models', fake_compare)
    data = {'profile_id': str(uuid4()), 'language': 'en-KE',
            'model': 'english', 'compare_consent': 'true'}
    res = CLIENT.post('/v1/compare', data=data,
                      files={'audio': ('test.wav', wav(), 'audio/wav')}, headers=HEADERS)
    assert res.status_code == 200, res.text
    assert res.json()['executed_action'] is False
    assert not list(tmp_path.rglob('*.wav'))
