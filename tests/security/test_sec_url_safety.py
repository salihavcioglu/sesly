"""Issue 3: SSRF validator for user-supplied fetch URLs."""

from types import SimpleNamespace

import pytest

from core.url_safety import (
    UnsafeURLError,
    is_public_ip,
    private_urls_allowed_for,
    validate_remote_url,
)


def resolver_for(*addrs):
    return lambda host, port: list(addrs)


PUBLIC = resolver_for("142.250.72.14")


@pytest.mark.parametrize(
    "addr",
    [
        "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "169.254.169.254",
        "100.64.0.1", "100.100.100.200", "0.0.0.0", "224.0.0.1", "240.0.0.1",
        "192.0.0.192", "198.18.0.1", "::1", "fe80::1", "fc00::1", "fd00:ec2::254",
        "::ffff:127.0.0.1", "::ffff:10.0.0.1", "2002:a00:1::", "64:ff9b::a00:1",
        "::127.0.0.1", "ff02::1", "::",
    ],
)
def test_non_public_addresses_blocked(addr):
    assert not is_public_ip(addr)
    with pytest.raises(UnsafeURLError):
        validate_remote_url("https://video.example/watch", resolver=resolver_for(addr))


def test_public_address_allowed():
    assert is_public_ip("142.250.72.14")
    assert is_public_ip("2607:f8b0:4005:80a::200e")
    assert validate_remote_url(" https://www.youtube.com/watch?v=x ", resolver=PUBLIC) == (
        "https://www.youtube.com/watch?v=x"
    )


def test_any_private_answer_in_a_mixed_set_blocks():
    with pytest.raises(UnsafeURLError):
        validate_remote_url("https://v.example/", resolver=resolver_for("142.250.72.14", "10.0.0.1"))


@pytest.mark.parametrize(
    "url",
    [
        "--exec=calc.exe",
        "-o/tmp/x",
        "file:///etc/passwd",
        "ftp://example.com/a",
        "javascript:alert(1)",
        "https://user:pw@example.com/",
        "https://",
        "https://-bad.example/",
        "https://exa mple.com/",
        "https://example.com/\n--exec",
        "http://localhost:3900/",
        "http://metadata.google.internal/computeMetadata/v1/",
        "http://127.0.0.1/",
        "http://[::1]/",
        "http://2130706433/",  # decimal 127.0.0.1 resolves to loopback
    ],
)
def test_malformed_or_local_urls_rejected(url):
    loopback_resolver = resolver_for("127.0.0.1")
    with pytest.raises(UnsafeURLError):
        validate_remote_url(url, resolver=loopback_resolver)


def test_unresolvable_host_rejected():
    def boom(host, port):
        raise UnsafeURLError("nope")

    with pytest.raises(UnsafeURLError):
        validate_remote_url("https://no-such-host.invalid/", resolver=boom)


def test_allow_private_still_enforces_scheme_and_dash():
    assert validate_remote_url("http://192.168.1.5/v.mp4", allow_private=True)
    with pytest.raises(UnsafeURLError):
        validate_remote_url("-http://x", allow_private=True)
    with pytest.raises(UnsafeURLError):
        validate_remote_url("file:///x", allow_private=True)


def _req(host, origin=None):
    headers = {"host": "127.0.0.1:3900"}
    if origin:
        headers["origin"] = origin
    return SimpleNamespace(
        client=SimpleNamespace(host=host),
        headers=headers,
        scope={"type": "http", "client": (host, 1), "headers": []},
        query_params={},
        cookies={},
        app=None,
    )


def test_private_targets_need_desktop_owner_and_env(monkeypatch):
    assert private_urls_allowed_for(_req("127.0.0.1")) is False  # env not set
    monkeypatch.setenv("SESLY_ALLOW_PRIVATE_URLS", "1")
    assert private_urls_allowed_for(_req("127.0.0.1")) is True
    assert private_urls_allowed_for(_req("127.0.0.1", "app://sesly")) is True
    assert private_urls_allowed_for(_req("127.0.0.1", "http://localhost:3901")) is False
    assert private_urls_allowed_for(_req("10.0.0.5")) is False
    monkeypatch.setenv("OMNIVOICE_SERVER_MODE", "1")
    assert private_urls_allowed_for(_req("127.0.0.1")) is False


def test_dub_ingest_url_uses_validator():
    import pathlib

    src = (pathlib.Path(__file__).resolve().parents[2] / "backend/api/routers/dub_core.py").read_text(
        encoding="utf-8"
    )
    assert "validate_request_url(req.url" in src
