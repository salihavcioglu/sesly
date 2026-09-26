"""Library deletion removes records, never export/render media or active jobs."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def library(tmp_path, monkeypatch):
    from core import db, job_store
    from api.routers import exports, longform_jobs
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'library.db')
    db.init_db()
    app = FastAPI()
    app.include_router(exports.router)
    app.include_router(longform_jobs.router)
    return TestClient(app, client=("127.0.0.1", 50000)), db, job_store


def test_delete_export_record_keeps_file_and_other_records(library, tmp_path):
    client, db, _ = library
    media = tmp_path / 'voice.wav'
    media.write_bytes(b'original media')
    with db.db_conn() as conn:
        for id in ('remove', 'keep'):
            conn.execute('INSERT INTO export_history (id, filename, destination_path, mode, created_at) VALUES (?, ?, ?, ?, ?)',
                         (id, 'voice.wav', str(media), 'clone', 1))
    assert client.delete('/export/history/remove').status_code == 200
    assert client.delete('/export/history/remove').status_code == 200
    assert [r['id'] for r in client.get('/export/history').json()] == ['keep']
    assert media.read_bytes() == b'original media'


def test_delete_finished_render_keeps_media_and_other_jobs(library, tmp_path):
    client, _, jobs = library
    media = tmp_path / 'book.m4b'
    media.write_bytes(b'rendered audio')
    for id in ('remove', 'keep'):
        jobs.create(id, type='audiobook')
        jobs.append_event(id, '{"type":"done","output":"book.m4b"}')
        jobs.mark_done(id)
    assert client.delete('/longform/jobs/remove').status_code == 200
    assert jobs.get('remove') is None
    assert jobs.events_since('remove') == []
    assert jobs.get('keep') is not None
    assert media.read_bytes() == b'rendered audio'
    assert client.delete('/longform/jobs/remove').status_code == 200


@pytest.mark.parametrize('kind,status,code', [('story','running',409), ('audiobook','pending',409), ('dub_generate','done',404)])
def test_delete_rejects_active_or_unrelated_job(library, kind, status, code):
    client, _, jobs = library
    jobs.create('protected', type=kind)
    jobs.append_event('protected', '{"type":"progress"}')
    if status == 'running': jobs.mark_running('protected')
    if status == 'done': jobs.mark_done('protected')
    assert client.delete('/longform/jobs/protected').status_code == code
    assert jobs.get('protected')['status'] == status
    assert len(jobs.events_since('protected')) == 1

@pytest.mark.parametrize('path', ['/export/history/remove', '/longform/jobs/remove'])
def test_remote_clients_cannot_delete_local_library(library, path):
    local, _, _ = library
    with TestClient(local.app, client=('203.0.113.5', 50000)) as remote:
        assert remote.delete(path).status_code == 403
