import json
from types import SimpleNamespace

import pytest


@pytest.mark.asyncio
async def test_extract_error_preserves_failure_after_long_banner(tmp_path, monkeypatch):
    from services import dub_pipeline
    stderr = ("ffmpeg version configuration " * 100 + "\n/home/private/media/secret.mp4: No audio stream found").encode()
    async def run_proc(args):
        return SimpleNamespace(returncode=1), b"", stderr
    monkeypatch.setattr(dub_pipeline, "find_ffmpeg", lambda: "ffmpeg")
    monkeypatch.setattr(dub_pipeline, "run_proc_factory", lambda job: run_proc)
    events = [event async for event in dub_pipeline.ingest_pipeline(
        "diagnostic", str(tmp_path), {"kind": "upload", "path": str(tmp_path / "input.mp4")},
    )]
    output = "\n".join(events)
    assert "No audio stream found" in output
    assert "code 1" in output
    assert "/home/private/" not in output


def test_empty_native_diagnostic_retains_exit_code():
    from services import dub_pipeline
    assert "code 7" in dub_pipeline._media_process_error("FFmpeg", 7, b"")


@pytest.mark.parametrize("path", ["/mnt/media/private.mp4", "D:\\Media\\private.mp4", "/opt/data/private.mp4"])
def test_native_error_redacts_non_home_command_paths(path):
    from services import dub_pipeline
    error = dub_pipeline._media_process_error("FFmpeg", 1, (path + ": Permission denied").encode(), paths=(path,))
    assert path not in error
    assert "Permission denied" in error
