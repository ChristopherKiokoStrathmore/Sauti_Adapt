"""Turn an uploaded audio body into raw 16 kHz mono float32 for Whisper.

Kept free of Modal, FastAPI and numpy imports so it can be unit tested in CI.

Two input paths:
  - Raw float32 (Content-Type: application/octet-stream, no container
    signature): passed through as-is. This is what the Sauti speech API sends.
  - Anything else (WAV, MP3, M4A/AAC, OGG/Opus, WebM, FLAC, AIFF, AMR, any
    sample rate or channel count): decoded with ffmpeg to 16 kHz mono
    float32. Files labelled application/octet-stream are also decoded when
    their first bytes show a known container (Postman often sends WAV that way).

Audio is transient: decoded files live in a private temporary directory that
is deleted as soon as ffmpeg finishes.
"""
from __future__ import annotations

import os
import subprocess
import tempfile

RAW_FLOAT32_TYPE = "application/octet-stream"
MAX_UPLOAD_BYTES = 500 * 1024 * 1024   # encoded upload; 30 min of 48 kHz stereo 24-bit WAV is ~520 MB
DECODE_TIMEOUT_SECONDS = 300
# Real audio/video containers only (video files are accepted; their first
# audio track is used). Deliberately excludes playlist, concat, image and
# device demuxers (hls, concat, image2, lavfi, ...) that could make ffmpeg
# read other files.
FFMPEG_FORMATS = ",".join((
    "wav", "w64", "rf64", "mp3", "mp2", "flac", "ogg", "matroska", "webm", "mov", "mp4",
    "m4a", "3gp", "aac", "ac3", "eac3", "aiff", "caf", "amr", "amrnb", "amrwb", "asf",
    "avi", "flv", "mpeg", "mpegts", "wv", "ape", "tta", "au", "voc", "dsf", "mpc",
    "mpc8", "spx", "gsm",
))
# Content types that are clearly not an audio file body.
REJECTED_TYPE_PREFIXES = ("text/", "application/json", "application/x-www-form-urlencoded", "multipart/")


class AudioInputError(Exception):
    """A client error with the HTTP status the endpoint should return."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def media_type(content_type: str | None) -> str:
    return (content_type or "").split(";")[0].strip().lower()


def has_container_signature(data: bytes) -> bool:
    """True when the bytes start like a known audio container, not raw samples.

    Only multi-byte signatures are used: a short pattern such as the MP3 frame
    sync (0xFFEx) can occur by chance at the start of raw float32 audio.
    """
    head = data[:12]
    # MPEG-TS has no header: a 0x47 sync byte starts every 188-byte packet.
    if len(data) >= 3 * 188 and data[0] == data[188] == data[376] == 0x47:
        return True
    return (
        (head[:4] == b"RIFF" and head[8:12] in (b"WAVE", b"RF64"))
        or head[:4] in (b"RF64", b"OggS", b"fLaC", b"FORM", b"caff", b"\x1a\x45\xdf\xa3")
        or head[:3] == b"ID3"
        or head[4:8] == b"ftyp"                 # MP4 / M4A / 3GP
        or head[:5] == b"#!AMR"
        or head[:4] == b"\x30\x26\xb2\x75"      # ASF / WMA
        or (head[:4] == b"RIFF" and head[8:12] == b"AVI ")
        or head[:3] == b"FLV"
        or head[:4] in (b"wvpk", b"MAC ", b"TTA1", b".snd", b"MPCK")
    )


def trim_partial_sample(data: bytes) -> bytes:
    """Drop 1-3 trailing bytes so the body is whole float32 samples."""
    return data[: len(data) - len(data) % 4]


def ffmpeg_command(input_path: str, sample_rate: int, max_seconds: float) -> list[str]:
    # One second past the limit so over-long audio can be detected and
    # rejected, while still bounding the decoded output size.
    return [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
        "-protocol_whitelist", "file",
        "-format_whitelist", FFMPEG_FORMATS,
        "-i", input_path,
        "-map", "0:a:0", "-vn", "-sn", "-dn",
        "-ac", "1", "-ar", str(sample_rate),
        "-t", str(max_seconds + 1),
        "-f", "f32le", "pipe:1",
    ]


def decode_with_ffmpeg(data: bytes, sample_rate: int, max_seconds: float,
                       timeout: float = DECODE_TIMEOUT_SECONDS, runner=subprocess.run) -> bytes:
    # A temporary file rather than a pipe: M4A files from phones often keep
    # their index at the end, which ffmpeg cannot read from a pipe.
    with tempfile.TemporaryDirectory(prefix="sauti-audio-") as tmp:
        path = os.path.join(tmp, "upload")
        with open(path, "wb") as handle:
            handle.write(data)
        try:
            completed = runner(ffmpeg_command(path, sample_rate, max_seconds),
                               capture_output=True, timeout=timeout, check=False)
        except subprocess.TimeoutExpired:
            raise AudioInputError(415, "Audio took too long to decode.") from None
        except FileNotFoundError:
            raise RuntimeError("ffmpeg is not installed in the API image.") from None
    if completed.returncode != 0 or not completed.stdout:
        # ffmpeg's stderr can echo file metadata, so it is not returned or logged.
        raise AudioInputError(
            415, "Could not decode audio. Send a common audio or video file (WAV, MP3, "
                 "M4A/AAC, OGG/Opus, WebM, FLAC, AIFF, AMR, WMA, MP4, MKV, AVI, ...) or raw "
                 "16 kHz mono float32 (application/octet-stream).")
    return completed.stdout


def prepare_audio(content_type: str | None, data: bytes, *, sample_rate: int,
                  min_samples: int, max_seconds: float, runner=subprocess.run) -> bytes:
    """Return raw little-endian float32 mono samples at sample_rate.

    Raises AudioInputError with 413 (size/length) or 415 (format).
    """
    kind = media_type(content_type)
    if kind.startswith(REJECTED_TYPE_PREFIXES):
        raise AudioInputError(
            415, "Send the audio file itself as the request body (Postman: Body > binary), "
                 "not form data or text.")
    if not data:
        raise AudioInputError(413, "Audio body is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise AudioInputError(413, f"Upload is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")

    if kind == RAW_FLOAT32_TYPE and not has_container_signature(data):
        samples = trim_partial_sample(data)
    else:
        samples = decode_with_ffmpeg(data, sample_rate, max_seconds, runner=runner)
        samples = trim_partial_sample(samples)

    count = len(samples) // 4
    if count > max_seconds * sample_rate:
        raise AudioInputError(413, f"Audio is longer than {max_seconds:g} seconds.")
    if count < min_samples:
        raise AudioInputError(413, f"Audio is shorter than {min_samples / sample_rate:g} seconds.")
    return samples
