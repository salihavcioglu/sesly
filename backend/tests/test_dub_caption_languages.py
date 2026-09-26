from services.dub_pipeline import _default_caption_languages


def test_caption_languages_include_manual_and_declared_source_tracks():
    assert _default_caption_languages(
        {
            "language": "en",
            "subtitles": {"fr": [{}]},
            "automatic_captions": {"en": [{}], "en-orig": [{}], "es": [{}]},
        }
    ) == ["en-orig", "fr"]


def test_caption_languages_prefer_matching_manual_source_over_automatic_duplicate():
    assert _default_caption_languages(
        {
            "language": "en-US",
            "subtitles": {"en": [{}], "fr": [{}]},
            "automatic_captions": {"en-orig": [{}], "en-US": [{}]},
        }
    ) == ["en", "fr"]


def test_caption_languages_recover_original_auto_track_without_language_metadata():
    assert _default_caption_languages(
        {
            "automatic_captions": {
                "de": [{}],
                "ja-orig": [{}],
                "es": [{}],
            }
        }
    ) == ["ja-orig"]


def test_caption_languages_do_not_guess_from_translated_automatic_tracks():
    assert _default_caption_languages(
        {"automatic_captions": {"de": [{}], "es": [{}]}}
    ) == []
