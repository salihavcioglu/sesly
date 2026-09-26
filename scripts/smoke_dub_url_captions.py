"""Live URL-ingest smoke without loading speech models or touching app data."""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from services.dub_pipeline import parse_vtt_segments, yt_download_sync  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--url",
        default="https://www.youtube.com/watch?v=ZzI9JE0i6Lc",
        help="Public video URL with original-language captions",
    )
    parser.add_argument("--lang", action="append", dest="languages")
    args = parser.parse_args()

    temp_root = Path(tempfile.gettempdir()).resolve()
    work = (temp_root / f"sesly-url-smoke-{uuid.uuid4().hex}").resolve()
    if work.parent != temp_root or not work.name.startswith("sesly-url-smoke-"):
        raise RuntimeError(f"Refusing unsafe smoke directory: {work}")
    work.mkdir()
    try:
        video, title, captions = yt_download_sync(
            args.url,
            str(work),
            fetch_subs=True,
            sub_langs=args.languages,
        )
        cue_count = sum(len(parse_vtt_segments(path)) for path in captions)
        if not Path(video).is_file():
            raise RuntimeError("URL ingest did not produce playable media")
        if not captions or cue_count == 0:
            raise RuntimeError("URL ingest did not produce usable captions")
        print(
            f"PASS: {title!r}; media={Path(video).suffix}; "
            f"caption_tracks={len(captions)}; cues={cue_count}"
        )
        return 0
    finally:
        if work.parent == temp_root and work.name.startswith("sesly-url-smoke-"):
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
