"""#1957 — WinError 448 must arrive with a remedy, not as a bare OS sentence.

A download failed with "[WinError 448] The path cannot be traversed because it
contains an untrusted mount point: <a folder on D:>" and nothing else.
That is a Windows rule about the VOLUME — Dev Drives, mounted VHD/ReFS volumes,
and junctions into another profile all trigger it — so no amount of retrying
the same link helps, and the message gives the user nothing to change.

Matched on the numeric code first because Windows translates the sentence, with
the English phrase as a fallback for locales that report it verbatim.
"""
import pytest

from core.failure import _CONTEXT_FREE_HINT_CLASSES, classify, public_hint_for_topic
from core.public_errors import public_exception_response

_RAW = (
    "download: [WinError 448] The path cannot be traversed because it contains "
    r"an untrusted mount point: 'D:\CodingStuff\nodejs'"
)


def test_the_windows_code_is_classified():
    assert classify(_RAW) == "WINDOWS_UNTRUSTED_MOUNT"


def test_a_translated_message_still_classifies_on_the_code():
    # Windows localises the sentence; the bracketed code is what survives.
    assert classify("[WinError 448] Der Pfad kann nicht durchlaufen werden") == (
        "WINDOWS_UNTRUSTED_MOUNT"
    )


def test_the_english_phrase_alone_classifies():
    assert classify("contains an untrusted mount point") == "WINDOWS_UNTRUSTED_MOUNT"


def test_the_hint_names_something_the_user_can_change():
    hint = public_hint_for_topic("WINDOWS_UNTRUSTED_MOUNT")
    assert "Storage" in hint
    assert "448" in hint


def test_it_reaches_the_user_on_a_context_free_surface():
    # The failure arrives through the global 500 handler, which only attaches
    # hints from the allowlist — so being classified is not enough on its own.
    assert "WINDOWS_UNTRUSTED_MOUNT" in _CONTEXT_FREE_HINT_CLASSES
    payload = public_exception_response(OSError(_RAW), fallback="Internal error.")
    assert payload["docs_topic"] == "WINDOWS_UNTRUSTED_MOUNT"
    assert payload["detail"] != "Internal error."


def test_the_offending_path_is_never_echoed_back():
    payload = public_exception_response(OSError(_RAW), fallback="Internal error.")
    for value in payload.values():
        assert "CodingStuff" not in str(value)


@pytest.mark.parametrize(
    "other",
    [
        "[WinError 1260] blocked by an application control policy",
        "[WinError 1455] The paging file is too small for this operation",
    ],
)
def test_the_other_windows_classes_are_untouched(other):
    assert classify(other) != "WINDOWS_UNTRUSTED_MOUNT"
