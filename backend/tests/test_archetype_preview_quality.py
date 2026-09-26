"""Unit tests for the archetype-preview quality guard (``api.routers.archetypes``).

Background: the Hype Host / Podcaster / Vlogger previews shipped a loud tonal
*buzz* instead of speech. The renderer pinned ``num_step=16`` + ``seed=42`` and
the "social" sample script collapsed to a near-pure tone at that point; the
old silence-only guard missed it (the buzz is loud, not silent) so the garbage
was cached and served.

These tests cover the fix *without the 5 GB model / a GPU*: they drive the pure
``_spectral_flatness`` / ``_is_unusable_audio`` helpers with synthetic tones and
tracked speech demo renders, and assert the render constants did not regress.
"""
from __future__ import annotations

import math
from pathlib import Path

import soundfile as sf

import pytest

# conftest.py puts `backend/` on sys.path and points OMNIVOICE_DATA_DIR at a
# throwaway tmpdir before the router imports OUTPUTS_DIR / VOICES_DIR from
# the REAL core.config (the old sys.modules stub leaked at collection time
# and broke later importers in mixed runs — see conftest.py).
torch = pytest.importorskip("torch")  # noqa: E402

from api.routers import archetypes as arch  # noqa: E402

SR = 24_000
N = SR * 3  # 3 s clips


def _pure_tone(hz: float = 220.0) -> "torch.Tensor":
    t = torch.arange(N, dtype=torch.float32) / SR
    return 0.8 * torch.sin(2 * math.pi * hz * t)


def _white_noise() -> "torch.Tensor":
    g = torch.Generator().manual_seed(0)
    return 0.5 * (torch.rand(N, generator=g) * 2 - 1)


def _two_tone_buzz() -> "torch.Tensor":
    """Two inharmonic partials — the other shape a collapsed render takes."""
    t = torch.arange(N, dtype=torch.float32) / SR
    s = torch.sin(2 * math.pi * 180.0 * t) + 0.6 * torch.sin(2 * math.pi * 361.0 * t)
    return 0.8 * s / s.abs().max()


def _speech_like() -> "torch.Tensor":
    """Broadband + harmonic + amplitude-modulated — a coarse stand-in for voiced
    speech: several harmonics (formant-ish), additive noise (consonants), and a
    syllabic envelope (word gaps). Flatness lands between a pure tone and noise.
    """
    g = torch.Generator().manual_seed(1)
    t = torch.arange(N, dtype=torch.float32) / SR
    harm = sum(torch.sin(2 * math.pi * f * t) / (i + 1)
               for i, f in enumerate((130.0, 260.0, 390.0, 520.0)))
    noise = 0.3 * (torch.rand(N, generator=g) * 2 - 1)
    env = 0.5 + 0.5 * torch.sin(2 * math.pi * 4.0 * t).clamp(min=0)  # ~4 Hz syllables
    sig = (harm + noise) * env
    return 0.7 * sig / sig.abs().max()


# ── _spectral_flatness ──────────────────────────────────────────────────────
def test_flatness_orders_tone_below_speech_below_noise():
    tone = arch._spectral_flatness(_pure_tone())
    speech = arch._spectral_flatness(_speech_like())
    noise = arch._spectral_flatness(_white_noise())
    assert tone is not None and speech is not None and noise is not None
    assert tone < arch._DEGENERATE_FLATNESS < speech < noise


def test_flatness_returns_none_on_too_short_or_nonfinite():
    assert arch._spectral_flatness(torch.zeros(16)) is None
    bad = torch.full((4096,), float("nan"))
    assert arch._spectral_flatness(bad) is None


# ── _is_unusable_audio ──────────────────────────────────────────────────────
def test_pure_tone_is_unusable():
    # The degenerate-buzz failure mode: loud (passes the silence guard) but tonal.
    tone = _pure_tone()
    assert tone.abs().max() > 0.02            # not silent
    assert arch._is_unusable_audio(tone) is True


def test_silence_is_unusable():
    assert arch._is_unusable_audio(torch.zeros(N)) is True


def test_speech_like_is_usable():
    assert arch._is_unusable_audio(_speech_like()) is False


# ── Threshold stays between the two things it has to separate ───────────────
# Synthetic broadband speech has much higher flatness than real voiced audio.
# Measure both sides of the threshold against actual inputs, including the
# existing demo renders that the old thresholds rejected.


def test_tonal_ceiling_is_measured_not_assumed():
    """Derive the tonal side of the margin instead of trusting a literal.

    A bare constant would keep passing if `_spectral_flatness` stopped scoring
    tones near zero, so measure the degenerate signals here and require the
    threshold to clear the worst of them tenfold.
    """
    tones = [
        arch._spectral_flatness(_pure_tone(80.0)),
        arch._spectral_flatness(_pure_tone(220.0)),
        arch._spectral_flatness(_two_tone_buzz()),
    ]
    assert all(t is not None for t in tones)
    assert max(tones) * 10 < arch._DEGENERATE_FLATNESS


_SAMPLES = Path(__file__).resolve().parents[1] / "assets" / "samples"
_SPEECH_FIXTURES = [
    "demo_voice.wav",
    "demo_clone_output.wav",
    *[f"voice_design/demo_voice_design_{name}.wav" for name in (
        "audiobook_uk_narrator", "aussie_podcaster", "bedtime_storyteller",
        "gravelly_villain", "indian_support_agent", "mandarin_sichuan", "us_news_anchor",
    )],
    *[f"dictation/{name}.wav" for name in (
        "en_conversational", "en_technical", "fr_reservation",
    )],
    *[f"demo/dubbing/{name}.src.wav" for name in (
        "source", "dubbed_es", "dubbed_fr", "dubbed_ja", "dubbed_zh",
    )],
]


@pytest.mark.parametrize("fixture", _SPEECH_FIXTURES)
def test_real_shipped_speech_clears_quality_floor(fixture):
    # These are existing tracked demo renders, not synthesized stand-ins or
    # asserted measurements. Loading PCM needs neither a model nor a network.
    audio, _sample_rate = sf.read(_SAMPLES / fixture, dtype="float32", always_2d=True)
    speech = torch.from_numpy(audio.T)
    flatness = arch._spectral_flatness(speech)
    assert flatness is not None
    assert flatness > arch._DEGENERATE_FLATNESS * 10
    assert arch._is_unusable_audio(speech) is False


def test_flatness_is_not_clip_length_dependent():
    """Repeating a signal must not change what it measures.

    The whole-clip FFT this replaced failed exactly here: its frequency
    resolution grew with duration, so the same audio measured 0.0229 at 3 s and
    ~0 at 12 s (100% drift). Framed, the drift is under 0.1%.
    """
    short = _speech_like()
    long = torch.cat([short] * 4)
    a, b = arch._spectral_flatness(short), arch._spectral_flatness(long)
    assert a is not None and b is not None
    assert abs(a - b) / a < 0.02


# ── Constants didn't regress ────────────────────────────────────────────────
def test_preview_render_constants():
    # 16 steps under-converged on the social script; the fix bumped it.
    assert arch._PREVIEW_NUM_STEP >= 24
    assert 0 < arch._DEGENERATE_FLATNESS < 0.03
