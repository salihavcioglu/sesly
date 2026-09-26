import hashlib
import io
import os
from pathlib import Path
import zipfile

import pytest

from engines.audiocpp import bootstrap
from services import audiocpp_runtime_install as installer


def test_managed_runtime_participates_in_binary_resolution(monkeypatch, tmp_path):
    monkeypatch.setattr(bootstrap, "managed_runtime_dir", lambda: tmp_path)

    assert tmp_path / bootstrap.binary_name() in bootstrap._probe_paths()


def test_runtime_status_recognizes_matching_managed_cli(monkeypatch, tmp_path):
    server = tmp_path / bootstrap.binary_name()
    cli = tmp_path / ("audiocpp_cli.exe" if os.name == "nt" else "audiocpp_cli")
    server.write_bytes(b"server")
    cli.write_bytes(b"cli")
    cli.chmod(0o700)
    monkeypatch.setattr(bootstrap, "resolve_server_binary", lambda: server)
    monkeypatch.setattr(bootstrap, "managed_runtime_dir", lambda: tmp_path)

    status = installer.status()

    assert status["installed"] is True
    assert status["managed"] is True
    assert status["version"] == bootstrap.VERSION


def test_runtime_status_does_not_guess_user_managed_version(monkeypatch, tmp_path):
    user_dir = tmp_path / "user-runtime"
    managed_dir = tmp_path / "managed-runtime"
    user_dir.mkdir()
    server = user_dir / bootstrap.binary_name()
    cli = user_dir / ("audiocpp_cli.exe" if os.name == "nt" else "audiocpp_cli")
    server.write_bytes(b"server")
    cli.write_bytes(b"cli")
    cli.chmod(0o700)
    monkeypatch.setattr(bootstrap, "resolve_server_binary", lambda: server)
    monkeypatch.setattr(bootstrap, "managed_runtime_dir", lambda: managed_dir)

    status = installer.status()

    assert status["installed"] is True
    assert status["managed"] is False
    assert status["version"] is None


def test_runtime_download_verifies_size_and_digest(monkeypatch, tmp_path):
    payload = b"checksummed runtime"

    class Response(io.BytesIO):
        headers = {"Content-Length": str(len(payload))}

    monkeypatch.setattr(
        installer.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: Response(payload),
    )
    destination = tmp_path / "runtime.zip"

    installer._download(
        "https://github.com/example/runtime.zip",
        destination,
        hashlib.sha256(payload).hexdigest(),
        len(payload),
    )

    assert destination.read_bytes() == payload


def test_runtime_zip_rejects_parent_traversal(tmp_path):
    archive = tmp_path / "runtime.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("../outside.exe", b"unsafe")

    with pytest.raises(RuntimeError, match="unsafe path"):
        installer._extract(archive, tmp_path / "target")

    assert not (tmp_path / "outside.exe").exists()


def test_pinned_runtime_assets_have_published_sizes_and_sha256():
    assert set(bootstrap._ASSETS) == set(bootstrap._ASSET_SIZES)
    for slug, (filename, digest) in bootstrap._ASSETS.items():
        assert bootstrap.VERSION.removeprefix("v") in filename
        assert len(digest) == 64 and set(digest) <= set("0123456789abcdef")
        assert bootstrap._ASSET_SIZES[slug] > 20_000_000
