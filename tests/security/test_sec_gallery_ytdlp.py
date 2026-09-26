"""Issue 2: /gallery/download auth, URL validation and yt-dlp argv safety."""

import pathlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from core import url_safety
from core.request_guard import RequestGuardMiddleware

ROOT = pathlib.Path(__file__).resolve().parents[2]


@pytest.fixture()
def gallery(monkeypatch):
    from api.routers import gallery as mod

    calls = []

    class FakeProc:
        returncode = 1

        async def communicate(self):
            return b"", b"boom"

    async def fake_spawn(*argv, **kwargs):
        calls.append(list(argv))
        return FakeProc()

    monkeypatch.setattr(mod, "spawn_subprocess", fake_spawn)
    monkeypatch.setattr(url_safety, "_resolve", lambda host, port: ["142.250.72.14"])
    app = FastAPI()
    app.include_router(mod.router)
    app.add_middleware(RequestGuardMiddleware)
    return app, calls


def _post(app, url, client=("127.0.0.1", 1)):
    c = TestClient(app, base_url="http://127.0.0.1:3900", client=client)
    return c.post("/gallery/download", params={"video_url": url, "character_name": "x"})


def test_url_is_passed_after_double_dash_and_no_remote_components(gallery):
    app, calls = gallery
    r = _post(app, "https://www.youtube.com/watch?v=abc")
    assert r.status_code == 500  # fake yt-dlp failed; argv captured
    argv = calls[0]
    assert argv[-2:] == ["--", "https://www.youtube.com/watch?v=abc"]
    assert "--remote-components" not in argv


def test_remote_components_is_opt_in(gallery, monkeypatch):
    app, calls = gallery
    monkeypatch.setenv("SESLY_YTDLP_REMOTE_COMPONENTS", "ejs:github")
    _post(app, "https://www.youtube.com/watch?v=abc")
    i = calls[0].index("--remote-components")
    assert calls[0][i + 1] == "ejs:github"
    monkeypatch.setenv("SESLY_YTDLP_REMOTE_COMPONENTS", "--exec=calc")
    calls.clear()
    _post(app, "https://www.youtube.com/watch?v=abc")
    assert "--remote-components" not in calls[0]


@pytest.mark.parametrize(
    "url", ["--exec=calc.exe", "-o", "file:///etc/passwd", "ftp://x.test/a", "http://127.0.0.1:8080/"]
)
def test_option_like_or_unsafe_urls_rejected_before_spawn(gallery, url):
    app, calls = gallery
    r = _post(app, url)
    assert r.status_code == 400
    assert calls == []


def test_private_resolution_rejected(gallery, monkeypatch):
    app, calls = gallery
    monkeypatch.setattr(url_safety, "_resolve", lambda host, port: ["169.254.169.254"])
    assert _post(app, "http://rebind.example.test/").status_code == 400
    assert calls == []


def test_download_requires_admin(gallery):
    app, calls = gallery
    r = _post(app, "https://www.youtube.com/watch?v=abc", client=("192.168.1.50", 1))
    assert r.status_code == 403
    assert calls == []


def test_search_passes_query_after_double_dash(gallery):
    app, calls = gallery
    c = TestClient(app, base_url="http://127.0.0.1:3900", client=("127.0.0.1", 1))
    c.post("/gallery/search/youtube", params={"query": "--exec=calc"})
    argv = calls[0]
    assert argv[-2:] == ["--", "ytsearch5:--exec=calc"]
    assert "--remote-components" not in argv


def test_no_hardcoded_remote_components_left():
    for path in (ROOT / "backend").rglob("*.py"):
        if "tests" in path.parts:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        assert '"ejs:github"' not in text, path
