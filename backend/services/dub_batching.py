"""Shared native-TTS batching policy for interactive and queued dubbing."""

from __future__ import annotations

import logging
import os

logger = logging.getLogger("omnivoice.dub_batching")

BATCH_WIDTH_ENV = "OMNIVOICE_DUB_BATCH_WIDTH"
_MAX_BATCH_WIDTH = 16


def native_batch_width(backend) -> int:
    """Return a host-safe native batch width for ``backend``."""
    override = os.environ.get(BATCH_WIDTH_ENV, "").strip()
    if override:
        try:
            return max(1, min(_MAX_BATCH_WIDTH, int(override)))
        except (TypeError, ValueError):
            logger.warning(
                "%s=%r is not an integer; deriving the batch width from the host",
                BATCH_WIDTH_ENV,
                override,
            )
    try:
        from core.device_caps import detect_host_caps

        caps = detect_host_caps()
    except Exception:  # noqa: BLE001 - an unprobeable host takes the safe path
        return 1
    if caps.family == "cpu" or not caps.vram_gb:
        return 1
    headroom = caps.vram_gb - float(getattr(backend, "min_vram_gb", 0.0) or 0.0)
    if headroom < 2.0:
        return 1
    if headroom < 6.0:
        return 2
    if headroom < 12.0:
        return 4
    return 8


def batch_timeout_s(texts: list[str], backend) -> float:
    """Bound one native batch without multiplying the executor base timeout."""
    from services.model_manager import generate_timeout_s

    floor = generate_timeout_s("", engine=backend)
    overage = sum(
        max(0.0, generate_timeout_s(text, engine=backend) - floor)
        for text in texts
    )
    return floor + overage


__all__ = ["BATCH_WIDTH_ENV", "batch_timeout_s", "native_batch_width"]
