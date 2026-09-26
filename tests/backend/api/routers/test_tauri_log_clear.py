"""Clearing the Tauri tab must not destroy the backend's stderr.

`/system/logs/tauri/clear` iterated every candidate in `_tauri_log_candidates()`
and truncated each one — including `backend_err.log`, the spawned backend's
stderr. Three things make that a data-loss bug rather than a tidy-up:

- The tab that owns the button does not show it. On desktop the Frontend/Tauri
  panel goes through the Rust `read_log_tail` command, whose `tauri_log_path()`
  resolves `tauri.log` and nothing else, so the user truncates a file they were
  never shown.
- `src-tauri/src/backend.rs::open_err_log_for_run()` opens it **append-only**
  so "a respawn must not destroy the previous run's evidence" (#1510) and
  rotates it to `.1` rather than truncating. It manages its own size; clearing
  it from here only undoes that.
- A native death — a Windows access violation (`0xC0000005`), a SIGSEGV — writes
  nothing to the Python log by construction, so this file is the only record
  that it happened. #1777 and #1782 are both threads where the maintainer had
  to ask a reporter for this file by hand.

Clear is therefore narrowed to the shell's own log. The READ path is unchanged,
and the last test pins that: `_tauri_log_candidates()` still lists all four
files in the same order on all three platforms, because the refactor that split
the list is where a silent regression would hide.
"""
from __future__ import annotations

import asyncio
import os

import pytest


@pytest.fixture
def system_mod():
    from api.routers import system

    return system


@pytest.fixture
def shell_logs(tmp_path, system_mod, monkeypatch):
    """A plugin log and both backend redirects, all non-empty."""
    plugin = tmp_path / "tauri.log"
    backend_out = tmp_path / "backend.log"
    backend_err = tmp_path / "backend_err.log"
    for f in (plugin, backend_out, backend_err):
        f.write_text(f"{f.name} content\n", encoding="utf-8")
    # Patch the composite as well as the two halves, and with raising=False, so
    # the behaviour assertions run identically against the pre-split code —
    # otherwise a fail-before check only proves the new helpers do not exist
    # yet, which is not the same as proving the bug.
    monkeypatch.setattr(
        system_mod,
        "_tauri_log_candidates",
        lambda: [str(plugin), str(backend_out), str(backend_err)],
    )
    monkeypatch.setattr(
        system_mod, "_tauri_plugin_log_candidates", lambda: [str(plugin)], raising=False
    )
    monkeypatch.setattr(
        system_mod,
        "_backend_redirect_log_candidates",
        lambda: [str(backend_out), str(backend_err)],
        raising=False,
    )
    return plugin, backend_out, backend_err


def test_clear_keeps_the_backend_stderr(system_mod, shell_logs):
    plugin, backend_out, backend_err = shell_logs

    res = asyncio.run(system_mod.clear_tauri_logs())

    assert res["cleared"] == [str(plugin)]
    assert plugin.stat().st_size == 0
    # The evidence a native crash leaves behind survives the button.
    assert backend_err.read_text(encoding="utf-8") == "backend_err.log content\n"
    assert backend_out.read_text(encoding="utf-8") == "backend.log content\n"


def test_clear_reports_nothing_when_there_is_no_plugin_log(system_mod, tmp_path, monkeypatch):
    absent = [str(tmp_path / "absent.log")]
    monkeypatch.setattr(system_mod, "_tauri_log_candidates", lambda: absent)
    monkeypatch.setattr(
        system_mod, "_tauri_plugin_log_candidates", lambda: absent, raising=False
    )
    monkeypatch.setattr(
        system_mod, "_backend_redirect_log_candidates", lambda: [], raising=False
    )

    assert asyncio.run(system_mod.clear_tauri_logs()) == {"cleared": [], "failed": 0}


@pytest.mark.parametrize(
    "platform,expected",
    [
        (
            "darwin",
            [
                "Library/Logs/{bid}/tauri.log",
                "Library/Logs/{bid}/Sesly.log",
                "Library/Logs/OmniVoice/backend.log",
                "Library/Logs/OmniVoice/backend_err.log",
            ],
        ),
        (
            "linux",
            [
                ".local/share/{bid}/logs/tauri.log",
                ".config/{bid}/logs/tauri.log",
                ".local/state/OmniVoice/backend.log",
                ".local/state/OmniVoice/backend_err.log",
            ],
        ),
        (
            "win32",
            [
                "AppData/Local/{bid}/logs/tauri.log",
                "AppData/Roaming/{bid}/logs/tauri.log",
                "AppData/Local/OmniVoice/Logs/backend.log",
                "AppData/Local/OmniVoice/Logs/backend_err.log",
            ],
        ),
    ],
)
def test_the_read_candidate_list_is_unchanged(system_mod, monkeypatch, platform, expected):
    """Splitting the list must not change what `/system/logs/tauri` can reach.

    Same files, same order, on every platform — the composite is where a
    refactor slip would silently hide a log from the read path.
    """
    bid = "com.salihavcioglu.sesly"
    home = "/home/tester"
    monkeypatch.setattr(system_mod.sys, "platform", platform)
    monkeypatch.setattr(os.path, "expanduser", lambda p: p.replace("~", home))
    for var in ("XDG_DATA_HOME", "XDG_STATE_HOME", "APPDATA", "LOCALAPPDATA", "OMNIVOICE_LOG_DIR"):
        monkeypatch.delenv(var, raising=False)
    if platform == "win32":
        monkeypatch.setenv("APPDATA", f"{home}/AppData/Roaming")
        monkeypatch.setenv("LOCALAPPDATA", f"{home}/AppData/Local")

    got = [p.replace("\\", "/") for p in system_mod._tauri_log_candidates()]

    assert got == [f"{home}/{suffix.format(bid=bid)}" for suffix in expected]


def test_the_backend_redirect_follows_the_writer_s_override(system_mod, monkeypatch, tmp_path):
    """`OMNIVOICE_LOG_DIR` moves the files, so the resolver has to follow it.

    `backend.rs::backend_log_path()` checks that variable before any per-OS
    default, and the backend is a child of the shell, so an ambient override
    reaches both processes. A resolver that ignored it would look in the
    per-OS default while the writer wrote somewhere else — the same divergence
    that makes the desktop Logs panel read the wrong file in #1782.
    """
    monkeypatch.setenv("OMNIVOICE_LOG_DIR", str(tmp_path))

    assert system_mod._backend_redirect_log_candidates() == [
        os.path.join(str(tmp_path), "backend.log"),
        os.path.join(str(tmp_path), "backend_err.log"),
    ]


def test_a_blank_override_falls_back_to_the_default(system_mod, monkeypatch):
    """Matches the writer's `!dir.trim().is_empty()` guard."""
    monkeypatch.setenv("OMNIVOICE_LOG_DIR", "   ")

    paths = system_mod._backend_redirect_log_candidates()

    assert paths, "a blank override must not empty the candidate list"
    assert all("OmniVoice" in p for p in paths)


def test_a_padded_override_resolves_the_same_place_the_writer_wrote(
    system_mod, monkeypatch, tmp_path
):
    """A padded `OMNIVOICE_LOG_DIR` must not split the reader from the writer.

    The Python side strips the variable before joining. `backend.rs` trimmed it
    only for the emptiness guard and then did `PathBuf::from(dir)` on the RAW
    value, so ` /tmp/logs ` had the shell writing to a directory whose name
    carried the spaces while this resolver looked in the trimmed one. That is
    the same reader/writer divergence #1782 is about, reintroduced through the
    override that exists to control it.
    """
    monkeypatch.setenv("OMNIVOICE_LOG_DIR", f"  {tmp_path}  ")

    assert system_mod._backend_redirect_log_candidates() == [
        os.path.join(str(tmp_path), "backend.log"),
        os.path.join(str(tmp_path), "backend_err.log"),
    ]


def test_a_vanished_rotated_file_is_skipped_but_a_real_error_is_not(
    system_mod, monkeypatch, tmp_path
):
    """The rotation walk may skip a file that rolled away — nothing else.

    `except OSError: continue` also swallowed PermissionError and genuine I/O
    failures, so a log the panel could not read rendered as an empty or partly
    empty panel with no explanation. Only the race the guard exists for is
    silent now.
    """
    base = tmp_path / "omnivoice.log"
    base.write_text("line one\n", encoding="utf-8")

    def _vanished(path, remaining):
        raise FileNotFoundError(path)

    monkeypatch.setattr(system_mod, "_tail_file", _vanished)
    lines, total, paths = system_mod._tail_rolling(str(base), 10)
    assert (lines, total, paths) == ([], 0, [])

    def _refused(path, remaining):
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(system_mod, "_tail_file", _refused)
    with pytest.raises(PermissionError):
        system_mod._tail_rolling(str(base), 10)
