import os
from datetime import datetime, timedelta

os.environ.update(
    DATABASE_URL="sqlite://",  # in-memory
    APP_PASSWORD="secret",
    SESSION_SECRET="test-session-secret",
)

import pytest  # noqa: E402
from garminconnect import GarminConnectNotFoundError as GarminConnectNotFound  # noqa: E402
from garminconnect import GarminConnectTooManyRequestsError  # noqa: E402
from sqlalchemy import func, select  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import db as db_module  # noqa: E402

# One shared in-memory database for every connection.
db_module.engine = db_module.create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
db_module.SessionLocal.configure(bind=db_module.engine)

from app import garmin, routes  # noqa: E402
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
        # per-activity endpoints: "<endpoint> <activity id>" for each call, and optional
        # replacements (endpoint -> function) to simulate missing data or failures
        self.detail_calls: list[str] = []
        self.detail_overrides: dict = {}
        # fitness endpoints: "<endpoint> <first> <last>" for each call; payload (or exception) per endpoint
        self.fitness_calls: list[str] = []
        self.fitness: dict = {}

    def get_activities(self, start: int, limit: int) -> list[dict]:
        self.calls += 1
        return self.activities[start : start + limit]

    def _detail(self, endpoint: str, activity_id: str, default):
        self.detail_calls.append(f"{endpoint} {activity_id}")
        override = self.detail_overrides.get(endpoint)
        return override() if override else default

    def get_activity_details(self, activity_id: str, maxchart: int, maxpoly: int) -> dict:
        # maxpoly > 0: the map's track request; 0: the time series for the activity page
        return self._detail("track" if maxpoly else "series", activity_id, {
            "geoPolylineDTO": {"polyline": [{"lat": 48.9, "lon": 2.1}, {"lat": 48.91, "lon": None}]},
            "metricDescriptors": [
                {"metricsIndex": 0, "key": "sumDistance", "unit": {"key": "meter"}},
                {"metricsIndex": 1, "key": "directHeartRate", "unit": {"key": "bpm"}},
                {"metricsIndex": 2, "key": "sumAccumulatedPower", "unit": {"key": "watt"}},
            ],
            "activityDetailMetrics": [{"metrics": [0.0, 120.0, 65535.0]}, {"metrics": [10.123456789, None, 65535.0]}],
        })

    def get_activity(self, activity_id: str) -> dict:
        return self._detail("summary", activity_id, {"summaryDTO": {"minHR": 90.0}})

    def get_activity_splits(self, activity_id: str) -> dict:
        return self._detail("laps", activity_id, {"lapDTOs": [{"lapIndex": 1, "distance": 1000.0}]})

    def get_activity_typed_splits(self, activity_id: str) -> dict:
        return self._detail("typed_splits", activity_id, {"splits": []})

    def get_activity_split_summaries(self, activity_id: str) -> dict:
        return self._detail("split_summaries", activity_id, {"splitSummaries": []})

    def get_activity_weather(self, activity_id: str) -> dict:
        return self._detail("weather", activity_id, {"temp": 55, "relativeHumidity": 94})

    def get_activity_hr_in_timezones(self, activity_id: str) -> list:
        return self._detail("hr_zones", activity_id, [{"zoneNumber": 1, "secsInZone": 60.0, "zoneLowBoundary": 98}])

    def get_activity_power_in_timezones(self, activity_id: str) -> list:
        return self._detail("power_zones", activity_id, [])

    def get_activity_exercise_sets(self, activity_id: str) -> dict:
        return self._detail("exercise_sets", activity_id, {"exerciseSets": [{"setType": "ACTIVE"}]})

    def _fitness(self, endpoint: str, first: str, last: str):
        self.fitness_calls.append(f"{endpoint} {first} {last}")
        payload = self.fitness.get(endpoint, {})
        if isinstance(payload, Exception):
            raise payload
        return payload

    def get_max_metrics_range(self, start: str, end: str):
        return self._fitness("max_metrics", start, end)

    def get_race_predictions(self, startdate: str, enddate: str, _type: str):
        assert _type == "daily"
        return self._fitness("race_predictions", startdate, enddate)

    def get_endurance_score(self, startdate: str, enddate: str):
        return self._fitness("endurance_score", startdate, enddate)

    def get_hill_score(self, startdate: str, enddate: str):
        return self._fitness("hill_score", startdate, enddate)

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

    rows = client.get("/api/activities?limit=5", headers=auth).json()["items"]
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
    track_calls = lambda: [c for c in fake.detail_calls if c.startswith("track")]  # noqa: E731

    r = client.get("/api/activities/2001/track", headers=auth)
    assert r.json() == {"points": [[48.9, 2.1]]}  # points without coordinates are dropped
    client.get("/api/activities/2001/track", headers=auth)
    assert track_calls() == ["track 2001"]  # second request served from the database

    assert client.get("/api/activities/2000/track", headers=auth).json() == {"points": []}
    assert track_calls() == ["track 2001"]  # no GPS: Garmin isn't called

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


def test_activity_page_data_fits_each_kind_of_activity(auth, monkeypatch):
    client.put("/api/garmin/tokens", json={"tokens": FakeTokenClient().dumps()}, headers=auth)
    run = {**activity(5003, "Outdoor run"), "hasPolyline": True, "startLatitude": 48.9}
    pool = {**activity(5002, "Pool"), "activityType": {"typeKey": "lap_swimming"}}  # no GPS
    manual = {**activity(5001, "Typed in"), "manualActivity": True}
    strength = {**activity(5000, "Gym"), "activityType": {"typeKey": "strength_training"}}
    fake = FakeGarmin([run, pool, manual, strength])
    monkeypatch.setattr(garmin, "connect", lambda db: fake)
    monkeypatch.setattr(garmin, "BACKFILL_BATCH", 0)  # keep the post-sync backfill out of this test
    client.post("/api/sync", headers=auth)

    # The summary page data comes from the database: every raw field, plus the gear.
    page = client.get("/api/activities/5003", headers=auth).json()
    assert page["raw"]["activityName"] == "Outdoor run" and page["gear"] == []
    assert client.get("/api/activities/404404", headers=auth).status_code == 404

    # Outdoor run: everything is fetched, columns per metric, Garmin's "no sensor" dropped.
    fake.detail_calls.clear()
    d = client.get("/api/activities/5003/details", headers=auth).json()
    assert d["series"]["metrics"] == {"sumDistance": [0.0, 10.123457], "directHeartRate": [120.0, None]}
    assert d["series"]["units"]["directHeartRate"] == "bpm"
    assert d["weather"]["temp"] == 55 and d["laps"][0]["distance"] == 1000.0 and d["summary"]["minHR"] == 90.0
    assert d["exercise_sets"] is None and d["power_zones"] is None  # not a strength session, no power
    assert "weather 5003" in fake.detail_calls
    fake.detail_calls.clear()
    assert client.get("/api/activities/5003/details", headers=auth).json() == d
    assert fake.detail_calls == []  # stored: no second trip to Garmin

    # Pool swim: no GPS, so no weather call. Manual entry: no samples at all.
    client.get("/api/activities/5002/details", headers=auth)
    assert "weather 5002" not in fake.detail_calls
    m = client.get("/api/activities/5001/details", headers=auth).json()
    assert m["series"] is None and m["weather"] is None
    assert not any(c.endswith(" 5001") and c.split()[0] in ("series", "weather", "hr_zones") for c in fake.detail_calls)

    # Strength session: exercise sets are requested.
    assert client.get("/api/activities/5000/details", headers=auth).json()["exercise_sets"] == [{"setType": "ACTIVE"}]


def test_activity_details_failures(auth, monkeypatch):
    from garminconnect import GarminConnectNotFoundError, GarminConnectTooManyRequestsError

    client.put("/api/garmin/tokens", json={"tokens": FakeTokenClient().dumps()}, headers=auth)
    fake = FakeGarmin([{**activity(6001, "Run"), "hasPolyline": True}, {**activity(6000, "Run"), "hasPolyline": True}])
    monkeypatch.setattr(garmin, "connect", lambda db: fake)
    monkeypatch.setattr(garmin, "BACKFILL_BATCH", 0)
    client.post("/api/sync", headers=auth)

    def not_found():
        raise GarminConnectNotFoundError("no weather")

    def flaky():
        raise RuntimeError("timeout")

    # Not found = no data, and the result is stored.
    fake.detail_overrides = {"weather": not_found}
    assert client.get("/api/activities/6001/details", headers=auth).json()["weather"] is None
    fake.detail_calls.clear()
    client.get("/api/activities/6001/details", headers=auth)
    assert fake.detail_calls == []

    # A temporary failure: shown without that part, but not stored, so the next view retries.
    fake.detail_overrides = {"weather": flaky}
    assert client.get("/api/activities/6000/details", headers=auth).json()["weather"] is None
    fake.detail_overrides = {}
    fake.detail_calls.clear()
    assert client.get("/api/activities/6000/details", headers=auth).json()["weather"]["temp"] == 55
    assert fake.detail_calls  # fetched again

    # Rate limited: reported to the app like the sync does.
    def limited():
        raise GarminConnectTooManyRequestsError("slow down")

    fake.activities.insert(0, {**activity(6002, "Run"), "hasPolyline": True})
    client.post("/api/sync", headers=auth)
    fake.detail_overrides = {"summary": limited}
    assert client.get("/api/activities/6002/details", headers=auth).status_code == 429


def test_sync_backfills_details_in_the_background(auth, monkeypatch):
    client.put("/api/garmin/tokens", json={"tokens": FakeTokenClient().dumps()}, headers=auth)
    runs = [{**activity(i, "Run"), "hasPolyline": True} for i in range(7010, 7000, -1)]
    fake = FakeGarmin(runs)
    monkeypatch.setattr(garmin, "connect", lambda db: fake)
    monkeypatch.setattr(garmin, "BACKFILL_BATCH", 4)  # batch of 4 per sync
    client.post("/api/sync", headers=auth)
    fetched = sorted({int(c.split()[1]) for c in fake.detail_calls if c.startswith("summary")})
    assert fetched == [7007, 7008, 7009, 7010]  # newest first

    fake.detail_calls.clear()
    client.post("/api/sync", headers=auth)
    fetched = sorted({int(c.split()[1]) for c in fake.detail_calls if c.startswith("summary")})
    assert fetched == [7003, 7004, 7005, 7006]  # continues with the next ones


def test_activity_list_filters_and_sorts(auth, monkeypatch):
    def run(activity_id: int, day: str, km: float, hr: float | None, name: str) -> dict:
        start = datetime.fromisoformat(f"{day}T07:00:00")
        return {
            **activity(activity_id, name),
            "startTimeGMT": start.strftime("%Y-%m-%d %H:%M:%S"),
            "startTimeLocal": (start + timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S"),
            "distance": km * 1000,
            "averageHR": hr,
            "averageSpeed": km * 1000 / 3600,
        }

    client.put("/api/garmin/tokens", json={"tokens": FakeTokenClient().dumps()}, headers=auth)
    fake = FakeGarmin([  # newest first, like Garmin; all in 2030 to stay clear of other tests' data
        run(8004, "2030-03-20", 21.1, 150.0, "Half"),
        run(8003, "2030-03-10", 5.0, None, "Easy"),  # no heart rate
        run(8002, "2030-02-15", 10.0, 160.0, "Tempo"),
        run(8001, "2030-01-05", 42.2, 145.0, "Marathon"),
    ])
    monkeypatch.setattr(garmin, "connect", lambda db: fake)
    monkeypatch.setattr(garmin, "BACKFILL_BATCH", 0)
    client.post("/api/sync", headers=auth)

    def names(query: str) -> tuple[list[str], int]:
        r = client.get(f"/api/activities?date_from=2030-01-01&date_to=2030-12-31&{query}", headers=auth).json()
        return [a["name"] for a in r["items"]], r["total"]

    assert names("") == (["Half", "Easy", "Tempo", "Marathon"], 4)  # newest first by default
    assert names("date_from=2030-02-15&date_to=2030-03-10") == (["Easy", "Tempo"], 2)  # both ends inclusive
    assert names("min_distance=8000&max_distance=25000") == (["Half", "Tempo"], 2)
    assert names("sort=distance&order=desc") == (["Marathon", "Half", "Tempo", "Easy"], 4)
    assert names("sort=name&order=asc")[0] == ["Easy", "Half", "Marathon", "Tempo"]
    # Missing heart rate goes last whichever the direction.
    assert names("sort=hr&order=desc")[0] == ["Tempo", "Half", "Marathon", "Easy"]
    assert names("sort=hr&order=asc")[0] == ["Marathon", "Half", "Tempo", "Easy"]
    # Paging keeps the order and the total.
    assert names("sort=distance&order=asc&limit=2&offset=2") == (["Half", "Marathon"], 4)
    assert client.get("/api/activities?sort=calories", headers=auth).status_code == 422


def test_activity_list_filters_by_sport(auth, monkeypatch):
    client.put("/api/garmin/tokens", json={"tokens": FakeTokenClient().dumps()}, headers=auth)
    def at(activity_id: int, type_key: str) -> dict:
        start = datetime(2031, 1, 1) + timedelta(hours=activity_id - 9000)
        return {**activity(activity_id, type_key), "activityType": {"typeKey": type_key},
                "startTimeGMT": start.strftime("%Y-%m-%d %H:%M:%S"), "startTimeLocal": start.strftime("%Y-%m-%d %H:%M:%S")}
    fake = FakeGarmin([at(9003, "trail_running"), at(9002, "road_biking"), at(9001, "running")])
    monkeypatch.setattr(garmin, "connect", lambda db: fake)
    monkeypatch.setattr(garmin, "BACKFILL_BATCH", 0)
    client.post("/api/sync", headers=auth)

    only_2031 = "date_from=2031-01-01&date_to=2031-12-31"
    r = client.get(f"/api/activities?{only_2031}&sport=running", headers=auth).json()
    assert [a["name"] for a in r["items"]] == ["trail_running", "running"]  # every running type
    assert r["total"] == 2
    assert [a["name"] for a in client.get(f"/api/activities?{only_2031}&sport=cycling", headers=auth).json()["items"]] == ["road_biking"]
    assert client.get(f"/api/activities?{only_2031}&sport=swimming", headers=auth).json()["total"] == 0
    assert {"running", "cycling"} <= set(r["families"])  # the families that exist, for the buttons
    assert client.get("/api/activities?sport=chess", headers=auth).status_code == 422


def test_map_lists_routes_and_start_points(auth, monkeypatch):
    client.put("/api/garmin/tokens", json={"tokens": FakeTokenClient().dumps()}, headers=auth)
    gps = {"hasPolyline": True, "startLatitude": 45.1, "startLongitude": 5.7}
    fake = FakeGarmin([
        {**activity(11003, "Ride"), **gps},  # details bring GPS samples
        {**activity(11002, "Trail"), **gps},  # track opened on its page
        {**activity(11001, "Run"), **gps, "manualActivity": True},  # start point only: no samples
        {**activity(11000, "Treadmill"), "manualActivity": True},  # no position at all
    ])
    fake.detail_overrides = {"series": lambda: {
        "metricDescriptors": [
            {"metricsIndex": 0, "key": "directLatitude", "unit": {"key": "dd"}},
            {"metricsIndex": 1, "key": "directLongitude", "unit": {"key": "dd"}},
        ],
        "activityDetailMetrics": [{"metrics": [45.1, 5.7]}, {"metrics": [None, None]}, {"metrics": [45.2, 5.8]}],
    }}
    monkeypatch.setattr(garmin, "connect", lambda db: fake)
    monkeypatch.setattr(garmin, "BACKFILL_BATCH", 100)
    client.post("/api/sync", headers=auth)
    client.get("/api/activities/11002/track", headers=auth)

    items = {a["id"]: a for a in client.get("/api/map", headers=auth).json() if 11000 <= a["id"] < 11100}
    assert list(items) == [11003, 11002, 11001]  # newest first; no position: not on the map
    assert items[11003]["route"] == routes.encode([[45.1, 5.7], [45.2, 5.8]])  # sample without a fix dropped
    assert items[11002]["route"] == routes.encode([[48.9, 2.1]])  # the track replaces the details' route
    assert items[11001]["route"] is None
    assert items[11001]["start"] == [45.1, 5.7]
    assert items[11001]["sport_family"] == "running"


def test_routes_are_built_for_data_stored_before_routes_existed(auth, monkeypatch):
    from app.models import ActivityRoute, ActivityTrack

    client.put("/api/garmin/tokens", json={"tokens": FakeTokenClient().dumps()}, headers=auth)
    fake = FakeGarmin([{**activity(12001, "Run"), "hasPolyline": True}])
    monkeypatch.setattr(garmin, "connect", lambda db: fake)
    monkeypatch.setattr(garmin, "BACKFILL_BATCH", 0)
    client.post("/api/sync", headers=auth)
    with db_module.SessionLocal() as db:
        db.add(ActivityTrack(activity_id=12001, points=[[45.1, 5.7], [45.2, 5.8]], fetched_at=datetime(2026, 1, 1)))
        db.commit()
        assert db.get(ActivityRoute, 12001) is None
        assert routes.backfill(db) >= 1
        assert db.get(ActivityRoute, 12001).polyline == routes.encode([[45.1, 5.7], [45.2, 5.8]])
        assert routes.backfill(db) == 0  # nothing left to build


def test_fitness_history_then_recent_weeks_only(auth, monkeypatch):
    from app import fitness
    from app.models import Activity, FitnessSource, FitnessValue

    client.put("/api/garmin/tokens", json={"tokens": FakeTokenClient().dumps()}, headers=auth)
    fake = FakeGarmin([])
    fake.fitness = {
        "max_metrics": [{"generic": {"calendarDate": "2026-03-01", "vo2MaxPreciseValue": 52.44, "fitnessAge": 31},
                         "cycling": None}],
        "race_predictions": [{"calendarDate": "2026-03-01", "time5K": 1260, "time10K": 2640,
                              "timeHalfMarathon": 5880, "timeMarathon": 12600}],
        "endurance_score": {"groupMap": {"2026-02-23": {"groupAverage": 6120.4}}},
        "hill_score": GarminConnectNotFound(),  # this watch has no hill score
    }
    monkeypatch.setattr(garmin, "connect", lambda db: fake)
    with db_module.SessionLocal() as db:
        db.query(FitnessValue).delete()
        db.query(FitnessSource).delete()
        db.commit()
        first_day = db.scalar(select(func.min(Activity.start_time_local))).date()

        # First sync: the whole history, a year per call.
        fitness.sync(db, today=first_day + timedelta(days=500))
        max_calls = [c for c in fake.fitness_calls if c.startswith("max_metrics")]
        assert max_calls == [
            f"max_metrics {first_day} {first_day + timedelta(days=363)}",
            f"max_metrics {first_day + timedelta(days=364)} {first_day + timedelta(days=500)}",
        ]
        assert len(fake.fitness_calls) == 8  # 4 sources x 2 chunks, the missing one included

        # Straight after: nothing asked again.
        fake.fitness_calls.clear()
        fitness.sync(db, today=first_day + timedelta(days=500))
        assert fake.fitness_calls == []

        # Hours later: only the last two weeks.
        for state in db.scalars(select(FitnessSource)):
            state.fetched_at -= timedelta(hours=7)
        db.commit()
        fitness.sync(db, today=first_day + timedelta(days=501))
        assert f"race_predictions {first_day + timedelta(days=486)} {first_day + timedelta(days=501)}" in fake.fitness_calls
        assert len(fake.fitness_calls) == 4

        # A failure worth retrying doesn't move that source forward.
        fake.fitness_calls.clear()
        fake.fitness["max_metrics"] = RuntimeError("Garmin is down")
        for state in db.scalars(select(FitnessSource)):
            state.fetched_at -= timedelta(hours=7)
        db.commit()
        fitness.sync(db, today=first_day + timedelta(days=502))
        assert db.get(FitnessSource, "max_metrics").fetched_through == first_day + timedelta(days=501)
        assert db.get(FitnessSource, "race_predictions").fetched_through == first_day + timedelta(days=502)

    body = client.get("/api/fitness", headers=auth).json()
    assert body["checked"] is True
    assert body["series"]["vo2max_running"] == [["2026-03-01", 52.4]]
    assert body["series"]["fitness_age"] == [["2026-03-01", 31.0]]
    assert body["series"]["race_5k"] == [["2026-03-01", 1260.0]]
    assert body["series"]["endurance_score"] == [["2026-02-23", 6120.0]]
    assert "hill_score" not in body["series"]


def test_fitness_waits_for_the_rate_limit(auth, monkeypatch):
    from app import fitness

    fake = FakeGarmin([])
    fake.fitness = {"max_metrics": GarminConnectTooManyRequestsError("slow down")}
    monkeypatch.setattr(garmin, "connect", lambda db: fake)
    monkeypatch.setattr(fitness, "SOURCES", {"max_metrics": fitness.SOURCES["max_metrics"]})
    with db_module.SessionLocal() as db:
        from app.models import FitnessSource

        db.query(FitnessSource).delete()
        db.commit()
        with pytest.raises(GarminConnectTooManyRequestsError):
            fitness.sync(db)
        assert db.get(FitnessSource, "max_metrics") is None  # retried in full next time
