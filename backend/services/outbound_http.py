"""Pinned HTTP transport for explicitly configured local/trusted services."""
from __future__ import annotations

import http.client
import re
import socket
from collections.abc import Collection
from dataclasses import dataclass
from urllib.parse import urlsplit

from api.dependencies import is_local_host


class UnsafeEndpoint(ValueError):
    """The configured endpoint is outside Sesly's trusted networks."""


class EndpointHTTPError(OSError):
    """A trusted server answered with an unexpected HTTP status."""

    def __init__(self, status: int):
        self.status = status
        super().__init__(f"endpoint returned HTTP {status}")


@dataclass(frozen=True)
class ResolvedEndpoint:
    scheme: str
    host: str
    port: int
    ip: str


_IP_PREFIX_HOST_RE = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}\.")


def resolve_trusted_endpoint(url: str) -> ResolvedEndpoint:
    """Validate and resolve a root HTTP(S) endpoint to one trusted address.

    Loopback is trusted by default. Non-loopback targets require an explicit
    match in ``OMNIVOICE_TRUSTED_NETWORKS``, the same policy used for remote
    inference consumers. Every DNS answer must be trusted; mixed answers are
    rejected rather than choosing a convenient one.
    """
    try:
        parsed = urlsplit(url)
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except (TypeError, ValueError) as exc:
        raise UnsafeEndpoint("invalid endpoint URL") from exc
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or parsed.hostname.lower().startswith("localhost.")
        or _IP_PREFIX_HOST_RE.match(parsed.hostname)
    ):
        raise UnsafeEndpoint("endpoint must be a credential-free HTTP(S) origin")
    try:
        answers = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise UnsafeEndpoint("endpoint host could not be resolved") from exc
    ips = list(dict.fromkeys(answer[4][0] for answer in answers))
    if not ips or any(not is_local_host(ip) for ip in ips):
        raise UnsafeEndpoint("endpoint is outside loopback or OMNIVOICE_TRUSTED_NETWORKS")
    return ResolvedEndpoint(parsed.scheme, parsed.hostname, port, ips[0])


# Routes that may be hit at a trusted inference origin. Requests without an
# explicit ``path`` argument target the origin itself ("/") and never reach a
# sub-path; requests that do name a sub-path must pick from this allowlist
# so a misconfigured caller cannot route an arbitrary path at a trusted
# origin. Add new entries only with a documented, well-known inference route.
_ALLOWED_SUBPATHS: frozenset[str] = frozenset({"tts"})


def _endpoint_path(requested_path: str) -> str:
    """Validate ``requested_path`` against the trusted sub-path allowlist.

    Returns the URL-encoded path to send. The empty string and ``/`` map to
    the origin itself; anything else must be in ``_ALLOWED_SUBPATHS``.
    """
    if requested_path in {"", "/"}:
        return "/"
    if requested_path in _ALLOWED_SUBPATHS:
        return f"/{requested_path}"
    raise UnsafeEndpoint("endpoint path is not on the trusted sub-path allowlist")


class _PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, endpoint: ResolvedEndpoint, timeout: float):
        super().__init__(endpoint.host, endpoint.port, timeout=timeout)
        self._pinned_ip = endpoint.ip

    def connect(self) -> None:
        self.sock = self._create_connection(
            (self._pinned_ip, self.port), self.timeout, self.source_address
        )


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, endpoint: ResolvedEndpoint, timeout: float):
        super().__init__(endpoint.host, endpoint.port, timeout=timeout)
        self._pinned_ip = endpoint.ip

    def connect(self) -> None:
        sock = self._create_connection(
            (self._pinned_ip, self.port), self.timeout, self.source_address
        )
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def open_trusted_endpoint(
    base_url: str,
    *,
    method: str,
    query: str = "",
    timeout: float,
    path: str = "",
    body: bytes | None = None,
    content_type: str | None = None,
    allowed_statuses: Collection[int] = frozenset(),
) -> http.client.HTTPResponse:
    """Open one request without redirects, pinned to the validated DNS answer.

    ``path`` defaults to ``""`` (the origin itself) and is restricted to a
    small allowlist of known inference routes (``/tts`` today); anything else
    is rejected so a misconfigured caller cannot route an arbitrary path at
    a trusted origin.

    ``body`` and ``content_type`` are forwarded as-is when supplied. Callers
    that need JSON should pass the encoded bytes and the matching
    ``Content-Type`` header (e.g. ``application/json``); the helper does not
    interpret the body, so it never grows new escape hatches around
    serialization. Leave both ``None`` for a body-less request.

    ``allowed_statuses`` permits explicit HTTP error statuses for route probes.
    It never permits redirects; generation callers keep the strict default.
    """
    endpoint = resolve_trusted_endpoint(base_url)
    conn_cls = _PinnedHTTPSConnection if endpoint.scheme == "https" else _PinnedHTTPConnection
    conn = conn_cls(endpoint, timeout)
    target = _endpoint_path(path)
    if query:
        target += f"?{query}"
    if body is not None and content_type is None:
        raise UnsafeEndpoint("body supplied without Content-Type")
    headers: dict[str, str] = {}
    if content_type is not None:
        # body may be None here; we still send Content-Length 0 so the server
        # sees a well-formed request with the announced content type.
        headers["Content-Type"] = content_type
        headers["Content-Length"] = str(len(body) if body is not None else 0)
    # Let http.client format the authority from the validated host and port.
    # Supplying the hostname ourselves drops non-default ports and IPv6
    # brackets, which can make Host-aware inference servers misroute requests.
    conn.request(method, target, body=body, headers=headers)
    response = conn.getresponse()
    # Redirects are never followed: a configured inference origin must answer
    # directly, so a Location header cannot escape the validated connection.
    if 300 <= response.status < 400:
        response.close()
        conn.close()
        raise UnsafeEndpoint("endpoint redirects are not allowed")
    if response.status >= 400 and response.status not in allowed_statuses:
        response.close()
        conn.close()
        raise EndpointHTTPError(response.status)
    return response
