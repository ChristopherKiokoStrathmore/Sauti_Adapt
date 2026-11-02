"""Sauti Adapt: private, fail-closed API for enrollment and recognition."""
import hmac
import json
import os
from functools import lru_cache
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from .audio import AudioValidationError, decode_wav
from .auth import audit, origin_allowed, rate_limit, verify_user
from .contracts import Intent, Language, Recognition, reject
from .prototype import PrototypeModel
from .storage import assert_owner, canonical_uuid, delete_profile, delete_recording, profile_dir, purge_expired, store_enrollment

app = FastAPI(title='Sauti Adapt Speech API', version='0.1.0', docs_url=None, redoc_url=None)
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
    if not x_sauti_user or not x_sauti_user_token or not verify_user(x_sauti_user, x_sauti_user_token):
        audit('auth', 'unauthorized')
        raise HTTPException(status_code=401, detail='Authentication failed.')
    try:
        user_id = canonical_uuid(x_sauti_user)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    rate_limit(user_id)
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
    user_id: str = Depends(require_user),
):
    if os.environ.get('ALLOW_ENROLLMENT') != 'true':
        audit('enroll', 'disabled', user_id, profile_id)
        raise HTTPException(status_code=403, detail='Enrollment disabled on this server.')
    if not consent:
        audit('enroll', 'no-consent', user_id, profile_id)
        raise HTTPException(status_code=403, detail='Explicit permission to record and retain this clip is required.')
    try:
        canonical_uuid(profile_id)
        canonical_uuid(session_id)
        purge_expired(profile_id)
        samples = await read_audio(audio)
        recording_id = store_enrollment(profile_id, session_id, intent, language, samples, session_role or None, user_id)
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
        assert_owner(profile_id, user_id)
        result = delete_profile(profile_id)
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
        assert_owner(profile_id, user_id)
        result = delete_recording(profile_id, recording_id)
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
        if release.get('status') != 'pilot-validation-passed' or release.get('model_version') != model.version:
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
