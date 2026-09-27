# Backend (FastAPI)

Python 3.12, managed with [uv](https://docs.astral.sh/uv/). uv downloads Python 3.12 for this folder automatically.

## Run locally

The easiest way is VS Code's **Run and Debug** panel (Ctrl+Shift+D), using `.vscode/launch.json`:

- **Full stack (backend + frontend)**: API on :8000, Vite on :5173, and Chrome opens with the debugger attached. Local password: `dev-password` (from `backend/.env`).
- **Seed sample activities**: fake activities, to test without Garmin.
- **Connect Garmin (local backend)**: your real Garmin data, locally.
- Reset the local database with **Terminal → Run Task → backend: reset local database**.

Or from a terminal:

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

## Check the fitness data Garmin returns

```powershell
uv run python scripts/check_garmin.py --fitness
```

Prints, for the last 90 days, the start of each raw Garmin answer (VO2 max, race predictions, endurance and hill scores) and the values the app reads from it. Raw data but "0 values read" means Garmin's format differs from what `app/fitness.py` expects.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | – | Liveness check (no database access) |
| POST | `/api/wake` | – | Starts waking the database, then returns immediately |
| POST | `/api/auth/login` | – | `{password}` → `{token}` |
| GET | `/api/activities?limit&offset` | ✓ | Newest first |
| GET | `/api/dashboard?today=YYYY-MM-DD` | ✓ | Period totals vs previous period, 12 weekly buckets by sport, yearly breakdown, records |
| GET | `/api/map` | ✓ | Every activity with a position: simplified route (encoded polyline) or start point |
| GET | `/api/fitness` | ✓ | VO2 max, fitness age, race predictions, endurance and hill scores over time |
| POST | `/api/sync` | ✓ | Import new Garmin activities (the Refresh button) |
| GET | `/api/garmin/status` | ✓ | Connected? last sync? |
| PUT | `/api/garmin/tokens` | ✓ | Used by `garmin_login.py` |

`/api/sync` errors (HTTP 409): `garmin_not_connected`, `garmin_reconnect_needed` (run the login script again), `sync_in_progress`. HTTP 429 `garmin_rate_limited` means Garmin is throttling; wait a few minutes.

## Sleeping database

Azure SQL pauses after 60 min idle. The first connection then fails with error 40613 while it resumes. `app/db.py` retries connections for up to 2 minutes, so requests wait instead of failing.
