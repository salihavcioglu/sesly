"""Every TTS engine points at a doc page, and that page exists (#1866).

The engine rows in Model Catalogue cannot explain an unavailable
engine themselves: `api.public_engine_metadata.public_backends` replaces the
computed `reason` and `last_error` with fixed strings before they reach the UI,
because an availability probe can carry exception text or a local path. The doc
pages under `docs/engines/` are what does explain it, and nothing in the app
linked to them, so the point of failure was a dead end.

`_ENGINE_DOCS` closes that, and this file keeps it honest. A registry entry
whose file was renamed, or a new engine added without one, would otherwise ship
a broken "Learn more" link — the kind of drift a mechanical test catches and a
reviewer does not. Same idea as tests/test_cosyvoice_install_docs.py, which
cross-checks a docs claim against the installer registry.
"""

from __future__ import annotations

import os

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _registry():
    from services import tts_backend

    return tts_backend


def test_every_registered_engine_has_a_doc():
    tb = _registry()
    missing = sorted(set(tb._REGISTRY.keys()) - set(tb._ENGINE_DOCS))
    assert missing == [], (
        "engine(s) with no docs/engines page — add one and map it in "
        f"_ENGINE_DOCS, or the row's Learn more link disappears: {missing}"
    )


def test_no_doc_entry_outlives_its_engine():
    tb = _registry()
    orphans = sorted(set(tb._ENGINE_DOCS) - set(tb._REGISTRY.keys()))
    assert orphans == [], f"_ENGINE_DOCS maps engine ids that no longer exist: {orphans}"


def test_every_mapped_doc_is_really_there():
    tb = _registry()
    broken = sorted(
        f"{bid} -> {path}"
        for bid, path in tb._ENGINE_DOCS.items()
        if not os.path.isfile(os.path.join(_REPO_ROOT, path))
    )
    assert broken == [], f"_ENGINE_DOCS points at files that do not exist: {broken}"


def test_docs_url_is_built_from_the_project_link_constant():
    tb = _registry()
    from core import links

    url = tb._engine_docs_url("cosyvoice")
    assert url == f"{links.PROJECT_REPO_BLOB_MAIN}/docs/engines/cosyvoice.md"
    # An id the registry does not carry gets no link rather than a 404 URL.
    assert tb._engine_docs_url("not-an-engine") is None


def test_docs_url_survives_the_public_metadata_scrub():
    """The whole point: `reason` is replaced, `docs_url` is not.

    A fix that put the doc link anywhere the scrub touches would ship a null
    href to the one screen that needs it.
    """
    from api.public_engine_metadata import public_backends

    entry = {
        "id": "cosyvoice",
        "available": False,
        "reason": "cosyvoice package not installed. Install from /home/alice/CosyVoice",
        "last_error": "cosyvoice package not installed.",
        "docs_url": "https://example.invalid/docs/engines/cosyvoice.md",
        "install_hint": "git clone --recursive FunAudioLLM/CosyVoice",
    }
    (public,) = public_backends([entry])

    # The reason is still replaced — what matters here is that no private text
    # survives it. Since #1866 the replacement names the KIND of problem, so
    # pinning the old generic sentence would fight that on purpose.
    assert "/home/alice" not in public["reason"]
    assert "CosyVoice" not in public["reason"]
    assert "isn't installed yet" in public["reason"]
    assert public["last_error"] == "A previous engine check failed."
    assert "/home/alice" not in public["reason"]
    assert public["docs_url"] == entry["docs_url"]
    assert public["install_hint"] == entry["install_hint"]
