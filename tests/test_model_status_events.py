from __future__ import annotations


def test_model_lifecycle_transition_emits_realtime_status(monkeypatch):
    from core import event_bus
    from services import model_manager

    emitted: list[tuple[str, dict]] = []
    monkeypatch.setattr(event_bus, "emit", lambda kind, payload=None: emitted.append((kind, payload)))
    before = dict(model_manager._loading_detail)
    try:
        model_manager._set_loading("loading_weights", "Loading weights", progress=20)
        model_manager._set_loading("ready", "Model ready", progress=100)
    finally:
        model_manager._loading_detail.clear()
        model_manager._loading_detail.update(before)

    assert emitted == [
        ("model_status", {"sub_stage": "loading_weights"}),
        ("model_status", {"sub_stage": "ready"}),
    ]
