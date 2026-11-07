"""Pick the encoder layer using a person's own consented clips.

Usage (on the server, with SAUTI_PRIVATE_DIR and SAUTI_STORAGE_KEY set):
  python -m sauti_ml.layer_sweep --profile-id UUID

For every layer it scores leave-one-out nearest-centroid accuracy over enrolled commands.
Counts are small and are NOT an accuracy claim. They only rank layers for this person.
"""
import argparse
import json
from collections import defaultdict
import numpy as np


def leave_one_out_accuracy(embeddings: np.ndarray, labels: list[str]) -> float:
    """embeddings: (n, dim) L2-normalised. Returns the fraction classified correctly by the other clips."""
    labels = list(labels)
    correct = counted = 0
    for i in range(len(labels)):
        centroids = {}
        for label in set(labels):
            rows = [embeddings[j] for j in range(len(labels)) if j != i and labels[j] == label]
            if rows:
                mean = np.mean(rows, axis=0)
                centroids[label] = mean / max(float(np.linalg.norm(mean)), 1e-9)
        if labels[i] not in centroids or len(centroids) < 2:
            continue
        best = max(centroids, key=lambda k: float(embeddings[i] @ centroids[k]))
        counted += 1
        correct += best == labels[i]
    return correct / counted if counted else 0.0


def sweep(layer_embeddings: np.ndarray, labels: list[str]) -> dict[int, float]:
    """layer_embeddings: (n, layers, dim)."""
    return {layer: round(leave_one_out_accuracy(layer_embeddings[:, layer, :], labels), 4)
            for layer in range(layer_embeddings.shape[1])}


def main() -> None:
    from pathlib import Path
    from .audio import decode_wav
    from .encoder import SpeechEncoder
    from .storage import canonical_uuid, load_manifest, read_private_bytes
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile-id', required=True)
    args = parser.parse_args()
    entries = [e for e in load_manifest(canonical_uuid(args.profile_id)) if e['intent'] != 'UNKNOWN']
    encoder = SpeechEncoder()
    rows = [encoder.embed_layers(decode_wav(read_private_bytes(Path(e['absolute_path'])))) for e in entries]
    scores = sweep(np.stack(rows), [e['intent'] + '|' + e['language'] for e in entries])
    print(json.dumps({'clips': len(entries), 'leave_one_out_by_layer': scores,
                      'accuracy_claim': False,
                      'note': 'Ranking aid only. Set SAUTI_ENCODER_LAYER to the best layer.'}, indent=2))


if __name__ == '__main__':
    main()
