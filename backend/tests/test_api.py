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

    stats = client.get("/api/stats", headers=auth).json()
    assert set(stats) == {"week", "month", "year"}
