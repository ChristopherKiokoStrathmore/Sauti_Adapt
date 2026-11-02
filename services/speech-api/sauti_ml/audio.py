"""Fail closed audio decoding and normalization. All model inputs are single channel 16 kHz PCM."""
import os
from io import BytesIO
from math import gcd
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

SAMPLE_RATE = 16000
MAX_BYTES = 2_000_000
MIN_DURATION_SECONDS = 0.3
DEFAULT_MAX_DURATION_SECONDS = 5.0
MAX_CONFIGURABLE_SECONDS = 30.0
MIN_RMS = 0.002


def max_duration_seconds() -> float:
    """Server clip limit. Default 5s. Invalid values fall back to the default.

    The participant must agree the final limit. This function still rejects
    anything above the configured cap; it does not accept unbounded audio.
    """
    raw = os.environ.get('SAUTI_MAX_CLIP_SECONDS', '').strip()
    if not raw:
        return DEFAULT_MAX_DURATION_SECONDS
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_MAX_DURATION_SECONDS
    if not (0.5 <= value <= MAX_CONFIGURABLE_SECONDS):
        return DEFAULT_MAX_DURATION_SECONDS
    return value

class AudioValidationError(ValueError):
    pass


def decode_wav(payload: bytes) -> np.ndarray:
    if not payload or len(payload) > MAX_BYTES:
        raise AudioValidationError('WAV file must be between 1 byte and 2 MB.')
    if not payload.startswith(b'RIFF') or payload[8:12] != b'WAVE':
        raise AudioValidationError('Only RIFF WAVE recordings are supported.')
    try:
        samples, sample_rate = sf.read(BytesIO(payload), dtype='float32', always_2d=True)
    except Exception as exc:
        raise AudioValidationError('Invalid or unreadable WAV audio.') from exc
    if sample_rate < 8000 or sample_rate > 96000 or samples.shape[1] > 2:
        raise AudioValidationError('Unsupported sample rate or channel count.')
    if not np.isfinite(samples).all():
        raise AudioValidationError('Audio contains invalid values.')
    mono = samples.mean(axis=1)
    limit = max_duration_seconds()
    if len(mono) / sample_rate > limit + .05:
        raise AudioValidationError(f'Recording must be at most {limit:g} seconds.')
    if sample_rate != SAMPLE_RATE:
        factor = gcd(sample_rate, SAMPLE_RATE)
        mono = resample_poly(mono, SAMPLE_RATE // factor, sample_rate // factor)
    seconds = len(mono) / SAMPLE_RATE
    if not (MIN_DURATION_SECONDS <= seconds <= limit + .1):
        raise AudioValidationError(f'Recording must be between 0.3 and {limit:g} seconds.')
    mono = np.asarray(mono, dtype=np.float32)
    mono = mono - float(mono.mean())
    rms = float(np.sqrt(np.mean(np.square(mono, dtype=np.float64))))
    if rms < MIN_RMS:
        raise AudioValidationError('Silence or near silence was detected. No command executed.')
    # Limit gain for quiet recordings; never amplify background noise without bounds.
    gain = min(4.0, 0.05 / max(rms, 1e-8))
    mono = np.clip(mono * gain, -1.0, 1.0)
    return mono


def encode_private_wav(samples: np.ndarray, path) -> None:
    sf.write(str(path), samples, SAMPLE_RATE, subtype='PCM_16')
