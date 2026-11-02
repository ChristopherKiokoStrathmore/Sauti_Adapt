"""Speaker-specific command prototypes and conservative reject logic."""
import hashlib
import json
from pathlib import Path
import numpy as np
from .contracts import Intent, Language, Recognition, reject


def model_content_version(prototypes, labels, languages, threshold, margin, encoder_id) -> str:
    """Hash the weights and calibration. A new training run cannot reuse an older version string."""
    matrix = np.ascontiguousarray(norm_rows(prototypes), dtype=np.float32)
    canonical = {
        'labels': [str(item) for item in labels],
        'languages': [str(item) for item in languages],
        'threshold': json.loads(json.dumps(float(threshold))),
        'margin': json.loads(json.dumps(float(margin))),
        'encoder_id': str(encoder_id),
        'vectors_sha256': hashlib.sha256(matrix.tobytes()).hexdigest(),
    }
    raw = json.dumps(canonical, sort_keys=True, separators=(',', ':')).encode('utf8')
    return hashlib.sha256(raw).hexdigest()


def norm_rows(values):
    a = np.asarray(values, dtype=np.float32)
    if a.ndim != 2 or not np.isfinite(a).all():
        raise ValueError('Expected a finite N by D feature matrix.')
    den = np.maximum(np.linalg.norm(a, axis=1, keepdims=True), 1e-9)
    return a / den

class PrototypeModel:
    def __init__(self, prototypes, labels, languages, threshold, margin, version, encoder_id):
        self.prototypes = norm_rows(prototypes)
        self.labels = list(labels)
        self.languages = list(languages)
        self.threshold = float(threshold)
        self.margin = float(margin)
        self.version = str(version)
        self.encoder_id = str(encoder_id)
        if len(self.prototypes) != len(self.labels) or len(self.labels) != len(self.languages):
            raise ValueError('Prototype metadata shape mismatch.')
        if not 0 <= self.threshold <= 1 or self.margin < 0:
            raise ValueError('Invalid model calibration.')

    def score(self, vector):
        vector = np.asarray(vector, dtype=np.float32)
        vector = vector / max(float(np.linalg.norm(vector)), 1e-9)
        similarities = self.prototypes @ vector
        # Combine language variants belonging to the SAME intention before margin calculation.
        by_intent = {}
        for ix, label in enumerate(self.labels):
            value = float(similarities[ix])
            if label not in by_intent or value > by_intent[label][0]:
                by_intent[label] = (value, self.languages[ix])
        return sorted(((k, v[0], v[1]) for k, v in by_intent.items()), key=lambda v: v[1], reverse=True)

    def predict(self, vector) -> Recognition:
        scores = self.score(vector)
        if not scores:
            return reject('No enrolled commands.', version=self.version)
        label, top, lang = scores[0]
        second = scores[1][1] if len(scores) > 1 else -1.0
        # Cosine similarity is NOT a calibrated probability. We expose a bounded
        # similarity score for UI inspection, and select thresholds using validation.
        similarity_score = max(0.0, min(1.0, (top + 1.0) / 2.0))
        if similarity_score < self.threshold or (top - second) < self.margin:
            return Recognition(status='rejected', intent=Intent.UNKNOWN, confidence=similarity_score,
                               language=None, model_version=self.version, reason='UNCERTAIN_OR_UNKNOWN')
        return Recognition(status='accepted', intent=Intent(label), language=Language(lang),
                           confidence=similarity_score, model_version=self.version, reason=None)

    def content_version(self) -> str:
        return model_content_version(
            self.prototypes, self.labels, self.languages, self.threshold, self.margin, self.encoder_id)

    def save(self, folder: Path, *, released: bool = False):
        from io import BytesIO
        from .storage import write_private_bytes
        folder.mkdir(parents=True, exist_ok=True)
        buffer = BytesIO()
        np.savez_compressed(buffer, vectors=self.prototypes,
                            labels=np.array(self.labels, dtype='U32'), languages=np.array(self.languages, dtype='U8'))
        write_private_bytes(folder / 'prototypes.npz', buffer.getvalue())
        write_private_bytes(folder / 'model.json', json.dumps({
            'threshold': self.threshold, 'margin': self.margin, 'model_version': self.version,
            'encoder_id': self.encoder_id, 'validated': bool(released),
            'score_semantics': 'bounded cosine similarity, NOT probability'
        }).encode('utf8'))

    @classmethod
    def load(cls, folder: Path):
        from io import BytesIO
        from .storage import read_private_bytes
        meta = json.loads(read_private_bytes(folder / 'model.json'))
        if not meta.get('validated'):
            raise ValueError('Model has not been validated.')
        with np.load(BytesIO(read_private_bytes(folder / 'prototypes.npz')), allow_pickle=False) as data:
            vectors = data['vectors']
            labels = data['labels'].tolist()
            languages = data['languages'].tolist()
        return cls(vectors, labels, languages, meta['threshold'], meta['margin'], meta['model_version'], meta['encoder_id'])
