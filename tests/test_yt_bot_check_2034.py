"""#2034 — YouTube's "Sign in to confirm you're not a bot" wall.

The reporter got yt-dlp's raw advice ("Use --cookies-from-browser or --cookies"),
which names CLI flags nobody using Sesly can pass. The app's own answer is
the Dub tab's cookies.txt import, so the failure gets its own class and hint,
and it is never retried as a network blip or escalated like a 403.
"""

REPORTED = (
    "download: ERROR: [youtube] TJAfLE39ZZ8: Sign in to confirm you\u2019re not a bot. "
    "Use --cookies-from-browser or --cookies for the authentication. See  "
    "https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how "
    "to manually pass cookies. Also see  "
    "https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies  for tips "
    "on effectively exporting YouTube cookies"
)


def test_the_reported_message_is_the_bot_check_class():
    from core.failure import classify

    assert classify(REPORTED) == "VIDEO_DOWNLOAD_BOT_CHECK"
    # yt-dlp has shipped both apostrophes.
    assert classify(REPORTED.replace("\u2019", "'")) == "VIDEO_DOWNLOAD_BOT_CHECK"


def test_the_hint_points_at_the_apps_own_cookie_import():
    from core.failure import _HINTS

    hint = _HINTS["VIDEO_DOWNLOAD_BOT_CHECK"]
    assert "cookies.txt" in hint and "Dub" in hint
    assert "--cookies" not in hint


def test_it_is_neither_retried_nor_escalated():
    from services.dub_pipeline import _is_forbidden_download_error, _is_transient_download_error

    exc = RuntimeError(REPORTED)
    assert not _is_transient_download_error(exc)
    assert not _is_forbidden_download_error(exc)


def test_a_plain_network_drop_is_still_the_network_class():
    from core.failure import classify

    assert classify("Unable to download video: Connection reset by peer") == "VIDEO_DOWNLOAD_NETWORK"
