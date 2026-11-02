"""Per-user credentials, rate limits, origin checks, and audit lines.

Audit lines never include audio, tokens, transcripts, or IP addresses.
"""
import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timezone
from fastapi import HTTPException, Request

_windows: dict[str, list[float]] = {}


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


def verify_user(user_id: str, token: str) -> bool:
    expected = accounts().get(user_id)
    if not expected or not token:
        return False
    actual = hashlib.sha256(token.encode('utf-8')).hexdigest()
    return hmac.compare_digest(expected, actual)


def rate_limit(bucket: str) -> None:
    try:
        limit = int(os.environ.get('SAUTI_RATE_LIMIT_PER_MINUTE', '30'))
    except ValueError:
        limit = 30
    limit = max(1, limit)
    now = time.monotonic()
    window = _windows.setdefault(bucket, [])
    window[:] = [stamp for stamp in window if now - stamp < 60]
    if len(window) >= limit:
        raise HTTPException(status_code=429, detail='Too many requests.')
    window.append(now)


def reset_rate_limits() -> None:
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
