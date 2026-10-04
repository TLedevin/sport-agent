"""Garmin Connect sync, using session tokens stored in the database."""

import json
import logging
import threading
from datetime import UTC, datetime
from typing import NamedTuple

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectNotFoundError,
    GarminConnectTooManyRequestsError,
)
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from . import routes
from .models import Activity, ActivityDetail, ActivityGear, ActivityName, ActivityTrack, GarminAuth, Gear, GearPhoto
from .sports import sport_family

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
        renamed = dict(db.execute(select(ActivityName.activity_id, ActivityName.name)).all())
        imported, start = 0, 0
        while True:
            page = client.get_activities(start, PAGE_SIZE)
            for data in page:
                if data["activityId"] not in known:
                    imported += 1
                activity = to_activity(data)
                if activity.id in renamed:  # your title wins over Garmin's
                    activity.name = renamed[activity.id]
                db.merge(activity)  # also refreshes recently edited activities
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
        db.execute(delete(GearPhoto).where(GearPhoto.gear_uuid == gone.uuid))
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
    routes.save(db, activity.id, points)
    db.commit()
    return points


# --- Activity details ----------------------------------------------------------

DETAILS_VERSION = 1  # bump when the stored shape changes, so old rows are re-fetched
MAX_CHART_POINTS = 2000  # time-series samples per activity (Garmin downsamples long ones)
NO_DATA = 65535  # Garmin's placeholder for "no sensor", e.g. power without a power meter


class _Retry(Exception):
    """A call failed for a reason worth retrying later: don't cache the result."""


def _optional(fetch):
    """Endpoints an activity may simply not have: 'not found' means no data. Rate limits and
    expired logins propagate; anything else means the result must not be cached."""
    try:
        return fetch()
    except (GarminConnectAuthenticationError, GarminConnectTooManyRequestsError):
        raise
    except GarminConnectNotFoundError:
        return None
    except GarminConnectConnectionError as err:
        status = getattr(getattr(err, "response", None), "status_code", None)
        if status in (400, 404):
            return None
        raise _Retry() from err
    except Exception as err:
        raise _Retry() from err


def _round(value):
    return round(value, 6) if isinstance(value, float) else value


def _series(details: dict | None) -> dict | None:
    """Garmin's row-per-sample metrics as one column per metric, dropping empty ones."""
    if not details:
        return None
    descriptors = details.get("metricDescriptors") or []
    rows = details.get("activityDetailMetrics") or []
    if not descriptors or not rows:
        return None
    columns, units = {}, {}
    for d in descriptors:
        i = d["metricsIndex"]
        values = [_round(r["metrics"][i]) if i < len(r["metrics"]) else None for r in rows]
        if all(v is None or v == NO_DATA for v in values):
            continue
        columns[d["key"]] = [None if v == NO_DATA else v for v in values]
        units[d["key"]] = (d.get("unit") or {}).get("key")
    return {"length": len(rows), "metrics": columns, "units": units} if columns else None


def _weather(weather: dict | None) -> dict | None:
    """Indoor activities get a record with every value empty: treat it as no weather."""
    if not weather or weather.get("temp") is None:
        return None
    return weather


def fetch_details(activity: Activity, client: Garmin) -> tuple[dict, bool]:
    """Everything Garmin offers for one activity. Returns (data, complete): incomplete data
    (a call failed in a retryable way) is shown but not cached.

    Activities differ a lot: manual entries have no samples, pool swims no GPS or weather,
    strength sessions have exercise sets... so each call is only made when it can return data.
    """
    raw, aid = activity.raw, str(activity.id)
    manual = bool(raw.get("manualActivity"))
    has_gps = bool(raw.get("hasPolyline")) or raw.get("startLatitude") is not None
    has_power = any(k in raw for k in ("avgPower", "maxPower", "normPower"))
    strength = sport_family(activity.sport_type) == "fitness" or "summarizedExerciseSets" in raw

    calls = {
        "summary": lambda: (client.get_activity(aid) or {}).get("summaryDTO"),
        "series": None if manual else lambda: _series(
            client.get_activity_details(aid, maxchart=MAX_CHART_POINTS, maxpoly=0)
        ),
        "laps": lambda: (client.get_activity_splits(aid) or {}).get("lapDTOs") or [],
        "typed_splits": None if manual else lambda: (client.get_activity_typed_splits(aid) or {}).get("splits") or [],
        "split_summaries": None if manual else lambda: (
            client.get_activity_split_summaries(aid) or {}
        ).get("splitSummaries") or [],
        "weather": (lambda: _weather(client.get_activity_weather(aid))) if has_gps and not manual else None,
        "hr_zones": None if manual else lambda: client.get_activity_hr_in_timezones(aid) or [],
        "power_zones": (lambda: client.get_activity_power_in_timezones(aid) or []) if has_power else None,
        "exercise_sets": (
            (lambda: (client.get_activity_exercise_sets(aid) or {}).get("exerciseSets") or []) if strength else None
        ),
    }
    data: dict = {"version": DETAILS_VERSION}
    complete = True
    for name, fetch in calls.items():
        if fetch is None:
            data[name] = None
            continue
        try:
            data[name] = _optional(fetch)
        except _Retry:
            log.warning("Activity %s: %s unavailable for now", aid, name, exc_info=True)
            data[name] = None
            complete = False
    return data, complete


def details(db: Session, activity: Activity, client: Garmin | None = None) -> dict:
    """Stored details, fetching them from Garmin the first time."""
    stored = db.get(ActivityDetail, activity.id)
    if stored is not None and stored.data.get("version") == DETAILS_VERSION:
        return stored.data
    data, complete = fetch_details(activity, client or connect(db))
    if complete:
        db.merge(ActivityDetail(activity_id=activity.id, data=data, fetched_at=_utcnow()))
        routes.save(db, activity.id, routes.points_from_details(data))
        db.commit()
    return data


_backfill_lock = threading.Lock()
BACKFILL_BATCH = 25


def backfill_details(db: Session, limit: int | None = None) -> int:
    """Fetch details for activities that don't have them yet, newest first. Run after a sync,
    so the history fills in over time without slowing the sync down. Returns how many were stored."""
    if not _backfill_lock.acquire(blocking=False):
        return 0
    limit = BACKFILL_BATCH if limit is None else limit
    try:
        have = select(ActivityDetail.activity_id).where(ActivityDetail.activity_id == Activity.id)
        missing = db.scalars(
            select(Activity).where(~have.exists()).order_by(Activity.start_time_utc.desc()).limit(limit)
        ).all()
        if not missing:
            return 0
        client = connect(db)
        stored = 0
        for activity in missing:
            try:
                data, complete = fetch_details(activity, client)
            except GarminConnectTooManyRequestsError:
                log.info("Details backfill paused: Garmin rate limit")
                break
            if complete:
                db.merge(ActivityDetail(activity_id=activity.id, data=data, fetched_at=_utcnow()))
                routes.save(db, activity.id, routes.points_from_details(data))
                db.commit()
                stored += 1
        log.info("Details backfill stored %d activities", stored)
        return stored
    finally:
        _backfill_lock.release()
