"""Fitness trends from Garmin: VO2 max, fitness age, race predictions, endurance and hill scores.

Garmin computes these on compatible watches, a value per day (weekly for the endurance score).
Each source is read over date ranges: the whole history on the first sync, then only the last
few weeks. Garmin doesn't document these payloads, so the parsers take what they recognise and
ignore the rest: an unexpected shape means missing values, never a failed sync.
"""

import logging
from collections.abc import Callable, Iterator
from datetime import UTC, date, datetime, timedelta

from garminconnect import Garmin
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import garmin
from .models import Activity, FitnessSource, FitnessValue

log = logging.getLogger(__name__)

CHUNK_DAYS = 364  # Garmin rejects race prediction ranges over a year
OVERLAP_DAYS = 14  # re-read recent weeks: weekly scores and late uploads change them
REFRESH_HOURS = 6  # a sync on every visit, but Garmin asked at most this often

Row = tuple[date, str, float]


def _day(value) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _number(value) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0 else None


def _entries(payload) -> list[dict]:
    if isinstance(payload, list):
        return [e for e in payload if isinstance(e, dict)]
    return [payload] if isinstance(payload, dict) else []


def parse_max_metrics(payload) -> list[Row]:
    """Per day: {"generic": {calendarDate, vo2MaxPreciseValue, fitnessAge}, "cycling": {...}}.
    "generic" is the running-based VO2 max."""
    rows = []
    for entry in _entries(payload):
        for block, metric in (("generic", "vo2max_running"), ("cycling", "vo2max_cycling")):
            data = entry.get(block)
            if not isinstance(data, dict) or not (day := _day(data.get("calendarDate"))):
                continue
            if vo2 := _number(data.get("vo2MaxPreciseValue")) or _number(data.get("vo2MaxValue")):
                rows.append((day, metric, round(vo2, 1)))
            if block == "generic" and (age := _number(data.get("fitnessAge"))):
                rows.append((day, "fitness_age", round(age, 1)))
    return rows


RACES = {"time5K": "race_5k", "time10K": "race_10k", "timeHalfMarathon": "race_half", "timeMarathon": "race_marathon"}


def parse_race_predictions(payload) -> list[Row]:
    """Per day: {calendarDate, time5K, time10K, timeHalfMarathon, timeMarathon}, in seconds."""
    rows = []
    for entry in _entries(payload):
        if not (day := _day(entry.get("calendarDate"))):
            continue
        for key, metric in RACES.items():
            if seconds := _number(entry.get(key)):
                rows.append((day, metric, seconds))
    return rows


def parse_endurance_score(payload) -> list[Row]:
    """Weekly averages in {"groupMap": {"<week start>": {"groupAverage": ...}}}, plus the latest
    score in "enduranceScoreDTO"."""
    rows = []
    for entry in _entries(payload):
        groups = entry.get("groupMap")
        for key, group in (groups.items() if isinstance(groups, dict) else []):
            if isinstance(group, dict) and (day := _day(key)) and (score := _number(group.get("groupAverage"))):
                rows.append((day, "endurance_score", round(score)))
        latest = entry.get("enduranceScoreDTO")
        if isinstance(latest, dict) and (day := _day(latest.get("calendarDate"))):
            if score := _number(latest.get("overallScore")):
                rows.append((day, "endurance_score", round(score)))
    return rows


HILL = {"overallScore": "hill_score", "strengthScore": "hill_strength", "enduranceScore": "hill_endurance"}


def parse_hill_score(payload) -> list[Row]:
    """Per day in "hillScoreDTOList": {calendarDate, overallScore, strengthScore, enduranceScore}."""
    rows = []
    for entry in _entries(payload):
        days = entry.get("hillScoreDTOList")
        for item in days if isinstance(days, list) else []:
            if not isinstance(item, dict) or not (day := _day(item.get("calendarDate"))):
                continue
            for key, metric in HILL.items():
                if score := _number(item.get(key)):
                    rows.append((day, metric, round(score)))
    return rows


# name -> (fetch(client, first, last), parse)
SOURCES: dict[str, tuple[Callable[[Garmin, str, str], object], Callable[[object], list[Row]]]] = {
    "max_metrics": (lambda c, first, last: c.get_max_metrics_range(first, last), parse_max_metrics),
    "race_predictions": (lambda c, first, last: c.get_race_predictions(first, last, "daily"), parse_race_predictions),
    "endurance_score": (lambda c, first, last: c.get_endurance_score(first, last), parse_endurance_score),
    "hill_score": (lambda c, first, last: c.get_hill_score(first, last), parse_hill_score),
}


def _chunks(first: date, last: date) -> Iterator[tuple[date, date]]:
    while first <= last:
        end = min(first + timedelta(days=CHUNK_DAYS - 1), last)
        yield first, end
        first = end + timedelta(days=1)


def _store(db: Session, rows: list[Row]) -> None:
    for day, metric, value in rows:
        db.merge(FitnessValue(calendar_date=day, metric=metric, value=value))


def sync(db: Session, client: Garmin | None = None, today: date | None = None) -> int:
    """Read each source from where it stopped (or from the first activity) up to today.
    Returns how many values were read. Rate limits and expired logins propagate."""
    now = datetime.now(UTC).replace(tzinfo=None)
    today = today or now.date()
    first_activity = db.scalar(select(func.min(Activity.start_time_local)))
    history_start = first_activity.date() if first_activity else today - timedelta(days=CHUNK_DAYS)
    read = 0
    for name, (fetch, parse) in SOURCES.items():
        state = db.get(FitnessSource, name)
        if state is not None and state.fetched_at > now - timedelta(hours=REFRESH_HOURS):
            continue
        start = max(history_start, state.fetched_through - timedelta(days=OVERLAP_DAYS)) if state else history_start
        complete = True
        for first, last in _chunks(start, today):
            client = client or garmin.connect(db)
            try:
                payload = garmin._optional(lambda: fetch(client, first.isoformat(), last.isoformat()))
            except garmin._Retry:
                log.warning("Fitness %s unavailable for now", name, exc_info=True)
                complete = False
                break
            rows = parse(payload)
            _store(db, rows)
            db.commit()
            read += len(rows)
        if complete:
            state = state or FitnessSource(source=name)
            state.fetched_through, state.fetched_at = today, now
            db.add(state)
            db.commit()
    if read:
        log.info("Fitness sync read %d values", read)
    return read
