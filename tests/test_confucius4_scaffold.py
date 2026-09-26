"""Confucius4-TTS engine scaffold (#590).

The engine is opt-in (gated behind OMNIVOICE_CONFUCIUS4_TTS_DIR) and
subprocess-isolated, so it must be wired into the registry yet completely inert
on a default install — never importing the (unvalidated) upstream package, never
reporting available without a clone. These tests pin exactly that.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))


def test_registered_in_lazy_registry():
    from services.tts_backend import _LAZY_REGISTRY
    assert _LAZY_REGISTRY.get("confucius4-tts") == ("engines.confucius4", "Confucius4Backend")


def test_backend_class_metadata():
    from engines.confucius4 import Confucius4Backend
    assert Confucius4Backend.id == "confucius4-tts"
    assert Confucius4Backend.gpu_compat == ("cuda", "rocm", "xpu", "npu", "cpu")
    assert Confucius4Backend.supports_voice_design is False


def test_inert_without_clone_dir(monkeypatch):
    monkeypatch.delenv("OMNIVOICE_CONFUCIUS4_TTS_DIR", raising=False)
    from engines.confucius4 import bootstrap
    bootstrap.invalidate()
    assert bootstrap.is_confucius4_installed() is False

    from engines.confucius4 import Confucius4Backend
    ok, reason = Confucius4Backend.is_available()
    assert ok is False
    assert "OMNIVOICE_CONFUCIUS4_TTS_DIR" in reason


def test_resolve_raises_actionable_without_clone(monkeypatch):
    monkeypatch.delenv("OMNIVOICE_CONFUCIUS4_TTS_DIR", raising=False)
    from engines.confucius4 import bootstrap
    bootstrap.invalidate()
    import pytest
    with pytest.raises(RuntimeError, match="OMNIVOICE_CONFUCIUS4_TTS_DIR"):
        bootstrap.resolve_confucius4_venv()


def test_catalog_metadata_does_not_exclude_supported_accelerators():
    from engines.confucius4 import Confucius4Backend
    from services.tts_backend import _INSTALL_HINTS

    # The catalog label is device-neutral; routing metadata owns hardware claims.
    assert not re.search(
        r"\b(?:cuda|rocm|xpu|npu|cpu|mps)\b",
        Confucius4Backend.display_name,
        re.IGNORECASE,
    )
    assert "CUDA/CPU" not in _INSTALL_HINTS[Confucius4Backend.id]
    for family in Confucius4Backend.gpu_compat:
        assert family in _INSTALL_HINTS[Confucius4Backend.id].lower()


def test_parent_resolves_home_relative_clone_without_bootstrapping(monkeypatch, tmp_path):
    from engines.confucius4 import bootstrap
    from unittest.mock import Mock
    clone = tmp_path / "home" / "Confucius4-TTS"
    python = bootstrap._venv_python_path(clone / ".venv")
    python.parent.mkdir(parents=True)
    python.write_text("existing interpreter")
    monkeypatch.setenv("HOME", str(clone.parent))
    monkeypatch.setenv("USERPROFILE", str(clone.parent))
    monkeypatch.setenv(bootstrap._CLONE_DIR_ENV, "~/Confucius4-TTS")
    monkeypatch.setattr(bootstrap, "_ENGINES_VENV_DIR", tmp_path / "not-installed")
    monkeypatch.setattr(bootstrap, "_resolved_python", None)
    install = Mock(side_effect=AssertionError("must reuse the existing venv"))
    probe = Mock(return_value="yes")
    monkeypatch.setattr(bootstrap, "_bootstrap_engines_venv", install)
    monkeypatch.setattr(bootstrap, "venv_can_import", probe)
    assert bootstrap.is_confucius4_installed()
    assert bootstrap.resolve_confucius4_venv() == python
    assert probe.call_args.args[0] == python
    assert repr(str(clone)) in probe.call_args.args[1]
    install.assert_not_called()
