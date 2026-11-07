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
import re
from pathlib import Path
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


# Browser extensions use stable 32-character Chrome IDs.
# Origin checks are not authentication: every extension request still needs
# the participant's own verified token.
EXTENSION_ORIGIN_PATTERN = re.compile(r"^chrome-extension://[a-p]{32}$")
EXTENSION_API_PATHS = frozenset({
    '/v1/extension/agent/plan',
    '/v1/extension/compare',
    '/v1/extension/config',
})


def is_allowed_extension_origin(origin: str, path: str) -> bool:
    return path in EXTENSION_API_PATHS and bool(EXTENSION_ORIGIN_PATTERN.fullmatch(origin))


def origin_allowed(request: Request) -> None:
    origin = request.headers.get('origin')
    if not origin:
        return
    if is_allowed_extension_origin(origin, request.url.path):
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

def provisioned_accounts() -> dict[str, str]:
    """Read durable token digests only. Never store plaintext participant tokens."""
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


def create_participant_account() -> tuple[str, str]:
    """Generate independent, unpredictable credentials on durable private storage."""
    import secrets
    from uuid import uuid4
    from .storage import private_root
    root = private_root()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = root / 'participant_accounts.json'
    with _lock:
        existing = provisioned_accounts()
        user_id = str(uuid4())
        token = secrets.token_urlsafe(32)
        digest = token_digest(token)
        if not digest:
            raise RuntimeError('Token pepper is not configured.')
        existing[user_id] = digest
        from .storage import write_private_bytes
        # Account records contain only HMAC digests, but protect them with strict file permissions.
        from tempfile import NamedTemporaryFile
        with NamedTemporaryFile(mode='w', dir=root, prefix='.accounts-', delete=False, encoding='utf8') as temp:
            json.dump(existing, temp)
            temp_path = Path(temp.name)
        temp_path.chmod(0o600)
        os.replace(temp_path, path)
    return user_id, token
