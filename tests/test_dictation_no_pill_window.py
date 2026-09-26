"""The dictation widget must stay safe while hidden and wake before capture.

The widget window hosts the recorder (`getUserMedia` + `MediaRecorder` + the
transcription WebSocket all live in `CaptureWidget.jsx`), so it has to exist
while idle. Some WebView engines suspend that hidden document, however, so a
start request must wake it before emitting the event it needs to record.

Two things keep that safe, and both are easy to undo by accident:

1. The window stamps `window.__OV_WINDOW__` from an `initialization_script`.
   Without it the frontend falls back to `getCurrentWindow().label`, which
   throws before Tauri's internals are injected — and the catch then guesses
   "main". A widget window that guesses wrong renders the whole app into
   300x64, with an opaque background and no CaptureWidget to hide it again:
   the dark rectangle that could only be cleared by killing the app.

2. Capture dispatch wakes it only through the non-activating pill command,
   after preserving the output target and before emitting the start event.
   The widget owns hiding itself again when it is idle.

The frontend half is pinned by
`frontend/src/test/DictationNoPillWindow.test.jsx`.
"""

import re
from pathlib import Path

import pytest

_LIB_RS = Path(__file__).resolve().parents[1] / "frontend" / "src-tauri" / "src" / "lib.rs"
_COMMANDS_RS = (
    Path(__file__).resolve().parents[1] / "frontend" / "src-tauri" / "src" / "commands.rs"
)


@pytest.fixture
def lib_rs() -> str:
    return _LIB_RS.read_text(encoding="utf-8")


@pytest.fixture
def commands_rs() -> str:
    return _COMMANDS_RS.read_text(encoding="utf-8")


def test_widget_window_stamps_its_identity_before_page_scripts(lib_rs: str) -> None:
    assert "initialization_script" in lib_rs, (
        "The widget window no longer injects an initialization_script. Window "
        "identity falls back to getCurrentWindow().label, which races Tauri's "
        "internals and strands an opaque window on the desktop."
    )
    assert "window.__OV_WINDOW__ = 'widget';" in lib_rs, (
        "The injected marker changed. frontend/src/main-app.jsx reads "
        "`window.__OV_WINDOW__` — keep the two in step or the widget window "
        "silently renders as the main window."
    )


def test_capture_dispatch_wakes_widget_before_emitting_start(lib_rs: str) -> None:
    """A hidden WebView cannot receive the event that tells it to show itself."""
    dispatch = re.search(
        r"fn dispatch_dictation_capture_from\(.*?\n\}", lib_rs, re.S
    )
    assert dispatch, "Could not locate dictation capture dispatch."
    body = dispatch.group(0)
    begin = body.find("begin_session")
    wake_guard = body.find('if event == "tray-dictate"', begin)
    wake = body.find("commands::show_dictation_pill")
    emit = body.find("app.emit")
    assert -1 not in (begin, wake_guard, wake, emit), (
        "Capture dispatch must preserve the output target, wake the hidden "
        "widget, then emit the start event."
    )
    assert begin < wake_guard < wake < emit, (
        "Wake the hidden recorder after preserving the output target and "
        "before emitting only a start; otherwise macOS can silently drop the "
        "request or a stop can reopen the pill."
    )


def test_in_page_capture_waits_for_listener_acceptance(commands_rs: str) -> None:
    request = re.search(
        r"pub async fn request_dictation_capture\(.*?\n\}", commands_rs, re.S
    )
    assert request, "The in-page capture command must remain asynchronous."
    body = request.group(0)
    assert "request_dictation_capture_delivery" in body
    assert "wait_for_capture_delivery" in body
    assert "completion_ready" in body
    assert "take_completion_or_cancel" in body
    assert "capture window did not acknowledge the request" in body
    assert "dictation capture did not start in time" in body


def test_no_computed_window_target_can_resolve_to_the_widget(lib_rs: str) -> None:
    """`"widget"` must never be chosen into a variable that is then shown.

    The check above only sees `get_webview_window("widget")` written out
    literally, and the single-instance handler did not write it that way:

        let target = if pill_mode { "widget" } else { "main" };
        if let Some(win) = app.get_webview_window(target) { win.show(); ... }

    In pill mode that showed the recorder window on every second launch —
    exactly the stranded rectangle, and reached by relaunching the app, which
    is what a user does when one is stuck on their desktop. It passed the
    literal check untouched, so pin the indirection too: every mention of the
    label has to be one of the known-safe uses.
    """
    allowed = (
        '&["widget", "main"]',  # window-state persistence denylist
        'get_webview_window("widget")',  # looked up (only ever to hide it)
        'window.label() != "main"',  # unrelated label comparison
        "window.__OV_WINDOW__ = 'widget';",  # the injected identity marker
        # Media-capture permissions are granted to both windows (#323). It
        # takes the handle but never shows it.
        'for label in ["main", "widget"]',
    )
    # The builder spells the label on its own line, so it can't be matched by
    # substring alongside `WebviewWindowBuilder::new(`.
    allowed_exact = ('"widget",',)
    offenders = []
    for lineno, line in enumerate(lib_rs.splitlines(), 1):
        if '"widget"' not in line:
            continue
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("///"):
            continue  # prose about the widget is not a call site
        if stripped in allowed_exact or any(ok in line for ok in allowed):
            continue
        offenders.append(f"{lineno}: {stripped}")
    assert not offenders, (
        "New use of the \"widget\" window label:\n  "
        + "\n  ".join(offenders)
        + "\nThe widget is a hidden recorder host. If this use is safe, add it "
        "to `allowed` above; if it can lead to show(), it puts an empty "
        "rectangle back on the user's desktop."
    )


def test_tray_toggle_does_not_infer_recording_from_visibility(lib_rs: str) -> None:
    """A permanently hidden window is never visible, so visibility can't mean
    'recording'. The tray Start/Stop item reads the `dictating` flag that the
    frontend already maintains via `set_tray_recording`."""
    assert "dictating" in lib_rs, "The dictating flag backing the tray toggle is gone."
    dictate_arm = re.search(r'"dictate" => \{(.*?)\n                        \}', lib_rs, re.S)
    assert dictate_arm, "Could not locate the tray 'dictate' handler to check it."
    body = dictate_arm.group(1)
    assert "is_visible" not in body, (
        "The tray dictate toggle is inferring recording state from window "
        "visibility again. The widget is never visible, so this makes Stop "
        "unreachable."
    )
    assert "dictating" in body, "The tray dictate toggle no longer reads the dictating flag."
