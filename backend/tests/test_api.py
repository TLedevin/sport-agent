import os
from datetime import datetime, timedelta

os.environ.update(
    DATABASE_URL="sqlite://",  # in-memory
    APP_PASSWORD="secret",
    SESSION_SECRET="test-session-secret",
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import db as db_module  # noqa: E402

# One shared in-memory database for every connection.
db_module.engine = db_module.create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
db_module.SessionLocal.configure(bind=db_module.engine)

from app import garmin  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)


def activity(activity_id: int, name: str = "Run") -> dict:
    start = datetime(2026, 1, 1) + timedelta(hours=activity_id)  # higher ID = more recent
    return {
        "activityId": activity_id,
        "activityName": name,
        "activityType": {"typeKey": "running"},
        "startTimeGMT": start.strftime("%Y-%m-%d %H:%M:%S"),
        "startTimeLocal": (start + timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S"),
        "distance": 10000.0,
        "duration": 3000.0,
        "elevationGain": 50.0,
        "averageHR": 150.0,
    }


class FakeTokenClient:
    def dumps(self) -> str:
        return '{"di_token": "a", "di_refresh_token": "b", "di_client_id": "c"}'


class FakeGarmin:
    """Newest first, like Garmin."""

    def __init__(self, activities: list[dict]):
        self.activities = activities
        self.client = FakeTokenClient()
        self.calls = 0

    def get_activities(self, start: int, limit: int) -> list[dict]:
        self.calls += 1
        return self.activities[start : start + limit]

    def get_activity_details(self, activity_id: str, maxchart: int, maxpoly: int) -> dict:
        self.calls += 1
        return {"geoPolylineDTO": {"polyline": [{"lat": 48.9, "lon": 2.1}, {"lat": 48.91, "lon": None}]}}


@pytest.fixture
def auth() -> dict:
    token = client.post("/api/auth/login", json={"password": "secret"}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_health_and_wake_need_no_login():
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.post("/api/wake").status_code == 202


def test_wrong_password_rejected():
    assert client.post("/api/auth/login", json={"password": "nope"}).status_code == 401


def test_data_requires_session():
    assert client.get("/api/activities").status_code == 401
    assert client.get("/api/activities", headers={"Authorization": "Bearer forged"}).status_code == 401


def test_sync_without_garmin_tokens_returns_409(auth):
    r = client.post("/api/sync", headers=auth)
    assert r.status_code == 409
    assert r.json()["detail"] == "garmin_not_connected"


def test_tokens_must_be_valid_json(auth):
    r = client.put("/api/garmin/tokens", json={"tokens": "not json"}, headers=auth)
    assert r.status_code == 422


def test_full_then_incremental_sync(auth, monkeypatch):
    r = client.put("/api/garmin/tokens", json={"tokens": FakeTokenClient().dumps()}, headers=auth)
    assert r.json() == {"connected": True}

    # First sync: 150 activities over two pages.
    history = [activity(i) for i in range(1150, 1000, -1)]
    fake = FakeGarmin(history)
    monkeypatch.setattr(garmin, "connect", lambda db: fake)
    r = client.post("/api/sync", headers=auth)
    assert r.json()["imported"] == 150
    assert r.json()["last_sync_at"] is not None

    # One new activity: only the first page is read.
    fake = FakeGarmin([activity(1151, "Morning run")] + history)
    monkeypatch.setattr(garmin, "connect", lambda db: fake)
    assert client.post("/api/sync", headers=auth).json()["imported"] == 1
    assert fake.calls == 1

    rows = client.get("/api/activities?limit=5", headers=auth).json()
    assert len(rows) == 5
    assert rows[0]["name"] == "Morning run"
    assert rows[0]["start_time_utc"].endswith("+00:00")

    status = client.get("/api/garmin/status", headers=auth).json()
    assert status["connected"] is True

    assert rows[0]["sport_family"] == "running"

    dash = client.get("/api/dashboard?today=2026-02-20", headers=auth).json()
    assert set(dash) == {"today", "periods", "evolution", "breakdown", "records", "last_activity", "periods_by_family"}
    assert dash["last_activity"]["name"] == "Morning run"
    assert dash["today"] == "2026-02-20"
    assert len(dash["evolution"]["3m"][0]["buckets"]) == 13


def test_track_is_fetched_once_then_stored(auth, monkeypatch):
    client.put("/api/garmin/tokens", json={"tokens": FakeTokenClient().dumps()}, headers=auth)
    outdoor = {**activity(2001, "Outdoor run"), "hasPolyline": True}
    indoor = {**activity(2000, "Treadmill"), "hasPolyline": False}
    fake = FakeGarmin([outdoor, indoor])
    monkeypatch.setattr(garmin, "connect", lambda db: fake)
    client.post("/api/sync", headers=auth)
    fake.calls = 0

    r = client.get("/api/activities/2001/track", headers=auth)
    assert r.json() == {"points": [[48.9, 2.1]]}  # points without coordinates are dropped
    client.get("/api/activities/2001/track", headers=auth)
    assert fake.calls == 1  # second request served from the database

    assert client.get("/api/activities/2000/track", headers=auth).json() == {"points": []}
    assert fake.calls == 1  # no GPS: Garmin isn't called

    assert client.get("/api/activities/999/track", headers=auth).status_code == 404
