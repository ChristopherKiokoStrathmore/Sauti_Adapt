"""Modal CDLI integration tests with synthetic audio only.

No live Modal calls, participant audio, model weights or secrets.
"""
import json
from unittest.mock import patch
import numpy as np
import pytest

from sauti_ml.compare import whisper_prediction


class StubResponse:
    status = 200
    def __init__(self, body):
        self.body = body
    def __enter__(self):
        return self
    def __exit__(self, *_):
        return False
    def read(self, limit):
        assert limit <= 100_000
        return json.dumps(self.body).encode()


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv(
        'SAUTI_MODAL_URL',
        'https://ulla39254--sauti-adapt-cdli-gpu-transcribe.us-east.modal.run'
    )
    monkeypatch.setenv('SAUTI_MODAL_BEARER_TOKEN', 'synthetic-test-token')
    return np.ones(16000, dtype=np.float32) * 0.01


def test_english_transcript_remains_comparison_only(configured):
    def fake(request, timeout):
        assert timeout >= 60
        assert request.get_header('Authorization') == 'Bearer synthetic-test-token'
        assert request.get_header('X-sauti-model') == 'english'
        assert request.get_header('Content-type') == 'application/octet-stream'
        assert len(request.data) == 16000 * 4
        return StubResponse({'model': 'english', 'transcript': 'scroll down',
                             'revision': 'test-sha', 'device': 'cuda'})
    with patch('urllib.request.urlopen', side_effect=fake):
        result = whisper_prediction(configured, 'english')
    assert result['status'] == 'accepted'
    assert result['intent'] == 'SCROLL_DOWN'
    assert result['transcript'] == 'scroll down'


def test_swahili_transcript_can_be_recognised(configured):
    with patch('urllib.request.urlopen', return_value=StubResponse({
        'model': 'swahili', 'transcript': 'shuka chini', 'device': 'cuda'
    })):
        result = whisper_prediction(configured, 'swahili')
    assert result['intent'] == 'SCROLL_DOWN'


def test_model_mismatch_is_rejected(configured):
    with patch('urllib.request.urlopen', return_value=StubResponse({
        'model': 'english', 'transcript': 'scroll down'
    })):
        with pytest.raises(ValueError, match='Invalid Modal'):
            whisper_prediction(configured, 'swahili')


def test_unknown_audio_never_maps_to_an_action(configured):
    with patch('urllib.request.urlopen', return_value=StubResponse({
        'model': 'english', 'transcript': 'hello how are you'
    })):
        result = whisper_prediction(configured, 'english')
    assert result['status'] == 'rejected'
    assert result['intent'] == 'UNKNOWN'


def test_missing_secret_never_calls_modal(configured, monkeypatch):
    monkeypatch.delenv('SAUTI_MODAL_BEARER_TOKEN')
    with patch('urllib.request.urlopen') as outbound:
        result = whisper_prediction(configured, 'english')
    assert result['status'] == 'unavailable'
    outbound.assert_not_called()


def test_invalid_modal_url_never_calls_external_host(configured, monkeypatch):
    monkeypatch.setenv('SAUTI_MODAL_URL', 'http://example.org')
    with patch('urllib.request.urlopen') as outbound:
        result = whisper_prediction(configured, 'english')
    assert result['status'] == 'unavailable'
    outbound.assert_not_called()


def test_personalised_comparison_stays_profile_gated(configured, monkeypatch):
    from sauti_ml.compare import infer_one
    from uuid import uuid4
    monkeypatch.setenv('SAUTI_PERSONALIZED_COMPARE_ENABLED', 'true')
    monkeypatch.setenv('SAUTI_PILOT_PROFILE_ID', str(uuid4()))
    with patch('urllib.request.urlopen') as outbound:
        result = infer_one(configured, str(uuid4()), 'personalized_english')
    assert result['status'] == 'unavailable'
    outbound.assert_not_called()
