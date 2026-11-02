"""Private enrollment storage. Never expose these files through static routes or git."""
import json
import os
import shutil
import threading
from pathlib import Path
from uuid import UUID, uuid4
from .contracts import Intent, Language
from .audio import encode_private_wav

_lock = threading.Lock()
SESSION_ROLES = frozenset({'train', 'calibration', 'test'})


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def private_root() -> Path:
    raw = os.environ.get('SAUTI_PRIVATE_DIR', '').strip()
    if not raw:
        raise RuntimeError('SAUTI_PRIVATE_DIR is not set. Refusing to write inside the repository.')
    path = Path(raw).expanduser().resolve()
    root = repo_root()
    if path == root or root in path.parents:
        raise RuntimeError('SAUTI_PRIVATE_DIR must be outside the git repository.')
    return path


def canonical_uuid(value: str) -> str:
    try:
        return str(UUID(value))
    except (ValueError, AttributeError) as exc:
        raise ValueError('A valid UUID profile or session ID is required.') from exc


def profile_dir(profile_id: str) -> Path:
    return private_root() / 'profiles' / canonical_uuid(profile_id)


def store_enrollment(profile_id: str, session_id: str, intent: Intent, language: Language, samples, session_role: str | None = None) -> str:
    profile_id = canonical_uuid(profile_id)
    session_id = canonical_uuid(session_id)
    if session_role is not None and session_role not in SESSION_ROLES:
        raise ValueError('session_role must be train, calibration, or test.')
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
    if session_role:
        record['session_role'] = session_role
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


def delete_recording(profile_id: str, recording_id: str) -> dict:
    profile_id = canonical_uuid(profile_id)
    recording_id = canonical_uuid(recording_id)
    folder = profile_dir(profile_id)
    manifest = folder / 'manifest.jsonl'
    if not manifest.is_file():
        return {'deleted': False, 'recordings_removed': 0}
    kept = []
    removed = 0
    with _lock:
        for line in manifest.read_text(encoding='utf8').splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get('recording_id') == recording_id:
                audio = folder / 'audio' / f'{recording_id}.wav'
                if audio.is_file():
                    audio.unlink()
                removed += 1
                continue
            kept.append(line)
        manifest.write_text(('\n'.join(kept) + '\n') if kept else '', encoding='utf8')
    return {'deleted': removed > 0, 'recordings_removed': removed}


def delete_profile(profile_id: str) -> dict:
    folder = profile_dir(profile_id)
    if not folder.exists():
        return {'deleted': False, 'recordings_removed': 0}
    with _lock:
        removed = len(list(folder.rglob('*.wav')))
        shutil.rmtree(folder)
    return {'deleted': True, 'recordings_removed': removed}
