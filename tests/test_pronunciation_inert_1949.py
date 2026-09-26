"""#1949 — an entry that cannot be applied must say so, not look like no match.

Settings offers three notations: Respelling, IPA, CMU. Only respelling
substitutes text today. IPA and CMU rows save cleanly, are validated, get a
badge and can be toggled on — then get dropped before term matching, and
nothing downstream reads them.

That is Phase 1 behaving as designed. The defect is that it was INVISIBLE:
"Test a sentence" answered "No entries match; spoken as written" for a term
that does match. Not a degraded answer, a wrong one — and it sent the user off
to re-type an entry that was already correct.

docs/specs/01-expressive-tts.md asked for the opposite: such entries "passed
through and flagged 'phoneme not honored on this engine' (parity-rule: visible
degradation)". These tests pin that flag.
"""
import pytest

from services.pronunciation import (
    apply_pronunciation,
    entries_for_language,
    inert_entries_for_language,
)


def _row(term, replacement, etype, language="*", enabled=1):
    return {
        "term": term,
        "replacement": replacement,
        "type": etype,
        "language": language,
        "enabled": enabled,
    }


def test_a_cmu_entry_is_reported_as_inert():
    rows = [_row("Alphan", "AA0 L P HH AA0 N", "cmu")]
    assert entries_for_language(rows, "tr") == {}
    assert inert_entries_for_language(rows, "tr") == [{"term": "Alphan", "type": "cmu"}]


def test_an_ipa_entry_is_reported_as_inert():
    rows = [_row("gif", "dʒɪf", "ipa")]
    assert inert_entries_for_language(rows, "en") == [{"term": "gif", "type": "ipa"}]


def test_respelling_is_not_reported_because_it_works():
    rows = [_row("gif", "jiff", "respelling")]
    assert inert_entries_for_language(rows, "en") == []
    assert apply_pronunciation("a gif", rows, "en") == "a jiff"


def test_a_disabled_entry_is_not_reported():
    # The user turned it off; saying it was ignored would be noise.
    rows = [_row("gif", "dʒɪf", "ipa", enabled=0)]
    assert inert_entries_for_language(rows, "en") == []


def test_language_scoping_matches_the_applied_path():
    # An entry scoped to another language is not "ignored", it simply does not
    # apply here — reporting it would be misleading in the other direction.
    rows = [_row("gif", "dʒɪf", "ipa", language="de")]
    assert inert_entries_for_language(rows, "en") == []
    assert inert_entries_for_language(rows, "de") == [{"term": "gif", "type": "ipa"}]


def test_the_substitution_itself_is_unchanged():
    # This reports; it must not start feeding raw phoneme strings into the
    # grapheme stream, which is the thing Phase 1 deliberately refuses.
    rows = [_row("Alphan", "AA0 L P HH AA0 N", "cmu")]
    assert apply_pronunciation("Merhaba, ben Alphan.", rows, "tr") == "Merhaba, ben Alphan."


@pytest.mark.parametrize("etype", ["CMU", "Ipa", " ipa "])
def test_type_matching_tolerates_casing_and_padding(etype):
    rows = [_row("x", "y", etype)]
    assert len(inert_entries_for_language(rows, "en")) == 1
