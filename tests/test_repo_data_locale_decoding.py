"""Repo data files that are UTF-8 by definition must be read as UTF-8.

``Path.read_text()`` and ``Path.open()`` with no ``encoding`` decode in the
locale code page. On a Chinese, Japanese or Korean Windows that is cp932 /
cp936 / cp949 / cp950, none of which can decode the em dashes these files
carry, so two readers raised ``UnicodeDecodeError``:

* ``core.version._fallback_version`` reads ``pyproject.toml`` — the version
  path a raw source checkout and a frozen build without package metadata both
  take. It runs while ``core.version`` is being imported, so the failure took
  the whole backend down before any Sesly code could report it.
* ``engines.omnivoice_gguf.backend._load_quant_map`` reads ``quant_map.json``
  when the engine picks a quant, so every generation failed instead.

Same Python 3.11 locale-decoding class as the ``.pth`` startup crash (#1783)
and alembic.ini (#2075); TOML and JSON are both defined as UTF-8, so the
readers name it.
"""
from __future__ import annotations

import io
import re
from contextlib import contextmanager
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_PYPROJECT = _ROOT / "pyproject.toml"
_QUANT_MAP = _ROOT / "backend" / "engines" / "omnivoice_gguf" / "quant_map.json"

# The Windows ANSI code pages of the CJK locales. cp1252 is deliberately not
# here: it decodes every byte, so a Western Windows only saw mojibake.
_CJK_CODE_PAGES = ["cp932", "cp936", "cp949", "cp950"]


@contextmanager
def _locale_code_page(code_page: str):
    """Make an unspecified text encoding resolve to ``code_page``.

    ``Path.read_text()`` / ``Path.open()`` route a ``None`` encoding through
    ``io.text_encoding``, which answers "whatever the locale says". Pinning it
    here reproduces the decode such a Windows performs on every host, while a
    reader that names its own encoding passes through untouched.
    """
    original = io.text_encoding
    io.text_encoding = lambda encoding=None, stacklevel=2: encoding or code_page
    try:
        yield
    finally:
        io.text_encoding = original


@pytest.mark.parametrize("code_page", _CJK_CODE_PAGES)
def test_fallback_version_resolves_when_the_locale_cannot_decode_pyproject(code_page):
    from core.version import _fallback_version

    expected = re.search(
        r'(?m)^version\s*=\s*"([^"]+)"', _PYPROJECT.read_text(encoding="utf-8")
    ).group(1)
    with _locale_code_page(code_page):
        assert _fallback_version() == expected


@pytest.mark.parametrize("code_page", _CJK_CODE_PAGES)
def test_quant_map_loads_when_the_locale_cannot_decode_it(code_page):
    from engines.omnivoice_gguf.backend import _load_quant_map

    with _locale_code_page(code_page):
        quant_map = _load_quant_map()
    assert quant_map["_meta"]["schema_version"] == 1


@pytest.mark.parametrize(
    "path", [_PYPROJECT, _QUANT_MAP], ids=["pyproject.toml", "quant_map.json"]
)
def test_the_file_is_valid_utf8(path):
    """The premise of both fixes: these files hold UTF-8, so utf-8 is the one
    encoding that reads them correctly on every host."""
    path.read_bytes().decode("utf-8")
