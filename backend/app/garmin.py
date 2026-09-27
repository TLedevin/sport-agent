"""Garmin Connect sync, using session tokens stored in the database."""

import json
import logging
import threading
from datetime import UTC, datetime
from typing import NamedTuple

from garminconnect import Garmin
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .models import Activity, ActivityGear, ActivityTrack, GarminAuth, Gear

log = logging.getLogger(__name__)

PAGE_SIZE = 100
MAX_TRACK_POINTS = 2000  # plenty for a card-sized map
_sync_lock = threading.Lock()


class GarminNotConnected(Exception):
    """No Garmin tokens stored yet: run scripts/garmin_login.py."""


class SyncInProgress(Exception):
    pass


class SyncResult(NamedTuple):
    imported: int  # new activities
    gear_changed: bool


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _parse_time(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")


def _parse_gear_date(value: str | None) -> datetime | None:
    # Garmin gear dates look like "2018-08-19T22:00:00.0"
    return datetime.fromisoformat(value.split(".")[0]) if value else None


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


def sync(db: Session, client: Garmin | None = None) -> SyncResult:
    """Import activities newer than the ones already stored, then refresh the gear.

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

        # Activities are already saved: a gear failure must not undo or hide them.
        try:
            gear_changed = sync_gear(db, client)
        except Exception:
            db.rollback()
            log.exception("Gear sync failed; it will be retried on the next sync")
            gear_changed = False
        return SyncResult(imported, gear_changed)
    finally:
        _sync_lock.release()


def _gear_state(gear: Gear) -> tuple:
    return (
        gear.name, gear.make_model, gear.status, gear.date_begin, gear.date_end,
        gear.maximum_distance, gear.total_distance, gear.total_activities,
    )


def sync_gear(db: Session, client: Garmin) -> bool:
    """Mirror Garmin's gear list, its usage totals and which activities used each item.
    Returns True when anything changed.

    Calls are kept low: totals are re-read for active gear (and for retired gear only when
    Garmin reports an edit), and an item's activity list only when its totals moved.
    """
    if client.profile_id is None:
        log.warning("Garmin profile id unknown: skipping gear sync")
        return False

    stored = {g.uuid: g for g in db.scalars(select(Gear))}
    changed = False
    for item in client.get_gear(str(client.profile_id)):
        uuid = item["uuid"]
        gear = stored.pop(uuid, None)
        is_new = gear is None
        if gear is None:
            gear = Gear(uuid=uuid, total_distance=0.0, total_activities=0, raw={})
            db.add(gear)
        before = None if is_new else _gear_state(gear)
        edited = gear.raw.get("updateDate") != item.get("updateDate")

        # Fields from the list first: the queries below flush the row, so it must be complete.
        make_model = item.get("customMakeModel") or None
        gear.name = (item.get("displayName") or make_model or item.get("gearModelName") or "Unnamed")[:255]
        gear.make_model = make_model[:255] if make_model else None
        gear.gear_type = item.get("gearTypeName") or "Other"
        gear.status = item.get("gearStatusName") or "active"
        gear.date_begin = _parse_gear_date(item.get("dateBegin"))
        gear.date_end = _parse_gear_date(item.get("dateEnd"))
        gear.maximum_distance = item.get("maximumMeters") or None
        gear.raw = item

        if is_new or edited or gear.status == "active":
            stats = client.get_gear_stats(uuid)
            distance = stats.get("totalDistance") or 0.0
            count = stats.get("totalActivities") or 0
            if is_new or (distance, count) != (gear.total_distance, gear.total_activities):
                used = {a["activityId"] for a in client.get_gear_activities(uuid)}
                db.execute(delete(ActivityGear).where(ActivityGear.gear_uuid == uuid))
                db.add_all(ActivityGear(activity_id=a, gear_uuid=uuid) for a in used)
            gear.total_distance, gear.total_activities = distance, count

        changed = changed or is_new or _gear_state(gear) != before

    for gone in stored.values():  # deleted in Garmin Connect
        db.execute(delete(ActivityGear).where(ActivityGear.gear_uuid == gone.uuid))
        db.delete(gone)
        changed = True
    db.commit()
    return changed


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
