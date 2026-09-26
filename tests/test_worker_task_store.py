"""Durable task state and restart recovery.

The behaviour that separates this from ``core/job_store.py``: a local job dies
with the process that ran it, so the local sweep marks in-flight jobs failed on
startup. A remote task does not — the GPU on the other machine keeps going
while the desktop app is closed. Recovery, not burial.
"""
from __future__ import annotations

import json
import os
import sqlite3

import pytest

from worker import task_store
from worker.errors import ErrorClass, WorkerError
from worker.lifecycle import AttemptState, PriorityClass, Task, TaskState


@pytest.fixture
def db(tmp_path, monkeypatch):
    """See test_worker_registry.py: patch the globals the store actually reads,
    because tests/backend/conftest.py purges core.* between tests."""
    from worker import task_store as ts

    db_globals = ts.db_conn.__wrapped__.__globals__
    path = str(tmp_path / "userdata.db")
    with sqlite3.connect(path) as conn:
        conn.executescript(db_globals["_BASE_SCHEMA"])
    monkeypatch.setitem(db_globals, "DB_PATH", path)
    return path


def _task(task_id="t1", **kw) -> Task:
    defaults = dict(
        task_id=task_id,
        operation="tts",
        engine="indextts",
        model_id="IndexTTS-2",
        params={"text": "hello"},
    )
    defaults.update(kw)
    return Task(**defaults)


# ── Round trip ─────────────────────────────────────────────────────────────


def test_task_round_trips(db):
    task = _task(
        priority=PriorityClass.BATCH,
        max_attempts=5,
        pinned_worker_id="gpu-bedroom",
    )
    task.deadline_at = 1234.0
    task_store.create(task, now=1000.0)

    loaded = task_store.get("t1")
    assert loaded.operation == "tts"
    assert loaded.params == {"text": "hello"}
    assert loaded.priority is PriorityClass.BATCH
    assert loaded.max_attempts == 5
    assert loaded.deadline_at == 1234.0
    assert loaded.pinned_worker_id == "gpu-bedroom"


def test_persisted_input_params_do_not_contain_user_home_paths(db, tmp_path, monkeypatch):
    root = tmp_path / "artifacts"
    (root / task_store.INPUTS_DIRNAME).mkdir(parents=True)
    monkeypatch.setattr(task_store, "artifact_root", lambda **_kw: str(root))
    voice = tmp_path / "Users" / "alice" / "voice.wav"
    voice.parent.mkdir(parents=True)
    voice.write_bytes(b"voice")

    task_store.create(_task(params={"text": "hello", "ref_audio": str(voice)}), now=1000.0)

    with sqlite3.connect(db) as conn:
        stored = conn.execute(
            "SELECT params_json FROM remote_tasks WHERE id='t1'"
        ).fetchone()[0]
    assert str(voice) not in stored
    assert str(tmp_path) not in stored
    assert "inputs/" in stored


def test_a_staged_input_id_is_posix_on_every_host(tmp_path, monkeypatch):
    """The artifact id crosses machines, so it cannot carry an OS separator.

    It is persisted in params_json, shipped to remote workers over gRPC, and
    matched against a later disk sweep. os.path.join made it host-specific: a
    Windows control plane produced ``inputs\<sha>.wav``, which a Linux worker
    cannot resolve and which stops matching the moment the same data directory
    is opened on another OS.
    """
    root = tmp_path / "artifacts"
    (root / task_store.INPUTS_DIRNAME).mkdir(parents=True)
    monkeypatch.setattr(task_store, "artifact_root", lambda **_kw: str(root))
    source = tmp_path / "voice.wav"
    source.write_bytes(b"voice")

    record = task_store.stage_input(str(source), root=str(root))

    assert "\\" not in record["artifact_id"], record["artifact_id"]
    assert record["artifact_id"].startswith(f"{task_store.INPUTS_DIRNAME}/")
    # And it still resolves to the file that was actually written.
    assert (root / record["artifact_id"]).is_file()


def test_a_legacy_windows_id_still_protects_its_input(db, tmp_path, monkeypatch):
    """An upgraded install must not delete inputs its tasks still point at.

    Rows staged before the id was canonicalised carry a backslash. The sweeper
    decides "unreferenced" by comparing ids, so matching a legacy row against a
    freshly built posix id would read every one of them as garbage and delete
    the file a surviving task depends on.
    """
    root = tmp_path / "artifacts"
    (root / task_store.INPUTS_DIRNAME).mkdir(parents=True)
    monkeypatch.setattr(task_store, "artifact_root", lambda **_kw: str(root))
    source = tmp_path / "voice.wav"
    source.write_bytes(b"voice")
    record = task_store.stage_input(str(source), root=str(root))
    staged = root / record["artifact_id"]
    os.utime(staged, (0, 0))  # older than any cutoff

    # The row exactly as a pre-fix Windows control plane wrote it. Inserted
    # directly: `create` validates against today's rules, and the point is a
    # row that predates them.
    legacy = dict(record, artifact_id=record["artifact_id"].replace("/", "\\"))
    with sqlite3.connect(db) as conn:
        conn.execute(
            "INSERT INTO remote_tasks"
            " (id, operation, params_json, state, created_at, updated_at)"
            " VALUES (?, 'tts', ?, 'queued', 1000.0, 1000.0)",
            ("legacy-1", json.dumps({task_store.INPUTS_PARAM_KEY: [legacy]})),
        )

    with task_store.db_conn() as conn:
        referenced = task_store._referenced_artifacts(conn)
    task_store.purge_artifacts((), referenced, cutoff=1e12, root=str(root))

    assert staged.is_file(), "a legacy-id input that a task still references was deleted"


def test_attempts_round_trip(db):
    task = _task()
    task_store.create(task, now=1000.0)
    attempt = task.assign(worker_id="w1", session_epoch=3, now=1001.0)
    task.accept(attempt.attempt_id, now=1002.0)
    task.start(attempt.attempt_id, now=1003.0)
    attempt.progress = 0.4
    attempt.stage = "synthesising"
    task_store.save(task, now=1003.0)

    loaded = task_store.get("t1")
    assert loaded.state is TaskState.RUNNING
    assert len(loaded.attempts) == 1
    assert loaded.attempts[0].session_epoch == 3
    assert loaded.attempts[0].progress == 0.4
    assert loaded.attempts[0].stage == "synthesising"


def test_errors_round_trip(db):
    task = _task()
    task_store.create(task, now=1000.0)
    attempt = task.assign(worker_id="w1", session_epoch=1, now=1001.0)
    task.fail_attempt(
        attempt.attempt_id,
        WorkerError(error_class=ErrorClass.CAPABILITY, code="INSUFFICIENT_MEMORY", message="too big"),
        now=1002.0,
    )
    task_store.save(task, now=1002.0)

    loaded = task_store.get("t1")
    assert loaded.attempts[0].error.error_class is ErrorClass.CAPABILITY
    assert loaded.attempts[0].error.code == "INSUFFICIENT_MEMORY"


def test_excluded_workers_survive(db):
    """Otherwise a retry after restart goes straight back to the worker that
    just failed it."""
    task = _task()
    task_store.create(task, now=1000.0)
    attempt = task.assign(worker_id="w1", session_epoch=1, now=1001.0)
    task.fail_attempt(
        attempt.attempt_id,
        WorkerError(error_class=ErrorClass.TRANSIENT, code="X", message="x"),
        now=1002.0,
    )
    task_store.save(task, now=1002.0)

    assert task_store.get("t1").excluded_workers == {"w1"}


def test_save_is_idempotent(db):
    task = _task()
    task_store.create(task, now=1000.0)
    task.assign(worker_id="w1", session_epoch=1, now=1001.0)
    task_store.save(task, now=1001.0)
    task_store.save(task, now=1002.0)

    assert len(task_store.get("t1").attempts) == 1


# ── Idempotency ────────────────────────────────────────────────────────────


def test_create_is_idempotent_on_the_client_key(db):
    """Client retries must not queue a second render of the same text."""
    first = task_store.create(_task("t1", idempotency_key="abc"), now=1000.0)
    second = task_store.create(_task("t2", idempotency_key="abc"), now=1001.0)
    assert second.task_id == first.task_id
    assert len(task_store.list_tasks()) == 1


def test_tasks_without_a_key_are_independent(db):
    task_store.create(_task("t1"), now=1000.0)
    task_store.create(_task("t2"), now=1001.0)
    assert len(task_store.list_tasks()) == 2


# ── Persist before ack ─────────────────────────────────────────────────────


def test_commit_writes_the_result_durably(db):
    task = _task()
    task_store.create(task, now=1000.0)
    attempt = task.assign(worker_id="w1", session_epoch=1, now=1001.0)
    task.accept(attempt.attempt_id, now=1002.0)
    task.start(attempt.attempt_id, now=1003.0)
    task.commit_result(attempt.attempt_id, result_ref="out.wav", now=1004.0)
    task_store.commit_result(task, result_json={"duration": 3.2}, now=1004.0)

    loaded = task_store.get("t1")
    assert loaded.state is TaskState.COMPLETED
    assert loaded.result_ref == "out.wav"
    assert loaded.attempts[0].state is AttemptState.COMMITTED


def test_is_committed_answers_after_the_in_memory_graph_is_gone(db):
    """The guard for a result redelivered after a control-plane restart: the
    task object is gone, but the fact is on disk."""
    task = _task()
    task_store.create(task, now=1000.0)
    attempt = task.assign(worker_id="w1", session_epoch=1, now=1001.0)
    task.accept(attempt.attempt_id, now=1002.0)
    task.start(attempt.attempt_id, now=1003.0)

    assert task_store.is_committed("t1") is False

    task.commit_result(attempt.attempt_id, result_ref="out.wav", now=1004.0)
    task_store.commit_result(task, now=1004.0)

    assert task_store.is_committed("t1") is True


def test_commit_clears_a_previous_error(db):
    """A task that failed an attempt and then succeeded must not still carry
    the old error into the UI."""
    task = _task()
    task_store.create(task, now=1000.0)
    a1 = task.assign(worker_id="w1", session_epoch=1, now=1001.0)
    task.fail_attempt(
        a1.attempt_id, WorkerError(error_class=ErrorClass.TRANSIENT, code="X", message="x"), now=1002.0
    )
    task_store.save(task, now=1002.0)

    a2 = task.assign(worker_id="w2", session_epoch=1, now=1003.0)
    task.accept(a2.attempt_id, now=1004.0)
    task.start(a2.attempt_id, now=1005.0)
    task.commit_result(a2.attempt_id, result_ref="out.wav", now=1006.0)
    task_store.commit_result(task, now=1006.0)

    assert task_store.get("t1").error is None


# ── Restart recovery ───────────────────────────────────────────────────────


def test_unfinished_tasks_are_recovered_not_failed(db):
    """The inversion of the local job sweep: the worker holding this task may
    still be rendering, so restart must not bury it."""
    task = _task()
    task_store.create(task, now=1000.0)
    attempt = task.assign(worker_id="w1", session_epoch=1, now=1001.0)
    task.accept(attempt.attempt_id, now=1002.0)
    task.start(attempt.attempt_id, now=1003.0)
    task_store.save(task, now=1003.0)

    recovered = task_store.load_unfinished()

    assert len(recovered) == 1
    assert recovered[0].state is TaskState.RUNNING
    assert recovered[0].active_attempt.worker_id == "w1"


def test_finished_tasks_are_not_recovered(db):
    task = _task()
    task_store.create(task, now=1000.0)
    attempt = task.assign(worker_id="w1", session_epoch=1, now=1001.0)
    task.accept(attempt.attempt_id, now=1002.0)
    task.start(attempt.attempt_id, now=1003.0)
    task.commit_result(attempt.attempt_id, result_ref="r", now=1004.0)
    task_store.commit_result(task, now=1004.0)

    assert task_store.load_unfinished() == []


def test_recovery_preserves_interactive_before_batch(db):
    batch = _task("t1", priority=PriorityClass.BATCH)
    interactive = _task("t2", priority=PriorityClass.INTERACTIVE)
    task_store.create(batch, now=1000.0)
    task_store.create(interactive, now=1001.0)

    assert [t.task_id for t in task_store.load_unfinished()] == ["t2", "t1"]


def test_scheduler_restore_adopts_recovered_tasks(db):
    """End to end: the scheduler picks up in-flight work after a restart."""
    from worker.pool import WorkerPool
    from worker.scheduler import Scheduler

    task = _task()
    task_store.create(task, now=1000.0)
    attempt = task.assign(worker_id="w1", session_epoch=1, now=1001.0)
    task.accept(attempt.attempt_id, now=1002.0)
    task.start(attempt.attempt_id, now=1003.0)
    task_store.save(task, now=1003.0)

    revived = Scheduler(WorkerPool(), persist=True)
    assert revived.restore() == 1
    assert revived.get("t1").state is TaskState.RUNNING


# ── Retention ──────────────────────────────────────────────────────────────


def test_finished_tasks_are_purgeable(db):
    task = _task()
    task_store.create(task, now=1000.0)
    attempt = task.assign(worker_id="w1", session_epoch=1, now=1001.0)
    task.accept(attempt.attempt_id, now=1002.0)
    task.start(attempt.attempt_id, now=1003.0)
    task.commit_result(attempt.attempt_id, result_ref="r", now=1004.0)
    task_store.commit_result(task, now=1004.0)

    assert task_store.purge_finished(older_than_seconds=10, now=1_000_000.0) == 1
    assert task_store.get("t1") is None

    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT COUNT(*) FROM remote_task_attempts").fetchone()[0] == 0


def test_live_tasks_are_never_purged(db):
    task_store.create(_task(), now=1000.0)
    assert task_store.purge_finished(older_than_seconds=0, now=1_000_000.0) == 0
    assert task_store.get("t1") is not None


def test_finished_task_purge_is_bounded_and_oldest_first(db, tmp_path):
    for index in range(3):
        task = _task(f"t{index + 1}")
        task_store.create(task, now=1000.0 + index)
        task.state = TaskState.COMPLETED
        task.finished_at = 1000.0 + index
        task_store.save(task, now=1000.0 + index)

    removed = task_store.purge_finished(
        older_than_seconds=10,
        now=2000.0,
        root=str(tmp_path / "artifacts"),
        limit=2,
    )

    assert removed == 2
    assert task_store.get("t1") is None
    assert task_store.get("t2") is None
    assert task_store.get("t3") is not None


def test_failed_result_cleanup_keeps_its_db_index_for_the_next_sweep(
    db, tmp_path, monkeypatch
):
    root = tmp_path / "artifacts"
    result_dir = root / "t1"
    result_dir.mkdir(parents=True)
    (result_dir / "a1.bin").write_bytes(b"rendered audio")
    task = _task()
    task_store.create(task, now=1000.0)
    task.state = TaskState.COMPLETED
    task.finished_at = 1000.0
    task_store.save(task, now=1000.0)
    real_rmtree = task_store.shutil.rmtree

    def interrupted_cleanup(_path):
        raise OSError("process stopped before artifact deletion")

    monkeypatch.setattr(task_store.shutil, "rmtree", interrupted_cleanup)
    assert (
        task_store.purge_finished(
            older_than_seconds=10, now=2000.0, root=str(root)
        )
        == 0
    )
    assert task_store.get("t1") is not None
    assert result_dir.is_dir()

    monkeypatch.setattr(task_store.shutil, "rmtree", real_rmtree)
    assert (
        task_store.purge_finished(
            older_than_seconds=10, now=2000.0, root=str(root)
        )
        == 1
    )
    assert task_store.get("t1") is None
    assert not result_dir.exists()


def test_result_directory_delete_is_durable_before_its_row_is_forgotten(
    db, tmp_path, monkeypatch
):
    root = tmp_path / "artifacts"
    result_dir = root / "t1"
    result_dir.mkdir(parents=True)
    (result_dir / "a1.bin").write_bytes(b"rendered audio")
    task = _task()
    task_store.create(task, now=1000.0)
    task.state = TaskState.COMPLETED
    task.finished_at = 1000.0
    task_store.save(task, now=1000.0)
    real_fsync_parent = task_store._fsync_parent_directory

    def fail_artifact_root_fsync(directory):
        if str(directory) == str(root):
            raise OSError("artifact-root fsync failed")
        return real_fsync_parent(directory)

    monkeypatch.setattr(
        task_store, "_fsync_parent_directory", fail_artifact_root_fsync
    )
    assert (
        task_store.purge_finished(
            older_than_seconds=10, now=2000.0, root=str(root)
        )
        == 0
    )
    assert not result_dir.exists()
    assert task_store.get("t1") is not None

    monkeypatch.setattr(
        task_store, "_fsync_parent_directory", real_fsync_parent
    )
    assert (
        task_store.purge_finished(
            older_than_seconds=10, now=2000.0, root=str(root)
        )
        == 1
    )
    assert task_store.get("t1") is None


def test_dispatch_budget_survives_reload_without_worker(db):
    from worker.deadlines import Deadlines
    from worker.pool import WorkerPool
    from worker.scheduler import Scheduler

    task = _task()
    task_store.create(task, now=1000.0)
    attempt = task.assign(worker_id="w1", session_epoch=1, now=1001.0)
    budget = Deadlines(20, 1800, 900, 120, 900, 75)
    attempt.deadlines = budget
    task_store.save(task, now=1002.0)
    loaded = task_store.get(task.task_id)
    assert loaded.active_attempt.deadlines == budget
    assert Scheduler(WorkerPool(), persist=False)._budget_for(loaded) == budget


@pytest.mark.parametrize("gpu_seconds", [300, 900])
def test_legacy_attempt_without_worker_keeps_conservative_execution_budget(db, monkeypatch, gpu_seconds):
    from services import model_manager
    from worker.pool import WorkerPool
    from worker.scheduler import Scheduler

    monkeypatch.setattr(model_manager, "GPU_JOB_TIMEOUT_S", gpu_seconds)
    monkeypatch.setattr(model_manager, "CPU_JOB_TIMEOUT_S", 600.0)
    monkeypatch.setattr(model_manager, "_CPU_GENERATE_TIMEOUT_EXPLICIT", True)
    task = _task()
    task_store.create(task, now=1000.0)
    task.assign(worker_id="old-worker", session_epoch=1, now=1001.0)
    task_store.save(task, now=1002.0)  # legacy NULL deadlines_json
    loaded = task_store.get(task.task_id)
    assert loaded.active_attempt.deadlines is None
    budget = Scheduler(WorkerPool(), persist=False)._budget_for(loaded)
    assert budget.execution_seconds >= max(gpu_seconds, 600)
