"""Transport-level request guards: Host allowlist, loopback Origin, CSRF.

Why this exists
---------------
``core.auth`` grants loopback clients admin + native capabilities purely from
the TCP peer address. That is only sound while the *browser* talking to us is
actually aimed at us:

* **DNS rebinding** — ``evil.example`` first resolves to the attacker, then to
  ``127.0.0.1``. The victim's browser now sends same-origin (from its point of
  view) requests to our loopback port with ``Host: evil.example``. The Host
  allowlist rejects them (421) before routing.
* **Cross-site requests** — a page on any origin can fire "simple" requests
  (``multipart/form-data`` / ``text/plain`` / urlencoded POSTs, ``<form>``
  submissions, WebSocket handshakes) at ``http://127.0.0.1:3900`` without a
  CORS preflight. The response is unreadable, but the side effect happens.
  For loopback clients any explicit foreign ``Origin`` is refused, and every
  state-changing request (any client) must prove it is not a cross-site
  browser request.

All checks are pure ASGI (no body buffering) and read configuration at call
time so tests and runtime toggles (LAN share, Tailscale Serve) take effect
without a restart.

Configuration
-------------
``SESLY_ALLOWED_HOSTS``  comma-separated extra Host names (port ignored). ``*``
                         disables the Host check entirely (not recommended).
                         Needed when a same-machine reverse proxy (nginx,
                         Caddy, Tailscale Serve started outside the app)
                         forwards a DNS name to the loopback listener.
"""

from __future__ import annotations

import ipaddress
import os
import socket
from urllib.parse import urlsplit

from core.auth import is_loopback
from core.csrf import (
    CSRF_HEADER,
    CSRF_VALUE,
    DEFAULT_DESKTOP_ORIGINS,
    _origin_tuple,
    origin_allowed,
)

ALLOWED_HOSTS_ENV = "SESLY_ALLOWED_HOSTS"
#: Alternate custom marker header. Either this or ``X-Sesly-CSRF: 1`` proves
#: the request passed a CORS preflight (custom headers are never "simple").
REQUEST_MARKER_HEADER = "x-sesly-request"

_BASE_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
_UNSPECIFIED_BIND = frozenset({"", "0.0.0.0", "::", "[::]"})
_STATE_CHANGING = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_TRUTHY = frozenset({"1", "true", "yes", "on"})

# Hosts registered at runtime by features that knowingly publish the loopback
# listener under a DNS name (``services.tailscale.serve_enable``).
_runtime_hosts: set[str] = set()


def add_runtime_allowed_host(host: str | None) -> None:
    norm = normalize_host(host or "")
    if norm:
        _runtime_hosts.add(norm)


def remove_runtime_allowed_host(host: str | None) -> None:
    norm = normalize_host(host or "")
    if norm:
        _runtime_hosts.discard(norm)


def clear_runtime_allowed_hosts() -> None:
    _runtime_hosts.clear()


def _server_mode() -> bool:
    return os.environ.get("OMNIVOICE_SERVER_MODE", "").strip().lower() in _TRUTHY


def normalize_host(value: str) -> str | None:
    """Hostname (lower-case, no port, no brackets, no trailing dot) or None."""
    value = (value or "").strip()
    if not value:
        return None
    try:
        parsed = urlsplit("//" + value)
        host = parsed.hostname
        parsed.port  # validates the port component; raises ValueError
    except ValueError:
        return None
    if not host or parsed.username is not None or parsed.path or parsed.query:
        return None
    host = host.rstrip(".").lower()
    return host or None


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


def _share_hosts(app) -> set[str]:
    state = getattr(app, "state", None) if app is not None else None
    share = getattr(state, "network_share", None) if state is not None else None
    if not share or not getattr(share, "enabled", False):
        return set()
    hosts = {str(a).lower() for a in (getattr(share, "lan_addresses", None) or [])}
    try:
        name = socket.gethostname().lower().rstrip(".")
    except OSError:
        name = ""
    if name:
        hosts.add(name)
        short = name.split(".")[0]
        hosts.update({short, f"{short}.local", f"{short}.lan"})
    return hosts


def allowed_hosts(app=None) -> frozenset[str] | None:
    """Host names accepted on this backend; ``None`` means "any" (``*``)."""
    hosts = set(_BASE_HOSTS)
    bind = os.environ.get("OMNIVOICE_BIND_HOST", "127.0.0.1").strip()
    if bind not in _UNSPECIFIED_BIND:
        norm = normalize_host(bind if not (":" in bind and not bind.startswith("[")) else f"[{bind}]")
        if norm:
            hosts.add(norm)
    for raw in os.environ.get(ALLOWED_HOSTS_ENV, "").split(","):
        raw = raw.strip()
        if not raw:
            continue
        if raw == "*":
            return None
        norm = normalize_host(raw)
        if norm:
            hosts.add(norm)
    hosts |= _runtime_hosts
    hosts |= _share_hosts(app)
    return frozenset(hosts)


def host_allowed(host_header: str | None, *, client_host: str | None, app=None) -> bool:
    """Whether the Host header is acceptable for this client.

    * No Host header: only non-browser HTTP/1.0 clients omit it — a browser
      (the only DNS-rebinding vehicle) always sends one.
    * IP literals are always accepted: rebinding needs an attacker-controlled
      DNS name, and an IP-literal origin can never be re-pointed.
    * Otherwise the name must be allowlisted. In server mode (Docker) a
      non-loopback peer never receives IP-based trust, so arbitrary public
      names (reverse proxies, custom domains) stay reachable there; loopback
      peers are checked in every mode because they are the ones trusted by IP.
    """
    if host_header is None or host_header == "":
        return True
    norm = normalize_host(host_header)
    if norm is None:
        return False
    allowed = allowed_hosts(app)
    if allowed is None or norm in allowed or _is_ip_literal(norm):
        return True
    if _server_mode() and not is_loopback(client_host):
        return True
    return False


def _header(scope, name: bytes) -> str | None:
    for key, value in scope.get("headers") or ():
        if key.lower() == name:
            return value.decode("latin-1")
    return None


class _ConnView:
    """Just enough of a Starlette connection for ``core.csrf`` helpers."""

    def __init__(self, scope):
        self.scope = scope
        from starlette.datastructures import Headers

        self.headers = Headers(scope=scope)
        self.method = scope.get("method", "GET")

    @property
    def url(self):
        # core.csrf reads url.scheme / url.netloc; only Host matters here.
        from starlette.datastructures import URL

        return URL(scope=self.scope)


def trusted_browser_origin(scope, origin: str | None) -> bool:
    """Same-origin, configured UI/desktop origins, or a loopback-host origin.

    Loopback-host origins on other ports (Vite dev servers, the Electron dev
    renderer) are accepted: anything able to serve a page on this machine's
    loopback can already call the API directly as a local process.
    """
    presented = _origin_tuple(origin)
    if presented is None:
        return False
    scheme, host, _port = presented
    if scheme in {"http", "https"} and host in {"localhost", "127.0.0.1", "[::1]", "::1"}:
        return True
    view = _ConnView(dict(scope, headers=[
        (k, v) for k, v in (scope.get("headers") or ()) if k.lower() != b"origin"
    ] + [(b"origin", origin.encode("latin-1"))]))
    return origin_allowed(view)


def csrf_request_allowed(scope) -> bool:
    """Whether a state-changing HTTP request is provably not cross-site.

    Accepted when ANY holds:
    * ``X-Sesly-CSRF: 1`` or ``X-Sesly-Request: 1`` (custom header → preflight);
    * an ``Authorization`` header (non-safelisted → preflight). This is what
      exempts OpenAI-compatible ``/v1/*`` clients that present a bearer key;
    * ``Origin`` (or, absent Origin, ``Referer``) is a trusted origin;
    * ``Sec-Fetch-Site`` is ``same-origin``/``none`` (browser-asserted);
    * no ``Origin``, ``Referer`` or ``Sec-Fetch-Site`` at all: not a modern
      browser (curl, SDKs, the MCP bridge, the desktop shell). Every current
      browser attaches Origin to cross-site POSTs and Sec-Fetch-Site to all
      requests, so a cross-site browser request cannot take this branch.
    """
    method = str(scope.get("method", "GET")).upper()
    if method not in _STATE_CHANGING:
        return True
    if _header(scope, CSRF_HEADER.encode()) == CSRF_VALUE:
        return True
    if _header(scope, REQUEST_MARKER_HEADER.encode()) == "1":
        return True
    if (_header(scope, b"authorization") or "").strip():
        return True
    origin = _header(scope, b"origin")
    if origin is not None:
        return trusted_browser_origin(scope, origin)
    referer = _header(scope, b"referer")
    if referer:
        try:
            parts = urlsplit(referer)
            ref_origin = f"{parts.scheme}://{parts.netloc}"
        except ValueError:
            return False
        return trusted_browser_origin(scope, ref_origin)
    fetch_site = (_header(scope, b"sec-fetch-site") or "").strip().lower()
    if fetch_site:
        return fetch_site in {"same-origin", "none"}
    return True


def native_desktop_request(request) -> bool:
    """The Electron/Tauri desktop owner: true loopback, desktop mode, and no
    browser Origin other than the packaged desktop origins (the Electron
    ``app://`` proxy strips Origin entirely)."""
    from core.auth import PrincipalKind, principal_for

    if _server_mode():
        return False
    principal = principal_for(request)
    if principal.kind != PrincipalKind.LOOPBACK or not principal.allows("native"):
        return False
    origin = request.headers.get("origin")
    if origin is None:
        return True
    presented = _origin_tuple(origin)
    desktop = {_origin_tuple(o) for o in DEFAULT_DESKTOP_ORIGINS}
    return presented is not None and presented in desktop


def pin_cookie(pin: str, *, secure: bool) -> str:
    """``Set-Cookie`` value for the LAN-share PIN.

    HttpOnly (the UI keeps its own sessionStorage copy and never reads the
    cookie), SameSite=Strict (never attached to cross-site requests), and
    Secure whenever the client-facing hop is TLS.
    """
    cookie = f"ov_pin={pin}; Path=/; HttpOnly; SameSite=Strict"
    if secure:
        cookie += "; Secure"
    return cookie


class RequestGuardMiddleware:
    """Pure-ASGI Host allowlist + loopback Origin + CSRF gate (see module doc)."""

    def __init__(self, app):
        self.app = app

    async def _reject(self, scope, receive, send, status: int, detail: str):
        if scope["type"] == "websocket":
            await receive()
            await send({"type": "websocket.close", "code": 1008})
            return
        from starlette.responses import JSONResponse

        await JSONResponse({"detail": detail}, status_code=status)(scope, receive, send)

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        client = scope.get("client")
        client_host = client[0] if client else None
        app = scope.get("app")
        if not host_allowed(_header(scope, b"host"), client_host=client_host, app=app):
            return await self._reject(
                scope, receive, send, 421,
                "Misdirected request: unrecognized Host header. "
                f"Add the host name to {ALLOWED_HOSTS_ENV} if this is intentional.",
            )
        method = str(scope.get("method", "GET")).upper()
        if is_loopback(client_host) and method != "OPTIONS":
            origin = _header(scope, b"origin")
            if origin is not None and not trusted_browser_origin(scope, origin):
                return await self._reject(scope, receive, send, 403, "cross-origin request rejected")
        if scope["type"] == "http" and not csrf_request_allowed(scope):
            return await self._reject(scope, receive, send, 403, "cross-site request rejected")
        return await self.app(scope, receive, send)
