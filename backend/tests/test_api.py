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

    def __init__(self, activities: list[dict], gear: list[dict] | None = None):
        self.activities = activities
        self.client = FakeTokenClient()
        self.profile_id = 42
        self.calls = 0
        # gear: Garmin's list payload plus "stats" and "activity_ids" used by the fake endpoints
        self.gear = gear or []
        self.gear_calls: list[str] = []

    def get_activities(self, start: int, limit: int) -> list[dict]:
        self.calls += 1
        return self.activities[start : start + limit]

    def get_activity_details(self, activity_id: str, maxchart: int, maxpoly: int) -> dict:
        self.calls += 1
        return {"geoPolylineDTO": {"polyline": [{"lat": 48.9, "lon": 2.1}, {"lat": 48.91, "lon": None}]}}

    def get_gear(self, profile: str) -> list[dict]:
        self.gear_calls.append("list")
        return [{k: v for k, v in g.items() if k not in ("stats", "activity_ids")} for g in self.gear]

    def get_gear_stats(self, uuid: str) -> dict:
        self.gear_calls.append(f"stats {uuid}")
        return next(g["stats"] for g in self.gear if g["uuid"] == uuid)

    def get_gear_activities(self, uuid: str) -> list[dict]:
        self.gear_calls.append(f"activities {uuid}")
        return [{"activityId": a} for g in self.gear if g["uuid"] == uuid for a in g["activity_ids"]]


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


def shoe(uuid: str, name: str, status: str, begin: str, distance: float, ids: list[int], updated: int = 1) -> dict:
    return {
        "uuid": uuid,
        "displayName": name,
        "customMakeModel": f"{name} model",
        "gearTypeName": "Shoes",
        "gearStatusName": status,
        "dateBegin": f"{begin}T00:00:00.0",
        "dateEnd": "2026-01-05T10:00:00.0" if status == "retired" else None,
        "maximumMeters": 800000.0,
        "updateDate": updated,
        "stats": {"totalDistance": distance, "totalActivities": len(ids)},
        "activity_ids": ids,
    }


def test_gear_is_loaded_then_refreshed_cheaply(auth, monkeypatch):
    client.put("/api/garmin/tokens", json={"tokens": FakeTokenClient().dumps()}, headers=auth)
    runs = [activity(3001, "Run 1"), activity(3000, "Run 0")]
    old = shoe("old", "Old pair", "retired", "2024-01-01", 700000.0, [3000])
    new = shoe("new", "New pair", "active", "2025-06-01", 10000.0, [3001])
    fake = FakeGarmin(runs, gear=[old, new])
    monkeypatch.setattr(garmin, "connect", lambda db: fake)

    # First sync loads every item, its totals and its activities.
    r = client.post("/api/sync", headers=auth).json()
    assert r["gear_changed"] is True
    assert sorted(fake.gear_calls) == sorted(
        ["list", "stats old", "activities old", "stats new", "activities new"]
    )

    gear = client.get("/api/gear", headers=auth).json()
    assert [g["name"] for g in gear] == ["New pair", "Old pair"]  # active first
    assert gear[0] | {} == {
        **gear[0],
        "make_model": "New pair model",
        "status": "active",
        "date_begin": "2025-06-01",
        "maximum_distance": 800000.0,
        "total_distance": 10000.0,
        "total_activities": 1,
        "last_used": "2026-05-06",  # Run 1's local date
    }
    assert gear[1]["date_end"] == "2026-01-05"

    # Nothing moved: only the list and the active item's totals are read.
    fake.gear_calls.clear()
    assert client.post("/api/sync", headers=auth).json()["gear_changed"] is False
    assert fake.gear_calls == ["list", "stats new"]

    # A new run in the new pair: its activity list is re-read.
    fake.activities.insert(0, activity(3002, "Run 2"))
    new["stats"] = {"totalDistance": 20000.0, "totalActivities": 2}
    new["activity_ids"] = [3001, 3002]
    fake.gear_calls.clear()
    assert client.post("/api/sync", headers=auth).json()["gear_changed"] is True
    assert fake.gear_calls == ["list", "stats new", "activities new"]
    assert client.get("/api/gear", headers=auth).json()[0]["total_distance"] == 20000.0

    # Deleted in Garmin Connect: gone here too.
    fake.gear = [new]
    assert client.post("/api/sync", headers=auth).json()["gear_changed"] is True
    assert [g["name"] for g in client.get("/api/gear", headers=auth).json()] == ["New pair"]


def test_gear_failure_does_not_break_activity_sync(auth, monkeypatch):
    client.put("/api/garmin/tokens", json={"tokens": FakeTokenClient().dumps()}, headers=auth)
    fake = FakeGarmin([activity(4000, "Run")])

    def broken(profile):
        raise RuntimeError("gear endpoint down")

    fake.get_gear = broken
    monkeypatch.setattr(garmin, "connect", lambda db: fake)
    r = client.post("/api/sync", headers=auth)
    assert r.status_code == 200
    assert r.json()["imported"] == 1
    assert r.json()["gear_changed"] is False
