"""#1879 — "clone without a reference clip" must not be reported in library terms.

mlx-audio raises a bare ValueError naming its own parameters:

    No conditionals available. Either provide audio_prompt/audio_prompt_sr for
    voice cloning, or ensure conds.safetensors is in the model directory.

The generate route passed that straight through as the 400 detail, so the user
was told to supply an argument they have no way to name and to check for a file
they have never heard of. What actually happened is simply "you asked to clone
without giving anything to clone from".

The route still passes through every ValueError it cannot classify — most are
Sesly's own validation messages and are exactly what the user should
read, so the fix must not swallow them.
"""
import pytest

from core.failure import _CONTEXT_FREE_HINT_CLASSES, classify, public_hint_for_topic

_RAW = (
    "No conditionals available. Either provide audio_prompt/audio_prompt_sr "
    "for voice cloning, or ensure conds.safetensors is in the model directory."
)


def test_the_library_wording_is_classified():
    assert classify(_RAW) == "CLONE_REFERENCE_MISSING"


def test_the_remedy_talks_about_a_reference_clip():
    hint = public_hint_for_topic("CLONE_REFERENCE_MISSING")
    assert "reference" in hint.lower()
    # And never in the library's own vocabulary.
    assert "audio_prompt" not in hint
    assert "conds.safetensors" not in hint


def test_it_survives_the_context_free_filter():
    assert "CLONE_REFERENCE_MISSING" in _CONTEXT_FREE_HINT_CLASSES


@pytest.mark.parametrize(
    "message",
    [
        "Text is required.",
        "Unknown TTS engine: 'nope'. See GET /engines/tts for the list of valid engine ids.",
        "speed must be between 0.5 and 2.0",
        "reference audio is shorter than 1s",
    ],
)
def test_our_own_validation_messages_are_left_alone(message):
    # The route falls back to str(e) whenever classify() finds nothing, so a
    # good message must not classify to something else and get replaced.
    topic = classify(message)
    assert topic != "CLONE_REFERENCE_MISSING"


def test_the_route_replaces_only_the_classified_case():
    # Mirrors the handler: owned remedy when classified, raw text otherwise.
    def detail_for(text):
        topic = classify(text)
        owned = public_hint_for_topic(topic) if topic else ""
        return owned or text

    assert detail_for(_RAW) != _RAW
    assert "reference" in detail_for(_RAW).lower()
    assert detail_for("Text is required.") == "Text is required."
