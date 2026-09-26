"""Fill the LOCAL database with a few fake activities, to try the app without Garmin.

    uv run python scripts/seed_sample_data.py

Safe to run several times. Refuses to run against a non-SQLite database.
"""

import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402
from app.db import SessionLocal, _ensure_schema  # noqa: E402
from app.garmin import to_activity  # noqa: E402

# name, sport, distance (m), duration (s), elevation (m), avg HR, days ago
SAMPLES = [
    ("Morning run", "running", 10230, 3050, 85, 148, 0.4),
    ("Col de la Croix-de-Fer", "road_biking", 62400, 9400, 1450, 139, 1.2),
    ("Pool session", "lap_swimming", 2000, 2700, 0, 128, 2.5),
    ("Trail des crêtes", "trail_running", 18700, 7300, 920, 156, 5),
    ("Strength", "strength_training", 0, 2700, None, 112, 6),
    ("Easy run", "running", 7400, 2520, 40, 141, 9),
    ("Commute", "cycling", 8300, 1500, 35, 118, 40),
    ("Long run", "running", 24100, 8350, 210, 152, 120),
]


def main() -> None:
    if not get_settings().database_url.startswith("sqlite"):
        sys.exit("Refusing to seed: DATABASE_URL is not a local SQLite database.")
    _ensure_schema()
    now = datetime.now(UTC).replace(tzinfo=None, microsecond=0)
    with SessionLocal() as db:
        for i, (name, sport, distance, duration, elevation, hr, days_ago) in enumerate(SAMPLES):
            start = now - timedelta(days=days_ago)
            db.merge(
                to_activity(
                    {
                        "activityId": 1_000_000 + i,  # far from real Garmin IDs
                        "activityName": name,
                        "activityType": {"typeKey": sport},
                        "startTimeGMT": start.strftime("%Y-%m-%d %H:%M:%S"),
                        "startTimeLocal": (start + timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S"),
                        "distance": distance,
                        "duration": duration,
                        "elevationGain": elevation,
                        "averageHR": hr,
                        "averageSpeed": distance / duration if distance else None,
                    }
                )
            )
        db.commit()
    print(f"Added {len(SAMPLES)} sample activities to the local database.")


if __name__ == "__main__":
    main()
