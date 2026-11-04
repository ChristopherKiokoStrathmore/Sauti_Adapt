"""Private enrollment storage. Never expose these files through static routes or git."""
import hashlib
import json
import os
import shutil
import threading
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from uuid import UUID, uuid4
from .contracts import Intent, Language
from .audio import encode_private_wav

_lock = threading.Lock()
SESSION_ROLES = frozenset({'train', 'calibration', 'test'})


def repo_root() -> Path:
    """Locate the source root in development and the app root in Railway.

    Railway deploys services/speech-api as /app/sauti_ml, so indexing
    parents[3] is not valid in that shallower production layout.
    """
    module_path = Path(__file__).resolve()
    for parent in module_path.parents:
        if (parent / 'services' / 'speech-api' / 'sauti_ml').is_dir():
            return parent
    # Isolated service deployment: /app/sauti_ml/storage.py -> /app.
    return module_path.parent.parent


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


def discard_clip_derivatives(folder: Path, raw: bytes) -> None:
    """Remove cached embeddings of this clip. The released prototype model is kept until profile deletion."""
    cache = folder / 'feature-cache'
    if not cache.is_dir() or not raw:
        return
    model_id = os.environ.get('SAUTI_ENCODER_ID', 'facebook/wav2vec2-base').strip() or 'facebook/wav2vec2-base'
    name = hashlib.sha256((model_id + '|').encode() + raw).hexdigest() + '.npy'
    path = cache / name
    if path.is_file():
        path.unlink()


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
    # Missing storage configuration must not silently bypass ownership checks.
    folder = profile_dir(profile_id)
    if not folder.exists():
        return
    owner = folder / 'owner'
    if not owner.is_file() or owner.read_text(encoding='utf8').strip() != user_id:
        raise PermissionError('This profile belongs to another person.')


TONES = ('neutral', 'happy', 'frustrated', 'tired', 'excited')


def store_enrollment(profile_id: str, session_id: str, intent: Intent, language: Language, samples, session_role: str | None = None, user_id: str | None = None, *, tone: str | None = None, retention_days: int | None = None, terms_version: str | None = None, improvement_consent: bool = False) -> str:
    profile_id = canonical_uuid(profile_id)
    session_id = canonical_uuid(session_id)
    if session_role is not None and session_role not in SESSION_ROLES:
        raise ValueError('session_role must be train, calibration, or test.')
    if not user_id:
        raise ValueError('A user id is required to store a recording.')
    if tone is not None and tone not in TONES:
        raise ValueError('tone must be one of: ' + ', '.join(TONES) + '.')
    if retention_days is not None and not (1 <= retention_days <= max_retention_days()):
        raise ValueError(f'retention_days must be between 1 and {max_retention_days()}.')
    if terms_version is not None and not (1 <= len(terms_version) <= 40):
        raise ValueError('terms_version must be 1 to 40 characters.')
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
    if tone:
        record['tone'] = tone
    if retention_days:
        record['retention_days'] = retention_days
    if terms_version:
        record['terms_version'] = terms_version
        record['consented_at'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
        record['improvement_consent'] = improvement_consent
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


def invalidate_released_model(folder: Path) -> None:
    """Fail closed after a training clip is withdrawn or expires.

    Previously released prototypes can encode information from deleted speech.
    Invalidate the release record immediately; a new evaluation is required.
    """
    release = folder / 'evaluation.json'
    if release.is_file():
        release.unlink()


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
                    try:
                        discard_clip_derivatives(folder, read_private_bytes(audio))
                    except Exception:
                        pass
                    audio.unlink()
                invalidate_released_model(folder)
                invalidate_released_model(folder)
                removed += 1
                continue
            kept.append(line)
        _store_manifest(folder, ('\n'.join(kept) + '\n') if kept else '')
    return {'deleted': removed > 0, 'recordings_removed': removed}


def max_retention_days() -> int:
    """Upper bound on a person's chosen retention. Default 365 days."""
    try:
        days = int(os.environ.get('SAUTI_MAX_RETENTION_DAYS', '365'))
    except ValueError:
        days = 365
    return max(1, days)


def _row_retention_days(row: dict) -> int:
    chosen = row.get('retention_days')
    if isinstance(chosen, int) and not isinstance(chosen, bool) and 1 <= chosen <= max_retention_days():
        return chosen
    return retention_days()


def retention_days() -> int:
    try:
        days = int(os.environ.get('SAUTI_RETENTION_DAYS', '30'))
    except ValueError:
        days = 30
    return max(1, days)


def purge_expired_folder(folder: Path) -> int:
    """Delete expired clips, cached embeddings and the model release record."""
    import time
    manifest = folder / 'manifest.jsonl'
    if not manifest.is_file():
        return 0
    now = time.time()
    kept = []
    removed = 0
    with _lock:
        for line in _manifest_text(folder).splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            recording_id = row.get('recording_id', '')
            audio = folder / 'audio' / f'{recording_id}.wav'
            if audio.is_file() and audio.stat().st_mtime < now - _row_retention_days(row) * 86400:
                try:
                    discard_clip_derivatives(folder, read_private_bytes(audio))
                except Exception:
                    pass
                audio.unlink()
                invalidate_released_model(folder)
                removed += 1
                continue
            kept.append(line)
        _store_manifest(folder, ('\n'.join(kept) + '\n') if kept else '')
    return removed


def purge_expired_profiles() -> int:
    """Sweep every profile. Safe to call repeatedly and from a background thread."""
    if not os.environ.get('SAUTI_PRIVATE_DIR', '').strip():
        return 0
    try:
        root = private_root() / 'profiles'
    except RuntimeError:
        return 0
    if not root.is_dir():
        return 0
    removed = 0
    for child in list(root.iterdir()):
        if not child.is_dir():
            continue
        try:
            canonical_uuid(child.name)
        except ValueError:
            continue
        removed += purge_expired_folder(child)
    return removed


def purge_expired(profile_id: str, user_id: str) -> int:
    """Delete this owner's expired clips. Ownership is checked before any file is removed."""
    assert_owner(profile_id, user_id)
    return purge_expired_folder(profile_dir(profile_id))


def delete_profile(profile_id: str, user_id: str) -> dict:
    assert_owner(profile_id, user_id)
    folder = profile_dir(profile_id)
    if not folder.exists():
        return {'deleted': False, 'recordings_removed': 0}
    with _lock:
        removed = len(list(folder.rglob('*.wav')))
        shutil.rmtree(folder)
    return {'deleted': True, 'recordings_removed': removed}
