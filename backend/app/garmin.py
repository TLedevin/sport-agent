"""Garmin Connect sync, using session tokens stored in the database."""

import json
import logging
import threading
from datetime import UTC, datetime

from garminconnect import Garmin
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Activity, ActivityTrack, GarminAuth

log = logging.getLogger(__name__)

PAGE_SIZE = 100
MAX_TRACK_POINTS = 2000  # plenty for a card-sized map
_sync_lock = threading.Lock()


class GarminNotConnected(Exception):
    """No Garmin tokens stored yet: run scripts/garmin_login.py."""


class SyncInProgress(Exception):
    pass


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _parse_time(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")


def save_tokens(db: Session, tokens: str) -> None:
    data = json.loads(tokens)  # raises ValueError if not JSON
    if not data.get("di_refresh_token"):
        raise ValueError("Token JSON has no di_refresh_token")
    auth = db.get(GarminAuth, 1) or GarminAuth(id=1)
    auth.tokens = tokens
    auth.tokens_updated_at = _utcnow()
    db.add(auth)
    db.commit()


def connect(db: Session) -> Garmin:
    auth = db.get(GarminAuth, 1)
    if auth is None:
        raise GarminNotConnected()
    client = Garmin()
    client.login(auth.tokens)  # restores the session, refreshing tokens if they expire soon
    return client


def to_activity(data: dict) -> Activity:
    return Activity(
        id=data["activityId"],
        name=(data.get("activityName") or "")[:255],
        sport_type=(data.get("activityType") or {}).get("typeKey", "other"),
        start_time_utc=_parse_time(data["startTimeGMT"]),
        start_time_local=_parse_time(data["startTimeLocal"]),
        distance=data.get("distance") or 0,
        duration=data.get("duration") or 0,
        moving_duration=data.get("movingDuration"),
        elevation_gain=data.get("elevationGain"),
        average_speed=data.get("averageSpeed"),
        max_speed=data.get("maxSpeed"),
        average_hr=data.get("averageHR"),
        max_hr=data.get("maxHR"),
        calories=data.get("calories"),
        raw=data,
    )


def sync(db: Session, client: Garmin | None = None) -> int:
    """Import activities newer than the ones already stored. Returns how many were new.

    Garmin lists activities newest first, so paging stops at the first page that
    contains an activity we already have. The first sync imports the full history.
    """
    if not _sync_lock.acquire(blocking=False):
        raise SyncInProgress()
    try:
        client = client or connect(db)
        known = set(db.scalars(select(Activity.id)))
        imported, start = 0, 0
        while True:
            page = client.get_activities(start, PAGE_SIZE)
            for data in page:
                if data["activityId"] not in known:
                    imported += 1
                db.merge(to_activity(data))  # also refreshes recently edited activities
            db.commit()
            if len(page) < PAGE_SIZE or any(a["activityId"] in known for a in page):
                break
            start += PAGE_SIZE

        auth = db.get(GarminAuth, 1)
        if auth is not None:
            tokens = client.client.dumps()
            if tokens != auth.tokens:  # keep refreshed tokens for the next run
                auth.tokens = tokens
                auth.tokens_updated_at = _utcnow()
            auth.last_sync_at = _utcnow()
            db.commit()
        log.info("Garmin sync imported %d new activities", imported)
        return imported
    finally:
        _sync_lock.release()


def track(db: Session, activity: Activity, client: Garmin | None = None) -> list[list[float]]:
    """GPS points as [[lat, lon], ...]. Fetched from Garmin once, then served from the database."""
    stored = db.get(ActivityTrack, activity.id)
    if stored is not None:
        return stored.points

    points: list[list[float]] = []
    if activity.raw.get("hasPolyline"):  # indoor activities have no GPS: skip the Garmin call
        client = client or connect(db)
        details = client.get_activity_details(str(activity.id), maxchart=1, maxpoly=MAX_TRACK_POINTS)
        polyline = (details.get("geoPolylineDTO") or {}).get("polyline") or []
        points = [
            [round(p["lat"], 6), round(p["lon"], 6)]
            for p in polyline
            if p.get("lat") is not None and p.get("lon") is not None
        ]
    db.add(ActivityTrack(activity_id=activity.id, points=points, fetched_at=_utcnow()))
    db.commit()
    return points
