"""Tests for backend/api/routers/settings.py perf endpoints + engine_env helper.

Covers INST-12 (Disable torch.compile Windows toggle):
  - GET /api/settings/perf/torch-compile-disabled returns the default + platform.
  - PUT round-trips through the settings_store (persisted as text "1"/"0").
  - PUT from a non-loopback origin is rejected with 403 (threat T-02-04).
  - The engine_env helper injects TORCH_COMPILE_DISABLE=1 when the flag is set,
    on every platform (#2135 widened this from win32-only).
  - An env-set TORCH_COMPILE_DISABLE on the parent propagates to children.
  - When neither the flag nor the env var is set, the var is never injected.
"""
from __future__ import annotations

import sys

import pytest


@pytest.fixture
def fresh_app(monkeypatch, tmp_path):
    """Same isolation pattern as tests/backend/test_engine_spawn_token.py —
    new tmp DB + a fresh settings router instance per test."""
    from huggingface_hub import constants
    monkeypatch.setattr(constants, "HF_TOKEN_PATH", str(tmp_path / "hf-token"))
    monkeypatch.setattr(constants, "HF_STORED_TOKENS_PATH", str(tmp_path / "stored_tokens"))
    monkeypatch.setenv("HF_TOKEN_PATH", str(tmp_path / "hf-token"))
    monkeypatch.setenv("OMNIVOICE_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HUGGING_FACE_HUB_TOKEN", raising=False)

    for mod in list(sys.modules):
        if (
            mod == "core" or mod.startswith("core.")
            or mod == "services" or mod.startswith("services.")
            or mod == "api" or mod.startswith("api.")
        ):
            del sys.modules[mod]

    from core import db as _db
    _db.init_db()

    from fastapi import FastAPI
    from api.routers import settings as settings_router

    app = FastAPI()
    app.include_router(settings_router.router)
    return app


def _client(app):
    from fastapi.testclient import TestClient
    return TestClient(app, client=("127.0.0.1", 12345))


def test_get_default_state(fresh_app, monkeypatch):
    """Fresh DB → enabled=False, platform=<runtime>."""
    import huggingface_hub
    monkeypatch.setattr(huggingface_hub, "get_token", lambda: None)
    c = _client(fresh_app)
    r = c.get("/api/settings/perf/torch-compile-disabled")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["enabled"] is False
    assert body["platform"] in {"darwin", "linux", "win32"}


def test_put_enabled_true_persists(fresh_app, monkeypatch):
    import huggingface_hub
    monkeypatch.setattr(huggingface_hub, "get_token", lambda: None)
    c = _client(fresh_app)
    r = c.put(
        "/api/settings/perf/torch-compile-disabled",
        json={"enabled": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["enabled"] is True
    r2 = c.get("/api/settings/perf/torch-compile-disabled")
    assert r2.json()["enabled"] is True


def test_put_non_loopback_rejected(fresh_app):
    """T-02-04: a PUT from a non-loopback origin is 403."""
    from fastapi.testclient import TestClient
    with TestClient(fresh_app, client=("10.0.0.5", 12345)) as c:
        r = c.put(
            "/api/settings/perf/torch-compile-disabled",
            json={"enabled": True},
        )
    assert r.status_code == 403


def test_value_round_trips_via_settings_store(fresh_app, monkeypatch):
    import huggingface_hub
    monkeypatch.setattr(huggingface_hub, "get_token", lambda: None)
    c = _client(fresh_app)
    c.put("/api/settings/perf/torch-compile-disabled", json={"enabled": True})
    from services import settings_store
    assert settings_store.get_text("perf.torch_compile_disabled") == "1"
    c.put("/api/settings/perf/torch-compile-disabled", json={"enabled": False})
    assert settings_store.get_text("perf.torch_compile_disabled") == "0"


def test_env_injection_when_enabled_on_windows(monkeypatch, tmp_path):
    """build_engine_env injects TORCH_COMPILE_DISABLE=1 on win32 + flag true."""
    from huggingface_hub import constants
    monkeypatch.setattr(constants, "HF_TOKEN_PATH", str(tmp_path / "hf-token"))
    monkeypatch.setattr(constants, "HF_STORED_TOKENS_PATH", str(tmp_path / "stored_tokens"))
    monkeypatch.setenv("HF_TOKEN_PATH", str(tmp_path / "hf-token"))
    monkeypatch.setenv("OMNIVOICE_DATA_DIR", str(tmp_path))
    for mod in list(sys.modules):
        if mod == "core" or mod.startswith("core.") or mod == "services" or mod.startswith("services."):
            del sys.modules[mod]
    from core import db as _db
    _db.init_db()

    from services import settings_store, engine_env
    settings_store.set_text("perf.torch_compile_disabled", "1")

    monkeypatch.setattr(sys, "platform", "win32")
    # token resolver must not blow up — monkeypatch.resolve to return None
    from services import token_resolver
    monkeypatch.setattr(token_resolver, "resolve", lambda **kw: None)

    env = engine_env.build_engine_env(base_env={})
    assert env.get("TORCH_COMPILE_DISABLE") == "1"


def test_env_injection_on_non_windows(monkeypatch, tmp_path):
    """#2135: the toggle injects on macOS/Linux too, not just win32.

    Was previously asserted the other way round — the flag was scoped to
    Windows on the theory that torch.compile only misbehaves there. #2135 is a
    Linux/CUDA host whose engine crashed under torch.compile with no way to
    turn it off, so a Settings toggle that silently no-ops on the user's
    platform is itself the bug.
    """
    from huggingface_hub import constants
    monkeypatch.setattr(constants, "HF_TOKEN_PATH", str(tmp_path / "hf-token"))
    monkeypatch.setattr(constants, "HF_STORED_TOKENS_PATH", str(tmp_path / "stored_tokens"))
    monkeypatch.setenv("HF_TOKEN_PATH", str(tmp_path / "hf-token"))
    monkeypatch.setenv("OMNIVOICE_DATA_DIR", str(tmp_path))
    for mod in list(sys.modules):
        if mod == "core" or mod.startswith("core.") or mod == "services" or mod.startswith("services."):
            del sys.modules[mod]
    from core import db as _db
    _db.init_db()

    from services import settings_store, engine_env, token_resolver
    settings_store.set_text("perf.torch_compile_disabled", "1")
    monkeypatch.setattr(token_resolver, "resolve", lambda **kw: None)

    monkeypatch.setattr(sys, "platform", "darwin")
    env = engine_env.build_engine_env(base_env={})
    assert env.get("TORCH_COMPILE_DISABLE") == "1"

    monkeypatch.setattr(sys, "platform", "linux")
    env = engine_env.build_engine_env(base_env={})
    assert env.get("TORCH_COMPILE_DISABLE") == "1"


def test_env_optout_propagates_to_children(monkeypatch, tmp_path):
    """#2135: TORCH_COMPILE_DISABLE on the parent reaches engine subprocesses.

    An operator who exported the documented variable used to get an eager
    parent and a *compiled* sidecar — the inconsistency that made the flag
    look ignored. Holds even with the Settings toggle off.
    """
    from huggingface_hub import constants
    monkeypatch.setattr(constants, "HF_TOKEN_PATH", str(tmp_path / "hf-token"))
    monkeypatch.setattr(constants, "HF_STORED_TOKENS_PATH", str(tmp_path / "stored_tokens"))
    monkeypatch.setenv("HF_TOKEN_PATH", str(tmp_path / "hf-token"))
    monkeypatch.setenv("OMNIVOICE_DATA_DIR", str(tmp_path))
    for mod in list(sys.modules):
        if mod == "core" or mod.startswith("core.") or mod == "services" or mod.startswith("services."):
            del sys.modules[mod]
    from core import db as _db
    _db.init_db()

    from services import settings_store, engine_env, token_resolver
    settings_store.set_text("perf.torch_compile_disabled", "0")
    monkeypatch.setattr(token_resolver, "resolve", lambda **kw: None)
    monkeypatch.setattr(sys, "platform", "linux")

    monkeypatch.setenv("TORCH_COMPILE_DISABLE", "1")
    env = engine_env.build_engine_env(base_env={})
    assert env.get("TORCH_COMPILE_DISABLE") == "1"


def test_no_env_injection_when_disabled(monkeypatch, tmp_path):
    """Flag false on win32 → var not injected."""
    from huggingface_hub import constants
    monkeypatch.setattr(constants, "HF_TOKEN_PATH", str(tmp_path / "hf-token"))
    monkeypatch.setattr(constants, "HF_STORED_TOKENS_PATH", str(tmp_path / "stored_tokens"))
    monkeypatch.setenv("HF_TOKEN_PATH", str(tmp_path / "hf-token"))
    monkeypatch.setenv("OMNIVOICE_DATA_DIR", str(tmp_path))
    for mod in list(sys.modules):
        if mod == "core" or mod.startswith("core.") or mod == "services" or mod.startswith("services."):
            del sys.modules[mod]
    from core import db as _db
    _db.init_db()

    from services import settings_store, engine_env, token_resolver
    settings_store.set_text("perf.torch_compile_disabled", "0")
    monkeypatch.setattr(token_resolver, "resolve", lambda **kw: None)
    monkeypatch.setattr(sys, "platform", "win32")
    # #2135 added an env-driven injection path; this test is about the *flag*,
    # so the ambient env must not be able to satisfy the assertion either way.
    for _name in ("TORCH_COMPILE_DISABLE", "TORCHDYNAMO_DISABLE", "TORCHINDUCTOR_DISABLE"):
        monkeypatch.delenv(_name, raising=False)
    env = engine_env.build_engine_env(base_env={})
    assert "TORCH_COMPILE_DISABLE" not in env
