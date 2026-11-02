"""Private enrollment storage. Never expose these files through static routes or git."""
import json
import os
import shutil
import threading
from io import BytesIO
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


def _fernet():
    from cryptography.fernet import Fernet
    key = os.environ.get('SAUTI_STORAGE_KEY', '').strip()
    if not key:
        raise RuntimeError('SAUTI_STORAGE_KEY is not set. Refusing to store private files in plaintext.')
    try:
        return Fernet(key.encode('utf-8'))
    except Exception as exc:
        raise RuntimeError('SAUTI_STORAGE_KEY must be a Fernet key.') from exc


def write_private_bytes(path: Path, payload: bytes) -> None:
    path.write_bytes(_fernet().encrypt(payload))
    path.chmod(0o600)


def read_private_bytes(path: Path) -> bytes:
    return _fernet().decrypt(path.read_bytes())


def canonical_uuid(value: str) -> str:
    try:
        return str(UUID(value))
    except (ValueError, AttributeError) as exc:
        raise ValueError('A valid UUID profile or session ID is required.') from exc


def profile_dir(profile_id: str) -> Path:
    return private_root() / 'profiles' / canonical_uuid(profile_id)


def claim_owner(profile_id: str, user_id: str) -> None:
    profile_id = canonical_uuid(profile_id)
    user_id = canonical_uuid(user_id)
    folder = profile_dir(profile_id)
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    owner = folder / 'owner'
    if owner.is_file():
        current = owner.read_text(encoding='utf8').strip()
        if current != user_id:
            raise PermissionError('This profile belongs to another person.')
        return
    owner.write_text(user_id + '\n', encoding='utf8')
    owner.chmod(0o600)


def assert_owner(profile_id: str, user_id: str) -> None:
    profile_id = canonical_uuid(profile_id)
    user_id = canonical_uuid(user_id)
    if not os.environ.get('SAUTI_PRIVATE_DIR', '').strip():
        return
    folder = profile_dir(profile_id)
    if not folder.exists():
        return
    owner = folder / 'owner'
    if not owner.is_file() or owner.read_text(encoding='utf8').strip() != user_id:
        raise PermissionError('This profile belongs to another person.')


def store_enrollment(profile_id: str, session_id: str, intent: Intent, language: Language, samples, session_role: str | None = None, user_id: str | None = None) -> str:
    profile_id = canonical_uuid(profile_id)
    session_id = canonical_uuid(session_id)
    if session_role is not None and session_role not in SESSION_ROLES:
        raise ValueError('session_role must be train, calibration, or test.')
    if not user_id:
        raise ValueError('A user id is required to store a recording.')
    claim_owner(profile_id, user_id)
    folder = profile_dir(profile_id)
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
    buffer = BytesIO()
    encode_private_wav(samples, buffer)
    line = json.dumps(record, ensure_ascii=False) + '\n'
    with _lock:
        write_private_bytes(path, buffer.getvalue())
        _store_manifest(folder, _manifest_text(folder) + line)
    return recording_id


def _manifest_text(folder: Path) -> str:
    path = folder / 'manifest.jsonl'
    if not path.is_file():
        return ''
    return read_private_bytes(path).decode('utf8')


def _store_manifest(folder: Path, text: str) -> None:
    write_private_bytes(folder / 'manifest.jsonl', text.encode('utf8'))


def load_manifest(profile_id: str, user_id: str | None = None):
    if user_id:
        assert_owner(profile_id, user_id)
    folder = profile_dir(profile_id)
    path = folder / 'manifest.jsonl'
    if not path.exists():
        raise ValueError('No recordings found for this profile.')
    result = []
    for line in _manifest_text(folder).splitlines():
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


def delete_recording(profile_id: str, recording_id: str, user_id: str) -> dict:
    assert_owner(profile_id, user_id)
    profile_id = canonical_uuid(profile_id)
    recording_id = canonical_uuid(recording_id)
    folder = profile_dir(profile_id)
    manifest = folder / 'manifest.jsonl'
    if not manifest.is_file():
        return {'deleted': False, 'recordings_removed': 0}
    kept = []
    removed = 0
    with _lock:
        for line in _manifest_text(folder).splitlines():
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
        _store_manifest(folder, ('\n'.join(kept) + '\n') if kept else '')
    return {'deleted': removed > 0, 'recordings_removed': removed}


def purge_expired(profile_id: str, user_id: str) -> int:
    """Delete clips older than SAUTI_RETENTION_DAYS (default 30). Returns how many were removed."""
    import time
    try:
        days = int(os.environ.get('SAUTI_RETENTION_DAYS', '30'))
    except ValueError:
        days = 30
    days = max(1, days)
    assert_owner(profile_id, user_id)
    folder = profile_dir(profile_id)
    manifest = folder / 'manifest.jsonl'
    if not manifest.is_file():
        return 0
    cutoff = time.time() - days * 86400
    kept = []
    removed = 0
    with _lock:
        for line in _manifest_text(folder).splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            recording_id = row.get('recording_id', '')
            audio = folder / 'audio' / f'{recording_id}.wav'
            if audio.is_file() and audio.stat().st_mtime < cutoff:
                audio.unlink()
                removed += 1
                continue
            kept.append(line)
        _store_manifest(folder, ('\n'.join(kept) + '\n') if kept else '')
    return removed


def delete_profile(profile_id: str, user_id: str) -> dict:
    assert_owner(profile_id, user_id)
    folder = profile_dir(profile_id)
    if not folder.exists():
        return {'deleted': False, 'recordings_removed': 0}
    with _lock:
        removed = len(list(folder.rglob('*.wav')))
        shutil.rmtree(folder)
    return {'deleted': True, 'recordings_removed': removed}
