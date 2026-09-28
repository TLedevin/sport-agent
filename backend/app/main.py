import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from garminconnect import GarminConnectAuthenticationError, GarminConnectTooManyRequestsError
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from . import dashboard, fitness, garmin, photos, routes
from .auth import check_password, create_session, require_session
from .config import get_settings
from .db import SessionLocal, get_db, wake_database
from .models import Activity, ActivityGear, ActivityRoute, FitnessSource, FitnessValue, GarminAuth, Gear, GearPhoto
from .sports import FAMILIES, sport_family

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Sport Agent API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().frontend_url],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)  # the map sends every route at once

authed = [Depends(require_session)]


@contextmanager
def _garmin_errors() -> Iterator[None]:
    """Garmin failures as HTTP errors the frontend knows how to explain."""
    try:
        yield
    except garmin.GarminNotConnected:
        raise HTTPException(409, "garmin_not_connected")
    except GarminConnectAuthenticationError:
        raise HTTPException(409, "garmin_reconnect_needed")
    except GarminConnectTooManyRequestsError:
        raise HTTPException(429, "garmin_rate_limited")


def _iso_utc(value: datetime | None) -> str | None:
    return value.replace(tzinfo=UTC).isoformat() if value else None


# --- Public -----------------------------------------------------------------


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/wake", status_code=202)
def wake(background: BackgroundTasks) -> dict:
    """Called as soon as the frontend loads, so the database resumes while you log in."""
    background.add_task(wake_database)
    return {"status": "waking"}


class LoginRequest(BaseModel):
    password: str


@app.post("/api/auth/login")
def login(body: LoginRequest) -> dict:
    if not check_password(body.password):
        time.sleep(1)  # slows down password guessing
        raise HTTPException(401, "Wrong password")
    return {"token": create_session()}


# --- Authenticated ------------------------------------------------------------


def _activity_json(a: Activity) -> dict:
    return {
        "id": a.id,
        "name": a.name,
        "sport_type": a.sport_type,
        "sport_family": sport_family(a.sport_type),
        "start_time_utc": _iso_utc(a.start_time_utc),
        "start_time_local": a.start_time_local.isoformat(),
        "location_name": a.raw.get("locationName"),
        "distance": a.distance,
        "duration": a.duration,
        "moving_duration": a.moving_duration,
        "elevation_gain": a.elevation_gain,
        "average_speed": a.average_speed,
        "average_hr": a.average_hr,
        "max_hr": a.max_hr,
        "calories": a.calories,
        "has_track": bool(a.raw.get("hasPolyline")),
    }


SORT_COLUMNS = {
    "date": Activity.start_time_utc,
    "name": Activity.name,
    "distance": Activity.distance,
    "duration": Activity.duration,
    "speed": Activity.average_speed,
    "hr": Activity.average_hr,
    "elevation": Activity.elevation_gain,
}


@app.get("/api/activities", dependencies=authed)
def list_activities(
    limit: int = 50,
    offset: int = 0,
    date_from: date | None = None,  # the athlete's local dates, both inclusive
    date_to: date | None = None,
    min_distance: float | None = None,  # meters
    max_distance: float | None = None,
    sport: Literal["running", "cycling", "swimming", "walking", "fitness", "other"] | None = None,  # family
    sort: Literal["date", "name", "distance", "duration", "speed", "hr", "elevation"] = "date",
    order: Literal["asc", "desc"] = "desc",
    db: Session = Depends(get_db),
) -> dict:
    """A page of activities matching the filters, how many match in total, and which sport
    families exist at all (for the filter buttons)."""
    # Families are derived from Garmin's sport type, not stored: filter on the matching types.
    types_by_family: dict[str, list[str]] = {}
    for sport_type in db.scalars(select(Activity.sport_type).distinct()):
        types_by_family.setdefault(sport_family(sport_type), []).append(sport_type)
    filters = []
    if sport:
        filters.append(Activity.sport_type.in_(types_by_family.get(sport, [])))
    if date_from:
        filters.append(Activity.start_time_local >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        filters.append(Activity.start_time_local < datetime.combine(date_to + timedelta(days=1), datetime.min.time()))
    if min_distance is not None:
        filters.append(Activity.distance >= min_distance)
    if max_distance is not None:
        filters.append(Activity.distance <= max_distance)

    column = SORT_COLUMNS[sort]
    rows = db.scalars(
        select(Activity)
        .where(*filters)
        # Missing values (no heart rate, no elevation...) last in both directions. Written as a
        # CASE rather than NULLS LAST, which SQL Server doesn't support.
        .order_by(
            case((column.is_(None), 1), else_=0),
            column.asc() if order == "asc" else column.desc(),
            Activity.id.desc(),  # stable order across pages
        )
        .offset(offset)
        .limit(min(limit, 200))
    ).all()  # read every row now: SQL Server rejects the count below while results are pending
    total = db.scalar(select(func.count()).select_from(Activity).where(*filters))
    return {
        "items": [_activity_json(a) for a in rows],
        "total": total,
        "families": [f for f in FAMILIES if f in types_by_family],
    }


def _get_activity(db: Session, activity_id: int) -> Activity:
    activity = db.get(Activity, activity_id)
    if activity is None:
        raise HTTPException(404, "Activity not found")
    return activity


@app.get("/api/activities/{activity_id}", dependencies=authed)
def get_activity(activity_id: int, db: Session = Depends(get_db)) -> dict:
    """The stored summary with every Garmin field, and the gear used. Answers from the database."""
    activity = _get_activity(db, activity_id)
    gear = db.execute(
        select(Gear.uuid, Gear.name, Gear.gear_type)
        .join(ActivityGear, ActivityGear.gear_uuid == Gear.uuid)
        .where(ActivityGear.activity_id == activity_id)
    ).all()
    return {
        **_activity_json(activity),
        "raw": activity.raw,
        "gear": [{"uuid": g.uuid, "name": g.name, "gear_type": g.gear_type} for g in gear],
    }


@app.get("/api/activities/{activity_id}/details", dependencies=authed)
def get_activity_details(activity_id: int, db: Session = Depends(get_db)) -> dict:
    """Time series, laps, weather, zones...: fetched from Garmin on first view, then stored."""
    activity = _get_activity(db, activity_id)
    with _garmin_errors():
        return garmin.details(db, activity)


@app.get("/api/activities/{activity_id}/track", dependencies=authed)
def get_track(activity_id: int, db: Session = Depends(get_db)) -> dict:
    activity = _get_activity(db, activity_id)
    with _garmin_errors():
        points = garmin.track(db, activity)
    return {"points": points}


@app.get("/api/map", dependencies=authed)
def get_map(db: Session = Depends(get_db)) -> list[dict]:
    """Every activity with a known position, newest first: its simplified route (an encoded
    polyline) when one is stored, else just its start point. The page filters by the visible
    area itself, so the whole set comes in one request."""
    start_lat = Activity.raw["startLatitude"].as_float()
    start_lon = Activity.raw["startLongitude"].as_float()
    rows = db.execute(
        select(
            Activity.id,
            Activity.name,
            Activity.sport_type,
            Activity.start_time_local,
            Activity.distance,
            Activity.duration,
            start_lat.label("start_lat"),
            start_lon.label("start_lon"),
            ActivityRoute.polyline,
        )
        .outerjoin(ActivityRoute, ActivityRoute.activity_id == Activity.id)
        .order_by(Activity.start_time_utc.desc(), Activity.id.desc())
    ).all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "sport_type": r.sport_type,
            "sport_family": sport_family(r.sport_type),
            "start_time_local": r.start_time_local.isoformat(),
            "distance": r.distance,
            "duration": r.duration,
            "start": [r.start_lat, r.start_lon] if r.start_lat is not None and r.start_lon is not None else None,
            "route": r.polyline or None,
        }
        for r in rows
        if r.polyline or (r.start_lat is not None and r.start_lon is not None)
    ]


@app.get("/api/fitness", dependencies=authed)
def get_fitness(db: Session = Depends(get_db)) -> dict:
    """Every fitness value as [date, value] pairs per metric, oldest first. `checked` tells
    "not read from Garmin yet" apart from "Garmin has no such data for this watch"."""
    series: dict[str, list] = {}
    for r in db.execute(
        select(FitnessValue.calendar_date, FitnessValue.metric, FitnessValue.value).order_by(FitnessValue.calendar_date)
    ):
        series.setdefault(r.metric, []).append([r.calendar_date.isoformat(), r.value])
    return {"series": series, "checked": db.scalar(select(func.count()).select_from(FitnessSource)) > 0}


@app.get("/api/dashboard", dependencies=authed)
def get_dashboard(today: date | None = None, db: Session = Depends(get_db)) -> dict:
    """`today` is the browser's local date, so weeks and months match the athlete's calendar."""
    columns = (
        Activity.id,
        Activity.name,
        Activity.sport_type,
        Activity.start_time_local,
        Activity.distance,
        Activity.duration,
        Activity.moving_duration,
        Activity.elevation_gain,
        Activity.average_speed,
    )
    rows = [
        dashboard.Row(
            id=r.id,
            name=r.name,
            sport_type=r.sport_type,
            start=r.start_time_local,
            distance=r.distance or 0,
            time=r.moving_duration or r.duration or 0,
            elevation=r.elevation_gain or 0,
            speed=r.average_speed,
        )
        for r in db.execute(select(*columns))
    ]
    latest = db.scalars(select(Activity).order_by(Activity.start_time_utc.desc()).limit(1)).first()
    return {
        **dashboard.build(rows, today or datetime.now(UTC).date()),
        "last_activity": _activity_json(latest) if latest else None,
    }


def _iso_date(value: datetime | None) -> str | None:
    return value.date().isoformat() if value else None


@app.get("/api/gear", dependencies=authed)
def list_gear(db: Session = Depends(get_db)) -> list[dict]:
    """Equipment: active items first, then retired, newest first within each."""
    last_used = dict(
        db.execute(
            select(ActivityGear.gear_uuid, func.max(Activity.start_time_local))
            .join(Activity, Activity.id == ActivityGear.activity_id)
            .group_by(ActivityGear.gear_uuid)
        ).all()
    )
    photo_dates = dict(db.execute(select(GearPhoto.gear_uuid, GearPhoto.updated_at)).all())  # not the images
    items = sorted(db.scalars(select(Gear)), key=lambda g: g.date_begin or datetime.min, reverse=True)
    items.sort(key=lambda g: g.status != "active")  # stable: keeps newest first within each group
    return [
        {
            "uuid": g.uuid,
            "name": g.name,
            "make_model": g.make_model,
            "gear_type": g.gear_type,
            "status": g.status,
            "date_begin": _iso_date(g.date_begin),
            "date_end": _iso_date(g.date_end),
            "maximum_distance": g.maximum_distance,
            "total_distance": g.total_distance,
            "total_activities": g.total_activities,
            "last_used": _iso_date(last_used.get(g.uuid)),
            # Changes when the photo does: part of the photo's address, so browsers cache it safely.
            "photo_version": _iso_utc(photo_dates.get(g.uuid)),
        }
        for g in items
    ]


def _get_gear(db: Session, uuid: str) -> Gear:
    gear = db.get(Gear, uuid)
    if gear is None:
        raise HTTPException(404, "Gear not found")
    return gear


class PhotoRequest(BaseModel):
    url: str


@app.put("/api/gear/{uuid}/photo", dependencies=authed)
def put_gear_photo(uuid: str, body: PhotoRequest, db: Session = Depends(get_db)) -> dict:
    """Downloads the image at `url` (or decodes a data: URL), shrinks it and keeps it."""
    _get_gear(db, uuid)
    try:
        photo = photos.save(db, uuid, body.url)
    except photos.PhotoError as err:
        raise HTTPException(422, str(err))
    return {"photo_version": _iso_utc(photo.updated_at)}


@app.get("/api/gear/{uuid}/photo", dependencies=authed)
def get_gear_photo(uuid: str, db: Session = Depends(get_db)) -> Response:
    photo = db.get(GearPhoto, uuid)
    if photo is None:
        raise HTTPException(404, "No photo")
    # The page asks with ?v=<photo_version>: a new photo gets a new address, so caching is safe.
    return Response(photo.image, media_type=photo.content_type,
                    headers={"Cache-Control": "private, max-age=31536000, immutable"})


@app.delete("/api/gear/{uuid}/photo", dependencies=authed, status_code=204)
def delete_gear_photo(uuid: str, db: Session = Depends(get_db)) -> None:
    photo = db.get(GearPhoto, uuid)
    if photo is not None:
        db.delete(photo)
        db.commit()


@app.get("/api/garmin/status", dependencies=authed)
def garmin_status(db: Session = Depends(get_db)) -> dict:
    auth = db.get(GarminAuth, 1)
    return {
        "connected": auth is not None,
        "tokens_updated_at": _iso_utc(auth.tokens_updated_at) if auth else None,
        "last_sync_at": _iso_utc(auth.last_sync_at) if auth else None,
    }


class TokensRequest(BaseModel):
    tokens: str


@app.put("/api/garmin/tokens", dependencies=authed)
def put_garmin_tokens(body: TokensRequest, db: Session = Depends(get_db)) -> dict:
    """Used by scripts/garmin_login.py: your Garmin password never reaches the server."""
    try:
        garmin.save_tokens(db, body.tokens)
    except ValueError as err:
        raise HTTPException(422, str(err))
    return {"connected": True}


def _backfill_details() -> None:
    """After the response: map routes for data stored before routes existed, fitness trends,
    then details for activities that don't have them yet."""
    try:
        with SessionLocal() as db:
            routes.backfill(db)
    except Exception:
        logging.getLogger(__name__).exception("Route backfill failed; the next sync retries")
    try:
        with SessionLocal() as db:
            fitness.sync(db)
    except GarminConnectTooManyRequestsError:
        logging.getLogger(__name__).info("Fitness sync paused: Garmin rate limit")
        return  # the details backfill would hit the same limit
    except Exception:
        logging.getLogger(__name__).exception("Fitness sync failed; the next sync retries")
    try:
        with SessionLocal() as db:
            garmin.backfill_details(db)
    except Exception:
        logging.getLogger(__name__).exception("Details backfill failed; the next sync retries")


@app.post("/api/sync", dependencies=authed)
def sync(background: BackgroundTasks, db: Session = Depends(get_db)) -> dict:
    try:
        with _garmin_errors():
            result = garmin.sync(db)
    except garmin.SyncInProgress:
        raise HTTPException(409, "sync_in_progress")
    background.add_task(_backfill_details)
    auth = db.get(GarminAuth, 1)
    return {
        "imported": result.imported,
        "gear_changed": result.gear_changed,
        "last_sync_at": _iso_utc(auth.last_sync_at) if auth else None,
    }
