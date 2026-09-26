import logging
import threading
import time
from collections.abc import Iterator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

log = logging.getLogger(__name__)

# How long to keep retrying while a paused Azure SQL database resumes.
WAKE_TIMEOUT_SECONDS = 120
# Azure SQL error codes meaning "temporarily unavailable, try again".
# 40613 is the one returned while a paused serverless database is resuming.
_TRANSIENT_ERRORS = ("40613", "40197", "40501", "49918", "49919", "49920", "HYT00", "08S01")


class Base(DeclarativeBase):
    pass


def _make_engine():
    url = get_settings().database_url
    if url.startswith("sqlite"):
        return create_engine(url, connect_args={"check_same_thread": False})

    engine = create_engine(url, pool_pre_ping=True, pool_recycle=1800)

    @event.listens_for(engine, "do_connect")
    def _connect_with_retry(dialect, conn_rec, cargs, cparams):
        deadline = time.monotonic() + WAKE_TIMEOUT_SECONDS
        while True:
            try:
                return dialect.loaded_dbapi.connect(*cargs, **cparams)
            except dialect.loaded_dbapi.Error as err:
                transient = any(code in str(err) for code in _TRANSIENT_ERRORS)
                if not transient or time.monotonic() > deadline:
                    raise
                log.info("Database is waking up, retrying in 5s")
                time.sleep(5)

    return engine


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

_schema_ready = False
_schema_lock = threading.Lock()


def _ensure_schema() -> None:
    """Create tables on first use rather than at startup, so a sleeping database
    doesn't delay the container from starting."""
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if not _schema_ready:
            from . import models  # noqa: F401  (registers the tables)

            Base.metadata.create_all(engine)
            _schema_ready = True


def get_db() -> Iterator[Session]:
    _ensure_schema()
    with SessionLocal() as db:
        yield db


def wake_database() -> None:
    """Open a connection so a paused database starts resuming."""
    try:
        _ensure_schema()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        log.info("Database is awake")
    except Exception:
        log.exception("Database wake-up failed")
