"""#2163: installing the pyannote diarisation pipeline end to end.

The pipeline repo (`pyannote/speaker-diarization-3.1`) carries a `config.yaml`
and no weights of its own — the real checkpoints live in the two repositories
its catalogue entry declares as `dependencies`. That shape exercises three
things at once, and the report hit all three:

* the finished-snapshot validator must accept a weightless `config_only` repo
  instead of rejecting it as a truncated download;
* both dependency repositories must actually be fetched, or the install
  "succeeds" with nothing that can run;
* every download must carry the resolved HF bearer token **as a string**, since
  the pipeline and segmentation repos are gated.

This is the integration guard for the whole scenario; the token seam itself is
unit-tested in ``test_gated_install_token_2163.py``.
"""
import asyncio
import importlib
import os
from pathlib import Path

os.environ.setdefault("OMNIVOICE_MODEL", "test")
os.environ.setdefault("OMNIVOICE_DISABLE_FILE_LOG", "1")

import pytest



PIPELINE = "pyannote/speaker-diarization-3.1"
SEGMENTATION = "pyannote/segmentation-3.0"
EMBEDDING = "pyannote/wespeaker-voxceleb-resnet34-LM"

_WEIGHT_BYTES = 6 * 1024 * 1024  # clears the 5 MB .bin floor in setup/models


@pytest.fixture
def download():
    return importlib.import_module("api.routers.setup.download")


def _install_pyannote(download, monkeypatch, tmp_path):
    """Run POST /models/install for the pipeline repo with the Hub mocked.

    Returns (snapshot_download kwargs per call, emitted SSE events).
    """
    from services.token_resolver import ResolvedToken
    import huggingface_hub
    from services import hf_revisions, performance_profiles, token_resolver
    from utils import hf_progress

    monkeypatch.setattr(
        token_resolver,
        "resolve",
        lambda *a, **k: ResolvedToken(
            token="hf_gatedsecret", source="app", username="tester"
        ),
    )

    calls: list[dict] = []

    def fake_snapshot_download(**kwargs):
        calls.append(kwargs)
        if kwargs.get("dry_run"):
            return []
        repo_id = kwargs["repo_id"]
        path = tmp_path / repo_id.replace("/", "__")
        path.mkdir(parents=True, exist_ok=True)
        # Mirror the real repos: the pipeline ships only a config, each
        # dependency ships a config plus its checkpoint.
        (path / "config.yaml").write_text("pipeline: ok\n", encoding="utf-8")
        if repo_id != PIPELINE:
            (path / "pytorch_model.bin").write_bytes(b"\0" * _WEIGHT_BYTES)
        return str(path)

    monkeypatch.setattr(huggingface_hub, "snapshot_download", fake_snapshot_download)
    monkeypatch.setattr(download, "compute_plan", lambda _plan: {
        "total_bytes": 1, "cached_bytes": 0, "to_download_bytes": 1,
        "n_files": 1, "n_cached": 0,
    })
    monkeypatch.setattr(download, "disk_space_error", lambda *_a, **_k: None)
    # Force the snapshot_download path so this test covers the install flow;
    # the segmented accelerator has its own unit tests.
    monkeypatch.setattr(download, "_segmented_enabled", lambda: False)
    monkeypatch.setattr(hf_revisions, "remember_revision", lambda *_a: None)
    monkeypatch.setattr(performance_profiles, "reconcile_active_profile", lambda: None)

    events: list[dict] = []
    listener_id = hf_progress.register_listener(lambda ev: events.append(ev))

    async def _run():
        await download.install_model(download.InstallModelRequest(repo_id=PIPELINE))
        pending = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
        if pending:
            await asyncio.gather(*pending)

    try:
        asyncio.run(_run())
    finally:
        hf_progress.unregister_listener(listener_id)
        download._install_cooldowns.pop(PIPELINE, None)
        download._install_failures.pop(PIPELINE, None)

    return calls, events


def test_pyannote_pipeline_install_completes(download, monkeypatch, tmp_path):
    calls, events = _install_pyannote(download, monkeypatch, tmp_path)

    phases = [e.get("phase") for e in events]
    errors = [e for e in events if e.get("phase") == "install_error"]
    assert not errors, f"install failed: {[e.get('error') for e in errors]}"
    assert "install_done" in phases

    # A weightless pipeline repo is a valid install, not a truncated download —
    # the "no model weights were found in the snapshot" rejection in the report.
    assert PIPELINE not in str(errors)


def test_pyannote_install_fetches_both_dependency_repositories(
    download, monkeypatch, tmp_path
):
    calls, _events = _install_pyannote(download, monkeypatch, tmp_path)

    real = [c for c in calls if not c.get("dry_run")]
    fetched = [c["repo_id"] for c in real]
    assert fetched == [PIPELINE, SEGMENTATION, EMBEDDING], (
        "the pipeline config alone is not a runnable install"
    )

    # Each dependency is filtered to the files its catalogue entry declares.
    by_repo = {c["repo_id"]: c for c in real}
    for dependency in (SEGMENTATION, EMBEDDING):
        assert by_repo[dependency]["allow_patterns"] == [
            "config.yaml",
            "pytorch_model.bin",
        ]
    # The pipeline repo itself is unfiltered — it has no allow_patterns.
    assert "allow_patterns" not in by_repo[PIPELINE]


def test_every_pyannote_download_carries_the_bearer_string(
    download, monkeypatch, tmp_path
):
    calls, _events = _install_pyannote(download, monkeypatch, tmp_path)

    assert calls, "no download was attempted"
    for call in calls:
        token = call.get("token")
        assert token == "hf_gatedsecret", f"{call['repo_id']} sent {token!r}"
        assert isinstance(token, str)
