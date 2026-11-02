"""Local hackathon-only private storage. Never expose these files through static routes."""
import json
import os
import threading
from pathlib import Path
from uuid import UUID, uuid4
from .contracts import Intent, Language
from .audio import encode_private_wav

_lock = threading.Lock()


def private_root() -> Path:
    return Path(os.environ.get('SAUTI_PRIVATE_DIR', './private')).resolve()


def canonical_uuid(value: str) -> str:
    try:
        return str(UUID(value))
    except (ValueError, AttributeError) as exc:
        raise ValueError('A valid UUID profile or session ID is required.') from exc


def profile_dir(profile_id: str) -> Path:
    return private_root() / 'profiles' / canonical_uuid(profile_id)


def store_enrollment(profile_id: str, session_id: str, intent: Intent, language: Language, samples) -> str:
    profile_id = canonical_uuid(profile_id)
    session_id = canonical_uuid(session_id)
    folder = profile_dir(profile_id)
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    recording_id = str(uuid4())
    path = folder / 'audio' / (recording_id + '.wav')
    path.parent.mkdir(mode=0o700, exist_ok=True)
    record = {
        'recording_id': recording_id,
        'file': str(path.relative_to(folder)),
        'session_id': session_id,
        'intent': intent.value,
        'language': language.value,
        'consent': True,
    }
    with _lock:
        encode_private_wav(samples, path)
        with (folder / 'manifest.jsonl').open('a', encoding='utf8') as f:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')
    return recording_id


def load_manifest(profile_id: str):
    folder = profile_dir(profile_id)
    path = folder / 'manifest.jsonl'
    if not path.exists():
        raise ValueError('No recordings found for this profile.')
    result = []
    for line in path.read_text(encoding='utf8').splitlines():
        r = json.loads(line)
        if not r.get('consent'):
            continue
        # Paths are created by us, but still revalidate that no external path is read.
        name = r.get('recording_id', '')
        if str(UUID(name)) != name:
            raise ValueError('Invalid recording ID in manifest.')
        r['absolute_path'] = folder / 'audio' / (name + '.wav')
        result.append(r)
    return result
