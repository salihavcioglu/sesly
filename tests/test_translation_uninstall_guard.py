"""Uninstalling a translation engine must never break the app or another engine (#2019).

`pip uninstall` acts on Sesly's own environment. The LLM engine's package
(openai) is a core dependency of the app, and deep_translator backs four online
engines at once, so removing either through one engine broke something else.
"""
import asyncio

import pytest
from fastapi import HTTPException


def _router():
    # Resolved at call time: other suites purge `services` from sys.modules, so
    # the module the router holds is the one to patch.
    from api.routers import engines as engines_router

    return engines_router, engines_router.translation_engines


def _uninstall(monkeypatch, engine_id, *, pip=None):
    engines_router, te = _router()
    monkeypatch.setattr(te, "is_frozen", lambda: False)

    async def no_pip(args, timeout=600.0):
        pytest.fail(f"pip ran: {args}")

    monkeypatch.setattr(te, "run_pip", pip or no_pip)
    return asyncio.run(engines_router.uninstall_translation_engine(engine_id))


def test_every_engine_backed_by_an_app_dependency_is_builtin():
    _, te = _router()
    core = te._app_dependency_names()
    assert "openai" in core and "argostranslate" in core  # the metadata is readable here
    for engine_id, entry in te.REGISTRY.items():
        pkg = entry.get("pip_package")
        if pkg and te._normalize(pkg) in core:
            assert entry.get("builtin"), engine_id


def test_a_package_the_app_depends_on_is_never_uninstalled(monkeypatch):
    # Even through an entry nobody marked builtin.
    _, te = _router()
    monkeypatch.setitem(te.REGISTRY, "x-llm", {"id": "x-llm", "display_name": "X", "pip_package": "openai"})
    with pytest.raises(HTTPException) as err:
        _uninstall(monkeypatch, "x-llm")
    assert err.value.status_code == 400
    assert "Sesly itself" in err.value.detail


def test_a_package_other_engines_share_is_never_uninstalled(monkeypatch):
    with pytest.raises(HTTPException) as err:
        _uninstall(monkeypatch, "google")
    assert err.value.status_code == 409
    for name in ("DeepL", "Microsoft", "MyMemory"):
        assert name in err.value.detail


def test_names_compare_in_normalized_form():
    _, te = _router()
    assert te._normalize("deep_translator") == te._normalize("Deep-Translator") == "deep-translator"


def test_an_unshared_optional_package_can_still_be_uninstalled(monkeypatch):
    _, te = _router()
    monkeypatch.setitem(te.REGISTRY, "solo", {"id": "solo", "display_name": "Solo", "pip_package": "solo-translator"})
    ran = []

    async def fake_pip(args, timeout=600.0):
        ran.append(args)
        return 0, "ok"

    res = _uninstall(monkeypatch, "solo", pip=fake_pip)
    assert res["status"] == "uninstalled"
    assert ran == [["uninstall", "-y", "solo-translator"]]
