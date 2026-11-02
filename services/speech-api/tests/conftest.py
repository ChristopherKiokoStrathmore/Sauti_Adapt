import hashlib
import json
import sys
from pathlib import Path
import pytest
from cryptography.fernet import Fernet

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

USER_ID = '11111111-1111-4111-8111-111111111111'
USER_TOKEN = 'test-user-token'


@pytest.fixture(autouse=True)
def security_defaults(monkeypatch):
    monkeypatch.setenv('SAUTI_STORAGE_KEY', Fernet.generate_key().decode())
    digest = hashlib.sha256(USER_TOKEN.encode('utf-8')).hexdigest()
    monkeypatch.setenv('SAUTI_ACCOUNTS', json.dumps({USER_ID: digest}))
    from sauti_ml.auth import reset_rate_limits
    reset_rate_limits()
