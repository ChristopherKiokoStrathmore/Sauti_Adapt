"""Frozen pretrained audio embeddings. Torch and Transformers are imported only in real ML mode.

The app path loads facebook/wav2vec2-base, calls eval(), and embeds under inference_mode.
It does not fine-tune. It reads one hidden layer (default 8, see encoder_config), trims
silence, and mean-pools. Notebook experiments are not imported here.
"""
import numpy as np
from . import encoder_config
from .audio import trim_silence


class SpeechEncoder:
    def __init__(self, model_id=None):
        import torch
        from transformers import AutoFeatureExtractor, Wav2Vec2Model
        self.torch = torch
        self.hf_id = model_id or encoder_config.hf_id()
        self.layer = encoder_config.layer_choice()
        self.trim = encoder_config.trim_enabled()
        # model_id is the full signature: it keys the feature cache and is stored in each model.
        self.model_id = encoder_config.encoder_signature() if model_id is None else self.hf_id
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.processor = AutoFeatureExtractor.from_pretrained(self.hf_id)
        self.model = Wav2Vec2Model.from_pretrained(self.hf_id).to(self.device)
        self.model.eval()

    @property
    def dimension(self):
        return int(self.model.config.hidden_size)

    def _prepare(self, audio: np.ndarray) -> np.ndarray:
        if audio.ndim != 1 or not np.isfinite(audio).all():
            raise ValueError('Expected finite mono audio')
        return trim_silence(audio) if self.trim else audio

    def embed_layers(self, audio: np.ndarray) -> np.ndarray:
        """Mean-pooled, L2-normalised embedding for every layer: (layers + 1, dim). For layer sweeps."""
        audio = self._prepare(audio)
        x = self.processor(audio, sampling_rate=16000, return_tensors='pt').input_values.to(self.device)
        with self.torch.inference_mode():
            states = self.model(x, output_hidden_states=True).hidden_states
            stacked = self.torch.stack([h.mean(dim=1)[0] for h in states]).cpu().numpy().astype(np.float32)
        return stacked / np.maximum(np.linalg.norm(stacked, axis=1, keepdims=True), 1e-9)

    def embed(self, audio: np.ndarray) -> np.ndarray:
        audio = self._prepare(audio)
        x = self.processor(audio, sampling_rate=16000, return_tensors='pt').input_values.to(self.device)
        with self.torch.inference_mode():
            if self.layer is None:
                hidden = self.model(x).last_hidden_state
            else:
                hidden = self.model(x, output_hidden_states=True).hidden_states[self.layer]
            embedding = hidden.mean(dim=1)[0].cpu().numpy().astype(np.float32)
        return embedding / max(float(np.linalg.norm(embedding)), 1e-9)
