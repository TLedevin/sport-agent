import logging
import time
from datetime import UTC, datetime, timedelta

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from garminconnect import GarminConnectAuthenticationError, GarminConnectTooManyRequestsError
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import garmin
from .auth import check_password, create_session, require_session
from .config import get_settings
from .db import get_db, wake_database
from .models import Activity, GarminAuth

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Sport Agent API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().frontend_url],
    allow_methods=["*"],
    allow_headers=["*"],
)

authed = [Depends(require_session)]


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


@app.get("/api/activities", dependencies=authed)
def list_activities(limit: int = 50, offset: int = 0, db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(
        select(Activity)
        .order_by(Activity.start_time_utc.desc())
        .offset(offset)
        .limit(min(limit, 200))
    )
    return [
        {
            "id": a.id,
            "name": a.name,
            "sport_type": a.sport_type,
            "start_time_utc": _iso_utc(a.start_time_utc),
            "start_time_local": a.start_time_local.isoformat(),
            "distance": a.distance,
            "duration": a.duration,
            "moving_duration": a.moving_duration,
            "elevation_gain": a.elevation_gain,
            "average_speed": a.average_speed,
            "average_hr": a.average_hr,
            "max_hr": a.max_hr,
            "calories": a.calories,
        }
        for a in rows
    ]


@app.get("/api/stats", dependencies=authed)
def stats(db: Session = Depends(get_db)) -> dict:
    now = datetime.now(UTC).replace(tzinfo=None)
    periods = {
        "week": now - timedelta(days=7),
        "month": now.replace(day=1, hour=0, minute=0, second=0, microsecond=0),
        "year": now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0),
    }
    result = {}
    for key, since in periods.items():
        count, distance, duration, elevation = db.execute(
            select(
                func.count(Activity.id),
                func.coalesce(func.sum(Activity.distance), 0),
                func.coalesce(func.sum(Activity.duration), 0),
                func.coalesce(func.sum(Activity.elevation_gain), 0),
            ).where(Activity.start_time_utc >= since)
        ).one()
        result[key] = {
            "count": count,
            "distance": float(distance),
            "duration": float(duration),
            "elevation_gain": float(elevation),
        }
    return result


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


@app.post("/api/sync", dependencies=authed)
def sync(db: Session = Depends(get_db)) -> dict:
    try:
        imported = garmin.sync(db)
    except garmin.GarminNotConnected:
        raise HTTPException(409, "garmin_not_connected")
    except garmin.SyncInProgress:
        raise HTTPException(409, "sync_in_progress")
    except GarminConnectAuthenticationError:
        raise HTTPException(409, "garmin_reconnect_needed")
    except GarminConnectTooManyRequestsError:
        raise HTTPException(429, "garmin_rate_limited")
    auth = db.get(GarminAuth, 1)
    return {"imported": imported, "last_sync_at": _iso_utc(auth.last_sync_at) if auth else None}
