"""Language metadata must use the same declarations as synthesis guards."""
import pytest
@pytest.fixture
def tts():
    from services import tts_backend
    return tts_backend

@pytest.mark.parametrize('engine,allowed,rejected', [
    ('kittentts', 'english', 'polish'),
    ('audiocpp', 'chinese', 'polish'),
    ('indextts2', 'spanish', 'polish'),
    ('confucius4-tts', 'french', 'polish'),
])
def test_finite_language_options_without_loading_models(engine, allowed, rejected, monkeypatch, tts):
    monkeypatch.delenv('OMNIVOICE_INDEXTTS_DIR', raising=False)
    options = tts.language_options(engine)
    assert allowed in options
    assert rejected not in options


def test_open_ended_engine_keeps_all_language_options(tts):
    assert tts.language_options('omnivoice') is None


def test_unknown_engine_does_not_break_inventory(tts):
    assert tts.language_options('third-party-unknown') is None


def test_active_engine_inventory_carries_language_choices(monkeypatch, tts):
    from api.routers import engines
    monkeypatch.setattr(tts, 'active_backend_id', lambda: 'kittentts')
    monkeypatch.setattr(tts, 'list_backends', lambda: [
        {'id': 'kittentts', 'available': True},
        {'id': 'omnivoice', 'available': False},
    ])
    response = engines._family_payload('tts', tts)
    assert 'english' in response['backends'][0]['supported_language_names']
    assert 'polish' not in response['backends'][0]['supported_language_names']
    assert 'supported_language_names' not in response['backends'][1]


@pytest.mark.parametrize('engine', ['indextts2', 'omnivoice-subprocess'])
def test_metadata_releases_temporary_sidecar_exit_handlers(monkeypatch, engine, tts):
    import atexit
    callbacks = []
    monkeypatch.setattr(atexit, 'register', lambda callback: callbacks.append(callback))
    monkeypatch.setattr(atexit, 'unregister', lambda callback: callbacks.remove(callback))
    for _ in range(3):
        tts.language_options(engine)
    assert callbacks == []
