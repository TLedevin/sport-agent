from datetime import date, datetime

from app.dashboard import Row, build, periods, evolution, periods_by_family, records
from app.sports import sport_family


def row(id: int, sport: str, start: str, distance=10000.0, time=3600.0, elevation=100.0, speed=3.0) -> Row:
    return Row(id, f"Activity {id}", sport, datetime.fromisoformat(start), distance, time, elevation, speed)


def test_sport_family():
    assert sport_family("trail_running") == "running"
    assert sport_family("treadmill_running") == "running"
    assert sport_family("road_biking") == "cycling"
    assert sport_family("indoor_cycling") == "cycling"
    assert sport_family("lap_swimming") == "swimming"
    assert sport_family("open_water_swimming") == "swimming"
    assert sport_family("hiking") == "walking"
    assert sport_family("strength_training") == "fitness"
    assert sport_family("yoga") == "fitness"
    assert sport_family("resort_skiing_snowboarding_ws") == "other"


def test_week_period_is_last_7_days_vs_the_7_before():
    today = date(2026, 9, 27)
    rows = [
        row(1, "running", "2026-09-21T08:00"),  # 7th day back: current
        row(2, "running", "2026-09-20T08:00"),  # previous
        row(3, "running", "2026-09-14T08:00"),  # previous (14th day back)
        row(4, "running", "2026-09-13T08:00"),  # outside both
    ]
    week = periods(rows, today)["week"]
    assert week["current"]["count"] == 1
    assert week["previous"]["count"] == 2


def test_month_comparison_clamps_to_shorter_previous_month():
    today = date(2026, 3, 31)  # compare 1-31 March with 1-28 February
    rows = [row(1, "running", "2026-02-28T08:00"), row(2, "running", "2026-03-31T20:00")]
    month = periods(rows, today)["month"]
    assert month["current"]["count"] == 1
    assert month["previous"]["count"] == 1


def test_year_to_date_vs_same_span_last_year():
    today = date(2026, 6, 15)
    rows = [row(1, "cycling", "2025-06-15T10:00"), row(2, "cycling", "2025-06-16T10:00"), row(3, "cycling", "2026-01-01T00:30")]
    year = periods(rows, today)["year"]
    assert year["current"]["count"] == 1
    assert year["previous"]["count"] == 1


def test_evolution_ranges_and_buckets():
    today = date(2026, 9, 27)  # a Sunday
    rows = [
        row(1, "running", "2026-09-21T07:00", time=1800, distance=5000),  # Monday of the current week
        row(2, "road_biking", "2026-09-27T09:00", time=7200, distance=60000),
        row(3, "running", "2026-09-20T07:00", time=600, distance=2000),  # previous week
        row(4, "running", "2024-11-15T07:00", time=900, distance=3000),  # oldest activity
    ]
    result = evolution(rows, today)
    assert {k: [(v["unit"], len(v["buckets"])) for v in series] for k, series in result.items()} == {
        "1m": [("day", 30), ("week", 5)],
        "3m": [("week", 13), ("month", 3)],
        "6m": [("week", 26), ("month", 6)],
        "1y": [("month", 12)],
        "all": [("month", 23), ("year", 3)],  # Nov 2024 to Sep 2026
    }

    days = result["1m"][0]["buckets"]
    assert days[0]["start"] == "2026-08-29" and days[-1]["start"] == "2026-09-27"
    assert days[-1]["distance_by_family"]["cycling"] == 60000

    weeks = result["3m"][0]["buckets"]
    assert weeks[-1]["start"] == "2026-09-21"
    assert weeks[-1]["duration_by_family"] == {**weeks[-1]["duration_by_family"], "running": 1800, "cycling": 7200}
    assert weeks[-2]["duration_by_family"]["running"] == 600

    months = result["1y"][0]["buckets"]
    assert months[0]["start"] == "2025-10-01" and months[-1]["start"] == "2026-09-01"
    assert months[-1]["distance_by_family"]["running"] == 7000
    assert result["all"][0]["buckets"][0]["start"] == "2024-11-01"
    assert result["all"][0]["buckets"][0]["distance_by_family"]["running"] == 3000

    years = result["all"][1]["buckets"]
    assert [y["start"] for y in years] == ["2024-01-01", "2025-01-01", "2026-01-01"]
    assert years[-1]["distance_by_family"]["running"] == 7000


def test_evolution_without_activities():
    result = evolution([], date(2026, 9, 27))
    assert len(result["all"][0]["buckets"]) == 1
    assert len(result["all"][1]["buckets"]) == 1


def test_records_pick_the_best_activity():
    rows = [
        row(1, "running", "2026-01-01T08:00", distance=21100, speed=3.2),
        row(2, "running", "2026-02-01T08:00", distance=5000, speed=4.1),
        row(3, "running", "2026-03-01T08:00", distance=3000, speed=5.0),  # too short for fastest
        row(4, "road_biking", "2026-04-01T08:00", distance=80000, elevation=1500, time=10000),
    ]
    found = {r["key"]: r for r in records(rows)}
    assert found["longest_run"]["activity_id"] == 1
    assert found["fastest_run"]["activity_id"] == 2
    assert found["longest_ride"]["activity_id"] == 4
    assert found["biggest_climb"]["value"] == 1500
    assert "longest_swim" not in found


def test_empty_history():
    result = build([], date(2026, 9, 27))
    assert result["periods"]["week"]["current"]["count"] == 0
    assert result["breakdown"] == []
    assert result["records"] == []


def test_periods_by_family_only_lists_recently_active_sports():
    today = date(2026, 9, 27)
    rows = [
        row(1, "running", "2026-09-25T08:00"),
        row(2, "road_biking", "2026-09-26T08:00", distance=40000.0),
        row(3, "trail_running", "2025-03-01T08:00"),  # last year: still in the year comparison
        row(4, "lap_swimming", "2024-12-31T08:00"),  # before last year: not offered
    ]
    result = periods_by_family(rows, today)
    assert list(result) == ["running", "cycling"]  # palette order
    assert result["running"]["week"]["current"]["count"] == 1
    assert result["running"]["year"]["previous"]["count"] == 1
    assert result["cycling"]["week"]["current"]["distance"] == 40000.0
