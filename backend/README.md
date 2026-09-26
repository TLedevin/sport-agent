# Backend (FastAPI)

Python 3.12, managed with [uv](https://docs.astral.sh/uv/). uv downloads Python 3.12 for this folder automatically.

## Run locally

```powershell
cd backend
copy .env.example .env
uv sync
uv run uvicorn app.main:app --reload     # http://localhost:8000/docs
uv run pytest                            # tests
```

Locally the data goes into a SQLite file (`local.db`). In Azure it goes into Azure SQL.

## Connect Garmin (once, and again whenever the app asks)

```powershell
uv run python scripts/garmin_login.py --api https://<api-url>    # or omit --api for local
```

You type your Garmin email, password and MFA code **on your PC**. Only the resulting session tokens are sent to the API and stored in the database. They refresh automatically on each sync.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | – | Liveness check (no database access) |
| POST | `/api/wake` | – | Starts waking the database, then returns immediately |
| POST | `/api/auth/login` | – | `{password}` → `{token}` |
| GET | `/api/activities?limit&offset` | ✓ | Newest first |
| GET | `/api/stats` | ✓ | Totals for last 7 days, this month, this year |
| POST | `/api/sync` | ✓ | Import new Garmin activities (the Refresh button) |
| GET | `/api/garmin/status` | ✓ | Connected? last sync? |
| PUT | `/api/garmin/tokens` | ✓ | Used by `garmin_login.py` |

`/api/sync` errors (HTTP 409): `garmin_not_connected`, `garmin_reconnect_needed` (run the login script again), `sync_in_progress`. HTTP 429 `garmin_rate_limited` means Garmin is throttling; wait a few minutes.

## Sleeping database

Azure SQL pauses after 60 min idle. The first connection then fails with error 40613 while it resumes. `app/db.py` retries connections for up to 2 minutes, so requests wait instead of failing.
