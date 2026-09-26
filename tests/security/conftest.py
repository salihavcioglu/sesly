import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(__file__))


@pytest.fixture(autouse=True)
def _strict_guard_env(monkeypatch):
    """Security tests run with the production allowlist (no ``testserver``)."""
    for name in (
        "SESLY_ALLOWED_HOSTS",
        "OMNIVOICE_SERVER_MODE",
        "OMNIVOICE_BIND_HOST",
        "OMNIVOICE_API_KEY",
        "OMNIVOICE_ALLOWED_ORIGINS",
        "SESLY_ALLOW_PRIVATE_URLS",
        "SESLY_YTDLP_REMOTE_COMPONENTS",
    ):
        monkeypatch.delenv(name, raising=False)
    from core import request_guard

    request_guard.clear_runtime_allowed_hosts()
    yield
    request_guard.clear_runtime_allowed_hosts()
