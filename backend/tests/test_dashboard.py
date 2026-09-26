from datetime import date, datetime

from app.dashboard import Row, build, periods, records, weekly
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


def test_weekly_buckets_start_on_monday_and_split_by_family():
    today = date(2026, 9, 27)  # a Sunday
    rows = [
        row(1, "running", "2026-09-21T07:00", time=1800),  # Monday of the current week
        row(2, "road_biking", "2026-09-27T09:00", time=7200),
        row(3, "running", "2026-09-20T07:00", time=600),  # previous week
    ]
    weeks = weekly(rows, today)
    assert len(weeks) == 12
    assert weeks[-1]["week_start"] == "2026-09-21"
    assert weeks[-1]["duration_by_family"]["running"] == 1800
    assert weeks[-1]["duration_by_family"]["cycling"] == 7200
    assert weeks[-2]["duration_by_family"]["running"] == 600


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
