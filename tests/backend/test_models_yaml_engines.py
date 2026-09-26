"""Every catalog model names the engines that load it.

The Model Catalogue lists downloadable weights UNDER their engine (the
`engines:` list in ``config/models.yaml``); a row with no owner falls into a
small "other weights" list instead. That only works if the mapping stays
complete and points at real backend ids, so this pins both: each entry
carries an explicit ``engines`` list (empty is allowed, and means "pipeline
weights no single engine owns"), and every id it names is a backend the
engines router would list for TTS or ASR.
"""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

YAML_PATH = Path(__file__).resolve().parents[2] / "backend" / "config" / "models.yaml"


def _catalog() -> list[dict]:
    with open(YAML_PATH, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    models = data.get("models") if isinstance(data, dict) else data
    assert isinstance(models, list) and models, "models.yaml has no model list"
    return models


@pytest.fixture(scope="module")
def known_engine_ids() -> set[str]:
    from services import asr_backend, tts_backend

    ids = {b["id"] for b in tts_backend.list_backends(include_hidden=True)}
    ids |= {b["id"] for b in asr_backend.list_backends()}
    return ids


def test_every_model_declares_its_engines():
    missing = [m["repo_id"] for m in _catalog() if not isinstance(m.get("engines"), list)]
    assert not missing, (
        "models.yaml entries without an `engines:` list (use `engines: []` for "
        f"pipeline weights no engine owns): {missing}"
    )


def test_engine_ids_in_models_yaml_exist(known_engine_ids):
    unknown = {
        (m["repo_id"], e)
        for m in _catalog()
        for e in m.get("engines") or []
        if e not in known_engine_ids
    }
    assert not unknown, f"models.yaml names engine ids the registry does not have: {sorted(unknown)}"


def test_sherpa_dictation_models_belong_to_the_sherpa_engine():
    for m in _catalog():
        if m.get("engine") == "sherpa-onnx":
            assert m.get("engines") == ["sherpa-onnx-asr"], m["repo_id"]
