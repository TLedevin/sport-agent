"""Dashboard aggregates. Periods use the athlete's local dates (start_time_local)."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from .sports import FAMILIES, sport_family

WEEKS = 12
FASTEST_RUN_MIN_DISTANCE = 5000  # meters


@dataclass
class Row:
    id: int
    name: str
    sport_type: str
    start: datetime  # local
    distance: float
    time: float  # seconds: moving time when known, else elapsed
    elevation: float
    speed: float | None

    @property
    def family(self) -> str:
        return sport_family(self.sport_type)


def _totals(rows: list[Row]) -> dict:
    return {
        "count": len(rows),
        "distance": sum(r.distance for r in rows),
        "duration": sum(r.time for r in rows),
        "elevation_gain": sum(r.elevation for r in rows),
    }


def _between(rows: list[Row], first: date, last: date) -> list[Row]:
    return [r for r in rows if first <= r.start.date() <= last]


def _same_day_or_last(year: int, month: int, day: int) -> date:
    """e.g. 31 March -> 28/29 February, for 'same point last month'."""
    while True:
        try:
            return date(year, month, day)
        except ValueError:
            day -= 1


def periods(rows: list[Row], today: date) -> dict:
    prev_month_year, prev_month = (today.year, today.month - 1) if today.month > 1 else (today.year - 1, 12)
    ranges = {
        "week": ((today - timedelta(days=6), today), (today - timedelta(days=13), today - timedelta(days=7))),
        "month": (
            (today.replace(day=1), today),
            (date(prev_month_year, prev_month, 1), _same_day_or_last(prev_month_year, prev_month, today.day)),
        ),
        "year": (
            (date(today.year, 1, 1), today),
            (date(today.year - 1, 1, 1), _same_day_or_last(today.year - 1, today.month, today.day)),
        ),
    }
    return {
        key: {"current": _totals(_between(rows, *cur)), "previous": _totals(_between(rows, *prev))}
        for key, (cur, prev) in ranges.items()
    }


def weekly(rows: list[Row], today: date) -> list[dict]:
    this_monday = today - timedelta(days=today.weekday())
    starts = [this_monday - timedelta(weeks=i) for i in range(WEEKS - 1, -1, -1)]
    buckets = {start: defaultdict(float) for start in starts}
    for r in rows:
        monday = r.start.date() - timedelta(days=r.start.weekday())
        if monday in buckets:
            buckets[monday][r.family] += r.time
    return [
        {"week_start": start.isoformat(), "duration_by_family": {f: buckets[start].get(f, 0.0) for f in FAMILIES}}
        for start in starts
    ]


def breakdown(rows: list[Row], today: date) -> list[dict]:
    by_family: dict[str, list[Row]] = defaultdict(list)
    for r in _between(rows, date(today.year, 1, 1), today):
        by_family[r.family].append(r)
    result = [{"family": f, **_totals(group)} for f, group in by_family.items()]
    return sorted(result, key=lambda x: x["duration"], reverse=True)


def _record(key: str, label: str, candidates: list[Row], metric, value) -> dict | None:
    if not candidates:
        return None
    best = max(candidates, key=metric)
    return {
        "key": key,
        "label": label,
        "value": value(best),
        "activity_id": best.id,
        "activity_name": best.name,
        "family": best.family,
        "date": best.start.date().isoformat(),
    }


def records(rows: list[Row]) -> list[dict]:
    runs = [r for r in rows if r.family == "running" and r.distance > 0]
    rides = [r for r in rows if r.family == "cycling" and r.distance > 0]
    swims = [r for r in rows if r.family == "swimming" and r.distance > 0]
    fast_runs = [r for r in runs if r.distance >= FASTEST_RUN_MIN_DISTANCE and r.speed]
    climbs = [r for r in rows if r.elevation > 0]
    found = [
        _record("longest_run", "Longest run", runs, lambda r: r.distance, lambda r: r.distance),
        _record("fastest_run", "Fastest run (5 km+)", fast_runs, lambda r: r.speed, lambda r: r.speed),
        _record("longest_ride", "Longest ride", rides, lambda r: r.distance, lambda r: r.distance),
        _record("longest_swim", "Longest swim", swims, lambda r: r.distance, lambda r: r.distance),
        _record("biggest_climb", "Biggest climb", climbs, lambda r: r.elevation, lambda r: r.elevation),
        _record("longest_session", "Longest session", rows, lambda r: r.time, lambda r: r.time),
    ]
    return [r for r in found if r]


def build(rows: list[Row], today: date) -> dict:
    return {
        "today": today.isoformat(),
        "periods": periods(rows, today),
        "weekly": weekly(rows, today),
        "breakdown": breakdown(rows, today),
        "records": records(rows),
    }
