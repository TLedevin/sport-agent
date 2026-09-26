from datetime import datetime

from sqlalchemy import JSON, BigInteger, DateTime, Float, Integer, String, Text, Unicode
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


class GarminAuth(Base):
    """Single row (id=1) holding the Garmin session tokens."""

    __tablename__ = "garmin_auth"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    tokens: Mapped[str] = mapped_column(Text)
    tokens_updated_at: Mapped[datetime] = mapped_column(DateTime)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime)
