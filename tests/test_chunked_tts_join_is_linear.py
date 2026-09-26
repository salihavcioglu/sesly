"""Joining rendered chunks costs one pass, not one per chunk.

``concatenate_audio_chunks`` grew its output with
``result = torch.cat([result, chunk])``. ``torch.cat`` allocates a new tensor
and copies both sides, and ``result`` was the accumulator — so every chunk
re-copied all the audio joined before it. Joining N chunks moved N/2 times the
finished audio, and each step held the old and new buffers at once.

Long-form is where this lands. ``DEFAULT_MAX_CHUNK_CHARS`` is 800, so a chapter
splits into roughly a hundred chunks and a book into several hundred; at 400
chunks the join took 1.8 s of pure copying to produce audio the synthesis had
already finished.

The rewrite prices the overlaps in an integer pass, allocates the finished
length once, and writes each chunk into its own slice. The tests below pin the
two things that matter: the audio is unchanged, and the work no longer grows
with the square of the chunk count.
"""
import sys
import os

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

torch = pytest.importorskip("torch")

@pytest.fixture
def chunked_tts():
    import importlib
    return importlib.import_module("services.chunked_tts")


SR = 24000
CROSSFADE_MS = 50
CF_SAMPLES = int(SR * CROSSFADE_MS / 1000)


def _previous_implementation(chunks, sample_rate, crossfade_ms):
    """The accumulate-with-cat join, verbatim, as the reference to match.

    Kept here rather than described, because "the audio is identical" is the
    whole licence for this change — an approximation of the old behaviour would
    prove nothing.
    """
    crossfade_samples = int(sample_rate * crossfade_ms / 1000)
    result = chunks[0]
    for chunk in chunks[1:]:
        chunk = chunk.to(device=result.device, dtype=result.dtype)
        overlap = min(crossfade_samples, result.shape[-1], chunk.shape[-1])
        if overlap > 0:
            fade_out = torch.linspace(1.0, 0.0, overlap, dtype=result.dtype, device=result.device)
            fade_in = torch.linspace(0.0, 1.0, overlap, dtype=result.dtype, device=result.device)
            blended = result[..., -overlap:] * fade_out + chunk[..., :overlap] * fade_in
            result = torch.cat([result[..., :-overlap], blended, chunk[..., overlap:]], dim=-1)
        else:
            result = torch.cat([result, chunk], dim=-1)
    return result


def _chunks(*lengths, channels=None):
    torch.manual_seed(len(lengths))
    shape = (channels,) if channels else ()
    return [torch.rand(*shape, n) for n in lengths]


# ── the audio must not change ───────────────────────────────────────────────


@pytest.mark.parametrize("name,chunks,crossfade", [
    ("even chunks", _chunks(*([SR] * 6)), CROSSFADE_MS),
    ("uneven chunks", _chunks(5, 50_000, 7, 3, 120_000, 1, 900), CROSSFADE_MS),
    # Every chunk is shorter than the crossfade, so `overlap` is capped by the
    # length joined SO FAR and the fade reaches back over a chunk boundary.
    # This is the case a chunk-against-chunk rewrite gets wrong.
    ("chunks shorter than the crossfade", _chunks(*([100] * 30)), CROSSFADE_MS),
    ("multi-channel", _chunks(*([SR] * 5), channels=2), CROSSFADE_MS),
    ("hard concat", _chunks(*([SR] * 5)), 0),
    ("negative crossfade", _chunks(50, 100, 25), -50),
    ("two chunks", _chunks(SR, SR), CROSSFADE_MS),
])
def test_output_is_identical_to_the_previous_join(name, chunks, crossfade, chunked_tts):
    expected = _previous_implementation(chunks, SR, crossfade)
    actual = chunked_tts.concatenate_audio_chunks(chunks, SR, crossfade_ms=crossfade)

    assert actual.shape == expected.shape, name
    assert torch.allclose(actual, expected, atol=1e-6), name


def test_no_sample_is_left_uninitialised(chunked_tts):
    """The output buffer is allocated uninitialised, so a gap would surface as
    whatever the allocator handed back — loud garbage in the middle of a take.
    Joining known-constant chunks makes any unwritten sample obvious."""
    chunks = [torch.full((1000,), float(i + 1)) for i in range(20)]

    joined = chunked_tts.concatenate_audio_chunks(chunks, SR, crossfade_ms=0)

    assert joined.shape[-1] == 20 * 1000
    assert torch.isfinite(joined).all()
    assert (joined >= 1.0).all() and (joined <= 20.0).all()


# ── and the work must not grow with the square of the chunk count ───────────
#
# Deliberately counted, not timed. A wall-clock assertion at a size CI will
# tolerate does not separate the two shapes — at one-second chunks the old
# join and the new one finish close enough that the test passes either way,
# which is worse than no test. The copy count separates them exactly.


def test_the_join_allocates_once_instead_of_once_per_chunk(monkeypatch, chunked_tts):
    """A deterministic stand-in for "this is linear now".

    Timing on a shared CI runner is noise; counting the copies is not. The old
    join called ``torch.cat`` once per chunk, each call copying everything
    joined so far. The rewrite copies each chunk once, into a buffer it
    allocates a single time.
    """
    cat_calls = 0
    real_cat = torch.cat

    def counting_cat(*args, **kwargs):
        nonlocal cat_calls
        cat_calls += 1
        return real_cat(*args, **kwargs)

    monkeypatch.setattr(torch, "cat", counting_cat)

    chunked_tts.concatenate_audio_chunks(_chunks(*([SR] * 64)), SR, crossfade_ms=CROSSFADE_MS)

    # 64 chunks used to mean 63 cats of an ever-growing buffer.
    assert cat_calls <= 1, f"joining re-copied the output {cat_calls} times"


# ── the dropped-chunk filter ────────────────────────────────────────────────


def test_dropped_chunks_are_filtered_without_rebuilding_the_index_set(monkeypatch, chunked_tts):
    """`set(dropped)` sat inside the comprehension's condition, so it was built
    once per element. Behaviour is unchanged; only the cost is."""
    constructions = 0
    def counting_set(values):
        nonlocal constructions
        constructions += 1
        return set(values)
    monkeypatch.setattr(chunked_tts, "set", counting_set, raising=False)
    rendered = [torch.rand(SR) if i % 2 else None for i in range(40)]

    joined = chunked_tts.join_rendered_chunks(rendered, SR, crossfade_ms=0)

    assert joined is not None
    assert joined.shape[-1] == 20 * SR
    assert constructions == 1


def test_all_chunks_dropped_still_reports_nothing_rendered(chunked_tts):
    assert chunked_tts.join_rendered_chunks([None, None], SR) is None
