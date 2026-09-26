"""The Backend log tab must survive a log rollover.

`main.py` attaches a `RotatingFileHandler(maxBytes=2MB, backupCount=3)`, so
`omnivoice.log` is rolled into `.1/.2/.3` and starts again from empty. The tail
endpoint read only the current file, so for the minutes after a rollover the
panel showed a handful of lines — or none — while up to 6 MB of history, the
failure included, sat in `omnivoice.log.1`.

That matters more than a cosmetic gap: `.github/ISSUE_TEMPLATE` and the engine
guides both ask a reporter to paste "the backend log" from that panel, and
#1782 is a thread where three rounds went into an empty Logs panel. A rollover
is not the only way to get one, but it is one this endpoint can rule out.

Measured before the fix, with 3 lines in the current file and 500 in each of
two backups: `tail=200` returned 3 lines and reported `total_lines: 3`.

Clear is in the same file because the two are coupled — once the tail reaches
into the backups, a Clear that truncates only `omnivoice.log` looks like it did
nothing.
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
def rolling(tmp_path, system_mod, monkeypatch):
    """A rolled-over log set: 3 fresh lines, 500 + 500 in the backups."""
    base = tmp_path / "omnivoice.log"
    base.write_text("".join(f"fresh {i}\n" for i in range(3)), encoding="utf-8")
    (tmp_path / "omnivoice.log.1").write_text(
        "".join(f"older {i}\n" for i in range(500)), encoding="utf-8"
    )
    (tmp_path / "omnivoice.log.2").write_text(
        "".join(f"oldest {i}\n" for i in range(500)), encoding="utf-8"
    )
    monkeypatch.setattr(system_mod, "LOG_PATH", str(base))
    monkeypatch.setattr(system_mod, "CRASH_LOG_PATH", str(tmp_path / "crash_log.txt"))
    return tmp_path


def test_tail_reaches_across_a_rollover(system_mod, rolling):
    res = asyncio.run(system_mod.system_logs(tail=200))

    assert len(res["lines"]) == 200
    # Oldest first, and the newest line is still the newest line on disk.
    assert res["lines"][0].strip() == "older 303"
    assert res["lines"][-1].strip() == "fresh 2"
    # It crossed exactly one boundary and stopped there.
    assert [os.path.basename(p) for p in res["paths"]] == ["omnivoice.log.1", "omnivoice.log"]


def test_the_common_case_still_reads_one_file(system_mod, tmp_path, monkeypatch):
    """No rollover in play → the backups are not opened at all.

    The panel polls every 5s, so reaching into 6 MB of backups on every call
    would be a poor trade for a case that only matters right after a roll.
    """
    base = tmp_path / "omnivoice.log"
    base.write_text("".join(f"line {i}\n" for i in range(500)), encoding="utf-8")
    (tmp_path / "omnivoice.log.1").write_text("stale\n" * 500, encoding="utf-8")
    monkeypatch.setattr(system_mod, "LOG_PATH", str(base))
    monkeypatch.setattr(system_mod, "CRASH_LOG_PATH", str(tmp_path / "crash_log.txt"))

    res = asyncio.run(system_mod.system_logs(tail=200))

    assert [os.path.basename(p) for p in res["paths"]] == ["omnivoice.log"]
    assert res["lines"][0].strip() == "line 300"
    assert "stale" not in "".join(res["lines"])


def test_a_backup_alone_is_still_a_log(system_mod, tmp_path, monkeypatch):
    """The window between the roll and the first new line is not "no log"."""
    base = tmp_path / "omnivoice.log"
    (tmp_path / "omnivoice.log.1").write_text("only in the backup\n", encoding="utf-8")
    monkeypatch.setattr(system_mod, "LOG_PATH", str(base))
    monkeypatch.setattr(system_mod, "CRASH_LOG_PATH", str(tmp_path / "crash_log.txt"))
    assert not base.exists()

    res = asyncio.run(system_mod.system_logs(tail=200))

    assert res["exists"] is True
    assert [line.strip() for line in res["lines"]] == ["only in the backup"]


def test_no_log_at_all_still_reports_absent(system_mod, tmp_path, monkeypatch):
    monkeypatch.setattr(system_mod, "LOG_PATH", str(tmp_path / "omnivoice.log"))
    monkeypatch.setattr(system_mod, "CRASH_LOG_PATH", str(tmp_path / "crash_log.txt"))

    res = asyncio.run(system_mod.system_logs(tail=200))

    assert res == {"lines": [], "path": str(tmp_path / "omnivoice.log"), "exists": False}


def test_a_file_that_vanishes_mid_walk_does_not_fail_the_panel(
    system_mod, rolling, monkeypatch
):
    """A rollover can rename a candidate between the scan and the open.

    The handler exposes no lock a route can take, so the walk skips the file
    instead of failing the request. The single-file version 500'd the whole
    panel in the same situation, so this is strictly better than before.
    """
    real_tail = system_mod._tail_file

    def flaky(path, tail):
        if path.endswith("omnivoice.log.1"):
            raise FileNotFoundError(path)
        return real_tail(path, tail)

    monkeypatch.setattr(system_mod, "_tail_file", flaky)

    res = asyncio.run(system_mod.system_logs(tail=200))

    # .1 is gone, so the walk falls through to .2 and still fills the request.
    assert res["exists"] is True
    assert len(res["lines"]) == 200
    assert [os.path.basename(p) for p in res["paths"]] == ["omnivoice.log.2", "omnivoice.log"]


def test_clear_covers_a_backup_created_after_the_scan(system_mod, rolling, monkeypatch):
    """Clear works off the fixed name set, not a snapshot of what exists.

    Enumerating first left a window where a rollover created a backup after the
    scan and its history survived a Clear that reported success.
    """
    monkeypatch.setattr(system_mod, "prefs_delete", lambda _key: None, raising=False)
    # Stand in for the race: a scan that ran before the rollover would have
    # reported no backups at all, and the version that trusted it truncated
    # only the current file while .1 and .2 kept their history.
    monkeypatch.setattr(system_mod, "_rotated_log_paths", lambda _base: [])

    asyncio.run(system_mod.clear_system_logs())

    for name in ("omnivoice.log", "omnivoice.log.1", "omnivoice.log.2"):
        assert (rolling / name).stat().st_size == 0, f"{name} survived a Clear that trusted a stale scan"


def test_clear_empties_the_backups_too(system_mod, rolling, monkeypatch):
    monkeypatch.setattr(system_mod, "prefs_delete", lambda _key: None, raising=False)

    res = asyncio.run(system_mod.clear_system_logs())

    assert res == {"cleared": True}
    for name in ("omnivoice.log", "omnivoice.log.1", "omnivoice.log.2"):
        assert (rolling / name).stat().st_size == 0, f"{name} survived Clear"
