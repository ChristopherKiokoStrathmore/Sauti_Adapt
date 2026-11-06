"""Conservative deployment checks with generated silent WAV, never participant data.

By default this tool reads only health and readiness. Optional speech and
disposable account tests require explicit flags and environment credentials.
It does not log tokens, cookies, transcripts, request bodies or PII.
"""
from __future__ import annotations

import argparse
from io import BytesIO
import json
import os
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from uuid import uuid4
import wave


def validate_endpoint(url: str) -> str:
    address = urlsplit(url)
    if address.username is not None or address.password is not None:
        raise ValueError("Credentials must not be part of URLs.")
    if address.query or address.fragment or address.path not in ("", "/"):
        raise ValueError("Use a service origin, without path, query or fragment.")
    if not address.hostname or not address.netloc:
        raise ValueError("Invalid service URL.")
    if address.scheme == "https":
        return url.rstrip("/")
    if address.scheme == "http" and address.hostname in ("localhost", "127.0.0.1", "::1"):
        return url.rstrip("/")
    raise ValueError("An HTTPS service URL is required outside localhost.")


def make_silent_wav() -> bytes:
    """Create non-speech test input; not a recognition accuracy benchmark."""
    output = BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\0\0" * 16000)
    return output.getvalue()


def require_rejected_mock(result: dict) -> None:
    if result.get("status") != "rejected" or result.get("intent") != "UNKNOWN":
        raise RuntimeError("Mock recognition unexpectedly authorised a command.")


def _call(url: str, method="GET", *, key=None, user=None, personal_token=None,
          body=None, content_type=None) -> dict:
    headers = {"Accept": "application/json"}
    if key:
        headers["x-api-key"] = key
    if user:
        headers["x-sauti-user"] = user
    if personal_token:
        headers["x-sauti-user-token"] = personal_token
    if content_type:
        headers["content-type"] = content_type
    request = Request(url, method=method, headers=headers, data=body)
    with urlopen(request, timeout=20) as response:
        if response.status < 200 or response.status > 299:
            raise RuntimeError("Smoke test HTTP status is not successful.")
        result = json.loads(response.read(100_000))
        if not isinstance(result, dict):
            raise RuntimeError("Invalid JSON object from speech API.")
        return result


def _multipart(fields: dict[str, str], wav_bytes: bytes) -> tuple[bytes, str]:
    boundary = "sauti-smoke-" + uuid4().hex
    chunks: list[bytes] = []
    for key, value in fields.items():
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode(),
            str(value).encode("utf-8"), b"\r\n",
        ])
    chunks.extend([
        f"--{boundary}\r\n".encode(),
        b'Content-Disposition: form-data; name="audio"; filename="silence.wav"\r\n',
        b"Content-Type: audio/wav\r\n\r\n", wav_bytes, b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ])
    return b"".join(chunks), "multipart/form-data; boundary=" + boundary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--mock-recognition", action="store_true")
    args = parser.parse_args()
    origin = validate_endpoint(args.url)
    # Only values in environment, never command-line secrets.
    key = os.environ.get("SAUTI_API_TOKEN", "").strip()
    if not key:
        raise SystemExit("Set SAUTI_API_TOKEN in your private environment.")
    health = _call(origin + "/health")
    if health.get("status") != "ok":
        raise SystemExit("FAIL: speech API health is not OK.")
    print("PASS: service health")

    ready = _call(origin + "/v1/readiness", key=key)
    if ready.get("status") not in ("configured", "configuration_incomplete"):
        raise SystemExit("FAIL: unknown readiness response.")
    print("Readiness:", ready.get("status"))

    if args.mock_recognition:
        if health.get("mode") != "mock":
            raise SystemExit("Refusing mock test against a real recogniser.")
        user = os.environ.get("SAUTI_TEST_USER_ID", "")
        token = os.environ.get("SAUTI_TEST_USER_TOKEN", "")
        if not user or not token:
            raise SystemExit("Set disposable test user credentials in the environment.")
        body, content_type = _multipart({
            "profile_id": str(uuid4()), "language": "en-KE",
        }, make_silent_wav())
        result = _call(origin + "/v1/recognize", method="POST",
                       key=key, user=user, personal_token=token,
                       body=body, content_type=content_type)
        require_rejected_mock(result)
        print("PASS: mock recognition rejected generated silence")

    print("NOT VERIFIED: participant recognition, enrolment, deletion, purge and GPU inference")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
