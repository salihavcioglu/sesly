"""Profile usage reads the persisted desktop project schema without double-counting."""
import json
import sqlite3
from contextlib import contextmanager

import pytest


@pytest.mark.parametrize("state,expected", [
    ({"dubSegments": [{"profile_id": "voice"}, {"profile_id": "other"}]}, 1),
    ({"segments": [{"profile_id": "voice"}]}, 1),
    ({"dubSegments": [], "segments": [{"profile_id": "voice"}]}, 0),
    ({"dubSegments": [{"profile_id": "voice"}], "segments": [{"profile_id": "voice"}]}, 1),
    ({"dubSegments": [None, 1, {"profile_id": "voice"}]}, 1),
    ([], 0),
])
def test_usage_desktop_project_state(monkeypatch, state, expected):
    from api.routers import profiles
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE generation_history (id, text, audio_path, created_at, generation_time, profile_id)")
    conn.execute("CREATE TABLE studio_projects (id, name, updated_at, state_json)")
    conn.execute("INSERT INTO studio_projects VALUES (?, ?, ?, ?)", ("project", "Demo", 1, json.dumps(state)))

    @contextmanager
    def database():
        yield conn

    monkeypatch.setattr(profiles, "db_conn", database)
    try:
        usage = profiles.get_profile_usage("voice")
        assert usage["project_total_segments"] == expected
        assert len(usage["projects"]) == bool(expected)
        assert usage["synth_total"] == 0
    finally:
        conn.close()
