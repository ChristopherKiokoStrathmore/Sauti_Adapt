"""Sauti Adapt: private, fail-closed API for enrollment and recognition."""
import hmac
import json
import os
import threading
from contextlib import asynccontextmanager
from functools import lru_cache
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from .audio import AudioValidationError, decode_wav
from .auth import audit, fail_pair_locked, note_auth_failure, note_ip_attempt, origin_allowed, trusted_client_ip, verify_user
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
