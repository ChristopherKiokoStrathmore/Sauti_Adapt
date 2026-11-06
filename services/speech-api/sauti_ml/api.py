"""Sauti Adapt: private, fail-closed API for enrollment and recognition."""
import hmac
import json
import os
import threading
from contextlib import asynccontextmanager
from functools import lru_cache
from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from .audio import AudioValidationError, decode_wav
from .auth import audit, create_participant_account, fail_pair_locked, note_auth_failure, note_ip_attempt, origin_allowed, trusted_client_ip, verify_user
from .contracts import Intent, Language, Recognition, reject
from .prototype import PrototypeModel
from .storage import assert_owner, canonical_uuid, delete_profile, delete_recording, profile_dir, purge_expired, purge_expired_profiles, store_enrollment

_retention_stop = threading.Event()


def _purge_interval_seconds() -> int:
    try:
        return max(30, int(os.environ.get('SAUTI_PURGE_INTERVAL_SECONDS', '3600')))
    except ValueError:
        return 3600


def _retention_loop() -> None:
    while not _retention_stop.wait(_purge_interval_seconds()):
        try:
            purge_expired_profiles()
        except Exception:
            pass


@asynccontextmanager
async def lifespan(_app):
    try:
        purge_expired_profiles()
    except Exception:
        pass
    _retention_stop.clear()
    threading.Thread(target=_retention_loop, name='sauti-retention', daemon=True).start()
    yield
    _retention_stop.set()


app = FastAPI(title='Sauti Adapt Speech API', version='0.1.0', docs_url=None, redoc_url=None, lifespan=lifespan)
MAX_REQUEST_BYTES = 2_500_000


@app.middleware('http')
async def limit_request_size(request: Request, call_next):
    length = request.headers.get('content-length')
    if length and length.isdigit() and int(length) > MAX_REQUEST_BYTES:
        return JSONResponse({'detail': 'Request is too large.'}, status_code=413)
    return await call_next(request)


def require_token(x_api_key: str | None = Header(default=None)):
    actual = os.environ.get('SAUTI_API_TOKEN', '')
    if not actual:
        raise HTTPException(status_code=503, detail='Server authentication not configured.')
    if not x_api_key or not hmac.compare_digest(x_api_key, actual):
        raise HTTPException(status_code=401, detail='Authentication failed.')


def require_user(
    request: Request,
    x_sauti_user: str | None = Header(default=None),
    x_sauti_user_token: str | None = Header(default=None),
) -> str:
    origin_allowed(request)
    claimed = (x_sauti_user or '').strip()
    token = x_sauti_user_token or ''
    peer = trusted_client_ip(request)
    note_ip_attempt(peer)
    try:
        user_id = canonical_uuid(claimed)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if fail_pair_locked(user_id, peer):
        raise HTTPException(status_code=429, detail='Too many requests.')
    if not token or not verify_user(user_id, token):
        note_auth_failure(user_id, peer)
        audit('auth', 'unauthorized')
        raise HTTPException(status_code=401, detail='Authentication failed.')
    return user_id


async def read_audio(audio: UploadFile):
    if audio.content_type not in ('audio/wav', 'audio/x-wav', 'audio/wave', 'application/octet-stream'):
        raise HTTPException(status_code=415, detail='Use 16-bit WAV audio.')
    payload = await audio.read(2_000_001)
    try:
        return decode_wav(payload)
    except AudioValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get('/health')
def health():
    return {'status': 'ok', 'mode': os.environ.get('SPEECH_MODE', 'mock'), 'enrollment_enabled': os.environ.get('ALLOW_ENROLLMENT') == 'true'}


@app.post('/v1/participants', dependencies=[Depends(require_token)])
def create_participant(
    request: Request,
    age: int = Body(..., ge=18, le=120),
    consent: bool = Body(False),
    terms_version: str = Body(''),
):
    """Issue an account only after explicit adult self-attestation and consent.

    The age and consent are validated in both API layers, never stored here.
    A pilot still needs genuine age verification and guardian workflows for minors.
    """
    from .auth import _consume, _configured_limit
    if not consent or terms_version != os.environ.get('SAUTI_TERMS_VERSION', '2026-11-v1'):
        raise HTTPException(status_code=403, detail='Current voice terms and consent are required.')
    if os.environ.get('SAUTI_AUTO_PROVISION') != 'true':
        raise HTTPException(status_code=403, detail='Automatic enrollment is not enabled.')
    if os.environ.get('SAUTI_REQUIRE_TERMS') != 'true' or not os.environ.get('SAUTI_PRIVACY_CONTACT'):
        raise HTTPException(status_code=503, detail='Voice privacy safeguards are not configured.')
    _consume('provision:' + trusted_client_ip(request), _configured_limit('SAUTI_PROVISION_RATE_LIMIT_PER_MINUTE', 3))
    try:
        user_id, token = create_participant_account()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail='Account storage is not available.') from exc
    from uuid import uuid4
    audit('participant', 'created', user_id)
    return JSONResponse({'user_id': user_id, 'token': token, 'profile_id': str(uuid4())}, headers={'cache-control': 'no-store'})


@app.post('/v1/session/revoke', dependencies=[Depends(require_token)])
def revoke_session(user_id: str = Depends(require_user)):
    """Revoke a participant token in durable private storage."""
    from .auth import revoke_user
    try:
        changed = revoke_user(user_id)
    except (RuntimeError, OSError):
        raise HTTPException(status_code=503, detail='Unable to revoke participant access.')
    if not changed:
        raise HTTPException(status_code=404, detail='Participant account not found.')
    audit('session', 'revoked', user_id)
    return {'status': 'revoked'}


@app.get('/v1/readiness', dependencies=[Depends(require_token)])
def readiness():
    """Authenticated configuration audit; never return secrets or participant data.

    This is a preflight, not proof that audio uploads, model inference, or
    retention work. A mounted path alone does not prove durable storage.
    """
    private_dir = os.environ.get('SAUTI_PRIVATE_DIR', '').strip()
    storage_root = os.environ.get('RAILWAY_VOLUME_MOUNT_PATH', '').strip()
    storage_mounted = bool(
        private_dir and storage_root and
        os.path.commonpath((os.path.abspath(private_dir), os.path.abspath(storage_root)))
        == os.path.abspath(storage_root)
    )
    checks = {
        'api_auth_configured': bool(os.environ.get('SAUTI_API_TOKEN', '').strip()),
        'user_token_pepper_configured': bool(os.environ.get('SAUTI_TOKEN_PEPPER', '').strip()),
        'encrypted_storage_key_configured': bool(os.environ.get('SAUTI_STORAGE_KEY', '').strip()),
        'private_storage_configured': bool(private_dir),
        'railway_volume_path_configured': storage_mounted,
        'terms_enforced': os.environ.get('SAUTI_REQUIRE_TERMS') == 'true',
        'privacy_contact_configured': bool(os.environ.get('SAUTI_PRIVACY_CONTACT', '').strip()),
        'terms_version_configured': bool(os.environ.get('SAUTI_TERMS_VERSION', '').strip()),
    }
    ready = all(checks.values())
    return {
        'status': 'configured' if ready else 'configuration_incomplete',
        'checks': checks,
        'speech_mode': os.environ.get('SPEECH_MODE', 'mock'),
        'enrollment_enabled': os.environ.get('ALLOW_ENROLLMENT') == 'true',
        'comparison_enabled': os.environ.get('SAUTI_COMPARE_ENABLED') == 'true',
        'note': 'Configuration only; run a consented test recording to verify durable storage.',
    }


@app.post('/v1/enroll', dependencies=[Depends(require_token)])
async def enroll(
    audio: UploadFile = File(...), profile_id: str = Form(...),
    session_id: str = Form(...), intent: Intent = Form(...),
    language: Language = Form(...), consent: bool = Form(False),
    session_role: str | None = Form(default=None),
    tone: str | None = Form(default=None),
    retention_days: int | None = Form(default=None),
    terms_version: str | None = Form(default=None),
    improvement_consent: bool = Form(False),
    user_id: str = Depends(require_user),
):
    if os.environ.get('ALLOW_ENROLLMENT') != 'true':
        audit('enroll', 'disabled', user_id, profile_id)
        raise HTTPException(status_code=403, detail='Enrollment disabled on this server.')
    if not consent:
        audit('enroll', 'no-consent', user_id, profile_id)
        raise HTTPException(status_code=403, detail='Explicit permission to record and retain this clip is required.')
    if os.environ.get('SAUTI_REQUIRE_TERMS') == 'true':
        if not os.environ.get('SAUTI_PRIVACY_CONTACT', '').strip():
            raise HTTPException(status_code=503, detail='Pilot privacy contact is not configured.')
        if terms_version != os.environ.get('SAUTI_TERMS_VERSION', '2026-11-v1'):
            audit('enroll', 'invalid-terms', user_id, profile_id)
            raise HTTPException(status_code=403, detail='Current voice-data terms must be accepted before enrollment.')
    try:
        canonical_uuid(profile_id)
        canonical_uuid(session_id)
        assert_owner(profile_id, user_id)
        purge_expired(profile_id, user_id)
        samples = await read_audio(audio)
        recording_id = store_enrollment(profile_id, session_id, intent, language, samples, session_role or None, user_id,
                                        tone=tone or None, retention_days=retention_days, terms_version=terms_version or None,
                                        improvement_consent=improvement_consent)
    except PermissionError as exc:
        audit('enroll', 'forbidden', user_id, profile_id)
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    audit('enroll', 'stored', user_id, profile_id)
    return {'recording_id': recording_id, 'status': 'stored', 'profile_id': canonical_uuid(profile_id)}



@app.post('/v1/compare', dependencies=[Depends(require_token)])
async def compare_only(
    audio: UploadFile = File(...), profile_id: str = Form(...),
    language: str = Form('en-KE'), model: str = Form('all'),
    expected_intent: Intent | None = Form(default=None),
    reference: str = Form(''),
    compare_consent: bool = Form(False),
    user_id: str = Depends(require_user),
):
    """Experimental comparison: no audio persistence and NO Controller actions."""
    if os.environ.get('SAUTI_COMPARE_ENABLED') != 'true':
        raise HTTPException(status_code=403, detail='Cloud model comparison is not enabled.')
    if not compare_consent:
        raise HTTPException(status_code=403, detail='Explicit model comparison permission is required.')
    if os.environ.get('SAUTI_REQUIRE_TERMS') == 'true' and not os.environ.get('SAUTI_PRIVACY_CONTACT', '').strip():
        raise HTTPException(status_code=503, detail='Pilot privacy contact is not configured.')
    if model not in ('prototype', 'english', 'swahili', 'personalized_english', 'personalized_swahili', 'all') or language not in ('en-KE', 'sw-KE', 'mixed'):
        raise HTTPException(status_code=422, detail='Unknown model or language setting.')
    if (model == 'personalized_english' and language != 'en-KE') or (model == 'personalized_swahili' and language != 'sw-KE'):
        raise HTTPException(status_code=422, detail='The personalized model requires its matching language.')
    if len(reference) > 280:
        raise HTTPException(status_code=422, detail='Reference text too long.')
    try:
        canonical_uuid(profile_id)
        assert_owner(profile_id, user_id)
        samples = await read_audio(audio)
        from fastapi.concurrency import run_in_threadpool
        from .compare import compare_models
        # Dedicated speech host needed. Vercel never loads model weights.
        return await run_in_threadpool(compare_models, samples, profile_id, model,
                                       language, expected_intent.value if expected_intent else None, reference)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail='Speech comparison service unavailable.') from exc


@app.delete('/v1/profile/{profile_id}', dependencies=[Depends(require_token)])
def remove_profile(profile_id: str, user_id: str = Depends(require_user)):
    """Withdrawal: delete every clip and model for this profile. Works even when enrollment is off."""
    try:
        result = delete_profile(profile_id, user_id)
    except PermissionError as exc:
        audit('delete-profile', 'forbidden', user_id, profile_id)
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    audit('delete-profile', 'deleted' if result.get('deleted') else 'absent', user_id, profile_id)
    return result


@app.delete('/v1/profile/{profile_id}/recordings/{recording_id}', dependencies=[Depends(require_token)])
def remove_recording(profile_id: str, recording_id: str, user_id: str = Depends(require_user)):
    try:
        result = delete_recording(profile_id, recording_id, user_id)
    except PermissionError as exc:
        audit('delete-recording', 'forbidden', user_id, profile_id)
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    audit('delete-recording', 'deleted' if result.get('deleted') else 'absent', user_id, profile_id)
    return result


@lru_cache(maxsize=1)
def model_encoder():
    from .encoder import SpeechEncoder
    return SpeechEncoder()


@app.post('/v1/recognize', response_model=Recognition, dependencies=[Depends(require_token)])
async def recognize(
    audio: UploadFile = File(...), profile_id: str = Form(...),
    language: Language = Form(Language.KENYAN_ENGLISH),
    user_id: str = Depends(require_user),
):
    try:
        canonical_uuid(profile_id)
        assert_owner(profile_id, user_id)
    except PermissionError as exc:
        audit('recognize', 'forbidden', user_id, profile_id)
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    samples = await read_audio(audio)
    mode = os.environ.get('SPEECH_MODE', 'mock')
    if mode != 'prototype':
        audit('recognize', 'rejected', user_id, profile_id)
        return reject('MODEL_NOT_READY: mock mode never executes voice commands.')
    folder = profile_dir(profile_id)
    if not (folder / 'model.json').is_file():
        audit('recognize', 'rejected', user_id, profile_id)
        return reject('NO_VALIDATED_PERSONAL_MODEL')
    try:
        model = PrototypeModel.load(folder)
        release_path = folder / 'evaluation.json'
        if not release_path.is_file():
            raise ValueError('Model has no release record.')
        release = json.loads(release_path.read_text(encoding='utf8'))
        if not isinstance(release, dict):
            raise ValueError('Model release record is invalid.')
        expected = model.content_version()
        if (release.get('status') != 'pilot-validation-passed'
                or release.get('model_version') != expected
                or model.version != expected):
            raise ValueError('Model was not released by training.')
        encoder = model_encoder()
        if encoder.model_id != model.encoder_id:
            audit('recognize', 'rejected', user_id, profile_id)
            return reject('ENCODER_VERSION_MISMATCH', version=model.version)
        result = model.predict(encoder.embed(samples))
    except (ValueError, FileNotFoundError):
        audit('recognize', 'rejected', user_id, profile_id)
        return reject('UNAVAILABLE_OR_INVALID_MODEL')
    audit('recognize', result.status, user_id, profile_id)
    return result
