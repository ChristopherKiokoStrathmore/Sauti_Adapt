"""One local experiment with consented encrypted recordings and untouched sessions."""
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
from uuid import uuid4

from .core import MODELS, SERVICE
from sauti_ml.audio import decode_wav
from sauti_ml.contracts import Intent, Language
from sauti_ml.storage import delete_profile, load_manifest, store_enrollment

COMMANDS = ('SCROLL_DOWN', 'SCROLL_UP', 'GO_BACK')


def save_settings(path, settings):
    path.write_text(json.dumps(settings, indent=2), encoding='utf8')
    path.chmod(0o600)


def open_experiment():
    from cryptography.fernet import Fernet
    folder = Path(os.environ.get('SAUTI_LAB_DIR', str(Path.home() / 'SautiAdaptLab'))).expanduser().resolve()
    repo = SERVICE.parents[1]
    if folder == repo or repo in folder.parents:
        raise ValueError('SAUTI_LAB_DIR must be outside the repository.')
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = folder / 'settings.json'
    if not path.exists():
        settings = {
            'storage_key': Fernet.generate_key().decode(), 'user_id': str(uuid4()),
            'profile_id': str(uuid4()),
            'sessions': {role: str(uuid4()) for role in ('train', 'calibration', 'test')},
            'test_used': False, 'uploads': [],
        }
        save_settings(path, settings)
    else:
        settings = json.loads(path.read_text(encoding='utf8'))
    Fernet(settings['storage_key'].encode())
    # This standalone process has its own profile, separate from any deployed service.
    os.environ['SAUTI_PRIVATE_DIR'] = str(folder / 'private')
    os.environ['SAUTI_STORAGE_KEY'] = settings['storage_key']
    return path, settings


def entries(settings):
    try:
        return load_manifest(settings['profile_id'], settings['user_id'])
    except ValueError as exc:
        if str(exc) == 'No recordings found for this profile.':
            return []
        raise


def enroll(path, settings, payload, role, intent, language, consent):
    if not consent:
        raise ValueError('Consent is required before retaining a recording.')
    if settings['test_used']:
        raise ValueError('This experiment is closed. Reset it before collecting a new experiment.')
    if role not in settings['sessions']:
        raise ValueError('Choose train, calibration, or test.')
    fingerprint = hashlib.sha256(payload).hexdigest()
    if fingerprint in settings['uploads']:
        raise ValueError('This recording was already stored. Record a fresh utterance.')
    samples = decode_wav(payload)
    store_enrollment(settings['profile_id'], settings['sessions'][role], Intent(intent),
                     Language(language), samples, session_role=role, user_id=settings['user_id'])
    settings['uploads'].append(fingerprint)
    save_settings(path, settings)


def readiness(settings):
    rows = entries(settings)
    counts = Counter((r['session_id'], r['intent'], r['language']) for r in rows)
    languages = sorted({r['language'] for r in rows}) or ['en-KE']
    table = []
    ready = True
    for language in languages:
        for intent in (*COMMANDS, 'UNKNOWN'):
            row = {'Language': language, 'Command': intent}
            for role, minimum in (('train', 3), ('calibration', 2), ('test', 2)):
                minimum = (0 if role == 'train' else 5) if intent == 'UNKNOWN' else minimum
                value = counts[settings['sessions'][role], intent, language]
                row[role] = f'{value} / {minimum}'
                ready &= value >= minimum
            table.append(row)
    return bool(ready), table


def train_once(path, settings):
    if settings['test_used']:
        raise ValueError('The test session has already been used. Start a fresh experiment.')
    ready, _ = readiness(settings)
    if not ready:
        raise ValueError('Complete the recording counts before training.')
    from sauti_ml.encoder import SpeechEncoder
    from sauti_ml.train import run
    # Download before consuming the test; a failed download does not spend a test session.
    encoder = SpeechEncoder(MODELS['prototype'].model_id)
    settings['test_used'] = True
    save_settings(path, settings)
    return run(settings['profile_id'], settings['sessions']['calibration'],
               settings['sessions']['test'], encoder=encoder)


def reset_experiment(path, settings):
    delete_profile(settings['profile_id'], settings['user_id'])
    settings.update(profile_id=str(uuid4()),
                    sessions={role: str(uuid4()) for role in ('train', 'calibration', 'test')},
                    test_used=False, uploads=[])
    save_settings(path, settings)
