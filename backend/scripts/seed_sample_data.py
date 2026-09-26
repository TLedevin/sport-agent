"""Fill the LOCAL database with ~5 months of fake training, to try the app without Garmin.

    uv run python scripts/seed_sample_data.py

Deterministic (same data every run) and safe to run several times. Refuses to run
against a non-SQLite database.
"""

import random
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402
from app.db import SessionLocal, _ensure_schema  # noqa: E402
from app.garmin import to_activity  # noqa: E402

DAYS = 150
FIRST_ID = 1_000_000  # far from real Garmin IDs

# sport, names, distance range (km), speed range (km/h), elevation per km (m), HR range
SESSIONS = {
    "running": (["Morning run", "Easy run", "Tempo run", "Evening run"], (6, 14), (10, 13), (4, 15), (138, 158)),
    "trail_running": (["Trail des crêtes", "Forest trail", "Hill repeats"], (10, 24), (8, 10), (35, 60), (145, 162)),
    "road_biking": (["Road ride", "Col ride", "Group ride"], (40, 110), (25, 31), (8, 22), (125, 145)),
    "lap_swimming": (["Pool session", "Technique swim"], (1.5, 3.2), (2.8, 3.4), (0, 0), (120, 140)),
    "hiking": (["Hike with friends", "Summit hike"], (8, 18), (4, 5), (50, 90), (105, 125)),
    "strength_training": (["Strength", "Core & mobility"], (0, 0), (0, 0), (0, 0), (100, 120)),
}
# Rough weekly rhythm: day of week -> sports that may happen that day.
WEEK_PLAN = {
    0: ["strength_training"],
    1: ["running"],
    2: ["lap_swimming", "running"],
    3: ["running", "strength_training"],
    5: ["road_biking", "hiking"],
    6: ["running", "trail_running"],
}


def generate(now: datetime) -> list[dict]:
    rng = random.Random(42)
    activities = []
    for day in range(DAYS, -1, -1):
        date = now - timedelta(days=day)
        for sport in WEEK_PLAN.get(date.weekday(), []):
            if rng.random() < 0.3:  # skipped session
                continue
            names, dist_range, speed_range, climb_per_km, hr_range = SESSIONS[sport]
            distance = rng.uniform(*dist_range) * 1000
            if distance:
                duration = distance / (rng.uniform(*speed_range) / 3.6)
            else:
                duration = rng.uniform(35, 70) * 60
            start = date.replace(hour=rng.choice([7, 12, 18]), minute=rng.randrange(60), second=0, microsecond=0)
            if start > now:
                continue
            activities.append(
                {
                    "activityId": FIRST_ID + len(activities),
                    "activityName": rng.choice(names),
                    "activityType": {"typeKey": sport},
                    "startTimeGMT": (start - timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S"),
                    "startTimeLocal": start.strftime("%Y-%m-%d %H:%M:%S"),
                    "distance": round(distance, 1),
                    "duration": round(duration),
                    "movingDuration": round(duration * 0.96),
                    "elevationGain": round(distance / 1000 * rng.uniform(*climb_per_km)) if distance else None,
                    "averageSpeed": distance / duration if distance else None,
                    "averageHR": rng.randint(*hr_range),
                    "maxHR": rng.randint(hr_range[1], hr_range[1] + 20),
                    "calories": round(duration / 60 * rng.uniform(8, 12)),
                }
            )
    return activities


def main() -> None:
    if not get_settings().database_url.startswith("sqlite"):
        sys.exit("Refusing to seed: DATABASE_URL is not a local SQLite database.")
    _ensure_schema()
    activities = generate(datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=2))
    with SessionLocal() as db:
        for data in activities:
            db.merge(to_activity(data))
        db.commit()
    print(f"Added {len(activities)} sample activities to the local database.")


if __name__ == "__main__":
    main()
