"""Pretrained audio embeddings. Torch and Transformers are imported only in real ML mode."""
import os
import numpy as np

class SpeechEncoder:
    def __init__(self, model_id=None):
        import torch
        from transformers import AutoFeatureExtractor, Wav2Vec2Model
        self.torch = torch
        self.model_id = model_id or os.environ.get('SAUTI_ENCODER_ID', 'facebook/wav2vec2-base')
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.processor = AutoFeatureExtractor.from_pretrained(self.model_id)
        self.model = Wav2Vec2Model.from_pretrained(self.model_id).to(self.device)
        self.model.eval()

    @property
    def dimension(self):
        return int(self.model.config.hidden_size)

    def embed(self, audio: np.ndarray) -> np.ndarray:
        if audio.ndim != 1 or not np.isfinite(audio).all():
            raise ValueError('Expected finite mono audio')
        encoded = self.processor(audio, sampling_rate=16000, return_tensors='pt')
        x = encoded.input_values.to(self.device)
        with self.torch.inference_mode():
            result = self.model(x).last_hidden_state
            embedding = result.mean(dim=1)[0].cpu().numpy().astype(np.float32)
        return embedding / max(float(np.linalg.norm(embedding)), 1e-9)
