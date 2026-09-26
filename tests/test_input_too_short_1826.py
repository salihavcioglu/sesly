"""#1826 — a degenerately short input must not surface as torch conv internals.

A one-or-two-character generation reaches a convolution whose kernel is wider
than the tensor it was given, and torch says so in its own terms:

    Calculated padded input size per channel: (1). Kernel size: (2). Kernel
    size can't be greater than actual input size

That arrived doubly wrapped in "Underlying error:" and told the user nothing
they could act on. The fix on their side is simply "type more than one
character", which the message never said.

It is also worth classifying because it is NOT transient: the engine will fail
the same way on every retry, and the generic wording invites exactly that.
"""
import pytest

from core.failure import _CONTEXT_FREE_HINT_CLASSES, classify, public_hint_for_topic
from core.public_errors import public_exception_response, stream_generation_failure

_RAW = (
    "Calculated padded input size per channel: (1). Kernel size: (2). "
    "Kernel size can't be greater than actual input size"
)
_WRAPPED = (
    "TTS engine stopped mid-generation with an error Sesly doesn't "
    "recognize. Retry once; if it keeps failing, please report it with the "
    f"full trace. Underlying error: RuntimeError: {_RAW}"
)


def test_the_torch_wording_is_classified():
    assert classify(_RAW) == "INPUT_TOO_SHORT"


def test_it_is_still_found_inside_the_wrapped_message():
    # This is how it actually reaches the user — nested two layers deep.
    assert classify(_WRAPPED) == "INPUT_TOO_SHORT"


def test_the_remedy_says_what_to_change():
    hint = public_hint_for_topic("INPUT_TOO_SHORT")
    assert "short" in hint.lower()
    assert "kernel" not in hint.lower() or "convolution" in hint.lower()


def test_it_does_not_invite_a_retry_that_cannot_work():
    # The generic message told the user to "retry once", which fails
    # identically every time for this class.
    hint = public_hint_for_topic("INPUT_TOO_SHORT")
    assert "not a transient failure" in hint


def test_it_reaches_the_user_on_both_surfaces():
    assert "INPUT_TOO_SHORT" in _CONTEXT_FREE_HINT_CLASSES
    payload = public_exception_response(RuntimeError(_WRAPPED), fallback="Internal error.")
    assert payload["docs_topic"] == "INPUT_TOO_SHORT"
    stream = stream_generation_failure(RuntimeError(_WRAPPED))
    assert stream.get("docs_topic") == "INPUT_TOO_SHORT"


@pytest.mark.parametrize(
    "other",
    [
        "CUDA out of memory. Tried to allocate 2.00 GiB",
        "No conditionals available. Either provide audio_prompt",
        "some unrelated runtime failure",
    ],
)
def test_it_does_not_capture_unrelated_failures(other):
    assert classify(other) != "INPUT_TOO_SHORT"
