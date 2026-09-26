"""#1943 — a context-free surface must not attach a stage-specific hint.

A macOS mlx-audio text-to-speech failure came back as a 500 reading "… The
connection to the video server dropped mid-download (often a transient
CDN/network blip …)". No video was involved. VIDEO_DOWNLOAD_NETWORK triggers
on bare phrases like "timed out" and "connection reset", so any unrelated
failure whose message contains one is handed a confidently wrong remediation.

failure._CONTEXT_FREE_HINT_CLASSES already existed for this, and its own
comment names VIDEO_DOWNLOAD_NETWORK as the class that must never appear on a
context-free surface. Only append_hint honoured it; public_exception_response
replaced append_hint on the 500 path without carrying the rule across.
"""
import pytest

from core.failure import _CONTEXT_FREE_HINT_CLASSES, classify
from core.public_errors import public_exception_response, stream_generation_failure

# Phrases that really do classify as the video-download class but say nothing
# about a video when they arrive from a model load or a synthesis run.
_GENERIC_NETWORK_WORDING = [
    "operation timed out",
    "connection reset by peer",
    "broken pipe",
    "remote end closed connection without response",
]


@pytest.mark.parametrize("message", _GENERIC_NETWORK_WORDING)
def test_no_video_hint_on_a_context_free_failure(message):
    assert classify(message) == "VIDEO_DOWNLOAD_NETWORK"  # still classified...
    payload = public_exception_response(RuntimeError(message), fallback="Internal error.")
    # ...but its hint must not reach a surface that does not know the stage.
    assert payload["detail"] == "Internal error."
    assert "video server" not in payload["detail"]
    assert "docs_topic" not in payload


@pytest.mark.parametrize("message", _GENERIC_NETWORK_WORDING)
def test_no_video_hint_on_the_streaming_generate_frame(message):
    payload = stream_generation_failure(RuntimeError(message))
    assert "video" not in str(payload["detail"]).lower()
    assert "docs_topic" not in payload


def test_allowlisted_classes_keep_their_hint():
    payload = public_exception_response(
        RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB"),
        fallback="Internal error.",
    )
    assert payload.get("docs_topic") == "GPU_OOM"
    assert payload["detail"] != "Internal error."


def test_windows_paging_file_keeps_its_hint():
    # An allowlisted class whose trigger is unmistakable — the regression guard
    # for over-filtering, which would silently strip every useful remediation.
    payload = public_exception_response(
        OSError("[WinError 1455] The paging file is too small for this operation to complete"),
        fallback="Internal error.",
    )
    assert payload.get("docs_topic") == "WINDOWS_PAGING_FILE_TOO_SMALL"


def test_the_filter_matches_the_documented_allowlist():
    # Pins the contract itself: the class the allowlist's own comment calls out
    # as unsafe must not be a member.
    assert "VIDEO_DOWNLOAD_NETWORK" not in _CONTEXT_FREE_HINT_CLASSES
    assert "GPU_OOM" in _CONTEXT_FREE_HINT_CLASSES
