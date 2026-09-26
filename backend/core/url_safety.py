"""Shared validation for user-supplied remote URLs (SSRF + argv injection).

Every endpoint that makes the backend fetch a URL chosen by the caller
(yt-dlp ingest, gallery clip download, ...) must pass it through
:func:`validate_remote_url` first.

Policy
------
* Scheme must be ``http``/``https`` (parsed, not prefix-matched); no userinfo,
  no leading ``-`` (argv-option injection), no control characters/whitespace.
* The host is resolved and **every** resolved address must be globally
  routable. Private, loopback, link-local, CGNAT (100.64/10), multicast,
  reserved, unspecified, benchmark, documentation, IPv4-mapped/compatible,
  6to4/Teredo/NAT64-embedded private addresses and cloud metadata endpoints
  are refused.
* Private targets are allowed only for the local desktop owner (loopback
  principal, not server mode) **and** only when ``SESLY_ALLOW_PRIVATE_URLS=1``.

Known limitation
----------------
yt-dlp performs its own DNS resolution and follows HTTP redirects and
extractor-embedded URLs internally. Validation here therefore cannot stop a
public URL that 30x-redirects to (or a DNS answer that rebinds to) a private
address between our check and yt-dlp's fetch. Pinning the resolved IP is not
viable for yt-dlp (TLS SNI/Host and CDN extractors need the real name). The
check blocks the direct, cheap SSRF; deployments exposing ingest to untrusted
users should additionally egress-filter the backend (e.g. Docker network
policy).
"""

from __future__ import annotations

import ipaddress
import os
import socket
from urllib.parse import urlsplit

ALLOW_PRIVATE_ENV = "SESLY_ALLOW_PRIVATE_URLS"
_TRUTHY = frozenset({"1", "true", "yes", "on"})
MAX_URL_LENGTH = 4096

_EXTRA_BLOCKED_NETS = tuple(
    ipaddress.ip_network(n)
    for n in (
        "0.0.0.0/8",
        "100.64.0.0/10",  # CGNAT (incl. Alibaba metadata 100.100.100.200)
        "192.0.0.0/24",  # IETF protocol assignments (Oracle metadata 192.0.0.192)
        "198.18.0.0/15",  # benchmarking
        "64:ff9b:1::/48",  # local-use NAT64
        "fd00:ec2::/32",  # AWS IMDS IPv6
    )
)
_NAT64 = ipaddress.ip_network("64:ff9b::/96")
_BLOCKED_HOSTNAMES = frozenset(
    {
        "localhost",
        "metadata",
        "metadata.google.internal",
        "metadata.goog",
        "instance-data",
        "instance-data.ec2.internal",
    }
)


class UnsafeURLError(ValueError):
    """The URL is malformed or targets a non-public address."""


def private_urls_allowed_env() -> bool:
    return os.environ.get(ALLOW_PRIVATE_ENV, "").strip().lower() in _TRUTHY


def _embedded_ipv4(addr: ipaddress.IPv6Address) -> list[ipaddress.IPv4Address]:
    out: list[ipaddress.IPv4Address] = []
    if addr.ipv4_mapped is not None:
        out.append(addr.ipv4_mapped)
    if addr.sixtofour is not None:
        out.append(addr.sixtofour)
    if addr.teredo is not None:
        out.extend(addr.teredo)
    if addr in _NAT64:
        out.append(ipaddress.IPv4Address(int(addr) & 0xFFFFFFFF))
    # Deprecated IPv4-compatible ::a.b.c.d
    if int(addr) >> 32 == 0 and int(addr) > 1:
        out.append(ipaddress.IPv4Address(int(addr) & 0xFFFFFFFF))
    return out


def is_public_ip(value: str | ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Whether ``value`` is a globally routable unicast address."""
    try:
        addr = ipaddress.ip_address(str(value).split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address):
        embedded = _embedded_ipv4(addr)
        if embedded:
            return all(is_public_ip(v4) for v4 in embedded)
    if (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
        or not addr.is_global
    ):
        return False
    return not any(addr in net for net in _EXTRA_BLOCKED_NETS if net.version == addr.version)


def _resolve(host: str, port: int) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError, OSError) as exc:
        raise UnsafeURLError(f"Could not resolve host '{host}'.") from exc
    return sorted({info[4][0] for info in infos})


def validate_remote_url(
    url: str,
    *,
    allow_private: bool = False,
    resolver=None,
) -> str:
    """Return the stripped URL if safe to fetch, else raise :class:`UnsafeURLError`."""
    if not isinstance(url, str):
        raise UnsafeURLError("URL must be a string.")
    url = url.strip()
    if not url:
        raise UnsafeURLError("URL is empty.")
    if len(url) > MAX_URL_LENGTH:
        raise UnsafeURLError("URL is too long.")
    if url.startswith("-"):
        raise UnsafeURLError("URL must not start with '-'.")
    if any(ch.isspace() or ord(ch) < 0x20 or ord(ch) == 0x7F for ch in url):
        raise UnsafeURLError("URL must not contain whitespace or control characters.")
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError as exc:
        raise UnsafeURLError("URL is malformed.") from exc
    if parts.scheme.lower() not in {"http", "https"}:
        raise UnsafeURLError("URL must use http:// or https://.")
    if parts.username is not None or parts.password is not None:
        raise UnsafeURLError("URL must not contain credentials.")
    host = (parts.hostname or "").rstrip(".").lower()
    if not host or host.startswith("-"):
        raise UnsafeURLError("URL has no valid host.")
    if allow_private:
        return url
    if host in _BLOCKED_HOSTNAMES or host.endswith(".localhost") or host.endswith(".internal"):
        raise UnsafeURLError("URL targets a local or metadata host.")
    if port is None:
        port = 443 if parts.scheme.lower() == "https" else 80
    try:
        ipaddress.ip_address(host)
        addresses = [host]
    except ValueError:
        addresses = (resolver or _resolve)(host, port)
    if not addresses:
        raise UnsafeURLError(f"Could not resolve host '{host}'.")
    for addr in addresses:
        if not is_public_ip(addr):
            raise UnsafeURLError(
                "URL targets a private, loopback or reserved network address."
            )
    return url


def private_urls_allowed_for(request) -> bool:
    """Private targets: local desktop owner AND explicit env opt-in only."""
    if not private_urls_allowed_env():
        return False
    from core.request_guard import native_desktop_request

    try:
        return native_desktop_request(request)
    except Exception:
        return False


def validate_request_url(url: str, request) -> str:
    """:func:`validate_remote_url` with the per-request private-target policy.

    Raises FastAPI ``HTTPException(400)`` with a user-facing message.
    """
    from fastapi import HTTPException

    try:
        return validate_remote_url(url, allow_private=private_urls_allowed_for(request))
    except UnsafeURLError as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{exc} Paste a full public video link (e.g. https://youtube.com/watch?v=…) "
                "or drop a local file instead."
            ),
        ) from None
