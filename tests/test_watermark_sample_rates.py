"""AudioSeal 0.2 ignores its sample_rate argument: normalize both model paths."""
import pytest
import torch
def _wm():
    from services import watermark
    return watermark


@pytest.mark.parametrize('rate', [8000, 16000, 22050, 24000, 44100, 48000, 96000])
def test_model_rate_and_original_audio_are_preserved(monkeypatch, rate):
    watermark = _wm()
    seen = []
    class Generator:
        def __call__(self, audio, sample_rate, message):
            seen.append(('embed', sample_rate, audio.shape[-1]))
            return audio  # zero residual must preserve all original samples
    class Detector:
        def detect_watermark(self, audio, sample_rate, message_threshold):
            seen.append(('detect', sample_rate, audio.shape[-1]))
            return 0.9, torch.tensor(watermark.OMNI_MESSAGE)
    monkeypatch.setattr(watermark, '_check_available', lambda: True)
    monkeypatch.setattr(watermark, '_get_generator', Generator)
    monkeypatch.setattr(watermark, '_get_detector', Detector)
    wave = torch.randn(1, rate + 7)
    result = watermark.embed_watermark(wave, rate, force=True)
    assert torch.equal(result, wave)
    assert watermark.detect_watermark(result, rate)['is_omnivoice']
    assert [s[0] for s in seen] == ['embed', 'detect']
    assert all(s[1] == 16000 for s in seen)
    assert all(abs(s[2] - (rate + 7) * 16000 / rate) < 1 for s in seen)


def test_resampled_watermark_is_added_without_lowpassing_the_source(monkeypatch):
    watermark = _wm()
    class Generator:
        def __call__(self, audio, sample_rate, message):
            return audio + 0.01
    monkeypatch.setattr(watermark, '_check_available', lambda: True)
    monkeypatch.setattr(watermark, '_get_generator', Generator)
    wave = torch.randn(1, 48007) * 0.1
    result = watermark.embed_watermark(wave, 48000, force=True)
    assert result.shape == wave.shape
    assert torch.allclose(result[..., 100:-100] - wave[..., 100:-100], torch.full_like(wave[..., 100:-100], 0.01), atol=1e-4)
