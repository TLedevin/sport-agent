"""Test the Garmin connector with your real account, without the web app.

    uv run python scripts/check_garmin.py              # show your 10 latest activities
    uv run python scripts/check_garmin.py --limit 30
    uv run python scripts/check_garmin.py --save-local # also connect the LOCAL backend to Garmin
    uv run python scripts/check_garmin.py --fitness    # also show the fitness trends Garmin returns

Reads GARMIN_EMAIL / GARMIN_PASSWORD from backend/.env (asks if missing). Garmin
tokens are cached in backend/.garmin_tokens.json, so later runs don't log in again:
repeated logins get blocked by Garmin (HTTP 429).

Each activity goes through the same conversion as the app (app.garmin.to_activity),
so a mapping problem shows up here as an error on that activity.
"""

import argparse
import json
import sys
from datetime import date, timedelta
from getpass import getpass
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from garminconnect import Garmin  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.garmin import to_activity  # noqa: E402

TOKEN_FILE = BACKEND / ".garmin_tokens.json"


def login() -> Garmin:
    settings = get_settings()
    if TOKEN_FILE.exists():
        print(f"Using cached Garmin tokens ({TOKEN_FILE.name}).")
        email, password = settings.garmin_email, settings.garmin_password
    else:
        email = settings.garmin_email or input("Garmin email: ")
        password = settings.garmin_password or getpass("Garmin password: ")
        print("Logging into Garmin...")
    garmin = Garmin(email, password, prompt_mfa=lambda: input("Garmin MFA code: "))
    # With a path, login() loads the cached tokens if valid, otherwise logs in with
    # the credentials and writes fresh tokens to that file.
    garmin.login(str(TOKEN_FILE))
    return garmin


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", type=int, default=10, help="how many recent activities to fetch")
    parser.add_argument("--save-local", action="store_true", help="store the tokens in the local database")
    parser.add_argument("--fitness", action="store_true", help="show the fitness data of the last 90 days")
    args = parser.parse_args()

    garmin = login()
    print(f"Connected as {garmin.get_full_name()}\n")

    raw = garmin.get_activities(0, args.limit)
    print(f"{'Date (local)':<17} {'Sport':<20} {'Distance':>9} {'Duration':>9} {'Avg HR':>6}  Name")
    errors = 0
    for data in raw:
        try:
            a = to_activity(data)
        except Exception as err:  # a field the app expects is missing or malformed
            errors += 1
            print(f"!! activity {data.get('activityId')}: {type(err).__name__}: {err}")
            continue
        hr = f"{a.average_hr:.0f}" if a.average_hr else "-"
        print(
            f"{a.start_time_local:%Y-%m-%d %H:%M} {a.sport_type[:20]:<20} "
            f"{a.distance / 1000:>6.2f} km {a.duration / 60:>6.0f} min {hr:>6}  {a.name}"
        )
    print(f"\n{len(raw)} activities fetched, {len(raw) - errors} converted, {errors} errors.")

    if args.fitness:
        errors += check_fitness(garmin)

    if args.save_local:
        from app.db import SessionLocal, _ensure_schema
        from app.garmin import save_tokens

        if not get_settings().database_url.startswith("sqlite"):
            sys.exit("--save-local only writes to the local SQLite database.")
        _ensure_schema()
        with SessionLocal() as db:
            save_tokens(db, garmin.client.dumps())
        print("Tokens saved to the local database: Refresh in the local app now syncs from Garmin.")

    if errors:
        sys.exit(1)


def check_fitness(garmin: Garmin) -> int:
    """Each fitness source over the last 90 days: the start of Garmin's raw answer, then what the
    app reads from it. Raw data without values read means the parser doesn't match the payload."""
    from app.fitness import SOURCES

    last = date.today()
    first = last - timedelta(days=90)
    errors = 0
    for name, (fetch, parse) in SOURCES.items():
        print(f"\n--- {name} ({first} to {last})")
        try:
            payload = fetch(garmin, first.isoformat(), last.isoformat())
        except Exception as err:
            errors += 1
            print(f"!! {type(err).__name__}: {err}")
            continue
        text = json.dumps(payload, indent=1, default=str)
        print(text[:1500] + ("\n..." if len(text) > 1500 else ""))
        rows = parse(payload)
        print(f"=> {len(rows)} values read", end="")
        latest = {}
        for day, metric, value in rows:
            latest[metric] = (day, value)
        print("".join(f"\n   latest {m}: {v} on {d}" for m, (d, v) in sorted(latest.items())) or "")
    return errors


if __name__ == "__main__":
    main()
