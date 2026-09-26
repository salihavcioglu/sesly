"""Issue 4: cross-site multipart/form POSTs to loopback must be refused."""

from fastapi.testclient import TestClient

from _guard_app import build_app

FILES = {"f": ("a.wav", b"RIFF", "audio/wav")}
DATA = {"name": "x"}


def _client(client=("127.0.0.1", 50000)):
    return TestClient(build_app(), base_url="http://127.0.0.1:3900", client=client)


def test_cross_site_form_post_is_rejected():
    # A remote LAN peer (no loopback Origin gate) still hits the CSRF gate.
    c = _client(client=("192.168.1.50", 1))
    r = c.post("/upload", data=DATA, files=FILES,
               headers={"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403


def test_cross_site_without_origin_but_with_fetch_metadata_is_rejected():
    c = _client(client=("192.168.1.50", 1))
    r = c.post("/upload", data=DATA, files=FILES, headers={"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403
    r = c.post("/upload", data=DATA, files=FILES,
               headers={"Referer": "https://evil.example/page"})
    assert r.status_code == 403


def test_marker_header_allows_request():
    c = _client()
    for header in ("X-Sesly-CSRF", "X-Sesly-Request"):
        r = c.post("/upload", data=DATA, files=FILES,
                   headers={header: "1", "Sec-Fetch-Site": "cross-site"})
        assert r.status_code == 200, header


def test_same_origin_browser_request_allowed():
    c = _client()
    r = c.post("/upload", data=DATA, files=FILES,
               headers={"Origin": "http://127.0.0.1:3900", "Sec-Fetch-Site": "same-origin"})
    assert r.status_code == 200
    r = c.post("/upload", data=DATA, files=FILES,
               headers={"Referer": "http://127.0.0.1:3900/studio"})
    assert r.status_code == 200


def test_non_browser_client_without_browser_headers_allowed():
    # curl / SDKs / the MCP bridge send no Origin, Referer or Sec-Fetch-*.
    assert _client().post("/upload", data=DATA, files=FILES).status_code == 200


def test_openai_compat_exempt_only_with_bearer():
    c = _client(client=("192.168.1.50", 1))
    hostile = {"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example"}
    assert c.post("/v1/audio/speech", headers=hostile).status_code == 403
    r = c.post("/v1/audio/speech", headers={**hostile, "Authorization": "Bearer sk-local"})
    assert r.status_code == 200


def test_safe_methods_not_blocked():
    c = _client(client=("192.168.1.50", 1))
    assert c.get("/probe", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 200


def test_preflight_is_answered_by_cors_not_rejected():
    c = _client()
    r = c.options("/upload", headers={
        "Origin": "http://localhost:3901",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "x-sesly-csrf",
    })
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "http://localhost:3901"


def test_frontend_clients_always_send_marker():
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[2]
    web = (root / "frontend/src/api/client.ts").read_text(encoding="utf-8")
    assert "if (backendTarget) headers.set(CSRF_HEADER_NAME, '1');" in web
    desktop = (root / "electron/src/renderer/src/lib/api/client.ts").read_text(encoding="utf-8")
    assert desktop.count("headers.set(CSRF_HEADER_NAME, '1');") >= 2
