"""Use installed checkpoints without rewriting upstream configs (#2097)."""
import importlib.util
import io
from pathlib import Path
import sys
import types
from contextlib import nullcontext

from omegaconf import OmegaConf
import pytest


@pytest.fixture
def sidecar(monkeypatch):
    path = Path(__file__).resolve().parents[1] / "backend/engines/indextts/main.py"
    spec = importlib.util.spec_from_file_location("_indextts_paths_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setenv("OMNIVOICE_INDEXTTS_FP16", "0")
    monkeypatch.setattr(module, "_heartbeat", lambda *args: nullcontext())
    return module


def install_fake(monkeypatch, tmp_path, constructor, version="2.5"):
    monkeypatch.setenv("OMNIVOICE_INDEXTTS_DIR", str(tmp_path))
    package = types.ModuleType("indextts")
    package.__path__ = []
    monkeypatch.setitem(sys.modules, "indextts", package)
    module = types.ModuleType("indextts.infer_v2_5" if version == "2.5" else "indextts.infer_v2")
    module.IndexTTS2 = constructor
    monkeypatch.setitem(sys.modules, module.__name__, module)
    if version == "2":
        monkeypatch.setitem(sys.modules, "indextts.infer_v2_5", None)


def write_config(tmp_path, **values):
    directory = tmp_path / "checkpoints"
    directory.mkdir()
    path = directory / "config.yaml"
    OmegaConf.save(OmegaConf.create(values), path)
    return path


@pytest.mark.parametrize("version", ["2", "2.5"])
@pytest.mark.parametrize("foreign", ["/cubefs/cluster/missing.pth", r"Z:\cluster\missing.pth"])
def test_model_load_uses_local_weights_and_keeps_config(sidecar, monkeypatch, tmp_path, version, foreign):
    config = write_config(tmp_path, gpt_checkpoint=foreign, s2mel_checkpoint=foreign, untouched="${gpt_checkpoint}")
    original = config.read_bytes()
    for name in ("gpt.pth", "s2mel.pth"):
        (config.parent / name).write_bytes(name.encode())
    seen = []
    def constructor(*, cfg_path, model_dir, **kwargs):
        seen.append(Path(cfg_path))
        cfg = OmegaConf.load(cfg_path)
        for key, filename in (("gpt_checkpoint", "gpt.pth"), ("s2mel_checkpoint", "s2mel.pth")):
            actual = Path(model_dir) / cfg[key]
            assert actual.read_bytes() == filename.encode()
        assert OmegaConf.to_container(cfg, resolve=False)["untouched"] == "${gpt_checkpoint}"
        return object()
    install_fake(monkeypatch, tmp_path, constructor, version)
    assert sidecar._load_model(io.BytesIO()) is sidecar._model
    assert config.read_bytes() == original
    assert seen[0] != config and not seen[0].exists()


@pytest.mark.parametrize("absolute", [False, True])
def test_valid_custom_checkpoint_is_not_replaced(sidecar, monkeypatch, tmp_path, absolute):
    custom = tmp_path / "custom.pth"
    custom.write_bytes(b"custom")
    value = str(custom) if absolute else "../custom.pth"
    config = write_config(tmp_path, gpt_checkpoint=value, s2mel_checkpoint=value)
    (config.parent / "gpt.pth").write_bytes(b"wrong default")
    def constructor(*, cfg_path, model_dir, **kwargs):
        assert Path(cfg_path) == config
        cfg = OmegaConf.load(cfg_path)
        assert cfg.gpt_checkpoint == value
        assert (Path(model_dir) / cfg.gpt_checkpoint).read_bytes() == b"custom"
        return object()
    install_fake(monkeypatch, tmp_path, constructor)
    sidecar._load_model(io.BytesIO())


@pytest.mark.parametrize("relative", [False, True])
def test_unrepairable_config_keeps_original_error(sidecar, monkeypatch, tmp_path, relative):
    missing = "custom-missing.pth" if relative else str(tmp_path / "missing.pth")
    config = write_config(tmp_path, gpt_checkpoint=missing)
    if relative:
        (config.parent / "gpt.pth").write_bytes(b"do not replace a custom relative path")
    def constructor(*, cfg_path, model_dir, **kwargs):
        assert Path(cfg_path) == config
        return (Path(model_dir) / OmegaConf.load(cfg_path).gpt_checkpoint).read_bytes()
    install_fake(monkeypatch, tmp_path, constructor)
    with pytest.raises(FileNotFoundError):
        sidecar._load_model(io.BytesIO())
    assert sidecar._model is None


def test_temporary_config_is_removed_when_constructor_fails(sidecar, monkeypatch, tmp_path):
    config = write_config(tmp_path, gpt_checkpoint="/cubefs/missing.pth")
    original = config.read_bytes()
    (config.parent / "gpt.pth").write_bytes(b"weights")
    seen = []
    def constructor(*, cfg_path, **kwargs):
        seen.append(Path(cfg_path))
        assert OmegaConf.load(cfg_path).gpt_checkpoint == "gpt.pth"
        raise RuntimeError("model failed")
    install_fake(monkeypatch, tmp_path, constructor)
    with pytest.raises(RuntimeError, match="model failed"):
        sidecar._load_model(io.BytesIO())
    assert config.read_bytes() == original
    assert not seen[0].exists()
    assert sidecar._model is None


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX permits literal Windows-path filenames")
def test_foreign_path_cwd_literal_does_not_hide_fallback(sidecar, monkeypatch, tmp_path):
    foreign = r"Z:\cluster\missing.pth"
    config = write_config(tmp_path, gpt_checkpoint=foreign)
    (config.parent / "gpt.pth").write_bytes(b"weights")
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    (cwd / foreign).write_bytes(b"unrelated cwd file")
    monkeypatch.chdir(cwd)
    def constructor(*, cfg_path, model_dir, **kwargs):
        cfg = OmegaConf.load(cfg_path)
        assert (Path(model_dir) / cfg.gpt_checkpoint).read_bytes() == b"weights"
        return object()
    install_fake(monkeypatch, tmp_path, constructor)
    sidecar._load_model(io.BytesIO())
