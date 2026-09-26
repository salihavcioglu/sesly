import asyncio


def test_remote_chapter_does_not_prepare_local_model(tmp_path, monkeypatch):
    from api.routers import audiobook
    from services import gpu_gateway
    from services.audiobook import Chapter, ExpressiveOptions, Span
    from worker.routing import Decision

    monkeypatch.setattr(audiobook, "_resolve_voice", lambda _id: {
        "ref_audio": None, "ref_text": None, "instruct": None, "seed": None,
    })
    monkeypatch.setattr(audiobook, "_voice_profile_exists", lambda _id: False)
    monkeypatch.setattr("services.tts_backend.active_backend_id", lambda: "test")
    monkeypatch.setattr(audiobook, "_prepare_synth", lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("remote audiobook loaded the local model")
    ))

    async def fake_run(op, *, local, remote, decision, job):
        assert op == remote.operation == "audiobook"
        assert local.prepare is not None
        assert remote.params["text"] == "hello"
        out = tmp_path / "remote.wav"
        out.write_bytes(b"wav")
        return str(out), 1.0, False, None

    monkeypatch.setattr(gpu_gateway, "run", fake_run)
    result = asyncio.run(audiobook._run_chapter(
        Chapter("One", [Span(None, "hello")]),
        decision=Decision(True, "w1", "gpu2"), job=gpu_gateway.JobRun("audiobook"),
        default_voice=None, language=None, opts=ExpressiveOptions(), voice_map=None,
        lexicon=None, cache_dir=str(tmp_path),
    ))
    assert result[0].endswith("remote.wav")


def test_local_chapter_uses_canonical_text_scaled_timeout(tmp_path, monkeypatch):
    from api.routers import audiobook
    from services import gpu_gateway, model_manager
    from services.audiobook import Chapter, ExpressiveOptions, Span
    from worker.routing import Decision

    class Backend:
        gpu_compat = ("mps", "cpu")

    chapter = Chapter("One", [Span(None, "a" * 900), Span(None, "b" * 901)])
    expected_text = f"{'a' * 900}\n{'b' * 901}"
    calls = []

    monkeypatch.setattr(audiobook, "_resolve_voice", lambda _id: {
        "ref_audio": None, "ref_text": None, "instruct": None, "seed": None,
    })
    monkeypatch.setattr(audiobook, "_voice_profile_exists", lambda _id: False)
    monkeypatch.setattr("services.tts_backend.active_backend_id", lambda: "test")
    monkeypatch.setattr("services.tts_backend.get_backend_class", lambda _id: Backend)

    async def fake_prepare(*_args, **_kwargs):
        return lambda *_args, **_kwargs: None, 24_000, lambda _id: {}, "test"

    def fake_timeout(text, *, engine=None, **_kwargs):
        calls.append((text, engine))
        return 315.05

    async def fake_run(op, *, local, remote, decision, job):
        prepared = await local.prepare()
        assert op == "audiobook"
        assert prepared.timeout == 315.05
        assert remote.params["text"] == expected_text
        return "local.wav", 1.0, False, None

    monkeypatch.setattr(audiobook, "_prepare_synth", fake_prepare)
    monkeypatch.setattr(model_manager, "generate_timeout_s", fake_timeout)
    monkeypatch.setattr(gpu_gateway, "run", fake_run)

    result = asyncio.run(audiobook._run_chapter(
        chapter,
        decision=Decision(False, "local"), job=gpu_gateway.JobRun("audiobook"),
        default_voice=None, language=None, opts=ExpressiveOptions(), voice_map=None,
        lexicon=None, cache_dir=str(tmp_path),
    ))

    assert result[0] == "local.wav"
    assert calls == [(expected_text, Backend)]


def test_audiobook_worker_marks_and_encodes_chapter(monkeypatch):
    import numpy as np
    from worker.executor import TaskExecutor

    marked = []
    monkeypatch.setattr("services.watermark.mark_synthetic",
                        lambda audio, sr, context, **_kw: marked.append((sr, context)) or audio)

    class Backend:
        sample_rate = 100
        def generate(self, text, **kwargs):
            return np.ones(20, dtype=np.float32)

    audio = TaskExecutor._synthesize_audiobook(
        Backend(), [{"text": "hello", "pause_ms_after": 0}],
        [{"ref_text": None, "instruct": None}],
        {"ref_audio": [None], "expressive": {}, "watermark": True},
    )
    assert len(audio) == 20
    assert marked == [(100, "worker.executor.tts")]


def test_audiobook_worker_forwards_mps_proxy_quality_and_seed():
    import numpy as np
    from services.audiobook import segment_seed
    from worker.executor import TaskExecutor

    calls = []

    class Backend:
        sample_rate = 100
        supports_native_omnivoice_controls = True

        def generate(self, text, **kwargs):
            calls.append((text, kwargs))
            return np.ones(20, dtype=np.float32)

    TaskExecutor._synthesize_audiobook(
        Backend(), [{"text": "hello", "pause_ms_after": 0}],
        [{"ref_text": None, "instruct": None, "seed": 42}],
        {"ref_audio": [None], "expressive": {}, "watermark": False},
    )

    _text, kwargs = calls[0]
    assert kwargs["num_step"] == 32
    assert kwargs["guidance_scale"] == 2.0
    assert kwargs["seed"] == segment_seed(42, "hello")
