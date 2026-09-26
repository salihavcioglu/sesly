"""#2177 — a streaming generation failure has to say what went wrong.

The report is a bare floor message and a class name:

    Generation failed. Check the selected engine and try again.
    Backend error class: RuntimeError

Nothing in it names a cause, so the reporter could not act and the issue was
labelled `needs-info`. The cause is structural, not incidental: the streaming
error frame never copies exception text (Constitution I), so everything it can
say comes from the failure taxonomy — and the taxonomy had no entry for the
class an unsupported GPU produces every single time.

`_oom_friendly_reraise` in the generate router recognises a dozen failure
classes and re-raises each with a written remedy. Ten of them reach a streaming
render as the identical floor message, because `diagnosis.classify()` either has no topic
for them or the topic is not on the context-free allowlist. This closes that gap
for the three whose triggers are unmistakable machine strings — the bar the
allowlist's own comments set — and leaves the generic-English ones alone, since
those are exactly the #1943 "confidently wrong remedy" risk the allowlist exists
to prevent.
"""
import pytest

@pytest.fixture
def diagnosis():
    import importlib
    from types import SimpleNamespace

    failure = importlib.import_module("core.failure")
    public = importlib.import_module("core.public_errors")
    return SimpleNamespace(
        classify=failure.classify,
        context_free=failure._CONTEXT_FREE_HINT_CLASSES,
        stream_failure=public.stream_failure,
        stream_generation_failure=public.stream_generation_failure,
    )


# CUDA's own sentence when the card's compute capability is absent from the
# installed build's kernel list — the RTX 50-series / Blackwell class.
NO_KERNEL_IMAGE = "CUDA error: no kernel image is available for execution on the device"
APP_CONTROL_BLOCKED = "[WinError 4551] The file was blocked by an application control policy"
AUDIO_IO = "LibsndfileError: System error."


# ── the reported failure ────────────────────────────────────────────────────


def test_an_unsupported_gpu_is_named_instead_of_the_floor_message(diagnosis):
    payload = diagnosis.stream_generation_failure(RuntimeError(NO_KERNEL_IMAGE))

    assert payload["docs_topic"] == "GPU_ARCH_UNSUPPORTED"
    assert payload["docs_url"].endswith("#generation-failure-diagnosis")
    assert payload["hint"]
    # The remedy that actually applies — and explicitly not the Flush button,
    # which is what a user reads "check the selected engine" as inviting.
    assert "CPU" in payload["hint"]
    assert "compatible PyTorch build" in payload["hint"]
    # The floor message is still the lead; the hint is appended to it.
    assert payload["detail"].startswith(diagnosis.stream_failure("generation_failed")["detail"])
    assert payload["detail"] != diagnosis.stream_failure("generation_failed")["detail"]


def test_an_unsupported_gpu_is_terminal_not_an_invitation_to_retry(diagnosis):
    """The reporter ran the same generation twice, ninety seconds apart, to the
    same result. A build mismatch does not change between renders."""
    payload = diagnosis.stream_generation_failure(RuntimeError(NO_KERNEL_IMAGE))

    assert payload["terminal"] is True
    assert payload["retryable"] is False


def test_the_exception_class_still_rides_along(diagnosis):
    # #1800's guarantee must survive the enrichment.
    payload = diagnosis.stream_generation_failure(RuntimeError(NO_KERNEL_IMAGE))
    assert payload["error_class"] == "RuntimeError"


# ── the same gap, two more classes ──────────────────────────────────────────


def test_an_os_blocked_load_reaches_the_client(diagnosis):
    """Its trigger is the numeric WinError, exactly like WINDOWS_UNTRUSTED_MOUNT
    (448) and WINDOWS_PAGING_FILE_TOO_SMALL (1455), both already allowlisted."""
    payload = diagnosis.stream_generation_failure(RuntimeError(APP_CONTROL_BLOCKED))

    assert payload["docs_topic"] == "WINDOWS_APP_CONTROL_BLOCKED"
    assert payload["hint"]
    assert payload["terminal"] is True


def test_an_audio_io_failure_reaches_the_client(diagnosis):
    """The desktop app already routes this topic to Settings → Storage; that
    recovery could never fire while the hint was dropped server-side."""
    payload = diagnosis.stream_generation_failure(RuntimeError(AUDIO_IO))

    assert payload["docs_topic"] == "AUDIO_IO_FAILED"
    assert payload["hint"]
    # A disk that is full now may not be later — recoverable, so not terminal.
    assert payload.get("terminal", False) is False
    assert payload["retryable"] is True


# ── nothing else may change ─────────────────────────────────────────────────


def test_an_unclassified_failure_is_byte_identical_to_before(diagnosis):
    payload = diagnosis.stream_generation_failure(RuntimeError("Something went sideways"))

    assert payload["detail"] == diagnosis.stream_failure("generation_failed")["detail"]
    assert payload["retryable"] is True
    assert "hint" not in payload
    assert "docs_topic" not in payload
    assert payload.get("terminal", False) is False


def test_out_of_memory_is_untouched(diagnosis):
    """The new branch sits after the OOM check, so real memory pressure keeps
    its own class and stays retryable."""
    payload = diagnosis.stream_generation_failure(RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB"))

    assert payload["docs_topic"] == "GPU_OOM"
    assert payload["retryable"] is True
    assert payload.get("terminal", False) is False


@pytest.mark.parametrize("message", [
    "The read operation timed out",
    "Connection reset by peer",
    "[Errno 32] Broken pipe",
    "Permission denied",
])
def test_a_generic_failure_still_gets_no_hint(message, diagnosis):
    """#1943's lesson holds: a topic whose trigger is a generic phrase must not
    stamp a confidently wrong remedy on an unrelated failure. These classify to
    nothing, or to a class the allowlist deliberately keeps off this surface."""
    payload = diagnosis.stream_generation_failure(RuntimeError(message))
    assert "hint" not in payload


def test_no_exception_text_is_ever_copied(diagnosis):
    """Constitution I — the reason this surface reports topics, not messages."""
    secret = "C:/Users/someone/private-voice-sample.wav"
    payload = diagnosis.stream_generation_failure(
        RuntimeError(f"{NO_KERNEL_IMAGE} while reading {secret}")
    )

    assert payload["docs_topic"] == "GPU_ARCH_UNSUPPORTED"
    for value in payload.values():
        assert secret not in str(value)
        assert "someone" not in str(value)


# ── taxonomy invariants ─────────────────────────────────────────────────────


def test_the_new_class_classifies_on_its_own(diagnosis):
    assert diagnosis.classify(NO_KERNEL_IMAGE) == "GPU_ARCH_UNSUPPORTED"
    # Wording variants seen in the wild resolve the same way.
    assert diagnosis.classify(
        "RuntimeError: CUDA error: no kernel image is available for execution "
        "on the device\nCUDA kernel errors might be asynchronously reported"
    ) == "GPU_ARCH_UNSUPPORTED"


def test_every_terminal_class_can_actually_reach_the_client(diagnosis):
    """A terminal class whose hint is filtered out would mark a render final
    while still explaining nothing — the worst of both. Terminal implies
    context-free."""
    from core.failure import _TERMINAL_FAILURE_CLASSES

    assert _TERMINAL_FAILURE_CLASSES <= diagnosis.context_free


def test_every_context_free_class_has_a_hint_to_give(diagnosis):
    from core.failure import _HINTS

    missing = {t for t in diagnosis.context_free if not _HINTS.get(t)}
    assert not missing, f"allowlisted with no hint text: {sorted(missing)}"
