"""Accelerator cache release and dedicated-memory detection without hardware."""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest


@pytest.mark.parametrize('active', ['cpu', 'cuda', 'mps', 'xpu', 'npu'])
@pytest.mark.parametrize('npu_present', [False, True])
def test_memory_management_preserves_accelerator_routing(monkeypatch, active, npu_present):
    from services import model_manager as mm
    backends = {name: SimpleNamespace(is_available=lambda name=name: active == name,
                                     empty_cache=Mock())
                for name in ['cuda', 'mps', 'xpu', 'npu']}
    torch = SimpleNamespace(cuda=backends['cuda'], mps=backends['mps'],
                            xpu=backends['xpu'], backends=SimpleNamespace(mps=backends['mps']))
    if npu_present:
        torch.npu = backends['npu']
    monkeypatch.setattr(mm, '_lazy_torch', lambda: torch)
    monkeypatch.setattr(mm, '_clear_cublas_workspaces', Mock())
    mm.free_vram()
    for name, backend in backends.items():
        assert backend.empty_cache.call_count == int(active == name and (name != 'npu' or npu_present))
    assert mm._has_dedicated_vram() == (active in ['cuda', 'xpu'] or (active == 'npu' and npu_present))
