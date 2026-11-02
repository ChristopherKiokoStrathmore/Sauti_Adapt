from io import BytesIO
import numpy as np
import soundfile as sf
import pytest
from sauti_ml.audio import decode_wav, AudioValidationError


def make_wav(signal, sr=16000):
    buffer = BytesIO()
    sf.write(buffer, signal, sr, format='WAV', subtype='PCM_16')
    return buffer.getvalue()


def test_valid_audio():
    t = np.arange(16000) / 16000
    x = .2 * np.sin(2 * np.pi * 440 * t)
    out = decode_wav(make_wav(x))
    assert out.shape == (16000,)
    assert out.dtype == np.float32


def test_resample():
    t = np.arange(8000) / 8000
    out = decode_wav(make_wav(.1 * np.sin(2*np.pi*220*t), 8000))
    assert len(out) == 16000


def test_silence_is_rejected():
    with pytest.raises(AudioValidationError, match='Silence'):
        decode_wav(make_wav(np.zeros(16000)))


def test_non_wav_rejected():
    with pytest.raises(AudioValidationError):
        decode_wav(b'not-wav')


def test_oversized_rejected():
    with pytest.raises(AudioValidationError):
        decode_wav(b'RIFF' + b'0' * 2_100_000)


def _tone(seconds, freq=440):
    count = int(16000 * seconds)
    t = np.arange(count) / 16000
    return .2 * np.sin(2 * np.pi * freq * t)


def test_default_limit_rejects_clips_over_five_seconds(monkeypatch):
    monkeypatch.delenv('SAUTI_MAX_CLIP_SECONDS', raising=False)
    with pytest.raises(AudioValidationError, match='at most 5 seconds'):
        decode_wav(make_wav(_tone(6)))


def test_configured_limit_is_enforced(monkeypatch):
    monkeypatch.setenv('SAUTI_MAX_CLIP_SECONDS', '2')
    with pytest.raises(AudioValidationError, match='at most 2 seconds'):
        decode_wav(make_wav(_tone(3)))
    assert decode_wav(make_wav(_tone(1))).shape == (16000,)


def test_invalid_limit_falls_back_to_five_seconds(monkeypatch):
    monkeypatch.setenv('SAUTI_MAX_CLIP_SECONDS', '100')
    with pytest.raises(AudioValidationError, match='at most 5 seconds'):
        decode_wav(make_wav(_tone(6)))
