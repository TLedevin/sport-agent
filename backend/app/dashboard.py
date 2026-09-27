"""Dashboard aggregates. Periods use the athlete's local dates (start_time_local)."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from .sports import FAMILIES, sport_family

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


def periods_by_family(rows: list[Row], today: date) -> dict:
    """The same periods per sport family, for families active since 1 January last year
    (the widest comparison window): any other family would only show zeros."""
    active = {r.family for r in _between(rows, date(today.year - 1, 1, 1), today)}
    return {
        family: periods([r for r in rows if r.family == family], today) for family in FAMILIES if family in active
    }


def _week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _month_start(day: date) -> date:
    return day.replace(day=1)


def _months_back(month: date, n: int) -> date:
    index = month.year * 12 + month.month - 1 - n
    return date(index // 12, index % 12 + 1, 1)


def _series(rows: list[Row], starts: list[date], bucket_of) -> list[dict]:
    time: dict[date, dict[str, float]] = {start: defaultdict(float) for start in starts}
    distance: dict[date, dict[str, float]] = {start: defaultdict(float) for start in starts}
    for r in rows:
        key = bucket_of(r.start.date())
        if key in time:
            time[key][r.family] += r.time
            distance[key][r.family] += r.distance
    return [
        {
            "start": start.isoformat(),
            "duration_by_family": {f: time[start].get(f, 0.0) for f in FAMILIES},
            "distance_by_family": {f: distance[start].get(f, 0.0) for f in FAMILIES},
        }
        for start in starts
    ]


def evolution(rows: list[Row], today: date) -> dict:
    """Training per sport over time for each range of the Evolution chart: one series per
    granularity the range offers, the default first. Buckets are oldest first, and each covers
    a whole calendar unit (the current one still in progress)."""
    this_week, this_month = _week_start(today), _month_start(today)
    first = min(r.start.date() for r in rows) if rows else today
    all_months = (this_month.year - first.year) * 12 + this_month.month - first.month + 1

    def days(n: int) -> dict:
        starts = [today - timedelta(days=i) for i in range(n - 1, -1, -1)]
        return {"unit": "day", "buckets": _series(rows, starts, lambda d: d)}

    def weeks(n: int) -> dict:
        starts = [this_week - timedelta(weeks=i) for i in range(n - 1, -1, -1)]
        return {"unit": "week", "buckets": _series(rows, starts, _week_start)}

    def months(n: int) -> dict:
        starts = [_months_back(this_month, i) for i in range(n - 1, -1, -1)]
        return {"unit": "month", "buckets": _series(rows, starts, _month_start)}

    def years() -> dict:
        starts = [date(y, 1, 1) for y in range(first.year, today.year + 1)]
        return {"unit": "year", "buckets": _series(rows, starts, lambda d: date(d.year, 1, 1))}

    return {
        "1m": [days(30), weeks(5)],
        "3m": [weeks(13), months(3)],
        "6m": [weeks(26), months(6)],
        "1y": [months(12)],  # a yearly view of one year would be one or two bars
        "all": [months(all_months), years()],
    }


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
        "periods_by_family": periods_by_family(rows, today),
        "evolution": evolution(rows, today),
        "breakdown": breakdown(rows, today),
        "records": records(rows),
    }
