"""Issue 1: DNS rebinding must not reach loopback-trusted admin routes."""

from types import SimpleNamespace

from fastapi.testclient import TestClient

from _guard_app import build_app

LOOPBACK = ("127.0.0.1", 50000)


def _client(base_url="http://127.0.0.1:3900", client=LOOPBACK):
    return TestClient(build_app(), base_url=base_url, client=client)


def test_rebound_host_is_rejected_before_routing():
    c = _client("http://evil.example:3900")
    assert c.get("/probe").status_code == 421
    assert c.post("/admin/action", headers={"X-Sesly-CSRF": "1"}).status_code == 421


def test_loopback_hosts_are_accepted():
    for base in ("http://127.0.0.1:3900", "http://localhost:3900", "http://[::1]:3900"):
        assert _client(base).post("/admin/action").status_code == 200, base


def test_ip_literal_hosts_cannot_be_rebound_and_are_accepted():
    assert _client("http://192.168.1.20:3900").get("/probe").status_code == 200


def test_env_allowlist_and_wildcard(monkeypatch):
    monkeypatch.setenv("SESLY_ALLOWED_HOSTS", "studio.example.test")
    assert _client("http://studio.example.test").get("/probe").status_code == 200
    assert _client("http://other.example.test").get("/probe").status_code == 421
    monkeypatch.setenv("SESLY_ALLOWED_HOSTS", "*")
    assert _client("http://other.example.test").get("/probe").status_code == 200


def test_configured_bind_host_is_allowed(monkeypatch):
    monkeypatch.setenv("OMNIVOICE_BIND_HOST", "mybox.lan")
    assert _client("http://mybox.lan:3900").get("/probe").status_code == 200


def test_runtime_host_registered_by_tailscale_serve():
    from core.request_guard import add_runtime_allowed_host, remove_runtime_allowed_host

    add_runtime_allowed_host("box.tail1234.ts.net")
    assert _client("https://box.tail1234.ts.net").get("/probe").status_code == 200
    remove_runtime_allowed_host("box.tail1234.ts.net")
    assert _client("https://box.tail1234.ts.net").get("/probe").status_code == 421


def test_lan_share_hostname_allowed_only_while_sharing(monkeypatch):
    import socket

    monkeypatch.setattr(socket, "gethostname", lambda: "studio-pc")
    app = build_app()
    app.state.network_share = SimpleNamespace(enabled=True, lan_addresses=["10.0.0.9"])
    c = TestClient(app, base_url="http://studio-pc.local:3901", client=("10.0.0.7", 1))
    assert c.get("/probe").status_code == 200
    app.state.network_share = SimpleNamespace(enabled=False, lan_addresses=[])
    assert c.get("/probe").status_code == 421


def test_server_mode_keeps_public_names_for_remote_peers_only(monkeypatch):
    monkeypatch.setenv("OMNIVOICE_SERVER_MODE", "1")
    remote = _client("https://voice.example.org", client=("172.17.0.1", 5))
    assert remote.get("/probe").status_code == 200
    local = _client("https://voice.example.org", client=LOOPBACK)
    assert local.get("/probe").status_code == 421


def test_loopback_foreign_origin_is_refused_even_with_allowed_host():
    c = _client()
    r = c.post("/admin/action", headers={"Origin": "https://evil.example", "X-Sesly-CSRF": "1"})
    assert r.status_code == 403
    assert c.get("/probe", headers={"Origin": "null"}).status_code == 403


def test_loopback_trusted_origins_pass():
    c = _client()
    for origin in ("app://sesly", "http://localhost:3901", "http://127.0.0.1:3900", "tauri://localhost"):
        assert c.post("/admin/action", headers={"Origin": origin}).status_code == 200, origin


def test_electron_app_proxy_shape_passes():
    # protocol.ts drops Origin/Host/Referer/sec-*; net.fetch sets Host to the
    # backend base (127.0.0.1:<port>) and forwards x-* headers.
    c = _client("http://127.0.0.1:3900")
    r = c.post("/native/action", headers={"X-Sesly-CSRF": "1"})
    assert r.status_code == 200


def test_admin_dependency_checks_host_and_origin_directly():
    """Defense in depth when the middleware is not mounted."""
    import pytest
    from fastapi import HTTPException

    from api.dependencies import require_admin

    def req(headers):
        return SimpleNamespace(
            client=SimpleNamespace(host="127.0.0.1"),
            headers=headers,
            method="POST",
            app=None,
            scope={"type": "http", "scheme": "http", "server": ("127.0.0.1", 3900),
                   "path": "/", "headers": [(k.encode(), v.encode()) for k, v in headers.items()]},
        )

    require_admin(req({"host": "127.0.0.1:3900"}))
    with pytest.raises(HTTPException) as exc:
        require_admin(req({"host": "evil.example"}))
    assert exc.value.status_code == 421
    with pytest.raises(HTTPException) as exc:
        require_admin(req({"host": "127.0.0.1:3900", "origin": "https://evil.example"}))
    assert exc.value.status_code == 403


def test_websocket_from_foreign_origin_is_closed():
    from fastapi import FastAPI, WebSocket
    from starlette.websockets import WebSocketDisconnect
    import pytest

    from core.request_guard import RequestGuardMiddleware

    app = FastAPI()

    @app.websocket("/ws")
    async def ws(sock: WebSocket):
        await sock.accept()
        await sock.send_text("hi")
        await sock.close()

    app.add_middleware(RequestGuardMiddleware)
    c = TestClient(app, base_url="http://127.0.0.1:3900", client=LOOPBACK)
    with c.websocket_connect("ws://127.0.0.1:3900/ws") as s:
        assert s.receive_text() == "hi"
    with pytest.raises(WebSocketDisconnect):
        with c.websocket_connect("ws://127.0.0.1:3900/ws", headers={"Origin": "https://evil.example"}) as s:
            s.receive_text()
