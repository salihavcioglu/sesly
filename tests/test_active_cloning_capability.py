import pytest


@pytest.mark.parametrize('model,expected', [('kokoro', False), ('csm', True), ('org/unknown', False)])
def test_active_mlx_capability_resolves_without_loading(model, expected, monkeypatch):
    from api.routers import engines
    from services import tts_backend
    monkeypatch.setenv('OMNIVOICE_MLX_AUDIO_MODEL', model)
    monkeypatch.setattr(tts_backend, 'active_backend_id', lambda: 'mlx-audio')
    monkeypatch.setattr(tts_backend, 'list_backends', lambda: [
        {'id': 'mlx-audio', 'available': True, 'supports_cloning': None},
    ])
    monkeypatch.setattr(tts_backend.MLXAudioBackend, '_ensure_loaded', lambda self: pytest.fail('loaded weights'))
    payload = engines._family_payload('tts', tts_backend)
    assert payload['backends'][0]['supports_cloning'] is expected
