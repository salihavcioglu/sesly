import httpx
import pytest
from fastapi import FastAPI


@pytest.mark.asyncio
@pytest.mark.parametrize('host,allowed', [('127.0.0.1', True), ('::1', True), ('192.0.2.10', False)])
async def test_catalogue_matches_native_install_boundary(host, allowed, monkeypatch):
    from api.routers import engines
    from services import sidecar_install, audiocpp_runtime_install
    payload = {'backends': [{'id': 'example', 'one_click_install': True, 'available': False}]}
    monkeypatch.setattr(engines, '_family_payload', lambda *args: payload)
    monkeypatch.setattr(sidecar_install, 'get_status', lambda engine: {'installed': False, 'job': None})
    monkeypatch.setattr(audiocpp_runtime_install, 'status', lambda: {'installed': False, 'supported': True})
    calls = []
    monkeypatch.setattr(sidecar_install, 'start_install', lambda engine: calls.append(engine) or {'status': 'started'})
    monkeypatch.setattr(audiocpp_runtime_install, 'start_install', lambda: calls.append('native') or {'status': 'started'})
    app = FastAPI()
    app.include_router(engines.router)
    app.dependency_overrides[engines.require_admin] = lambda: None
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=(host, 1234)), base_url='http://test') as client:
        listing = (await client.get('/engines')).json()['tts']['backends'][0]
        assert listing['one_click_install'] is allowed
        assert listing.get('local_install_required', False) is (not allowed)
        assert payload['backends'][0]['one_click_install'] is True  # no cached registry mutation
        for path in ['/engines/sidecar/example/install', '/engines/audiocpp/runtime/install']:
            response = await client.get(path + '/status')
            assert response.status_code == 200, response.text
            status = response.json()
            assert status['install_allowed'] is allowed
            response = await client.post(path)
            assert response.status_code == (200 if allowed else 403)
    assert len(calls) == (2 if allowed else 0)
