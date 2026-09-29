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
from .models import Activity, ActivityGear, ActivityPhoto, ActivityRoute, RaceResult, FitnessSource, FitnessValue, GarminAuth, Gear, GearPhoto
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


def _photo_json(p) -> dict:
    """A photo's size and signed addresses (see photos.py). `p` needs id, width and height."""
    return {
        "id": p.id,
        "width": p.width,
        "height": p.height,
        "url": photos.signed_url(p.id, "full"),
        "thumb_url": photos.signed_url(p.id, "thumb"),
    }


# The photo columns worth reading for lists: never the images themselves.
PHOTO_META = (ActivityPhoto.id, ActivityPhoto.activity_id, ActivityPhoto.width, ActivityPhoto.height)


def _photos_by_activity(db: Session, activity_ids: list[int]) -> dict[int, list[dict]]:
    if not activity_ids:
        return {}
    found: dict[int, list[dict]] = {}
    for p in db.execute(
        select(*PHOTO_META)
        .where(ActivityPhoto.activity_id.in_(activity_ids))
        .order_by(ActivityPhoto.created_at, ActivityPhoto.id)
    ):
        found.setdefault(p.activity_id, []).append(_photo_json(p))
    return found


RACE_FIELDS = (
    "official_time", "overall_rank", "overall_total", "gender", "gender_rank", "gender_total",
    "category", "category_rank", "category_total",
)


def _race_json(r: RaceResult | None) -> dict | None:
    return {f: getattr(r, f) for f in RACE_FIELDS} if r else None


def _race_results(db: Session, activity_ids: list[int]) -> dict[int, dict]:
    if not activity_ids:
        return {}
    return {r.activity_id: _race_json(r) for r in db.scalars(select(RaceResult).where(RaceResult.activity_id.in_(activity_ids)))}


def _activity_json(a: Activity, photos: list[dict] | None = None, race: dict | None = None) -> dict:
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
        "photos": photos or [],
        # Tagged as a race in Garmin Connect (its "Race" event type).
        "is_race": ((a.raw.get("eventType") or {}).get("typeKey") == "race"),
        "race_result": race,
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
    photos_of = _photos_by_activity(db, [a.id for a in rows])
    races = _race_results(db, [a.id for a in rows])
    return {
        "items": [_activity_json(a, photos_of.get(a.id), races.get(a.id)) for a in rows],
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
        **_activity_json(activity, _photos_by_activity(db, [activity.id]).get(activity.id),
                         _race_json(db.get(RaceResult, activity.id))),
        "race_defaults": _race_defaults(db),
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


RECENT_PHOTOS = 8


def _recent_photos(db: Session) -> list[dict]:
    """The photos of the latest activities that have some, for the dashboard."""
    rows = db.execute(
        select(*PHOTO_META, Activity.name, Activity.sport_type)
        .join(Activity, Activity.id == ActivityPhoto.activity_id)
        .order_by(Activity.start_time_utc.desc(), ActivityPhoto.created_at, ActivityPhoto.id)
        .limit(RECENT_PHOTOS)
    ).all()
    return [
        {**_photo_json(r), "activity_id": r.activity_id, "activity_name": r.name,
         "sport_family": sport_family(r.sport_type)}
        for r in rows
    ]


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
        "last_activity": _activity_json(latest, _photos_by_activity(db, [latest.id]).get(latest.id)) if latest else None,
        "recent_photos": _recent_photos(db),
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


# --- Race results --------------------------------------------------------------------------


def _race_defaults(db: Session) -> dict:
    """Sex and category of the latest result entered, to prefill the next one."""
    latest = db.scalars(select(RaceResult).order_by(RaceResult.updated_at.desc()).limit(1)).first()
    return {"gender": latest.gender, "category": latest.category} if latest else {"gender": None, "category": None}


class RaceResultRequest(BaseModel):
    official_time: float | None = None  # seconds
    overall_rank: int | None = None
    overall_total: int | None = None
    gender: Literal["men", "women"] | None = None
    gender_rank: int | None = None
    gender_total: int | None = None
    category: str | None = None
    category_rank: int | None = None
    category_total: int | None = None


def _check_race(body: RaceResultRequest) -> str | None:
    """The first problem with a result, in words the form can show; None when it's fine."""
    if body.category is not None and len(body.category.strip()) > 32:
        return "The category is too long (32 characters at most)."
    values = body.model_dump()
    if all(v is None or v == "" for v in values.values()):
        return "Enter at least your time or a ranking."
    if body.official_time is not None and not 0 < body.official_time < 14 * 86400:
        return "The time doesn't look right."
    for name, label in (("overall", "overall"), ("gender", "sex"), ("category", "category")):
        rank, total = values[f"{name}_rank"], values[f"{name}_total"]
        if any(v is not None and v < 1 for v in (rank, total)):
            return f"The {label} ranking must be 1 or more."
        if rank is not None and total is not None and rank > total:
            return f"Your {label} rank can't be higher than the number of finishers."
    if (body.gender_rank or body.gender_total) and not body.gender:
        return "Choose men or women for the ranking by sex."
    if (body.category_rank or body.category_total) and not (body.category or "").strip():
        return "Choose your category for the ranking by category."
    return None


@app.put("/api/activities/{activity_id}/race-result", dependencies=authed)
def put_race_result(activity_id: int, body: RaceResultRequest, db: Session = Depends(get_db)) -> dict:
    _get_activity(db, activity_id)
    if problem := _check_race(body):
        raise HTTPException(422, problem)
    result = db.get(RaceResult, activity_id) or RaceResult(activity_id=activity_id)
    for field, value in body.model_dump().items():
        setattr(result, field, value)
    result.category = (body.category or "").strip() or None
    result.updated_at = datetime.now(UTC).replace(tzinfo=None)
    db.add(result)
    db.commit()
    return _race_json(result)


@app.delete("/api/activities/{activity_id}/race-result", dependencies=authed, status_code=204)
def delete_race_result(activity_id: int, db: Session = Depends(get_db)) -> None:
    result = db.get(RaceResult, activity_id)
    if result is not None:
        db.delete(result)
        db.commit()


# --- Activity photos -------------------------------------------------------------------------


class ActivityPhotoRequest(BaseModel):
    url: str  # an image address, or a data: URL (a pasted image, or one picked on the device)


@app.post("/api/activities/{activity_id}/photos", dependencies=authed, status_code=201)
def add_activity_photo(activity_id: int, body: ActivityPhotoRequest, db: Session = Depends(get_db)) -> dict:
    _get_activity(db, activity_id)
    try:
        photo = photos.add_activity_photo(db, activity_id, body.url)
    except photos.PhotoError as err:
        raise HTTPException(422, str(err))
    return _photo_json(photo)


@app.delete("/api/activity-photos/{photo_id}", dependencies=authed, status_code=204)
def delete_activity_photo(photo_id: int, db: Session = Depends(get_db)) -> None:
    photo = db.get(ActivityPhoto, photo_id)
    if photo is not None:
        db.delete(photo)
        db.commit()


@app.get("/api/photos", dependencies=authed)
def list_photos(db: Session = Depends(get_db)) -> list[dict]:
    """Every activity that has photos, newest first, with its photos in the order they were added."""
    with_photos = select(ActivityPhoto.activity_id)
    activities = db.scalars(
        select(Activity).where(Activity.id.in_(with_photos)).order_by(Activity.start_time_utc.desc())
    ).all()
    photos_of: dict[int, list[dict]] = {}
    for p in db.execute(select(*PHOTO_META).order_by(ActivityPhoto.created_at, ActivityPhoto.id)):
        photos_of.setdefault(p.activity_id, []).append(_photo_json(p))
    return [{"activity": _activity_json(a, photos_of.get(a.id)), "photos": photos_of.get(a.id, [])} for a in activities]


@app.get("/api/photos/{photo_id}/{size}")
def get_photo(photo_id: int, size: str, sig: str = "", db: Session = Depends(get_db)) -> Response:
    """The image itself. No session header (it's an <img>): the signature in the address is the key."""
    if not photos.valid_signature(photo_id, size, sig):
        raise HTTPException(404, "No photo")
    column = ActivityPhoto.thumb if size == "thumb" else ActivityPhoto.image
    row = db.execute(select(column, ActivityPhoto.content_type).where(ActivityPhoto.id == photo_id)).first()
    if row is None:
        raise HTTPException(404, "No photo")
    # A photo never changes (a new one gets a new id), so browsers keep it for good.
    return Response(row[0], media_type=row[1], headers={"Cache-Control": "private, max-age=31536000, immutable"})


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
