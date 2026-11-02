"""Train and VALIDATE speaker-specific prototypes using separate recording sessions.

Usage:
  cd services/speech-api
  python -m sauti_ml.train --profile-id UUID --calibration-session UUID --test-session UUID

This NEVER runs automatically when samples are uploaded. It requires separate sessions,
unknown speech examples, an untouched test session, and prevents activation if safety checks fail.
"""
import argparse
import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import soundfile as sf
from .audio import decode_wav
from .storage import canonical_uuid, load_manifest, profile_dir
from .prototype import PrototypeModel
from .encoder import SpeechEncoder

MIN_TRAIN_PER_CLASS = 3
MIN_VALID_PER_CLASS = 2
MIN_UNKNOWN_VALID = 5
MARGIN = 0.05


def test_predictions(model, known, unknown):
    confusion = Counter()
    correct = 0
    wrong_accepted = 0
    for label, embedding in known:
        result = model.predict(embedding)
        predicted = result.intent.value if result.status == 'accepted' else 'REJECTED'
        confusion[f'{label}->{predicted}'] += 1
        if predicted == label:
            correct += 1
        elif predicted != 'REJECTED':
            wrong_accepted += 1
    unknown_accepts = sum(model.predict(e).status == 'accepted' for e in unknown)
    return {
        'known_count': len(known), 'correct_accepted': correct,
        'known_wrong_accepted': wrong_accepted, 'known_rejected': len(known) - correct - wrong_accepted,
        'unknown_count': len(unknown), 'unknown_false_accepts': unknown_accepts,
        'command_acceptance_recall': round(correct / max(len(known), 1), 4),
        'observed_unknown_false_accept_rate': round(unknown_accepts / max(len(unknown), 1), 4),
        'confusion': dict(confusion)
    }


def run(profile_id: str, calibration_session: str, test_session: str, *, encoder=None) -> dict:
    profile_id = canonical_uuid(profile_id)
    calibration_session = canonical_uuid(calibration_session)
    test_session = canonical_uuid(test_session)
    if calibration_session == test_session:
        raise ValueError('Calibration and test sessions must be different.')
    entries = load_manifest(profile_id)
    training = [e for e in entries if e['session_id'] not in (calibration_session, test_session)]
    calibration = [e for e in entries if e['session_id'] == calibration_session]
    test = [e for e in entries if e['session_id'] == test_session]
    if not training or not calibration or not test:
        raise ValueError('Three distinct data partitions are required: train, calibration, untouched test.')
    def fingerprints(rows):
        return {hashlib.sha256(Path(e['absolute_path']).read_bytes()).hexdigest() for e in rows}
    a, b, c = fingerprints(training), fingerprints(calibration), fingerprints(test)
    if a & b or a & c or b & c:
        raise ValueError('Identical audio appears across train/calibration/test partitions: data leakage.')
    classes = sorted({(e['intent'], e['language']) for e in training if e['intent'] != 'UNKNOWN'})
    if len({c[0] for c in classes}) < 3:
        raise ValueError('Enrollment requires at least three distinct commands, plus unknown speech.')
    for label, lang in classes:
        train_n = sum(e['intent'] == label and e['language'] == lang for e in training)
        cal_n = sum(e['intent'] == label and e['language'] == lang for e in calibration)
        test_n = sum(e['intent'] == label and e['language'] == lang for e in test)
        if train_n < MIN_TRAIN_PER_CLASS or cal_n < MIN_VALID_PER_CLASS or test_n < MIN_VALID_PER_CLASS:
            raise ValueError(f'{label} / {lang} requires >=3 train, >=2 calibration and >=2 test samples; got {train_n}/{cal_n}/{test_n}.')
    for session_name, subset in [('calibration',calibration),('test',test)]:
        if len([e for e in subset if e['intent'] == 'UNKNOWN']) < MIN_UNKNOWN_VALID:
            raise ValueError(f'Collect at least five unknown/unrelated utterances in the {session_name} session.')

    encoder = encoder or SpeechEncoder()
    folder = profile_dir(profile_id)
    cache_dir = folder / 'feature-cache'
    cache_dir.mkdir(mode=0o700, exist_ok=True)

    def feature(e):
        path = Path(e['absolute_path'])
        raw = path.read_bytes()
        key = hashlib.sha256((encoder.model_id + '|').encode() + raw).hexdigest()
        cache_path = cache_dir / (key + '.npy')
        if cache_path.is_file():
            return np.load(cache_path, allow_pickle=False)
        v = encoder.embed(decode_wav(raw))
        np.save(cache_path, v, allow_pickle=False)
        return v

    groups = defaultdict(list)
    for e in training:
        if e['intent'] != 'UNKNOWN':
            groups[(e['intent'], e['language'])].append(feature(e))
    centroids, labels, languages = [], [], []
    for (label, language), examples in sorted(groups.items()):
        mean = np.mean(examples, axis=0)
        mean = mean / max(float(np.linalg.norm(mean)), 1e-9)
        centroids.append(mean)
        labels.append(label)
        languages.append(language)

    positive = [(e['intent'], feature(e)) for e in calibration if e['intent'] != 'UNKNOWN']
    negatives = [feature(e) for e in calibration if e['intent'] == 'UNKNOWN']
    # Calibration chooses the policy. Test is NEVER used to pick thresholds.
    candidates = []
    for threshold in np.arange(0.40, 0.995, 0.005):
        model = PrototypeModel(centroids, labels, languages, float(threshold), MARGIN,
                               'sauti-prototype-v1', encoder.model_id)
        metrics = test_predictions(model, positive, negatives)
        if metrics['unknown_false_accepts'] == 0 and metrics['known_wrong_accepted'] == 0:
            candidates.append((metrics['correct_accepted'], float(threshold), metrics, model))
    if not candidates:
        raise RuntimeError('No validation threshold prevented false activations; model NOT released.')
    candidates.sort(key=lambda r: (r[0], r[1]), reverse=True)
    correct, threshold, metrics, model = candidates[0]
    # A model that fails to recognize even a single example of a class is not ready.
    for intent in sorted(set(labels)):
        if metrics['confusion'].get(f'{intent}->{intent}', 0) < 1:
            raise RuntimeError(f'No correct held-out activation for {intent}; model NOT released.')
    test_positive = [(e['intent'], feature(e)) for e in test if e['intent'] != 'UNKNOWN']
    test_negatives = [feature(e) for e in test if e['intent'] == 'UNKNOWN']
    test_metrics = test_predictions(model, test_positive, test_negatives)
    if test_metrics['unknown_false_accepts'] or test_metrics['known_wrong_accepted']:
        raise RuntimeError('Final untouched test detected false command activation; model NOT released.')
    for intent in sorted(set(labels)):
        if test_metrics['confusion'].get(f'{intent}->{intent}', 0) < 1:
            raise RuntimeError(f'No correct untouched-test activation for {intent}; model NOT released.')
    model.save(folder)
    report = {
        'status': 'pilot-validation-passed', 'model_version': model.version,
        'profile_id': profile_id, 'encoder_id': encoder.model_id,
        'threshold': threshold, 'margin': MARGIN,
        'calibration_session': calibration_session, 'test_session': test_session,
        'evaluated_at': datetime.now(timezone.utc).isoformat(),
        'training_examples': len(training), 'calibration_examples': len(calibration), 'test_examples': len(test),
        'metrics': {'calibration': metrics, 'test': test_metrics},
        'warning': 'Small test sets cannot establish a low real-world false activation rate. Requires co-designer usability evaluation.'
    }
    (folder / 'evaluation.json').write_text(json.dumps(report, indent=2), encoding='utf8')
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile-id', required=True)
    parser.add_argument('--calibration-session', required=True)
    parser.add_argument('--test-session', required=True)
    args = parser.parse_args()
    report = run(args.profile_id, args.calibration_session, args.test_session)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
