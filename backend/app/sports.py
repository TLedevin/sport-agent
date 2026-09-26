"""Groups Garmin's many sport types into a few families (each gets a color and icon in the UI)."""

FAMILIES = ("running", "cycling", "swimming", "walking", "fitness", "other")

# Checked in order: the first family with a matching keyword wins.
_KEYWORDS = (
    ("swimming", ("swim",)),
    ("running", ("run",)),
    ("cycling", ("cycl", "bik", "ride", "bmx")),
    ("walking", ("walk", "hik")),
    ("fitness", ("strength", "cardio", "hiit", "yoga", "pilates", "fitness", "elliptical", "stair", "training")),
)


def sport_family(sport_type: str) -> str:
    key = sport_type.lower()
    for family, keywords in _KEYWORDS:
        if any(word in key for word in keywords):
            return family
    return "other"
