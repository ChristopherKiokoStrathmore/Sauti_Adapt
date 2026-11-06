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
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import numpy as np
from .audio import decode_wav
from .storage import canonical_uuid, load_manifest, profile_dir, read_private_bytes, write_private_bytes
from .prototype import PrototypeModel, model_content_version
from .encoder import SpeechEncoder
from .release_gate import GatePolicy, assess_release

MIN_TRAIN_PER_CLASS = 3
MIN_VALID_PER_CLASS = 2
MIN_UNKNOWN_VALID = 5
# Margins are selected using calibration data, not fixed in the source.
MARGIN_CANDIDATES = (0.01, 0.03, 0.05, 0.08, 0.10, 0.15, 0.20)


def _language_bucket():
    return {
        'correct': 0, 'rejected': 0, 'incorrect': 0,
        'unknown_false_accepts': 0, 'known_count': 0, 'unknown_count': 0,
    }


def test_predictions(model, known, unknown):
    """Score known items (intent, language, embedding) and unknown items (language, embedding).

    `correct` is an enrolled command accepted as itself. `rejected` was not accepted.
    `incorrect` is a known command accepted as a different command. `unknown_false_accepts`
    is speech enrolled as UNKNOWN that was accepted as a command. These counts are not
    an accuracy claim. Unit tests pass artificial vectors, not human speech.
    """
    confusion = Counter()
    correct = 0
    wrong_accepted = 0
    by_language = {'en-KE': _language_bucket(), 'sw-KE': _language_bucket()}
    by_command = defaultdict(lambda: {'correct': 0, 'rejected': 0, 'incorrect': 0})
    confusion_by_language = defaultdict(Counter)
    for label, language, embedding in known:
        result = model.predict(embedding)
        predicted = result.intent.value if result.status == 'accepted' else 'REJECTED'
        confusion[f'{language}:{label}->{predicted}'] += 1
        confusion_by_language[language][f'{label}->{predicted}'] += 1
        bucket = by_language.setdefault(language, _language_bucket())
        bucket['known_count'] += 1
        command = by_command[f'{label}|{language}']
        if predicted == label:
            correct += 1
            bucket['correct'] += 1
            command['correct'] += 1
        elif predicted != 'REJECTED':
            wrong_accepted += 1
            bucket['incorrect'] += 1
            command['incorrect'] += 1
        else:
            bucket['rejected'] += 1
            command['rejected'] += 1
    unknown_accepts = 0
    for language, embedding in unknown:
        accepted = model.predict(embedding).status == 'accepted'
        bucket = by_language.setdefault(language, _language_bucket())
        bucket['unknown_count'] += 1
        if accepted:
            unknown_accepts += 1
            bucket['unknown_false_accepts'] += 1
    return {
        'known_count': len(known), 'correct_accepted': correct,
        'known_wrong_accepted': wrong_accepted, 'known_rejected': len(known) - correct - wrong_accepted,
        'unknown_count': len(unknown), 'unknown_false_accepts': unknown_accepts,
        'command_acceptance_recall': round(correct / max(len(known), 1), 4),
        'observed_unknown_false_accept_rate': round(unknown_accepts / max(len(unknown), 1), 4),
        'by_language': by_language,
        'by_command_language': {key: dict(value) for key, value in sorted(by_command.items())},
        'confusion_by_language': {lang: dict(counts) for lang, counts in sorted(confusion_by_language.items())},
        'confusion': dict(confusion),
    }


def _unenrolled_activations(metrics, pairs):
    missing = []
    by_command = metrics.get('by_command_language', {})
    for intent, language in pairs:
        row = by_command.get(f'{intent}|{language}', {})
        if row.get('correct', 0) < 1:
            missing.append(f'{intent} in {language}')
    return missing


def run(profile_id: str, calibration_session: str, test_session: str, *, encoder=None, result_kind: str = 'private-session') -> dict:
    started = time.perf_counter()
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
        return {hashlib.sha256(read_private_bytes(Path(e['absolute_path']))).hexdigest() for e in rows}
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
        raw = read_private_bytes(path)
        key = hashlib.sha256((encoder.model_id + '|').encode() + raw).hexdigest()
        cache_path = cache_dir / (key + '.npy')
        if cache_path.is_file():
            return np.load(BytesIO(read_private_bytes(cache_path)), allow_pickle=False)
        v = encoder.embed(decode_wav(raw))
        buffer = BytesIO()
        np.save(buffer, v, allow_pickle=False)
        write_private_bytes(cache_path, buffer.getvalue())
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

    positive = [(e['intent'], e['language'], feature(e)) for e in calibration if e['intent'] != 'UNKNOWN']
    negatives = [(e['language'], feature(e)) for e in calibration if e['intent'] == 'UNKNOWN']
    enrolled = list(zip(labels, languages))
    # Calibration chooses the policy. Test is NEVER used to pick thresholds.
    candidates = []
    best_safe = None
    for margin in MARGIN_CANDIDATES:
        for threshold in np.arange(0.40, 0.995, 0.005):
            version = model_content_version(centroids, labels, languages,
                                            float(threshold), margin, encoder.model_id)
            model = PrototypeModel(centroids, labels, languages, float(threshold),
                                   margin, version, encoder.model_id)
            metrics = test_predictions(model, positive, negatives)
            if metrics['unknown_false_accepts'] or metrics['known_wrong_accepted']:
                continue
            # Prefer coverage, then conservative threshold and margin.
            row = (metrics['correct_accepted'], float(threshold), metrics, model)
            if (best_safe is None or row[0] > best_safe[0]
                    or (row[0] == best_safe[0] and row[1] > best_safe[1])):
                best_safe = row
            if not _unenrolled_activations(metrics, enrolled):
                candidates.append(row)
    if not candidates:
        if best_safe is None:
            raise RuntimeError('No validation threshold prevented false activations; model NOT released.')
        missing = _unenrolled_activations(best_safe[2], enrolled)
        detail = ', '.join(missing) if missing else 'every enrolled command and language'
        raise RuntimeError(f'No validation threshold covered {detail} without a false activation; model NOT released.')
    candidates.sort(key=lambda r: (r[0], r[1]), reverse=True)
    correct, threshold, metrics, model = candidates[0]
    test_positive = [(e['intent'], e['language'], feature(e)) for e in test if e['intent'] != 'UNKNOWN']
    test_negatives = [(e['language'], feature(e)) for e in test if e['intent'] == 'UNKNOWN']
    test_metrics = test_predictions(model, test_positive, test_negatives)
    # Minimum evidence is enforced across calibration and untouched test.
    # No held-out test labels participate in threshold or margin selection.
    import os
    policy = GatePolicy(
        minimum_unknown_count=int(os.environ.get('SAUTI_MIN_UNKNOWN_COUNT', '30')),
        maximum_upper_false_accept_rate=float(os.environ.get('SAUTI_MAX_UNKNOWN_FAR_UPPER', '0.10')),
        weak_evidence=os.environ.get('SAUTI_ALLOW_WEAK_EVIDENCE', '').lower() == 'true',
    )
    missing = _unenrolled_activations(test_metrics, enrolled)
    decision = assess_release(
        len(negatives), metrics['unknown_false_accepts'],
        len(test_negatives), test_metrics['unknown_false_accepts'],
        known_wrong=metrics['known_wrong_accepted'] + test_metrics['known_wrong_accepted'],
        missing_commands=missing, policy=policy,
    )
    if decision.status == 'blocked':
        raise RuntimeError('Voice command evidence gate blocked: ' + decision.reason + ' Model NOT released.')
    # Weak evidence is written for review but never executable by the API.
    model.save(folder, released=decision.executable)
    report = {
        'status': decision.status, 'model_version': model.version,
        'command_execution_authorised': decision.executable,
        'release_evidence': decision.as_dict(),
        'profile_id': profile_id, 'encoder_id': encoder.model_id,
        'threshold': threshold, 'margin': model.margin,
        'calibration_session': calibration_session, 'test_session': test_session,
        'evaluated_at': datetime.now(timezone.utc).isoformat(),
        'training_examples': len(training), 'calibration_examples': len(calibration), 'test_examples': len(test),
        'metrics': {'calibration': metrics, 'test': test_metrics},
        'latency_seconds': round(time.perf_counter() - started, 3),
        'result_kind': result_kind,
        'accuracy_claim': False,
        'warning': 'Small test sets cannot establish a low real-world false activation rate. The Clopper-Pearson upper bound applies only to collected unknown clips. Requires independent co-designer testing.'
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
