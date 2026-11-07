"""Encoder settings shared by the encoder, training cache and retention purge.

Kept free of torch so storage can compute the same cache key without importing ML.
The signature is stored in each model and in every feature-cache key, so changing
the layer or trimming invalidates old models instead of silently mismatching them.
"""
import os

DEFAULT_HF_ID = 'facebook/wav2vec2-base'
# Middle layers of wav2vec2-base usually carry more word-level phonetic content than
# the final layer. The default is a literature-based starting point and is NOT VERIFIED
# on atypical speech. Use `python -m sauti_ml.layer_sweep` on consented recordings.
DEFAULT_LAYER = '8'


def hf_id() -> str:
    return os.environ.get('SAUTI_ENCODER_ID', '').strip() or DEFAULT_HF_ID


def layer_choice() -> int | None:
    """Return 1..12, or None for the legacy last_hidden_state."""
    raw = os.environ.get('SAUTI_ENCODER_LAYER', DEFAULT_LAYER).strip().lower()
    if raw in ('', 'last'):
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if 1 <= value <= 24 else None


def trim_enabled() -> bool:
    return os.environ.get('SAUTI_ENCODER_TRIM', 'true').strip().lower() != 'false'


def encoder_signature() -> str:
    parts = [hf_id()]
    layer = layer_choice()
    if layer is not None:
        parts.append(f'L{layer}')
    if trim_enabled():
        parts.append('trim')
    return parts[0] + ''.join('+' + p for p in parts[1:])
