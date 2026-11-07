"""Headway extension direct Railway API tests. Synthetic audio, never private voice."""
import json
from io import BytesIO
from unittest.mock import patch
from uuid import uuid4

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from sauti_ml.api import app
from sauti_ml.auth import is_allowed_extension_origin

client = TestClient(app)
ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
HEADERS = {
    'origin': ORIGIN,
    'x-sauti-user': '11111111-1111-4111-8111-111111111111',
    'x-sauti-user-token': 'test-user-token',
}


def synthetic_wav():
    samples = np.sin(2 * np.pi * 260 * np.arange(16000) / 16000) * .1
    out = BytesIO()
    sf.write(out, samples, 16000, format='WAV', subtype='PCM_16')
    return out.getvalue()


def test_extension_origin_is_scoped_to_explicit_endpoints():
    assert is_allowed_extension_origin(ORIGIN, '/v1/extension/agent/plan')
    assert is_allowed_extension_origin(ORIGIN, '/v1/extension/compare')
    assert not is_allowed_extension_origin(ORIGIN, '/v1/participants')
    assert not is_allowed_extension_origin('https://random.example', '/v1/extension/compare')
    assert not is_allowed_extension_origin('chrome-extension://not-an-id', '/v1/extension/compare')


def test_extension_preflight_does_not_require_server_key():
    for path in ('/v1/extension/agent/plan', '/v1/extension/compare'):
        response = client.options(path, headers={
            'origin': ORIGIN, 'access-control-request-method': 'POST',
            'access-control-request-headers': 'content-type,x-sauti-user,x-sauti-user-token',
        })
        assert response.status_code == 204
        assert response.headers['access-control-allow-origin'] == ORIGIN
        assert 'x-sauti-user-token' in response.headers['access-control-allow-headers']
    normal = client.options('/v1/agent/plan', headers={'origin': ORIGIN})
    assert normal.headers.get('access-control-allow-origin') is None


def test_extension_planner_requires_personal_token_even_without_server_api_key(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'test-not-a-secret')
    with patch('sauti_ml.agent.plan_action', return_value={'action': 'scroll', 'direction': 'down'}) as planner:
        bad = client.post('/v1/extension/agent/plan',
                          json={'instruction': 'Scroll down'}, headers={**HEADERS, 'x-sauti-user-token': 'invalid'})
        assert bad.status_code == 401
        planner.assert_not_called()
        good = client.post('/v1/extension/agent/plan',
                           json={'instruction': 'Scroll down'}, headers=HEADERS)
    assert good.status_code == 200
    assert good.headers['access-control-allow-origin'] == ORIGIN
    assert good.json() == {
        'plan': {'action': 'scroll', 'direction': 'down'},
        'requires_confirmation': True, 'executed_action': False,
    }


def test_extension_comparison_rejects_without_consent_and_unknown_model(monkeypatch):
    monkeypatch.setenv('SAUTI_COMPARE_ENABLED', 'true')
    file = {'audio': ('synthetic.wav', synthetic_wav(), 'audio/wav')}
    missing_consent = client.post('/v1/extension/compare', headers=HEADERS,
                                  data={'profile_id': str(uuid4()), 'language': 'en-KE',
                                        'model': 'english'}, files=file)
    assert missing_consent.status_code == 403
    invalid_model = client.post('/v1/extension/compare', headers=HEADERS,
                                data={'profile_id': str(uuid4()), 'language': 'en-KE',
                                      'model': 'all', 'compare_consent': 'true'}, files=file)
    assert invalid_model.status_code == 422


def test_extension_comparison_uses_audio_without_shared_server_key(monkeypatch):
    monkeypatch.setenv('SAUTI_COMPARE_ENABLED', 'true')
    monkeypatch.setattr('sauti_ml.api.assert_owner', lambda profile_id, user_id: None)
    with patch('sauti_ml.compare.compare_models',
               return_value={'results': [{'model': 'english',
                                           'model_id': 'sauti-adapt-finetuned-model/english',
                                           'transcript': 'scroll down'}], 'executed_action': False}) as mock:
        response = client.post('/v1/extension/compare',
                               headers=HEADERS,
                               data={'profile_id': str(uuid4()), 'model': 'english',
                                     'language': 'en-KE', 'compare_consent': 'true'},
                               files={'audio': ('synthetic.wav', synthetic_wav(), 'audio/wav')})
    assert response.status_code == 200, response.text
    assert response.headers['access-control-allow-origin'] == ORIGIN
    assert response.json()['executed_action'] is False
    mock.assert_called_once()
