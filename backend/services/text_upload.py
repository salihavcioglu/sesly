"""Decode an uploaded text file whose encoding nobody declared.

Subtitle and manuscript uploads arrive as raw bytes. Windows tools commonly
save them as UTF-16 with a byte-order mark (Notepad's "Unicode", many subtitle
editors) or in the legacy Windows-1252 code page. A UTF-8 decode turns the
first into NUL-interleaved text and, lossily, drops every accent, dash and
curly quote from the second.
"""
from __future__ import annotations

import codecs

# Longest-first: the UTF-32 LE mark starts with the UTF-16 LE one, so checking
# UTF-16 first would strip two bytes and read a UTF-32 file as NUL-interleaved
# UTF-16.
_BOMS = (
    (codecs.BOM_UTF32_LE, "utf-32-le"),
    (codecs.BOM_UTF32_BE, "utf-32-be"),
    (codecs.BOM_UTF8, "utf-8"),
    (codecs.BOM_UTF16_LE, "utf-16-le"),
    (codecs.BOM_UTF16_BE, "utf-16-be"),
)

_CP1252_UNDEFINED = "sesly-cp1252-undefined"


def _undefined_as_latin1(exc: UnicodeDecodeError) -> tuple[str, int]:
    # Only the offending bytes take their Latin-1 code point — what the
    # browser's windows-1252 decoder does — so the rest of the file keeps its
    # curly quotes and dashes.
    return exc.object[exc.start:exc.end].decode("latin-1"), exc.end


codecs.register_error(_CP1252_UNDEFINED, _undefined_as_latin1)


def _bom(data: bytes) -> tuple[bytes, str] | None:
    for bom, encoding in _BOMS:
        if data.startswith(bom):
            return bom, encoding
    return None


def bom_encoding(data: bytes) -> str | None:
    """The encoding a leading byte-order mark names, or ``None``.

    One table, so every caller that needs to know "does this file say what it
    is?" asks the same question :func:`decode_text_upload` answers.
    """
    found = _bom(data)
    return found[1] if found else None


def decode_text_upload(data: bytes) -> str:
    """Return the text of ``data``, without its byte-order mark.

    A BOM names the encoding. Without one, valid UTF-8 is UTF-8; anything else
    is read as Windows-1252, the legacy code page such files come from. Each of
    the five bytes Windows-1252 leaves undefined takes its Latin-1 code point,
    so the decode never raises.
    """
    found = _bom(data)
    if found:
        bom, encoding = found
        return data[len(bom):].decode(encoding, errors="replace")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors=_CP1252_UNDEFINED)
