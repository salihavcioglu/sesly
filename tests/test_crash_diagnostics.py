"""#2135 — a fatal native crash must leave a traceback behind.

The reporter's backend died mid-`/generate` with "no Python traceback ... the
backend process simply exits". `faulthandler` was present in the codebase but
only ever used for the #632 startup-hang watchdog (`dump_traceback_later`);
`faulthandler.enable()` — the part that handles SIGSEGV/SIGABRT — was never
called, so a native abort produced nothing at all.

The end-to-end assertion here is the one that matters: kill a real child
interpreter with a real fatal signal and require a real traceback on stderr.
"""
from __future__ import annotations

import os
import subprocess
import sys
import textwrap

import pytest

@pytest.fixture(autouse=True)
def _current_application_module():
    import importlib
    global crash_diagnostics
    crash_diagnostics = importlib.import_module("core.crash_diagnostics")


_BACKEND_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend",
)


def test_enable_returns_true_by_default():
    assert crash_diagnostics.enable_fault_handler() is True


def test_respects_disable_env(monkeypatch):
    monkeypatch.setenv("OMNIVOICE_DISABLE_FAULTHANDLER", "1")
    assert crash_diagnostics.enable_fault_handler() is False


@pytest.mark.parametrize("value", ["0", "false", "no", "off", ""])
def test_falsey_disable_env_still_arms(monkeypatch, value):
    monkeypatch.setenv("OMNIVOICE_DISABLE_FAULTHANDLER", value)
    assert crash_diagnostics.enable_fault_handler() is True


def test_never_raises_on_a_broken_stderr():
    """A frozen build can hand us a stderr faulthandler cannot use."""

    class _NoFileno:
        def fileno(self):
            raise OSError("detached")

    assert crash_diagnostics.enable_fault_handler(stderr=_NoFileno()) is False


# ── the real thing: a hard crash must produce a stack ───────────────────────


def _crash_child(arm: bool) -> str:
    """Run a child that segfaults, return its stderr."""
    # faulthandler._sigsegv() raises a genuine SIGSEGV / access violation --
    # the same class of fatal, uncatchable fault a bad CUDA kernel produces.
    # (ctypes.string_at(0) is NOT equivalent: Windows converts that one into an
    # ordinary catchable OSError, so it would test nothing here.) This is the
    # hook CPython's own test suite uses to exercise faulthandler.
    source = textwrap.dedent(
        f"""
        import faulthandler, sys
        sys.path.insert(0, {str(_BACKEND_DIR)!r})
        if {arm!r}:
            from core.crash_diagnostics import enable_fault_handler
            enable_fault_handler()

        def victim():
            faulthandler._sigsegv()

        victim()
        """
    )
    proc = subprocess.run(
        [sys.executable, "-c", source], capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode != 0, "child was supposed to crash"
    return proc.stderr


def test_fatal_signal_produces_a_traceback():
    """Fails before the fix: an unarmed interpreter dies silently."""
    stderr = _crash_child(arm=True)
    # Wording differs by platform ("Fatal Python error: Segmentation fault" on
    # POSIX, "Windows fatal exception: access violation" on Windows), so assert
    # the property both share: a fatal-fault banner naming the dying frame.
    assert "fatal" in stderr.lower(), f"no fatal-fault banner:\n{stderr}"
    assert "victim" in stderr, f"no Python frame in crash output:\n{stderr}"


def test_unarmed_interpreter_gives_nothing():
    """Documents the pre-fix behaviour this regression test protects against."""
    stderr = _crash_child(arm=False)
    assert "victim" not in stderr
