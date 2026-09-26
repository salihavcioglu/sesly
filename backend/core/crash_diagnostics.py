"""Native-crash diagnostics for the backend process (#2135).

A crash inside torch/CUDA — graph capture, a driver fault, an allocator abort —
kills the interpreter below the level any ``except`` can reach. #2135's reporter
saw exactly that: the backend "simply exited" mid-``/generate`` with no Python
traceback, no HTTP response, and ``ConnectionRefused`` on the next ``/health``.
There was nothing in the logs to diagnose because nothing in Python ever ran
again.

``faulthandler`` installs handlers for the fatal signals (SIGSEGV, SIGABRT,
SIGBUS, SIGFPE, SIGILL) that print every thread's Python stack to stderr on the
way down. That is the difference between "the process vanished" and a named
frame pointing at the engine call that killed it.

This is strictly a diagnostic: it does not prevent the crash, and it must never
be the reason startup fails.
"""
from __future__ import annotations

import os

_DISABLE_ENV = "OMNIVOICE_DISABLE_FAULTHANDLER"
_TRUTHY = frozenset({"1", "true", "yes", "on"})


def _disabled() -> bool:
    return os.environ.get(_DISABLE_ENV, "").strip().lower() in _TRUTHY


def enable_fault_handler(stderr=None) -> bool:
    """Arm fatal-signal tracebacks. Returns True when armed.

    Call as early as possible — before torch is imported — so a crash during
    model load is covered too. Honours ``OMNIVOICE_DISABLE_FAULTHANDLER=1`` for
    hosts whose outer supervisor installs its own handlers.

    Args:
        stderr: optional file object to write dumps to. Defaults to the real
            ``sys.stderr`` (→ ``backend_err.log``). faulthandler keeps the
            underlying fd, so the object must stay open for the process
            lifetime.

    Never raises: a frozen build with a detached stderr, or a platform without
    the signals, degrades to "no crash dump" rather than a failed boot.
    """
    if _disabled():
        return False
    try:
        import faulthandler

        # all_threads=True: the fatal frame is routinely on a GPU-pool or
        # compile worker, not whichever thread happens to take the signal.
        if stderr is not None:
            faulthandler.enable(file=stderr, all_threads=True)
        else:
            faulthandler.enable(all_threads=True)
        return True
    except Exception:
        return False
