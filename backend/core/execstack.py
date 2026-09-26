"""Repair wheel-shipped shared libraries that request an executable stack.

Why this exists
---------------
CTranslate2 wheels up to and including 4.4.0 ship
``ctranslate2.libs/libctranslate2-*.so`` with ``PT_GNU_STACK`` marked
``RWE`` — a request for an executable stack. Linux kernels that refuse to
grant it (hardened kernels, and mainline from 6.x onwards) fail the
``dlopen`` outright::

    ImportError: libctranslate2-d3638643.so.4.4.0: cannot enable executable
    stack as shared object requires: Invalid argument

Everything that links CTranslate2 dies with it: the **whisperx** and
**faster-whisper** ASR engines (#692) *and* Argos translation, which is the
default dub translation engine (``argostranslate.translate`` imports
``ctranslate2``). #692 taught the ASR selector to fall through to another
engine; it never fixed the library, so Linux users on Python 3.11 lost both
engines. The pin is upstream and not ours to lift: whisperx 3.4.5 — the last
release that supports Python 3.11, which is what ``.python-version``, CI and
the installers use — requires ``ctranslate2<4.5.0``, and 4.5.0 is the first
release whose ``.so`` drops the exec-stack request.

The flag is a single bit in the ELF program header, so we clear it in place
rather than shipping a patched wheel or asking users for ``patchelf`` (which
is not installed on a typical desktop). Inspection is a ~100-byte read with
no imports, so :func:`ensure_ctranslate2_loadable` is cheap enough to call
from an availability probe: it only rewrites a file when that file would
otherwise refuse to load.

Everything here is a no-op off Linux (macOS/Windows have no such rejection)
and handles malformed ELF data — a repair that cannot happen returns a reason, and the
caller degrades exactly as it did before.
"""
from __future__ import annotations

import glob
import logging
import os
import struct
import sys
import threading

logger = logging.getLogger("omnivoice.execstack")

#: ELF segment type for the stack-permission marker, and its executable bit.
_PT_GNU_STACK = 0x6474E551
_PF_X = 0x1

#: Serialize in-process writes; flock also coordinates sidecar processes.
_REPAIR_LOCK = threading.RLock()


def _elf_header(fh) -> tuple[str, int, int, int, bool] | None:
    """Return ``(endian_prefix, e_phoff, e_phentsize, e_phnum, is_64)`` or None.

    None means "not an ELF file we understand" — which is a normal answer
    (a ``.so`` stub, a text file, a Mach-O), never an error.
    """
    fh.seek(0)
    ident = fh.read(16)
    if len(ident) < 16 or ident[:4] != b"\x7fELF":
        return None
    if ident[4] not in (1, 2) or ident[5] not in (1, 2):
        return None
    is_64 = ident[4] == 2
    endian = "<" if ident[5] == 1 else ">"
    fh.seek(0, os.SEEK_END)
    size = fh.tell()
    header_size = 64 if is_64 else 52
    if size < header_size:
        return None
    fh.seek(0)
    header = fh.read(header_size)
    if len(header) != header_size:
        return None
    e_phoff = struct.unpack_from(endian + ("Q" if is_64 else "I"), header, 0x20 if is_64 else 0x1C)[0]
    e_phentsize, e_phnum = struct.unpack_from(endian + "HH", header, 0x36 if is_64 else 0x2A)
    if (not e_phnum or e_phoff < header_size or
            e_phentsize < (56 if is_64 else 32) or
            e_phoff + e_phentsize * e_phnum > size):
        return None
    # p_flags sits at a different offset per class (ELF64 puts it right after
    # p_type; ELF32 puts it last), so the caller needs the class too.
    return endian, e_phoff, e_phentsize, e_phnum, is_64


def _gnu_stack_flags_offset(fh) -> tuple[int, int, str] | None:
    """Locate the ``PT_GNU_STACK`` ``p_flags`` field.

    Returns ``(file_offset, flags_value, endian_prefix)``, or None when the
    file is not an ELF or carries no such segment.
    """
    parsed = _elf_header(fh)
    if parsed is None:
        return None
    endian, e_phoff, e_phentsize, e_phnum, is_64 = parsed
    flags_rel = 4 if is_64 else 24  # p_flags offset inside the program header
    for i in range(e_phnum):
        base = e_phoff + i * e_phentsize
        fh.seek(base)
        raw = fh.read(e_phentsize)
        if len(raw) < flags_rel + 4:
            continue
        (p_type,) = struct.unpack_from(endian + "I", raw, 0)
        if p_type != _PT_GNU_STACK:
            continue
        (p_flags,) = struct.unpack_from(endian + "I", raw, flags_rel)
        return base + flags_rel, p_flags, endian
    return None


def has_execstack(path: str) -> bool | None:
    """True when ``path`` requests an executable stack.

    None when the question does not apply: unreadable, not an ELF, or no
    ``PT_GNU_STACK`` segment.
    """
    try:
        with open(path, "rb") as fh:
            found = _gnu_stack_flags_offset(fh)
    except OSError:
        return None
    if found is None:
        return None
    _offset, flags, _endian = found
    return bool(flags & _PF_X)


def clear_execstack(path: str) -> tuple[bool, str]:
    """Clear the executable-stack request on ``path``.

    Returns ``(changed, detail)``. ``changed`` is False both when there was
    nothing to do and when the write was refused (a read-only bundle, for
    instance) — ``detail`` says which.
    """
    try:
        # Lock and inspect the same descriptor we write: another process may
        # already have repaired it, or the wheel may have been replaced.
        with _REPAIR_LOCK, open(path, "r+b") as fh:
            # Use host capability, not an emulated target platform.
            if os.name == "posix":
                import fcntl
                fcntl.flock(fh, fcntl.LOCK_EX)
            found = _gnu_stack_flags_offset(fh)
            if found is None:
                return False, "no PT_GNU_STACK segment"
            offset, flags, endian = found
            if not flags & _PF_X:
                return False, "already non-executable"
            fh.seek(offset)
            fh.write(struct.pack(endian + "I", flags & ~_PF_X))
            fh.flush()
            os.fsync(fh.fileno())
    except OSError as e:
        return False, f"unreadable or not writable ({e.__class__.__name__})"
    return True, "cleared PT_GNU_STACK executable bit"


def ctranslate2_library_paths() -> list[str]:
    """Native libraries shipped with the installed ``ctranslate2`` wheel.

    Found without importing ``ctranslate2`` — importing it is the very thing
    that fails when the exec-stack bit is set.
    """
    import importlib.util

    roots: list[str] = []
    try:
        spec = importlib.util.find_spec("ctranslate2")
    except (ImportError, ValueError):  # pragma: no cover — defensive
        spec = None
    locations = list(getattr(spec, "submodule_search_locations", None) or []) if spec else []
    for pkg_dir in locations:
        roots.append(pkg_dir)
        roots.append(os.path.join(os.path.dirname(pkg_dir), "ctranslate2.libs"))
    # Frozen builds flatten the wheel into the bundle directory.
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        roots.append(meipass)
        roots.append(os.path.join(meipass, "ctranslate2.libs"))
    out: list[str] = []
    for root in roots:
        if not os.path.isdir(root):
            continue
        for pattern in ("libctranslate2*.so*", "libctranslate2*.dylib"):
            out.extend(sorted(glob.glob(os.path.join(root, pattern))))
    # Dedupe, preserving order.
    return list(dict.fromkeys(out))


def ensure_ctranslate2_loadable() -> tuple[bool, str]:
    """Make ``import ctranslate2`` possible on kernels that refuse exec stacks.

    Returns ``(ok, detail)`` where ``ok`` is False only when a library needs
    the repair and could not get it — the caller should then report its
    engine unavailable with ``detail`` as the reason. The repair is idempotent. Re-probe on each call so installation or
    external repair takes effect without restarting.
    """

    result: tuple[bool, str]
    if sys.platform != "linux":
        # Only Linux rejects an exec-stack request at dlopen time.
        result = (True, "not applicable off Linux")
    else:
        libs = ctranslate2_library_paths()
        if not libs:
            result = (True, "no ctranslate2 library found")
        else:
            repaired: list[str] = []
            blocked: list[str] = []
            for lib in libs:
                if has_execstack(lib) is not True:
                    continue
                changed, detail = clear_execstack(lib)
                if changed:
                    repaired.append(os.path.basename(lib))
                    logger.warning(
                        "Repaired %s: %s — its executable-stack request is "
                        "rejected by this kernel, which broke whisperx, "
                        "faster-whisper and Argos translation (#692)",
                        os.path.basename(lib), detail,
                    )
                elif has_execstack(lib) is not False:
                    blocked.append(f"{os.path.basename(lib)} ({detail})")
            if blocked:
                result = (
                    False,
                    "ctranslate2's native library requests an executable stack, "
                    "which this kernel refuses, and it could not be patched: "
                    + "; ".join(blocked)
                    + ". Reinstall the backend on Python 3.12+ (which resolves "
                    "ctranslate2 4.8+, without the exec-stack request), or run "
                    "`patchelf --clear-execstack <library>` once.",
                )
            elif repaired:
                result = (True, "repaired " + ", ".join(repaired))
            else:
                result = (True, "no exec-stack request")

    return result


def reset_ctranslate2_cache() -> None:
    """Compatibility hook; recoverable probe results are no longer cached."""
