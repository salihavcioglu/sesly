import asyncio
import io
import zipfile
from types import SimpleNamespace

import pytest
import torch


def test_remote_dub_resolution_does_not_load_local_tts(monkeypatch):
    from api.routers import dub_generate
    from worker.routing import Decision

    decision = Decision(remote=True, worker_id="remote-1", label="Render box")
    preflight = []

    async def fake_preflight(engine, routed, **kwargs):
        preflight.append((engine, routed, kwargs))

    async def reject_local_load(**_kwargs):
        raise AssertionError("remote Dubbing must not load local TTS weights")

    monkeypatch.setattr(dub_generate, "active_backend_id", lambda: "omnivoice")
    monkeypatch.setattr(dub_generate.gpu_gateway, "decide", lambda _op: decision)
    monkeypatch.setattr(dub_generate.gpu_gateway, "preflight", fake_preflight)
    monkeypatch.setattr(dub_generate, "resolve_generation_backend", reject_local_load)

    engine, routed, backend = asyncio.run(dub_generate._resolve_dub_execution())

    assert (engine, routed) == ("omnivoice", decision)
    assert isinstance(backend, dub_generate._RemoteDubBackend)
    assert preflight == [
        ("omnivoice", decision, {"operation": "dub_segments"})
    ]


def test_local_dub_resolution_loads_cloning_backend(monkeypatch):
    from api.routers import dub_generate
    from worker.routing import Decision

    decision = Decision(remote=False, reason="chosen")
    backend = SimpleNamespace(sample_rate=48_000)
    calls = []

    async def resolve_backend(**kwargs):
        calls.append(kwargs)
        return backend

    monkeypatch.setattr(dub_generate, "active_backend_id", lambda: "test")
    monkeypatch.setattr(dub_generate.gpu_gateway, "decide", lambda _op: decision)
    monkeypatch.setattr(dub_generate, "resolve_generation_backend", resolve_backend)

    engine, routed, resolved = asyncio.run(dub_generate._resolve_dub_execution())

    assert (engine, routed, resolved) == ("test", decision, backend)
    assert calls == [{"require_cloning": True}]


@pytest.mark.parametrize("operation", ["dub_segments", "batch_segments"])
def test_worker_runs_segment_bundles_as_one_task_and_reports_each_segment(
    monkeypatch, operation
):
    from worker.executor import TaskExecutor

    class Backend:
        sample_rate = 24_000
        applies_own_mastering = True

        def generate(self, text, **_kwargs):
            return torch.full((1, len(text) * 10), 0.1)

    monkeypatch.setattr(TaskExecutor, "_load_backend", staticmethod(lambda _engine: Backend()))
    progress = []

    async def report(fraction, stage):
        progress.append((fraction, stage))

    assignment = SimpleNamespace(
        operation=operation, engine="test", params_json=(
            '{"segments":[{"index":3,"text":"one","effect_preset":"raw",'
            '"watermark":false},{"index":8,"text":"two","effect_preset":"raw",'
            '"watermark":false}],"ref_audio":[null,null]}'
        ), inputs=[], deadlines=SimpleNamespace(model_load_seconds=30, execution_seconds=30),
    )
    result = asyncio.run(TaskExecutor().execute(assignment, on_progress=report))

    with zipfile.ZipFile(io.BytesIO(result["payload"])) as bundle:
        assert bundle.namelist() == ["segments/3.wav", "segments/8.wav"]
    assert progress == [(0.5, "segment 1 of 2"), (1.0, "segment 2 of 2")]


def test_worker_uses_native_batches_for_compatible_dub_segments(monkeypatch):
    from services import dub_batching
    from worker.executor import TaskExecutor

    calls = []

    class Backend:
        sample_rate = 24_000
        applies_own_mastering = True

        def generate(self, _text, **_kwargs):
            raise AssertionError("compatible rows should use the native batch path")

        def generate_batch(self, texts, **kwargs):
            calls.append((texts, kwargs))
            return [torch.full((1, len(text) * 10), 0.1) for text in texts]

    monkeypatch.setattr(TaskExecutor, "_load_backend", staticmethod(lambda _engine: Backend()))
    monkeypatch.setattr(dub_batching, "native_batch_width", lambda _backend: 4)
    assignment = SimpleNamespace(
        operation="dub_segments",
        engine="test",
        params_json=(
            '{"segments":[{"index":3,"text":"one","effect_preset":"raw",'
            '"watermark":false},{"index":8,"text":"two","effect_preset":"raw",'
            '"watermark":false}],"ref_audio":[null,null]}'
        ),
        inputs=[],
        deadlines=SimpleNamespace(model_load_seconds=30, execution_seconds=30),
    )

    result = asyncio.run(TaskExecutor().execute(assignment))

    assert calls[0][0] == ["one", "two"]
    assert calls[0][1]["language"] == [None, None]
    with zipfile.ZipFile(io.BytesIO(result["payload"])) as bundle:
        assert bundle.namelist() == ["segments/3.wav", "segments/8.wav"]


def test_remote_dub_decoder_rejects_non_segment_members(tmp_path, monkeypatch):
    from api.routers import dub_generate
    from services.gpu_gateway import RemoteResult

    artifact = tmp_path / "bad.zip"
    with zipfile.ZipFile(artifact, "w") as bundle:
        bundle.writestr("../escape.wav", b"bad")
    monkeypatch.setattr(dub_generate, "DUB_DIR", str(tmp_path / "dubs"))

    with pytest.raises(ValueError, match="unexpected dub artifact member"):
        dub_generate._decode_remote_dub(RemoteResult("task", "worker", "GPU", str(artifact)))
