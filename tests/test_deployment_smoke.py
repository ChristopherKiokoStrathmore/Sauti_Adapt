"""Characterisation of non-participant deployment smoke inputs."""
from io import BytesIO
import wave
import pytest
from scripts.smoke_deployment import make_silent_wav, validate_endpoint, require_rejected_mock


def test_silent_wav_is_a_valid_one_second_clip():
    payload = make_silent_wav()
    with wave.open(BytesIO(payload), 'rb') as wav:
        assert wav.getframerate() == 16000
        assert wav.getnchannels() == 1
        assert wav.getsampwidth() == 2
        assert wav.getnframes() == 16000


@pytest.mark.parametrize('url', [
    'http://example.com', 'file:///tmp/api',
    'https://127.0.0.1@untrusted.example',
    'http://192.0.2.8', 'ftp://localhost:8000',
])
def test_unsafe_endpoints_are_refused(url):
    with pytest.raises(ValueError):
        validate_endpoint(url)


def test_local_http_and_remote_https_allowed():
    assert validate_endpoint('http://127.0.0.1:8000') == 'http://127.0.0.1:8000'
    assert validate_endpoint('https://api.example.org') == 'https://api.example.org'


def test_reject_a_mock_that_accepts_a_command():
    require_rejected_mock({'status': 'rejected', 'intent': 'UNKNOWN'})
    with pytest.raises(RuntimeError):
        require_rejected_mock({'status': 'accepted', 'intent': 'SCROLL_DOWN'})
