"""Per-user credentials, rate limits, origin checks, and audit lines.

Audit lines never include audio, tokens, transcripts, or IP addresses.

Rate limits live in memory in this process:
* `fail:{user-uuid}|{ip}` counts failed password checks only, and only for a
  canonical user UUID. It is checked before verify, so a locked pair is refused
  with 429 for both wrong and right tokens. Failures from one IP do not lock
  that person out from another IP. Successful requests do not increment it.
* `ip:{address}` counts every attempt, success or failure. Its limit is looser.
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
import sqlite3
import threading
import time
from datetime import datetime, timezone
from fastapi import HTTPException, Request

_windows: dict[str, list[float]] = {}
_lock = threading.Lock()
_MAX_BUCKETS = 4096
_CLIENT_IP_HEADER = 'x-sauti-client-ip'


def accounts() -> dict[str, str]:
    raw = os.environ.get('SAUTI_ACCOUNTS', '').strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {str(user): str(digest) for user, digest in parsed.items()}


def token_digest(token: str) -> str:
    """HMAC-SHA256 of a personal token. The pepper stays on the server.

    Raw SHA-256 is only safe for tokens with at least 128 bits of randomness.
    The documented generator used a placeholder string, so the stored value is
    an HMAC keyed by SAUTI_TOKEN_PEPPER instead.
    """
    pepper = os.environ.get('SAUTI_TOKEN_PEPPER', '').strip()
    if not pepper or not token:
        return ''
    return hmac.new(pepper.encode('utf-8'), token.encode('utf-8'), hashlib.sha256).hexdigest()


def verify_user(user_id: str, token: str) -> bool:
    if is_revoked(user_id):
        return False
    expected = accounts().get(user_id) or provisioned_accounts().get(user_id)
    actual = token_digest(token)
    if not expected or not actual:
        return False
    return hmac.compare_digest(expected, actual)


def _configured_limit(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        value = default
    return max(1, value)


def _fresh(stamps: list[float], now: float) -> list[float]:
    return [stamp for stamp in stamps if now - stamp < 60]


def _prune(now: float) -> None:
    stale = [key for key, stamps in _windows.items() if not _fresh(stamps, now)]
    for key in stale:
        del _windows[key]
    if len(_windows) <= _MAX_BUCKETS:
        return
    oldest = sorted(_windows, key=lambda key: _windows[key][-1] if _windows[key] else 0)
    for key in oldest[:len(_windows) - _MAX_BUCKETS]:
        del _windows[key]


def api_key_matches(presented: str | None) -> bool:
    actual = os.environ.get('SAUTI_API_TOKEN', '')
    if not actual or not presented:
        return False
    return hmac.compare_digest(presented, actual)


def trusted_client_ip(request: Request) -> str:
    """Use the proxy-supplied client IP only together with a valid server API key."""
    if api_key_matches(request.headers.get('x-api-key')):
        forwarded = (request.headers.get(_CLIENT_IP_HEADER) or '').split(',')[0].strip()
        if forwarded:
            return forwarded[:80]
    host = request.client.host if request.client and request.client.host else 'unknown'
    return host[:80]


def note_ip_attempt(ip: str) -> None:
    _consume(f'ip:{ip}', _configured_limit('SAUTI_IP_RATE_LIMIT_PER_MINUTE', 120))


def fail_pair_locked(user_id: str, ip: str) -> bool:
    now = time.monotonic()
    with _lock:
        _prune(now)
        stamps = _fresh(_windows.get(f'fail:{user_id}|{ip}', []), now)
        return len(stamps) >= _configured_limit('SAUTI_AUTH_FAIL_LIMIT_PER_MINUTE', 10)


def note_auth_failure(user_id: str, ip: str) -> None:
    now = time.monotonic()
    with _lock:
        _prune(now)
        key = f'fail:{user_id}|{ip}'
        stamps = _fresh(_windows.get(key, []), now)
        stamps.append(now)
        _windows[key] = stamps


def rate_limit_bucket_count() -> int:
    with _lock:
        return len(_windows)


def _consume(bucket: str, limit: int) -> None:
    now = time.monotonic()
    with _lock:
        _prune(now)
        stamps = _fresh(_windows.get(bucket, []), now)
        if len(stamps) >= limit:
            _windows[bucket] = stamps
            raise HTTPException(status_code=429, detail='Too many requests.')
        stamps.append(now)
        _windows[bucket] = stamps


def reset_rate_limits() -> None:
    with _lock:
        _windows.clear()


def origin_allowed(request: Request) -> None:
    origin = request.headers.get('origin')
    if not origin:
        return
    allowed = [item.strip() for item in os.environ.get('SAUTI_ALLOWED_ORIGINS', '').split(',') if item.strip()]
    if origin not in allowed:
        raise HTTPException(status_code=403, detail='Origin is not allowed.')


def audit(event: str, outcome: str, user_id: str | None = None, profile_id: str | None = None) -> None:
    record = {
        'time': datetime.now(timezone.utc).isoformat(),
        'event': event,
        'outcome': outcome,
        'user': hashlib.sha256(user_id.encode('utf-8')).hexdigest()[:12] if user_id else None,
        'profile': hashlib.sha256(profile_id.encode('utf-8')).hexdigest()[:12] if profile_id else None,
    }
    line = json.dumps(record, separators=(',', ':'))
    try:
        from .storage import private_root
        folder = private_root()
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        path = folder / 'audit.log'
        with path.open('a', encoding='utf8') as handle:
            handle.write(line + '\n')
        path.chmod(0o600)
    except Exception:
        print(line, flush=True)

def _database():
    """Use a private SQLite database with WAL for concurrent provisioning."""
    from .storage import private_root
    root = private_root()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = root / 'participant_accounts.sqlite3'
    connection = sqlite3.connect(path, timeout=30.0)
    try:
        connection.execute('PRAGMA journal_mode=WAL')
        connection.execute('PRAGMA busy_timeout=30000')
        connection.execute('''
            CREATE TABLE IF NOT EXISTS accounts (
                user_id TEXT PRIMARY KEY,
                digest TEXT NOT NULL,
                revoked INTEGER NOT NULL DEFAULT 0
            )
        ''')
        connection.execute('''
            CREATE TABLE IF NOT EXISTS revocations (
                user_id TEXT PRIMARY KEY,
                revoked_at TEXT NOT NULL
            )
        ''')
        connection.commit()
        path.chmod(0o600)
        return connection
    except Exception:
        connection.close()
        raise


def _legacy_accounts() -> dict[str, str]:
    """Read existing accounts for migration; never rewrite the legacy JSON."""
    from .storage import private_root
    try:
        path = private_root() / 'participant_accounts.json'
    except RuntimeError:
        return {}
    if not path.is_file():
        return {}
    try:
        parsed = json.loads(path.read_text(encoding='utf8'))
        return parsed if isinstance(parsed, dict) else {}
    except (OSError, ValueError):
        return {}


def is_revoked(user_id: str) -> bool:
    try:
        with _database() as connection:
            if connection.execute(
                'SELECT 1 FROM revocations WHERE user_id = ?', (user_id,)
            ).fetchone():
                return True
            row = connection.execute(
                'SELECT revoked FROM accounts WHERE user_id = ?', (user_id,)
            ).fetchone()
            return bool(row and row[0])
    except RuntimeError:
        return False


def provisioned_accounts() -> dict[str, str]:
    """Read active SQLite account digests with read-only legacy compatibility."""
    try:
        with _database() as connection:
            active = dict(connection.execute(
                'SELECT user_id, digest FROM accounts WHERE revoked = 0 '
                'AND user_id NOT IN (SELECT user_id FROM revocations)'
            ).fetchall())
            revoked = {row[0] for row in connection.execute(
                'SELECT user_id FROM revocations'
            ).fetchall()}
        legacy = _legacy_accounts()
        return {**{k: v for k, v in legacy.items() if k not in revoked}, **active}
    except RuntimeError:
        return {}


def revoke_user(user_id: str) -> bool:
    """Invalidate tokens for this account, including legacy and env accounts."""
    from .storage import canonical_uuid
    user_id = canonical_uuid(user_id)
    with _database() as connection:
        if connection.execute(
            'SELECT 1 FROM revocations WHERE user_id = ?', (user_id,)
        ).fetchone():
            return False
        stored = connection.execute(
            'SELECT 1 FROM accounts WHERE user_id = ?', (user_id,)
        ).fetchone()
        if not stored and user_id not in _legacy_accounts() and user_id not in accounts():
            return False
        connection.execute(
            'INSERT INTO revocations (user_id, revoked_at) VALUES (?, ?)',
            (user_id, datetime.now(timezone.utc).isoformat()),
        )
        connection.execute(
            'UPDATE accounts SET revoked = 1 WHERE user_id = ?', (user_id,)
        )
        connection.commit()
    return True


def create_participant_account() -> tuple[str, str]:
    """Provision a random token digest in SQLite without whole-file rewriting."""
    import secrets
    from uuid import uuid4
    user_id = str(uuid4())
    token = secrets.token_urlsafe(32)
    digest = token_digest(token)
    if not digest:
        raise RuntimeError('Token pepper is not configured.')
    with _database() as connection:
        connection.execute(
            'INSERT INTO accounts (user_id, digest, revoked) VALUES (?, ?, 0)',
            (user_id, digest),
        )
        connection.commit()
    return user_id, token
