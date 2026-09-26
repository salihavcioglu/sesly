"""#2135 — CUDA-graph capture must not be attempted on pre-Ampere GPUs.

`torch.compile(mode="reduce-overhead")` captures CUDA graphs. On a Turing
Tesla T4 (sm_75, Google Colab) that took the **entire backend process** down on
the first `/generate`: no Python traceback, no HTTP response, just a dead PID
and `ConnectionRefused` on the next `/health`. The capture aborts below the
interpreter, so neither the #278 eager-fallback wrapper nor any `except` in the
generate path can observe it — the only defence is not entering that path.

`_resolve_compile_mode()` keeps the compiled Inductor kernels (and most of the
speedup) while dropping graph capture on any device older than sm_80, and fails
*open* — a probe error or an unknown device keeps today's behaviour, so this
can only ever remove the optimization where it was measured to be dangerous.
"""
from __future__ import annotations

import sys
from types import SimpleNamespace

import pytest

@pytest.fixture
def model_manager():
    import importlib
    return importlib.import_module("services.model_manager")



class _FakeCuda:
    def __init__(self, capability, available=True, name="NVIDIA Tesla T4"):
        self._cap = tuple(capability)
        self._available = available
        self._name = name

    def is_available(self):
        return self._available

    def get_device_capability(self, idx=0):
        return self._cap

    def get_device_name(self, idx=0):
        return self._name


@pytest.fixture(autouse=True)
def _no_force_env(monkeypatch, model_manager):
    monkeypatch.delenv(model_manager._FORCE_CUDAGRAPH_ENV, raising=False)


def _fake_torch(monkeypatch, cuda):
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(cuda=cuda))


# ── the regression ──────────────────────────────────────────────────────────


def test_turing_t4_drops_cudagraph_mode(monkeypatch, model_manager):
    """The exact reporter configuration: Tesla T4, sm_75."""
    _fake_torch(monkeypatch, _FakeCuda((7, 5)))
    assert model_manager._resolve_compile_mode() == "default"


def test_volta_also_drops_cudagraph_mode(monkeypatch, model_manager):
    """sm_70 is likewise below the Ampere floor (V100, also common on Colab)."""
    _fake_torch(monkeypatch, _FakeCuda((7, 0), name="Tesla V100-SXM2-16GB"))
    assert model_manager._resolve_compile_mode() == "default"


def test_downgraded_mode_is_not_a_cudagraph_mode(monkeypatch, model_manager):
    """The point of the downgrade: no graph capture, so no #315 pinning either.

    Guards the property rather than the string — if the fallback mode is ever
    retuned, it must still be one that does not capture graphs.
    """
    _fake_torch(monkeypatch, _FakeCuda((7, 5)))
    assert model_manager._resolve_compile_mode() not in model_manager._CUDAGRAPH_COMPILE_MODES


# ── no regression for GPUs that work today ──────────────────────────────────


@pytest.mark.parametrize("capability", [(8, 0), (8, 6), (8, 9), (9, 0), (12, 0)])
def test_ampere_and_newer_keep_cudagraph_mode(monkeypatch, capability, model_manager):
    _fake_torch(monkeypatch, _FakeCuda(capability, name="NVIDIA RTX (fake)"))
    assert model_manager._resolve_compile_mode() == model_manager._TORCH_COMPILE_MODE


def test_force_env_restores_cudagraph_mode(monkeypatch, model_manager):
    """Operators benchmarking old GPUs can opt back in explicitly."""
    _fake_torch(monkeypatch, _FakeCuda((7, 5)))
    monkeypatch.setenv(model_manager._FORCE_CUDAGRAPH_ENV, "1")
    assert model_manager._resolve_compile_mode() == model_manager._TORCH_COMPILE_MODE


# ── fail-open: never lose the optimization to a bad probe ───────────────────


def test_capability_probe_error_keeps_configured_mode(monkeypatch, model_manager):
    class _BrokenCuda(_FakeCuda):
        def get_device_capability(self, idx=0):
            raise RuntimeError("driver error")

    _fake_torch(monkeypatch, _BrokenCuda((8, 0)))
    assert model_manager._resolve_compile_mode() == model_manager._TORCH_COMPILE_MODE


def test_cuda_unavailable_keeps_configured_mode(monkeypatch, model_manager):
    _fake_torch(monkeypatch, _FakeCuda((7, 5), available=False))
    assert model_manager._resolve_compile_mode() == model_manager._TORCH_COMPILE_MODE


def test_missing_torch_keeps_configured_mode(monkeypatch, model_manager):
    monkeypatch.setitem(sys.modules, "torch", None)
    assert model_manager._resolve_compile_mode() == model_manager._TORCH_COMPILE_MODE
