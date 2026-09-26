"""#1808 — timeout guidance must name the control the user actually has.

#1797 moved the compute-time budget into Settings → Performance & Device, but
three branches of `_timeout_guidance` still told the user to raise
OMNIVOICE_GENERATE_TIMEOUT_S. That sends someone to set an environment variable
for a value the app now exposes as a slider — and on Windows in particular,
setting one durably is exactly the trap the project's own docs warn against.

The env var still works and still shadows the setting; nothing about the
mechanism changed. What changed is which of the two the message names.
"""
import re

import pytest

from services.model_manager import _timeout_guidance

_ENV_VAR = "OMNIVOICE_GENERATE_TIMEOUT_S"
_SETTINGS = "Settings → Performance & Device"


@pytest.mark.parametrize("wedged", [False, True])
@pytest.mark.parametrize("min_vram_gb", [0.0, 24.0])
def test_no_branch_sends_the_user_to_an_environment_variable(wedged, min_vram_gb):
    text = _timeout_guidance("generation", 300.0, min_vram_gb, wedged=wedged)
    assert _ENV_VAR not in text


@pytest.mark.parametrize("min_vram_gb", [0.0, 24.0])
def test_the_advice_names_the_in_app_control(min_vram_gb):
    text = _timeout_guidance("generation", 300.0, min_vram_gb)
    assert _SETTINGS in text


def test_the_message_still_says_what_happened():
    # The rewrite must not cost the diagnosis — only the remedy changed.
    text = _timeout_guidance("generation", 300.0)
    assert "300" in text or "compute" in text.lower()


def test_no_user_facing_string_in_the_module_names_the_env_var():
    # The whole class, not the three instances: a new branch added later must
    # not reintroduce it. Comments and the config read itself are exempt —
    # those are how the variable is still honoured.
    import inspect

    import services.model_manager as mm

    source = inspect.getsource(mm)
    offenders = []
    for line in source.splitlines():
        if _ENV_VAR not in line:
            continue
        stripped = line.strip()
        if stripped.startswith("#") or "os.environ" in line:
            continue
        # A bare mention inside a docstring/comment-like policy note is fine;
        # what matters is a quoted string handed to a user.
        if re.search(r'["\'][^"\']*' + _ENV_VAR, line):
            offenders.append(stripped)
    assert offenders == [], (
        "timeout guidance names an environment variable instead of "
        f"{_SETTINGS}: {offenders}"
    )
