import io
import os
import shutil
import struct
import subprocess
import sys
import wave

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import audio_input  # noqa: E402
from audio_input import (  # noqa: E402
    MAX_UPLOAD_BYTES,
    AudioInputError,
    ffmpeg_command,
    has_container_signature,
    prepare_audio,
    trim_partial_sample,
)

RATE = 16_000
LIMITS = {"sample_rate": RATE, "min_samples": 4_800, "max_seconds": 120}


def raw_float32(seconds: float, value: float = 0.1) -> bytes:
    return struct.pack("<%df" % int(seconds * RATE), *([value] * int(seconds * RATE)))


def wav_bytes(seconds: float, rate: int = 48_000, channels: int = 2) -> bytes:
    frames = int(seconds * rate)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(struct.pack("<h", 3000) * frames * channels)
    return buffer.getvalue()


class FakeRunner:
    """Stands in for subprocess.run; records calls and returns fixed output."""

    def __init__(self, stdout=b"", returncode=0, raises=None):
        self.stdout, self.returncode, self.raises = stdout, returncode, raises
        self.calls = []

    def __call__(self, command, **kwargs):
        self.calls.append(command)
        if self.raises:
            raise self.raises
        return subprocess.CompletedProcess(command, self.returncode, self.stdout, b"")


# Raw float32 fast path

def test_raw_float32_passes_through_without_ffmpeg():
    runner = FakeRunner()
    audio = raw_float32(1)
    assert prepare_audio("application/octet-stream", audio, runner=runner, **LIMITS) == audio
    assert runner.calls == []


def test_raw_float32_trailing_partial_sample_is_dropped():
    audio = raw_float32(1)
    assert prepare_audio("application/octet-stream", audio + b"\x01\x02\x03", runner=FakeRunner(), **LIMITS) == audio


def test_content_type_parameters_and_case_are_ignored():
    audio = raw_float32(1)
    runner = FakeRunner()
    assert prepare_audio("Application/Octet-Stream; charset=binary", audio, runner=runner, **LIMITS) == audio
    assert runner.calls == []


def test_raw_float32_over_120_seconds_is_rejected():
    with pytest.raises(AudioInputError) as error:
        prepare_audio("application/octet-stream", raw_float32(121), runner=FakeRunner(), **LIMITS)
    assert error.value.status == 413


def test_raw_float32_under_minimum_is_rejected():
    with pytest.raises(AudioInputError) as error:
        prepare_audio("application/octet-stream", raw_float32(0.1), runner=FakeRunner(), **LIMITS)
    assert error.value.status == 413


# Routing to ffmpeg

@pytest.mark.parametrize("content_type", ["audio/wav", "audio/mpeg", "audio/mp4", "audio/webm",
                                          "video/webm", "audio/ogg", "application/ogg", None, ""])
def test_other_content_types_are_decoded(content_type):
    runner = FakeRunner(stdout=raw_float32(1))
    assert prepare_audio(content_type, b"encoded-audio", runner=runner, **LIMITS) == raw_float32(1)
    assert len(runner.calls) == 1


def test_octet_stream_with_wav_header_is_decoded_not_treated_as_raw():
    runner = FakeRunner(stdout=raw_float32(1))
    prepare_audio("application/octet-stream", wav_bytes(1), runner=runner, **LIMITS)
    assert len(runner.calls) == 1


@pytest.mark.parametrize("head", [
    b"RIFF\x00\x00\x00\x00WAVE", b"ID3\x04", b"OggS", b"fLaC", b"\x1a\x45\xdf\xa3",
    b"\x00\x00\x00\x20ftypM4A ", b"#!AMR\n", b"FORM\x00\x00\x00\x00AIFF",
])
def test_container_signatures_are_recognised(head):
    assert has_container_signature(head + b"\x00" * 16)


def test_raw_float32_audio_is_not_mistaken_for_a_container():
    assert not has_container_signature(raw_float32(1))
    assert not has_container_signature(struct.pack("<4f", -0.5, 0.25, 0.0, 1.0))


# Rejections

@pytest.mark.parametrize("content_type", ["multipart/form-data; boundary=x", "text/plain",
                                          "application/json", "application/x-www-form-urlencoded"])
def test_non_audio_bodies_are_rejected_with_guidance(content_type):
    runner = FakeRunner()
    with pytest.raises(AudioInputError) as error:
        prepare_audio(content_type, b"anything", runner=runner, **LIMITS)
    assert error.value.status == 415
    assert "binary" in error.value.detail
    assert runner.calls == []


def test_empty_body_is_rejected():
    with pytest.raises(AudioInputError) as error:
        prepare_audio("audio/wav", b"", runner=FakeRunner(), **LIMITS)
    assert error.value.status == 413


def test_oversized_upload_is_rejected_before_decoding(monkeypatch):
    # Shrink the limit so the test does not allocate hundreds of MB.
    monkeypatch.setattr(audio_input, "MAX_UPLOAD_BYTES", 1024)
    runner = FakeRunner()
    with pytest.raises(AudioInputError) as error:
        prepare_audio("audio/wav", b"\x00" * 1025, runner=runner, **LIMITS)
    assert error.value.status == 413
    assert runner.calls == []


def test_upload_limit_allows_long_recordings():
    # 30 min of 48 kHz stereo 16-bit WAV (~345 MB) must fit.
    assert MAX_UPLOAD_BYTES >= 30 * 60 * 48_000 * 2 * 2


@pytest.mark.parametrize("head", [b"RIFF\x00\x00\x00\x00AVI ", b"FLV\x01", b"wvpk", b".snd"])
def test_more_container_signatures_are_recognised(head):
    assert has_container_signature(head + b"\x00" * 16)


def test_undecodable_audio_returns_415_without_ffmpeg_output():
    runner = FakeRunner(returncode=1)
    with pytest.raises(AudioInputError) as error:
        prepare_audio("audio/mpeg", b"not audio", runner=runner, **LIMITS)
    assert error.value.status == 415


def test_decode_timeout_returns_415():
    runner = FakeRunner(raises=subprocess.TimeoutExpired("ffmpeg", 60))
    with pytest.raises(AudioInputError) as error:
        prepare_audio("audio/mpeg", b"slow", runner=runner, **LIMITS)
    assert error.value.status == 415


def test_decoded_audio_over_limit_is_rejected():
    runner = FakeRunner(stdout=raw_float32(121))
    with pytest.raises(AudioInputError) as error:
        prepare_audio("audio/wav", b"long", runner=runner, **LIMITS)
    assert error.value.status == 413


def test_missing_ffmpeg_is_a_server_error_not_a_client_error():
    with pytest.raises(RuntimeError):
        prepare_audio("audio/wav", b"x", runner=FakeRunner(raises=FileNotFoundError()), **LIMITS)


def test_temporary_upload_file_is_deleted():
    seen = []

    def runner(command, **kwargs):
        path = command[command.index("-i") + 1]
        seen.append(path)
        assert os.path.exists(path)
        return subprocess.CompletedProcess(command, 0, raw_float32(1), b"")

    prepare_audio("audio/wav", b"encoded", runner=runner, **LIMITS)
    assert seen and not os.path.exists(seen[0])


def test_ffmpeg_command_restricts_inputs_and_output_format():
    command = ffmpeg_command("/tmp/x", 16_000, 120)
    assert command[command.index("-protocol_whitelist") + 1] == "file"
    formats = command[command.index("-format_whitelist") + 1].split(",")
    assert "hls" not in formats and "concat" not in formats
    assert command[command.index("-ar") + 1] == "16000"
    assert command[command.index("-ac") + 1] == "1"
    assert command[command.index("-f") + 1] == "f32le"
    assert command[command.index("-t") + 1] == "121"


def test_trim_partial_sample():
    assert trim_partial_sample(b"12345678") == b"12345678"
    assert trim_partial_sample(b"1234567") == b"1234"
    assert trim_partial_sample(b"") == b""


# Real ffmpeg (skipped when it is not installed; CI installs it)

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


@needs_ffmpeg
def test_real_ffmpeg_decodes_48k_stereo_wav_to_16k_mono():
    samples = prepare_audio("audio/wav", wav_bytes(1.0), **LIMITS)
    assert abs(len(samples) // 4 - RATE) <= 160      # within 10 ms of one second


@needs_ffmpeg
def test_real_ffmpeg_decodes_wav_sent_as_octet_stream():
    samples = prepare_audio("application/octet-stream", wav_bytes(1.0, rate=8_000, channels=1), **LIMITS)
    assert abs(len(samples) // 4 - RATE) <= 160


@needs_ffmpeg
def test_real_ffmpeg_rejects_wav_longer_than_limit():
    with pytest.raises(AudioInputError) as error:
        prepare_audio("audio/wav", wav_bytes(122, rate=8_000, channels=1), **LIMITS)
    assert error.value.status == 413


@needs_ffmpeg
def test_real_ffmpeg_rejects_garbage():
    with pytest.raises(AudioInputError) as error:
        prepare_audio("audio/mpeg", b"definitely not an mp3 file" * 100, **LIMITS)
    assert error.value.status == 415


@needs_ffmpeg
def test_real_ffmpeg_accepts_audio_longer_than_old_two_minute_limit():
    samples = prepare_audio("audio/wav", wav_bytes(150, rate=8_000, channels=1),
                            sample_rate=RATE, min_samples=4_800, max_seconds=30 * 60)
    assert abs(len(samples) // 4 - 150 * RATE) <= 160


def test_mpeg_ts_is_recognised_by_its_packet_sync_bytes():
    packets = (b"\x47" + b"\x00" * 187) * 4
    assert has_container_signature(packets)
    assert not has_container_signature(b"\x47" + b"\x00" * 700)   # one sync byte is not enough
