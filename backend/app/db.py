import logging
import threading
import time
from collections.abc import Iterator

from sqlalchemy import create_engine, event, inspect, text
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
            add_missing_columns(engine)
            _schema_ready = True


def add_missing_columns(target) -> list[str]:
    """create_all makes new tables but never changes existing ones. A column added to a model
    later is added here, so the schema can grow without a migration tool. Only optional
    (nullable) columns: anything else needs a real migration. Returns what was added."""
    from . import models  # noqa: F401  (registers the tables)

    inspector = inspect(target)
    quote = target.dialect.identifier_preparer.quote
    # SQLite says ADD COLUMN; SQL Server just ADD.
    add = "ADD COLUMN" if target.dialect.name == "sqlite" else "ADD"
    added = []
    with target.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                if column.primary_key or not column.nullable:
                    log.error("Column %s.%s is missing and can't be added automatically", table.name, column.name)
                    continue
                kind = column.type.compile(dialect=target.dialect)
                conn.execute(text(f"ALTER TABLE {quote(table.name)} {add} {quote(column.name)} {kind} NULL"))
                added.append(f"{table.name}.{column.name}")
                log.info("Added column %s.%s", table.name, column.name)
    return added


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
