"""MOSS-TTS-Nano from its own venv: the sidecar, and the switch to it.

At the pinned upstream commit, `moss_tts_nano` exports only `__version__` and
the entry point is the top-level `moss_tts_nano_runtime.NanoTTSService`. These
tests run the sidecar against a fake of that runtime.
"""
import importlib.util
import io
import json
import re
import struct
import sys
import types
from pathlib import Path

import numpy as np
import pytest

_MAIN = Path(__file__).resolve().parents[1] / "backend/engines/moss_tts_nano_subprocess/main.py"


def _load_sidecar(monkeypatch, calls, *, sample_rate=48000, channels=2, samples=960):
    class NanoTTSService:
        def __init__(self, **kw):
            calls.append(("init", kw))
            self.output_dir = Path(kw["output_dir"])

        def preload(self, **kw):
            calls.append(("preload", kw))

        def synthesize(self, **kw):
            calls.append(("synthesize", kw))
            shape = (samples, channels) if channels > 1 else (samples,)
            return {"waveform_numpy": np.full(shape, 0.25, dtype=np.float32), "sample_rate": sample_rate}

    runtime = types.ModuleType("moss_tts_nano_runtime")
    runtime.NanoTTSService = NanoTTSService
    package = types.ModuleType("moss_tts_nano")
    defaults = types.ModuleType("moss_tts_nano.defaults")
    defaults.DEFAULT_CHECKPOINT_PATH = "OpenMOSS-Team/MOSS-TTS-Nano"
    defaults.DEFAULT_AUDIO_TOKENIZER_PATH = "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano"
    package.defaults = defaults
    monkeypatch.setitem(sys.modules, "moss_tts_nano_runtime", runtime)
    monkeypatch.setitem(sys.modules, "moss_tts_nano", package)
    monkeypatch.setitem(sys.modules, "moss_tts_nano.defaults", defaults)
    spec = importlib.util.spec_from_file_location("_nano_sidecar_under_test", _MAIN)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _frames(buf):
    data, out, i = buf.getvalue(), [], 0
    while i < len(data):
        (n,) = struct.unpack("!I", data[i:i + 4])
        out.append(json.loads(data[i + 4:i + 4 + n]))
        i += 4 + n
    return out


def test_drives_upstreams_runtime_and_downmixes_to_mono(monkeypatch):
    calls = []
    sidecar = _load_sidecar(monkeypatch, calls)
    out = io.BytesIO()

    sidecar._handle_synthesize({"op": "synthesize", "text": "hello"}, out)

    init = dict(calls)["init"]
    assert init["checkpoint_path"] == "OpenMOSS-Team/MOSS-TTS-Nano"
    assert init["audio_tokenizer_path"] == "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano"
    assert ("preload", {"load_model": True}) in calls
    synth = dict(calls)["synthesize"]
    assert synth["text"] == "hello"
    assert synth["mode"] == "voice_clone"
    assert synth["prompt_audio_path"] is None
    # One output file, reused, inside the temp dir — not one per call.
    assert Path(synth["output_audio_path"]).parent == Path(init["output_dir"])
    audio = _frames(out)[-1]
    assert audio["op"] == "audio"
    assert audio["sample_rate"] == 48000 and audio["n_samples"] == 960


def test_passes_the_reference_clip_and_rejects_a_url(monkeypatch, tmp_path):
    calls = []
    sidecar = _load_sidecar(monkeypatch, calls)
    ref = tmp_path / "ref.wav"
    ref.write_bytes(b"x")
    sidecar._handle_synthesize({"text": "hi", "ref_audio": str(ref)}, io.BytesIO())
    assert dict(calls)["synthesize"]["prompt_audio_path"] == str(ref)
    with pytest.raises(ValueError, match="local file path"):
        sidecar._handle_synthesize({"text": "hi", "ref_audio": "https://x.test/a.wav"}, io.BytesIO())


def test_resamples_to_the_rate_the_engine_reports(monkeypatch):
    sidecar = _load_sidecar(monkeypatch, [], sample_rate=24000, channels=1, samples=960)
    out = io.BytesIO()
    sidecar._handle_synthesize({"text": "hi"}, out)
    audio = _frames(out)[-1]
    assert audio["sample_rate"] == 48000
    assert audio["n_samples"] == 1920


def test_only_the_cold_call_sends_progress(monkeypatch):
    """Progress frames keep the watchdog armed through downloads; a warm call
    sending them would stop it from catching a generation that wedges."""
    sidecar = _load_sidecar(monkeypatch, [])
    first, second = io.BytesIO(), io.BytesIO()
    sidecar._handle_synthesize({"text": "one"}, first)
    sidecar._handle_synthesize({"text": "two"}, second)
    assert any(f["op"] == "progress" for f in _frames(first))
    assert [f["op"] for f in _frames(second)] == ["audio"]


def test_the_sidecar_imports_nothing_from_the_app():
    src = _MAIN.read_text(encoding="utf-8")
    for name in ("services", "core", "engines", "api", "backend", "utils"):
        assert not re.search(rf"^\s*(from|import) {name}\b", src, re.M), name


def test_the_class_switches_to_the_sidecar_once_its_venv_exists(monkeypatch, tmp_path):
    from engines.moss_tts_nano_subprocess import MossTTSNanoSubprocessBackend
    from services import tts_backend
    from services.sidecar_install import _INSTALL_COMPLETE_MARKER, _venv_python

    monkeypatch.setenv("OMNIVOICE_MOSS_TTS_NANO_DIR", "")
    monkeypatch.delenv("OMNIVOICE_MOSS_TTS_NANO_DIR")
    assert tts_backend.get_backend_class("moss-tts-nano") is tts_backend.MossTTSNanoBackend

    py = _venv_python(tmp_path / ".venv")
    py.parent.mkdir(parents=True)
    py.write_text("#!fake\n")
    (tmp_path / _INSTALL_COMPLETE_MARKER).write_text("x\n", encoding="utf-8")
    monkeypatch.setenv("OMNIVOICE_MOSS_TTS_NANO_DIR", str(tmp_path))

    cls = tts_backend.get_backend_class("moss-tts-nano")
    assert cls is MossTTSNanoSubprocessBackend
    assert cls.venv_python() == py
    assert cls.is_available() == (True, "ready")
    for attr in ("id", "display_name", "gpu_compat"):
        assert getattr(cls, attr) == getattr(tts_backend.MossTTSNanoBackend, attr), attr
    assert cls().supported_languages == tts_backend.MossTTSNanoBackend().supported_languages


def test_every_own_venv_engine_has_an_installer_that_sets_its_path():
    """The resolver switches on the env var the engine's module reads; the
    installer must be the thing that sets that same variable."""
    import importlib

    from services import sidecar_install, tts_backend

    for engine_id, (module_name, class_name) in tts_backend._OWN_VENV_SIDECARS.items():
        module = importlib.import_module(module_name)
        spec = sidecar_install.get_spec(engine_id)
        assert spec is not None, engine_id
        assert spec.env_var == module.VENV_ENV_VAR, engine_id
        assert getattr(module, class_name).id == engine_id
