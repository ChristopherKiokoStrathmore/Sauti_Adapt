"""Sauti Adapt: private, fail-closed API for enrollment and recognition."""
import hmac
import os
from functools import lru_cache
from fastapi import FastAPI, Depends, File, Form, Header, HTTPException, UploadFile
from .audio import AudioValidationError, decode_wav
from .contracts import Intent, Language, Recognition, reject
from .storage import canonical_uuid, profile_dir, store_enrollment
from .prototype import PrototypeModel

app = FastAPI(title='Sauti Adapt Speech API', version='0.1.0', docs_url=None, redoc_url=None)


def require_token(x_api_key: str | None = Header(default=None)):
    actual = os.environ.get('SAUTI_API_TOKEN', '')
    if not actual:
        raise HTTPException(status_code=503, detail='Server authentication not configured.')
    if not x_api_key or not hmac.compare_digest(x_api_key, actual):
        raise HTTPException(status_code=401, detail='Authentication failed.')


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
    language: Language = Form(...), consent: bool = Form(False)
):
    if os.environ.get('ALLOW_ENROLLMENT') != 'true':
        raise HTTPException(status_code=403, detail='Enrollment disabled on this server.')
    if not consent:
        raise HTTPException(status_code=403, detail='Explicit permission to record and retain this clip is required.')
    try:
        canonical_uuid(profile_id)
        canonical_uuid(session_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    samples = await read_audio(audio)
    recording_id = store_enrollment(profile_id, session_id, intent, language, samples)
    return {'recording_id': recording_id, 'status': 'stored', 'profile_id': canonical_uuid(profile_id)}


@lru_cache(maxsize=1)
def model_encoder():
    from .encoder import SpeechEncoder
    return SpeechEncoder()


@app.post('/v1/recognize', response_model=Recognition, dependencies=[Depends(require_token)])
async def recognize(
    audio: UploadFile = File(...), profile_id: str = Form(...),
    language: Language = Form(Language.KENYAN_ENGLISH)
):
    try:
        canonical_uuid(profile_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    samples = await read_audio(audio)
    mode = os.environ.get('SPEECH_MODE', 'mock')
    if mode != 'prototype':
        return reject('MODEL_NOT_READY: mock mode never executes voice commands.')
    folder = profile_dir(profile_id)
    if not (folder / 'model.json').is_file():
        return reject('NO_VALIDATED_PERSONAL_MODEL')
    try:
        model = PrototypeModel.load(folder)
        encoder = model_encoder()
        if encoder.model_id != model.encoder_id:
            return reject('ENCODER_VERSION_MISMATCH', version=model.version)
        return model.predict(encoder.embed(samples))
    except (ValueError, FileNotFoundError):
        return reject('UNAVAILABLE_OR_INVALID_MODEL')
