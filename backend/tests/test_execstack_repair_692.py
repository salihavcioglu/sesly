"""Regression tests for #692 — the CTranslate2 exec-stack rejection is now
*repaired*, not merely routed around.

ctranslate2 ≤4.4.0 (what whisperx 3.4.5 pins, and 3.4.5 is the last release
supporting the Python 3.11 we ship) marks its native library's stack as
executable. Kernels that refuse the request fail the dlopen outright, which
took out both CTranslate2 ASR engines *and* Argos — the default offline dub
translation engine, whose bare `argostranslate` import succeeds without the
native dep, so the engine advertised itself as ready and every translate
request 500'd with an opaque ImportError.

`core.execstack` clears the one ELF bit that causes it. These tests pin the
patcher on synthetic ELFs (no ctranslate2 needed), the memoization, and the
wiring into every consumer probe.
"""
import struct

import pytest


_PT_GNU_STACK = 0x6474E551
_PT_LOAD = 1


def _elf(path, *, bits=64, endian="<", flags=0x7, phdr_type=_PT_GNU_STACK):
    """Write a minimal ELF whose second program header is `phdr_type`.

    Only the fields the patcher reads are meaningful — a real linker would emit
    far more, but the point is to prove the offsets are computed correctly for
    both ELF classes, and to fail loudly if they ever drift.
    """
    is_64 = bits == 64
    phentsize = 56 if is_64 else 32
    phoff = 64 if is_64 else 52
    ident = b"\x7fELF" + bytes([2 if is_64 else 1, 1 if endian == "<" else 2, 1]) + b"\0" * 9
    header = bytearray(phoff)
    header[: len(ident)] = ident
    if is_64:
        struct.pack_into(endian + "Q", header, 0x20, phoff)
        struct.pack_into(endian + "HH", header, 0x36, phentsize, 2)
    else:
        struct.pack_into(endian + "I", header, 0x1C, phoff)
        struct.pack_into(endian + "HH", header, 0x2A, phentsize, 2)

    def _phdr(p_type, p_flags):
        raw = bytearray(phentsize)
        struct.pack_into(endian + "I", raw, 0, p_type)
        struct.pack_into(endian + "I", raw, 4 if is_64 else 24, p_flags)
        return bytes(raw)

    path.write_bytes(bytes(header) + _phdr(_PT_LOAD, 0x5) + _phdr(phdr_type, flags))
    return str(path)


@pytest.mark.parametrize("bits", [64, 32])
@pytest.mark.parametrize("endian", ["<", ">"])
def test_clear_execstack_flips_only_the_x_bit(tmp_path, bits, endian):
    from core import execstack
    lib = _elf(tmp_path / "libfake.so", bits=bits, endian=endian, flags=0x7)
    assert execstack.has_execstack(lib) is True

    changed, detail = execstack.clear_execstack(lib)
    assert changed is True and "cleared" in detail
    assert execstack.has_execstack(lib) is False

    # Read + write permissions survive; only PF_X is gone.
    with open(lib, "rb") as fh:
        offset, flags, _ = execstack._gnu_stack_flags_offset(fh)
    assert flags == 0x6

    # Idempotent: a second pass is a no-op, so a restart never rewrites.
    assert execstack.clear_execstack(lib) == (False, "already non-executable")


def test_non_executable_stack_is_left_alone(tmp_path):
    from core import execstack
    lib = _elf(tmp_path / "libok.so", flags=0x6)
    assert execstack.has_execstack(lib) is False
    before = (tmp_path / "libok.so").read_bytes()
    assert execstack.clear_execstack(lib) == (False, "already non-executable")
    assert (tmp_path / "libok.so").read_bytes() == before


def test_elf_without_gnu_stack_segment(tmp_path):
    from core import execstack
    lib = _elf(tmp_path / "libnostack.so", phdr_type=_PT_LOAD, flags=0x7)
    assert execstack.has_execstack(lib) is None
    assert execstack.clear_execstack(lib) == (False, "no PT_GNU_STACK segment")


def test_non_elf_and_missing_files_are_not_errors(tmp_path):
    from core import execstack
    text = tmp_path / "notelf.so"
    text.write_bytes(b"#!/bin/sh\necho hi\n")
    assert execstack.has_execstack(str(text)) is None
    assert execstack.clear_execstack(str(text))[0] is False

    missing = str(tmp_path / "nope" / "libghost.so")
    assert execstack.has_execstack(missing) is None
    changed, detail = execstack.clear_execstack(missing)
    assert changed is False and "unreadable" in detail


def test_ensure_rechecks_unrepairable_libraries(tmp_path, monkeypatch):
    from core import execstack
    lib = _elf(tmp_path / "libctranslate2-test.so.4.4.0", flags=0x7)
    monkeypatch.setattr(execstack.sys, "platform", "linux")
    monkeypatch.setattr(execstack, "ctranslate2_library_paths", lambda: [lib])
    monkeypatch.setattr(
        execstack, "clear_execstack", lambda p: (False, "not writable (PermissionError)")
    )
    execstack.reset_ctranslate2_cache()
    ok, detail = execstack.ensure_ctranslate2_loadable()
    assert ok is False
    # Actionable: names the library, why, and both ways out.
    assert "executable stack" in detail and "patchelf" in detail and "3.12" in detail

    # An external repair must become visible without a backend restart.
    _elf(tmp_path / "libctranslate2-test.so.4.4.0", flags=0x6)
    assert execstack.ensure_ctranslate2_loadable()[0] is True


def test_ensure_repairs_then_reports_ok(tmp_path, monkeypatch):
    from core import execstack
    lib = _elf(tmp_path / "libctranslate2-test.so.4.4.0", flags=0x7)
    monkeypatch.setattr(execstack.sys, "platform", "linux")
    monkeypatch.setattr(execstack, "ctranslate2_library_paths", lambda: [lib])
    execstack.reset_ctranslate2_cache()
    ok, detail = execstack.ensure_ctranslate2_loadable()
    assert ok is True and "repaired" in detail
    assert execstack.has_execstack(lib) is False
    execstack.reset_ctranslate2_cache()


def test_ensure_is_a_noop_off_linux(tmp_path, monkeypatch):
    """macOS/Windows never reject an exec-stack request — don't touch signed
    bundles looking for a problem that cannot exist there."""
    from core import execstack
    monkeypatch.setattr(execstack.sys, "platform", "darwin")
    monkeypatch.setattr(
        execstack, "ctranslate2_library_paths", lambda: pytest.fail("probed off Linux")
    )
    execstack.reset_ctranslate2_cache()
    ok, detail = execstack.ensure_ctranslate2_loadable()
    assert ok is True and "off Linux" in detail
    execstack.reset_ctranslate2_cache()


# ── Wiring: every consumer of the native lib must consult the repair ─────────


def test_asr_probes_report_unavailable_when_repair_impossible(monkeypatch):
    from services import asr_backend as ab

    monkeypatch.setattr(
        ab, "_ctranslate2_execstack_ok", lambda: (False, "kernel refuses it")
    )
    okx, msgx = ab.WhisperXBackend.is_available()
    okf, msgf = ab.FasterWhisperBackend.is_available()
    assert okx is False and "CTranslate2" in msgx and "kernel refuses it" in msgx
    assert okf is False and "CTranslate2" in msgf and "kernel refuses it" in msgf


def test_argos_probe_module_pulls_the_native_dep():
    """`argostranslate` alone imports fine with a broken CTranslate2 — the
    registry must probe the module that actually loads it, or the Engine
    selector advertises an engine whose every request fails."""
    from services.translation_engines import REGISTRY

    assert REGISTRY["argos"]["probe_module"] == "argostranslate.translate"


def test_engine_probe_survives_a_native_load_failure(monkeypatch):
    from services import translation_engines as te

    def boom(name):
        raise OSError("libctranslate2-x.so: cannot enable executable stack")

    monkeypatch.setattr(te.importlib, "import_module", boom)
    ok, detail = te._probe({"probe_module": "deep_translator"})
    assert ok is False and "OSError" in detail


@pytest.mark.parametrize("bits", [32, 64])
@pytest.mark.parametrize("length", [16, 31, 45, 63])
def test_truncated_elf_is_not_an_error(tmp_path, bits, length):
    from core import execstack
    path = tmp_path / "short.so"
    _elf(path, bits=bits)
    path.write_bytes(path.read_bytes()[:length])
    before = path.read_bytes()
    assert execstack.has_execstack(str(path)) is None
    assert execstack.clear_execstack(str(path))[0] is False
    assert path.read_bytes() == before


def test_install_after_absent_probe_is_detected(tmp_path, monkeypatch):
    from core import execstack
    monkeypatch.setattr(execstack.sys, "platform", "linux")
    libs = []
    monkeypatch.setattr(execstack, "ctranslate2_library_paths", lambda: libs)
    assert execstack.ensure_ctranslate2_loadable()[0]
    libs.append(_elf(tmp_path / "new.so"))
    assert execstack.ensure_ctranslate2_loadable()[0]
    assert execstack.has_execstack(libs[0]) is False


def test_concurrent_repairs_remain_available(tmp_path, monkeypatch):
    from core import execstack
    from concurrent.futures import ThreadPoolExecutor
    lib = _elf(tmp_path / "parallel.so")
    monkeypatch.setattr(execstack.sys, "platform", "linux")
    monkeypatch.setattr(execstack, "ctranslate2_library_paths", lambda: [lib])
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: execstack.ensure_ctranslate2_loadable(), range(24)))
    assert all(ok for ok, _ in results)
    assert execstack.has_execstack(lib) is False


def test_isolated_probe_checks_repair_before_import(monkeypatch):
    from core import execstack
    from services.subprocess_asr import IsolatedFasterWhisperBackend
    monkeypatch.setattr(execstack, "ensure_ctranslate2_loadable", lambda: (False, "repair blocked"))
    ok, detail = IsolatedFasterWhisperBackend.is_available()
    assert not ok and "repair blocked" in detail


def test_repair_uses_host_locking_capability_when_target_platform_is_emulated(tmp_path, monkeypatch):
    from core import execstack
    import builtins
    import os
    from types import SimpleNamespace

    lib = _elf(tmp_path / 'libctranslate2-test.so', flags=0x7)
    monkeypatch.setattr(execstack.sys, 'platform', 'linux')
    monkeypatch.setattr(execstack, 'os', SimpleNamespace(**{**vars(os), 'name': 'nt'}))
    original_import = builtins.__import__

    def windows_import(name, *args, **kwargs):
        if name == 'fcntl':
            raise ModuleNotFoundError('fcntl is unavailable on Windows')
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, '__import__', windows_import)
    changed, _ = execstack.clear_execstack(lib)
    assert changed
    assert execstack.has_execstack(lib) is False
