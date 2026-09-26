"""Issues 5 + 6: PIN cookie flags and /system/set-env tightening.

``backend/main.py`` and ``api/routers/system.py`` import torch, so these tests
exercise the extracted helpers directly and pin the wiring with source checks.
"""

import ast
import pathlib
from types import SimpleNamespace

from core.request_guard import native_desktop_request, pin_cookie

ROOT = pathlib.Path(__file__).resolve().parents[2]


def test_pin_cookie_flags():
    plain = pin_cookie("123456", secure=False)
    assert "HttpOnly" in plain and "SameSite=Strict" in plain and "Secure" not in plain
    assert "SameSite=Lax" not in plain
    assert pin_cookie("123456", secure=True).endswith("; Secure")


def test_main_uses_pin_cookie_helper():
    src = (ROOT / "backend/main.py").read_text(encoding="utf-8")
    assert "SameSite=Lax" not in src
    assert 'pin_cookie(pin, secure=effective_scheme(request) == "https")' in src
    assert "app.add_middleware(RequestGuardMiddleware)" in src
    # Registered after the auth gates (=> outside them) and before CORS
    # (=> inside CORS so preflights reach CORS first).
    i_guard = src.index("app.add_middleware(RequestGuardMiddleware)")
    assert src.index("app.add_middleware(BearerKeyMiddleware)") < i_guard
    assert i_guard < src.index("    CORSMiddleware,")


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


def test_native_principal_definition(monkeypatch):
    assert native_desktop_request(_req("127.0.0.1")) is True
    assert native_desktop_request(_req("127.0.0.1", "app://sesly")) is True
    assert native_desktop_request(_req("127.0.0.1", "https://box.ts.net")) is False
    assert native_desktop_request(_req("100.64.1.2")) is False
    monkeypatch.setenv("OMNIVOICE_SERVER_MODE", "1")
    assert native_desktop_request(_req("127.0.0.1")) is False


def _set_env_source():
    src = (ROOT / "backend/api/routers/system.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(
        n for n in ast.walk(tree)
        if isinstance(n, ast.AsyncFunctionDef) and n.name == "set_env_var"
    )
    return src, ast.get_source_segment(src, fn)


def test_set_env_guards_code_execution_keys():
    src, body = _set_env_source()
    assert "request: Request" in body
    assert "native_desktop_request(request)" in body
    assert "_NATIVE_ONLY_KEYS" in body
    assert "_PROXY_KEYS | _INSTALL_DIR_KEYS" in src
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        assert f'"{key}"' in src.split("_PROXY_KEYS =", 1)[1].split("\n", 1)[0]
    # Router-level admin gate still covers it.
    assert "router = APIRouter(dependencies=[Depends(require_admin)])" in src


def test_set_env_docstring_no_longer_claims_ffmpeg_path():
    _src, body = _set_env_source()
    assert "FFMPEG_PATH" not in body
