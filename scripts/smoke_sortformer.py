"""Exercise the installed native Sortformer runtime against local media.

This smoke is intentionally opt-in: it never downloads a model or runtime and
only writes a bounded, normalized clip beneath the operating-system temp dir.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from services.diarization_native import MAX_V1_AUDIO_SECONDS, NativeSortformer  # noqa: E402
from services.ffmpeg_utils import find_ffmpeg  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("media", type=Path, help="Local audio or video containing speech")
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--seconds", type=float, default=60.0)
    parser.add_argument("--min-speakers", type=int, default=1)
    parser.add_argument(
        "--cancel-after",
        type=float,
        help="Verify native cancellation after this many seconds instead of collecting turns",
    )
    args = parser.parse_args()

    source = args.media.expanduser().resolve()
    if not source.is_file():
        parser.error(f"media does not exist: {source}")
    if not 0 < args.seconds <= MAX_V1_AUDIO_SECONDS:
        parser.error(f"--seconds must be between 0 and {MAX_V1_AUDIO_SECONDS:g}")
    if args.start < 0:
        parser.error("--start cannot be negative")
    if args.min_speakers < 1:
        parser.error("--min-speakers must be positive")
    if args.cancel_after is not None and args.cancel_after <= 0:
        parser.error("--cancel-after must be positive")

    with tempfile.TemporaryDirectory(prefix="sesly-sortformer-smoke-") as temp:
        clip = Path(temp) / "input.wav"
        subprocess.run(
            [
                find_ffmpeg(),
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-ss",
                str(args.start),
                "-t",
                str(args.seconds),
                "-i",
                str(source),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                str(clip),
            ],
            check=True,
        )

        started = time.monotonic()
        cancelled = threading.Event()
        timer = None
        if args.cancel_after is not None:
            timer = threading.Timer(args.cancel_after, cancelled.set)
            timer.start()
        try:
            annotation = NativeSortformer()(clip, cancel_check=cancelled.is_set)
        except RuntimeError as exc:
            elapsed = time.monotonic() - started
            if args.cancel_after is None or "cancelled" not in str(exc).lower():
                raise
            from services.diarization_native import is_running

            if is_running():
                raise RuntimeError("Sortformer process remained registered after cancellation") from exc
            print(
                json.dumps(
                    {
                        "status": "pass",
                        "cancelled": True,
                        "elapsed_seconds": round(elapsed, 2),
                        "cancel_after_seconds": args.cancel_after,
                    },
                    indent=2,
                )
            )
            return 0
        finally:
            if timer is not None:
                timer.cancel()
        elapsed = time.monotonic() - started
        if args.cancel_after is not None:
            raise RuntimeError("Sortformer completed before the cancellation smoke fired")
        turns = [
            {
                "start": round(segment.start, 3),
                "end": round(segment.end, 3),
                "speaker": speaker,
            }
            for segment, _, speaker in annotation.itertracks(yield_label=True)
        ]

    speakers = {turn["speaker"] for turn in turns}
    if not turns:
        raise RuntimeError("Sortformer returned no speaker turns")
    if len(speakers) < args.min_speakers:
        raise RuntimeError(
            f"Sortformer returned {len(speakers)} speaker(s), expected at least "
            f"{args.min_speakers}"
        )
    if any(turn["start"] < 0 or turn["end"] <= turn["start"] for turn in turns):
        raise RuntimeError("Sortformer returned invalid speaker-turn boundaries")
    if max(turn["end"] for turn in turns) > args.seconds + 0.001:
        raise RuntimeError("Sortformer returned a speaker turn beyond the input clip")

    print(
        json.dumps(
            {
                "status": "pass",
                "elapsed_seconds": round(elapsed, 2),
                "clip_seconds": args.seconds,
                "speaker_count": len(speakers),
                "turn_count": len(turns),
                "turns": turns,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
