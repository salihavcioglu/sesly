"""FDL-09: the segmented (multi-connection) downloader is ON by default.

The app forces the legacy-LFS path (HF_HUB_DISABLE_XET=1) for clear progress,
which is single-stream and slow. The segmented accelerator restores parallel
byte-range speed with a safe fallback to snapshot_download — so it ships ON by
default for fast first-run downloads. This pins the default so it can't silently
regress to opt-in, and that the env override still disables it.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))



def _enabled():
    """Resolve the app module at run time, not at collection."""
    from api.routers.setup.download import _segmented_enabled

    return _segmented_enabled()


def test_segmented_is_on_by_default(monkeypatch):
    monkeypatch.delenv("OMNIVOICE_SEGMENTED_DOWNLOAD", raising=False)
    assert _enabled() is True


def test_env_override_can_disable(monkeypatch):
    monkeypatch.setenv("OMNIVOICE_SEGMENTED_DOWNLOAD", "0")
    assert _enabled() is False


def test_env_override_truthy_keeps_it_on(monkeypatch):
    for val in ("1", "true", "on", "yes"):
        monkeypatch.setenv("OMNIVOICE_SEGMENTED_DOWNLOAD", val)
        assert _enabled() is True


# The accelerator must be re-entered on the NEXT attempt after a dropped
# connection, so it resumes from its .part manifest. Falling straight through to
# snapshot_download in the same attempt finishes the install from a separate
# .incomplete file and strands the manifest — restart-from-zero all over again.

import httpx  # noqa: E402

_MAX = 5


def _plan(exc, attempt, max_attempts=_MAX):
    """Resolve the app module at run time, not at collection.

    A module-level import of an app module goes stale when an earlier test
    pollutes ``sys.modules``.
    """
    from api.routers.setup.download import _segmented_retry_plan

    return _segmented_retry_plan(exc, attempt, max_attempts)


def _dropped():
    return httpx.RemoteProtocolError(
        "peer closed connection without sending complete message body"
    )


def test_dropped_connection_reraises_so_the_next_attempt_resumes():
    for attempt in (1, 2, 3):
        disable, reraise = _plan(_dropped(), attempt)
        assert reraise is True, f"attempt {attempt} must reach the outer retry"
        assert disable is False, f"attempt {attempt} must keep the accelerator"


def test_the_accelerator_keeps_the_second_to_last_attempt():
    """Handover must not start early.

    Disabling AND falling through in the same attempt would abandon the
    resumable manifest one attempt sooner than needed and restart the file
    through a separate `.incomplete`.
    """
    disable, reraise = _plan(_dropped(), _MAX - 1)
    assert (disable, reraise) == (True, True), (
        "the attempt that exhausts the accelerator still re-raises, so the "
        "plain path starts on the last attempt, not the second-to-last"
    )


def test_final_attempt_takes_the_plain_path_without_reraising():
    """The accelerator can never be the reason an install fails outright."""
    assert _plan(_dropped(), _MAX) == (True, False)
    assert _plan(_dropped(), 1, 1) == (True, False), "single-attempt install"


def test_a_non_network_failure_disables_the_accelerator_at_once():
    """An accelerator that cannot work here must not burn every retry."""
    assert _plan(ValueError("sha256 mismatch"), 1) == (True, False)


def _note(disable, reraise):
    from api.routers.setup.download import _segmented_retry_note

    return _segmented_retry_note(disable, reraise)


def test_the_log_does_not_promise_a_fallback_that_has_not_happened_yet():
    """The exhausting attempt re-raises, so its fallback is next — not now."""
    assert _note(*_plan(_dropped(), _MAX - 1)) == (
        "exhausted — retrying once more, then snapshot_download takes over"
    )
    assert "now" not in _note(*_plan(_dropped(), _MAX - 1))

    # The branch that really does hand over says so.
    assert _note(*_plan(_dropped(), _MAX)).endswith("snapshot_download now")
    assert _note(*_plan(ValueError("sha256 mismatch"), 1)).endswith(
        "snapshot_download now"
    )

    # Still accelerating.
    assert _note(*_plan(_dropped(), 1)) == (
        "kept for the next attempt (resumes from its manifest)"
    )
