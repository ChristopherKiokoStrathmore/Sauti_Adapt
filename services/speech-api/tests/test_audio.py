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
