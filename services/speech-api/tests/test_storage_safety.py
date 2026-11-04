"""Safety regressions for consented voice retention and released models."""
import os
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest

from sauti_ml.contracts import Intent, Language
from sauti_ml.storage import (
    assert_owner, delete_recording, profile_dir, purge_expired_folder,
    store_enrollment,
)


def test_missing_private_storage_fails_closed(monkeypatch):
    monkeypatch.delenv('SAUTI_PRIVATE_DIR', raising=False)
    with pytest.raises(RuntimeError, match='SAUTI_PRIVATE_DIR'):
        assert_owner(str(uuid4()), str(uuid4()))


def test_shallow_railway_layout_uses_app_root_without_index_error(monkeypatch):
    from sauti_ml import storage
    # Railway installs only the service, e.g. /app/sauti_ml/storage.py.
    monkeypatch.setattr(storage, '__file__', '/app/sauti_ml/storage.py')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', '/data/sauti-private')
    assert storage.repo_root() == Path('/app')
    assert storage.private_root() == Path('/data/sauti-private')
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', '/app/participant-recordings')
    with pytest.raises(RuntimeError, match='outside the git repository'):
        storage.private_root()


def test_withdrawn_clip_invalidates_model_release(monkeypatch, tmp_path):
    from cryptography.fernet import Fernet
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('SAUTI_STORAGE_KEY', Fernet.generate_key().decode())
    user, profile, session = (str(uuid4()) for _ in range(3))
    samples = np.zeros(16000, dtype=np.float32)
    clip = store_enrollment(profile, session, Intent.SCROLL_DOWN, Language.KENYAN_ENGLISH,
                            samples, 'train', user, retention_days=30)
    folder = profile_dir(profile)
    release = folder / 'evaluation.json'
    release.write_text('{"status":"pilot-validation-passed"}')
    result = delete_recording(profile, clip, user)
    assert result['deleted'] is True
    assert not release.exists()
    assert not (folder / 'audio' / f'{clip}.wav').exists()


def test_expired_clip_invalidates_model_release(monkeypatch, tmp_path):
    from cryptography.fernet import Fernet
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    monkeypatch.setenv('SAUTI_STORAGE_KEY', Fernet.generate_key().decode())
    user, profile, session = (str(uuid4()) for _ in range(3))
    clip = store_enrollment(profile, session, Intent.SCROLL_DOWN, Language.KENYAN_ENGLISH,
                            np.zeros(16000, dtype=np.float32), 'train', user, retention_days=1)
    folder = profile_dir(profile)
    release = folder / 'evaluation.json'
    release.write_text('{"status":"pilot-validation-passed"}')
    audio = folder / 'audio' / f'{clip}.wav'
    old = audio.stat().st_mtime - 3 * 86400
    os.utime(audio, (old, old))
    assert purge_expired_folder(folder) == 1
    assert not release.exists()
