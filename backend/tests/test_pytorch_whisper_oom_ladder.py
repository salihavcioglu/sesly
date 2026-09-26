"""The pytorch-whisper fallback must survive a CUDA OOM instead of losing a chunk.

The VRAM preflight sizes the *weights*; generation adds a workspace that scales
with the batch, and word timestamps keep every layer's cross-attention for the
whole batch. So a card with room for the model still OOMs at the first
transcribe — and the dub path merely retried the identical call, gave up, and
emitted nothing for that chunk: a silent hole in the transcript, indistinguishable
from silence. Step the batch down, then finish on CPU.
"""
import pytest

from services.asr_backend import PyTorchWhisperBackend

_OOM = RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB")


class _FakePipe:
    """Stands in for a transformers ASR pipeline on CUDA."""

    def __init__(self, oom_below_batch):
        self.device = "cuda:0"
        self.oom_below_batch = oom_below_batch
        self.calls = []

    def __call__(self, _audio, *, return_timestamps, chunk_length_s, batch_size):
        self.calls.append(batch_size)
        if batch_size > self.oom_below_batch:
            raise _OOM
        return {"text": "ok", "chunks": [{"text": "ok", "timestamp": (0.0, 1.0)}]}


@pytest.fixture()
def audio(tmp_path):
    import numpy as np
    import soundfile as sf

    path = tmp_path / "a.wav"
    sf.write(path, np.zeros(16000, dtype="float32"), 16000)
    return str(path)


def test_oom_steps_down_the_batch_and_still_returns_text(audio):
    pipe = _FakePipe(oom_below_batch=2)
    backend = PyTorchWhisperBackend(asr_pipe=pipe)
    out = backend.transcribe(audio, word_timestamps=True)
    assert out["text"] == "ok"
    # Tried the word-timestamp ladder in order, stopping at the first that fits.
    assert pipe.calls == [8, 2]


@pytest.mark.parametrize(
    "word_timestamps,expected", [(True, [8, 2, 1]), (False, [16, 4, 1])]
)
def test_batch_ladder_is_smaller_when_word_timestamps_are_requested(
    audio, monkeypatch, word_timestamps, expected
):
    """Word timestamps retain per-layer cross-attention for the whole batch, so
    the ladder must start lower than for plain transcription."""
    pipe = _FakePipe(oom_below_batch=0)
    backend = PyTorchWhisperBackend(asr_pipe=pipe)
    sentinel = RuntimeError("cpu rebuild reached")
    monkeypatch.setattr(
        backend, "_rebuild_on_cpu", lambda: (_ for _ in ()).throw(sentinel)
    )
    with pytest.raises(RuntimeError, match="cpu rebuild reached"):
        backend.transcribe(audio, word_timestamps=word_timestamps)
    assert pipe.calls == expected


def test_exhausted_ladder_falls_back_to_cpu(audio, monkeypatch):
    pipe = _FakePipe(oom_below_batch=0)
    backend = PyTorchWhisperBackend(asr_pipe=pipe)

    cpu = _FakePipe(oom_below_batch=99)
    cpu.device = "cpu"

    def _rebuild():
        backend._pipe = cpu

    monkeypatch.setattr(backend, "_rebuild_on_cpu", _rebuild)
    out = backend.transcribe(audio, word_timestamps=True)
    assert out["text"] == "ok"
    assert pipe.calls == [8, 2, 1] and cpu.calls == [2]


def test_non_oom_errors_are_not_retried(audio):
    class _Boom(_FakePipe):
        def __call__(self, *a, **kw):
            self.calls.append(kw["batch_size"])
            raise ValueError("bad audio")

    pipe = _Boom(oom_below_batch=99)
    with pytest.raises(ValueError):
        PyTorchWhisperBackend(asr_pipe=pipe).transcribe(audio)
    assert pipe.calls == [8]  # one attempt, no ladder


def test_cpu_pipeline_keeps_the_small_batch(audio):
    pipe = _FakePipe(oom_below_batch=99)
    pipe.device = "cpu"
    PyTorchWhisperBackend(asr_pipe=pipe).transcribe(audio)
    assert pipe.calls == [2]


def test_cpu_fallback_preserves_injected_model_and_processor(monkeypatch):
    import torch
    from types import SimpleNamespace
    calls = []
    model = SimpleNamespace(to=lambda **kw: calls.append(kw))
    processor = object()
    pipe = SimpleNamespace(model=model, tokenizer=processor, feature_extractor=processor, device="cuda:0")
    backend = PyTorchWhisperBackend(asr_pipe=pipe)
    monkeypatch.setattr(backend, "_model_name", lambda: pytest.fail("must not resolve another checkpoint"))
    backend._rebuild_on_cpu()
    assert backend._pipe is pipe and pipe.model is model
    assert pipe.tokenizer is processor and pipe.feature_extractor is processor
    assert str(pipe.device) == "cpu"
    assert calls == [{"device": "cpu", "dtype": torch.float32}]
