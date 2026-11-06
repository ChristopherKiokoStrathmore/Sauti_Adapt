"""SQLite account persistence and token revocation characterisation.

Tests use generated credentials and temporary private storage only.
"""
import sqlite3
from sauti_ml.auth import create_participant_account, verify_user, revoke_user


def test_account_creation_uses_durable_sqlite_not_rewritten_json(monkeypatch, tmp_path):
    monkeypatch.setenv("SAUTI_PRIVATE_DIR", str(tmp_path))
    monkeypatch.setenv("SAUTI_TOKEN_PEPPER", "test-independent-pepper")
    user, token = create_participant_account()
    assert verify_user(user, token)
    db = tmp_path / "participant_accounts.sqlite3"
    assert db.is_file()
    assert not (tmp_path / "participant_accounts.json").exists()
    assert token.encode() not in db.read_bytes()
    with sqlite3.connect(db) as connection:
        assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_revoke_blocks_current_and_subsequent_tokens(monkeypatch, tmp_path):
    monkeypatch.setenv("SAUTI_PRIVATE_DIR", str(tmp_path))
    monkeypatch.setenv("SAUTI_TOKEN_PEPPER", "another-private-pepper")
    user, token = create_participant_account()
    assert revoke_user(user) is True
    assert verify_user(user, token) is False
    assert revoke_user(user) is False


def test_revocation_survives_legacy_json_fallback(monkeypatch, tmp_path):
    import json
    from sauti_ml.auth import token_digest
    monkeypatch.setenv("SAUTI_PRIVATE_DIR", str(tmp_path))
    monkeypatch.setenv("SAUTI_TOKEN_PEPPER", "pepper")
    user = "11111111-1111-4111-8111-111111111111"
    token = "legacy-test-token"
    (tmp_path / "participant_accounts.json").write_text(
        json.dumps({user: token_digest(token)}), encoding="utf8"
    )
    assert verify_user(user, token)
    assert revoke_user(user)
    assert verify_user(user, token) is False



def test_revoke_http_route_requires_active_user_token(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from sauti_ml.api import app
    monkeypatch.setenv("SAUTI_PRIVATE_DIR", str(tmp_path))
    monkeypatch.setenv("SAUTI_API_TOKEN", "private-service-auth")
    monkeypatch.setenv("SAUTI_TOKEN_PEPPER", "http-test-pepper")
    user, token = create_participant_account()
    headers = {
        "x-api-key": "private-service-auth",
        "x-sauti-user": user,
        "x-sauti-user-token": token,
    }
    client = TestClient(app)
    assert client.post("/v1/session/revoke").status_code == 401
    response = client.post("/v1/session/revoke", headers=headers)
    assert response.status_code == 200
    assert response.json() == {"status": "revoked"}
    assert not verify_user(user, token)
    assert client.post("/v1/session/revoke", headers=headers).status_code == 401
