"""Simplified routes for the map of all activities.

Every route is sent in one response, so each is simplified (Douglas-Peucker) and stored as an
encoded polyline: a few hundred bytes per activity instead of thousands of raw GPS samples.
Built from the stored track or the detail samples, whichever the activity has.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import ActivityDetail, ActivityRoute, ActivityTrack

log = logging.getLogger(__name__)

TOLERANCE = 0.00005  # degrees (~5 m): detail finer than this doesn't show on the map
MAX_POINTS = 500  # safety cap for very long activities


def simplify(points: list[list[float]], tolerance: float = TOLERANCE) -> list[list[float]]:
    """Douglas-Peucker: keeps the points that shape the route, drops the ones on straight lines."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        (y1, x1), (y2, x2) = points[first], points[last]
        dx, dy = x2 - x1, y2 - y1
        length = (dx * dx + dy * dy) ** 0.5
        farthest, index = 0.0, -1
        for i in range(first + 1, last):
            y, x = points[i]
            if length:
                distance = abs(dy * (x - x1) - dx * (y - y1)) / length
            else:  # loop back to the start point
                distance = ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
            if distance > farthest:
                farthest, index = distance, i
        if farthest > tolerance:
            keep[index] = True
            stack += [(first, index), (index, last)]
    kept = [p for p, k in zip(points, keep) if k]
    if len(kept) > MAX_POINTS:
        step = len(kept) / MAX_POINTS
        kept = [kept[int(i * step)] for i in range(MAX_POINTS - 1)] + [kept[-1]]
    return kept


def encode(points: list[list[float]]) -> str:
    """Google's encoded polyline format, precision 5 (~1 m)."""
    chunks: list[str] = []
    previous = (0, 0)
    for lat, lon in points:
        current = (round(lat * 1e5), round(lon * 1e5))
        for value in (current[0] - previous[0], current[1] - previous[1]):
            value = ~(value << 1) if value < 0 else value << 1
            while value >= 0x20:
                chunks.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            chunks.append(chr(value + 63))
        previous = current
    return "".join(chunks)


def points_from_details(data: dict) -> list[list[float]]:
    """GPS positions from the detail samples, skipping samples without a fix."""
    metrics = (data.get("series") or {}).get("metrics") or {}
    lats, lons = metrics.get("directLatitude"), metrics.get("directLongitude")
    if not lats or not lons:
        return []
    return [[lat, lon] for lat, lon in zip(lats, lons) if lat is not None and lon is not None]


def save(db: Session, activity_id: int, points: list[list[float]]) -> None:
    """Store the simplified route (not committed). An empty route never replaces a real one."""
    existing = db.get(ActivityRoute, activity_id)
    if not points and existing is not None:
        return
    route = existing or ActivityRoute(activity_id=activity_id)
    route.polyline = encode(simplify(points))
    route.computed_at = datetime.now(UTC).replace(tzinfo=None)
    db.add(route)


def backfill(db: Session) -> int:
    """Build routes for activities whose track or details were stored before routes existed.
    Needs no Garmin call. Returns how many were built."""
    have = select(ActivityRoute.activity_id)
    # Read the ids first: SQL Server can't run other queries while a result is still being read.
    track_ids = db.scalars(select(ActivityTrack.activity_id).where(ActivityTrack.activity_id.not_in(have))).all()
    detail_ids = db.scalars(select(ActivityDetail.activity_id).where(ActivityDetail.activity_id.not_in(have))).all()
    built = 0
    for activity_id in track_ids:
        save(db, activity_id, db.get(ActivityTrack, activity_id).points)
        built += 1
    for activity_id in set(detail_ids) - set(track_ids):
        detail = db.get(ActivityDetail, activity_id)
        points = points_from_details(detail.data)
        db.expunge(detail)  # details are large: don't keep them all in memory
        save(db, activity_id, points)
        built += 1
        if built % 50 == 0:
            db.commit()
    db.commit()
    if built:
        log.info("Built %d map routes", built)
    return built
