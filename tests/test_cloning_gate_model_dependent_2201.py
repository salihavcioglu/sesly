"""#2201: don't tell a user their engine can't clone when its model can't.

    400: The active TTS engine 'mlx-audio' doesn't support voice cloning, so
    voice conversion can't preserve speaker voices. Switch to one of:
    omnivoice, cosyvoice, voxcpm2, … in Model Catalogue, or use OmniVoice.

mlx-audio clones fine. It multiplexes seven curated models and reports
``supports_cloning`` per MODEL, so the flag was False only because the pick in
force was Kokoro. The reporter was sent to abandon the engine for one of
thirteen others while their own model picker was offering "CSM (voice cloning)"
one setting away — the label is literally that, in ``_MLX_AUDIO_MODEL_LABELS``.

The gate message is built in one place and serves dubbing, batch and voice
conversion (``resolve_generation_backend(require_cloning=True)``), so the fix
lands on all three at once.

``cloning_capable_engine_ids()`` keeps excluding model-dependent adapters — a
class-level getattr on a property is always truthy, and listing mlx-audio
unconditionally would recommend it to users running Kokoro. That exclusion is
right for the *list*; it was never a reason for the *message* to claim the
engine cannot clone.
"""
import pytest


def _tts_backend():
    """Resolve the live module after other suites replace backend modules."""
    from services import tts_backend

    return tts_backend


def _detail(*args):
    """Resolved lazily so the behavioural tests below fail on their assertions
    rather than on a missing symbol against a tree without the fix."""
    from services import tts_backend

    return tts_backend.cloning_unavailable_detail(*args)


def _mlx(monkeypatch, model_key):
    """An mlx-audio instance pinned to `model_key`, no weights loaded."""
    monkeypatch.setenv("OMNIVOICE_MLX_AUDIO_MODEL", model_key)
    monkeypatch.setattr(
        _tts_backend().MLXAudioBackend, "_ensure_loaded",
        lambda self: pytest.fail("the capability check must not load weights"),
    )
    return _tts_backend().MLXAudioBackend()


# ── the reported failure ────────────────────────────────────────────────────


def test_the_message_names_the_model_to_switch_to_not_just_other_engines(monkeypatch):
    detail = _detail(
        "mlx-audio", _mlx(monkeypatch, "kokoro"), "voice conversion"
    )

    # The one-setting fix, in the words the picker uses.
    assert "CSM (voice cloning)" in detail
    assert "Model Catalogue" in detail
    # Names the model actually in the way, so "which model?" needs no guessing.
    assert _tts_backend().MLXAudioBackend.CURATED_MODELS["kokoro"] in detail
    # And no longer asserts something untrue about the engine.
    assert "doesn't support voice cloning" not in detail


def test_the_engine_list_survives_as_the_fallback(monkeypatch):
    """Switching model is the smaller change, but switching engine still works
    and must stay on offer."""
    detail = _detail(
        "mlx-audio", _mlx(monkeypatch, "kokoro"), "dubbing"
    )
    for engine_id in _tts_backend().cloning_capable_engine_ids():
        assert engine_id in detail


def test_the_purpose_is_still_named(monkeypatch):
    for purpose in ("voice conversion", "dubbing"):
        detail = _detail(
            "mlx-audio", _mlx(monkeypatch, "kokoro"), purpose
        )
        assert purpose in detail


# ── nothing else moves ──────────────────────────────────────────────────────


def test_a_fixed_non_cloning_engine_keeps_the_original_message():
    """KittenTTS declares a plain `supports_cloning = False` — there is no
    model to switch to, so the engine-switch message is the right one."""
    cls = _tts_backend().KittenTTSBackend
    backend = cls.__new__(cls)
    detail = _detail("kittentts", backend, "dubbing")

    assert "doesn't support voice cloning" in detail
    assert "Model Catalogue" in detail
    # No model advice, because there is no model choice to give.
    assert "this engine's model" not in detail


def test_model_dependent_engines_stay_out_of_the_capable_list():
    """Listing mlx-audio unconditionally would recommend it to a user running
    Kokoro, which is how this class of wrong advice starts."""
    assert "mlx-audio" not in _tts_backend().cloning_capable_engine_ids()
    assert "omnivoice" in _tts_backend().cloning_capable_engine_ids()


# ── the invariant that keeps this fixed ─────────────────────────────────────


def test_cloning_model_keys_match_supports_cloning(monkeypatch):
    """The declared keys and the property must agree, or the message starts
    recommending a model that cannot clone — the same bug pointed the other
    way. Proven against every curated model, not just the declared one."""
    declared = set(_tts_backend().MLXAudioBackend.cloning_model_keys)
    assert declared, "mlx-audio clones with at least one curated model"

    for key in _tts_backend().MLXAudioBackend.CURATED_MODELS:
        backend = _mlx(monkeypatch, key)
        assert backend.supports_cloning is (key in declared), (
            f"{key}: supports_cloning={backend.supports_cloning} but "
            f"{'' if key in declared else 'not '}declared in cloning_model_keys"
        )


def test_every_declared_key_is_a_real_curated_model():
    cls = _tts_backend().MLXAudioBackend
    unknown = set(cls.cloning_model_keys) - set(cls.CURATED_MODELS)
    assert not unknown, f"cloning_model_keys names models that do not exist: {unknown}"


def test_every_declared_key_has_a_picker_label():
    """The message quotes the picker, so a key with no label would send the
    user looking for an option that is not spelled that way."""
    from services.tts_backend import _MLX_AUDIO_MODEL_LABELS

    for key in _tts_backend().MLXAudioBackend.cloning_model_keys:
        assert _MLX_AUDIO_MODEL_LABELS.get(key), f"{key} has no picker label"
    assert _tts_backend().MLXAudioBackend.cloning_model_labels() == ("CSM (voice cloning)",)


def test_a_fixed_flag_engine_declares_no_cloning_models():
    """`cloning_model_keys` is only meaningful where the flag is model-derived;
    a plain bool with model keys would be a contradiction."""
    from services import tts_backend

    for engine_id, cls in tts_backend._REGISTRY.items():
        flag = getattr(cls, "supports_cloning", True)
        if isinstance(flag, bool) and getattr(cls, "cloning_model_keys", ()):
            pytest.fail(
                f"{engine_id}: declares cloning_model_keys but supports_cloning "
                f"is a fixed {flag}"
            )
