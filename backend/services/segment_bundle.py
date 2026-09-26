"""Safe extraction for remote multi-segment WAV results."""

from __future__ import annotations

import os
import re
import shutil
import zipfile


_MEMBER = re.compile(r"segments/(\d+)\.wav")


def extract_segment_wavs(artifact_path: str, target_dir: str) -> dict[int, str]:
    """Extract an exact ``segments/<index>.wav`` bundle atomically.

    The worker controls the ZIP member names, so accept only the protocol's
    flat numeric namespace. Streaming each member into a locally minted name
    also avoids ZipFile.extract() path traversal and symlink behaviour.
    """
    if not artifact_path or not os.path.isfile(artifact_path):
        raise ValueError("the segment bundle is missing")

    os.makedirs(target_dir, exist_ok=True)
    paths: dict[int, str] = {}
    partials: list[str] = []
    try:
        with zipfile.ZipFile(artifact_path) as archive:
            for member in archive.infolist():
                match = _MEMBER.fullmatch(member.filename)
                if not match:
                    raise ValueError(
                        f"unexpected segment artifact member: {member.filename}"
                    )
                index = int(match.group(1))
                if index in paths:
                    raise ValueError(f"duplicate segment artifact index: {index}")
                destination = os.path.join(target_dir, f"{index}.wav")
                partial = f"{destination}.part"
                partials.append(partial)
                with archive.open(member) as source, open(partial, "wb") as output:
                    shutil.copyfileobj(source, output)
                os.replace(partial, destination)
                partials.remove(partial)
                paths[index] = destination
        if not paths:
            raise ValueError("the segment bundle is empty")
        return paths
    except BaseException:
        for path in (*partials, *paths.values()):
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass
        try:
            os.rmdir(target_dir)
        except OSError:
            pass
        raise


def remove_segment_wavs(paths: dict[int, str]) -> None:
    """Remove files minted by :func:`extract_segment_wavs`, then empty dirs."""
    directories = set()
    for path in paths.values():
        directories.add(os.path.dirname(path))
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
    for directory in sorted(directories, key=len, reverse=True):
        try:
            os.rmdir(directory)
        except OSError:
            pass


__all__ = ["extract_segment_wavs", "remove_segment_wavs"]
