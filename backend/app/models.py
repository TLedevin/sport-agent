from datetime import date, datetime

from sqlalchemy import JSON, BigInteger, Date, DateTime, Float, Integer, String, Text, Unicode
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class Activity(Base):
    __tablename__ = "activities"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)  # Garmin activityId
    name: Mapped[str] = mapped_column(Unicode(255))
    sport_type: Mapped[str] = mapped_column(String(64))  # e.g. running, cycling
    start_time_utc: Mapped[datetime] = mapped_column(DateTime, index=True)  # naive, UTC
    start_time_local: Mapped[datetime] = mapped_column(DateTime)  # naive, athlete's local time
    distance: Mapped[float] = mapped_column(Float, default=0)  # meters
    duration: Mapped[float] = mapped_column(Float, default=0)  # seconds
    moving_duration: Mapped[float | None] = mapped_column(Float)  # seconds
    elevation_gain: Mapped[float | None] = mapped_column(Float)  # meters
    average_speed: Mapped[float | None] = mapped_column(Float)  # m/s
    max_speed: Mapped[float | None] = mapped_column(Float)  # m/s
    average_hr: Mapped[float | None] = mapped_column(Float)
    max_hr: Mapped[float | None] = mapped_column(Float)
    calories: Mapped[float | None] = mapped_column(Float)
    raw: Mapped[dict] = mapped_column(JSON)  # full Garmin payload, for future features


class ActivityTrack(Base):
    """GPS track, fetched from Garmin the first time an activity's map is shown.

    A separate table rather than a column: create_all adds new tables but never
    alters existing ones, so this needs no migration on Azure SQL.
    """

    __tablename__ = "activity_tracks"

    activity_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    points: Mapped[list] = mapped_column(JSON)  # [[lat, lon], ...], empty when there's no GPS
    fetched_at: Mapped[datetime] = mapped_column(DateTime)


class ActivityDetail(Base):
    """Everything Garmin has beyond the summary: time series, laps, weather, zones...
    Fetched once (on first view, or by the post-sync backfill), then served from here."""

    __tablename__ = "activity_details"

    activity_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    data: Mapped[dict] = mapped_column(JSON)
    fetched_at: Mapped[datetime] = mapped_column(DateTime)


class ActivityRoute(Base):
    """Simplified route for the map of all activities, as an encoded polyline (see routes.py).
    Empty when the activity has no GPS."""

    __tablename__ = "activity_routes"

    activity_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    polyline: Mapped[str] = mapped_column(Text)
    computed_at: Mapped[datetime] = mapped_column(DateTime)


class Gear(Base):
    """Equipment from Garmin Connect (shoes, bikes...), with Garmin's own usage totals."""

    __tablename__ = "gear"

    uuid: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(Unicode(255))  # your name for it, else the model
    make_model: Mapped[str | None] = mapped_column(Unicode(255))
    gear_type: Mapped[str] = mapped_column(String(32))  # e.g. Shoes, Bike
    status: Mapped[str] = mapped_column(String(16))  # active or retired
    date_begin: Mapped[datetime | None] = mapped_column(DateTime)
    date_end: Mapped[datetime | None] = mapped_column(DateTime)  # when retired
    maximum_distance: Mapped[float | None] = mapped_column(Float)  # meters, the replacement target
    total_distance: Mapped[float] = mapped_column(Float, default=0)  # meters
    total_activities: Mapped[int] = mapped_column(Integer, default=0)
    raw: Mapped[dict] = mapped_column(JSON)  # Garmin's gear payload


class ActivityGear(Base):
    """Which gear each activity used (an activity can use several, e.g. bike + shoes)."""

    __tablename__ = "activity_gear"

    activity_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    gear_uuid: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)


class FitnessValue(Base):
    """One fitness metric on one day: VO2 max, fitness age, race predictions (seconds),
    endurance and hill scores. See fitness.py."""

    __tablename__ = "fitness_values"

    calendar_date: Mapped[date] = mapped_column(Date, primary_key=True)
    metric: Mapped[str] = mapped_column(String(32), primary_key=True)  # e.g. vo2max_running
    value: Mapped[float] = mapped_column(Float)


class FitnessSource(Base):
    """How far each Garmin fitness endpoint has been read, so a sync only asks for recent days."""

    __tablename__ = "fitness_sources"

    source: Mapped[str] = mapped_column(String(32), primary_key=True)
    fetched_through: Mapped[date] = mapped_column(Date)
    fetched_at: Mapped[datetime] = mapped_column(DateTime)


class GarminAuth(Base):
    """Single row (id=1) holding the Garmin session tokens."""

    __tablename__ = "garmin_auth"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    tokens: Mapped[str] = mapped_column(Text)
    tokens_updated_at: Mapped[datetime] = mapped_column(DateTime)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime)
