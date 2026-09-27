from datetime import date

from app.fitness import parse_endurance_score, parse_hill_score, parse_max_metrics, parse_race_predictions

D = date(2026, 3, 1)


def test_max_metrics_running_cycling_and_fitness_age():
    payload = [
        {"generic": {"calendarDate": "2026-03-01", "vo2MaxPreciseValue": 52.46, "vo2MaxValue": 52.0, "fitnessAge": 31},
         "cycling": {"calendarDate": "2026-03-01", "vo2MaxPreciseValue": None, "vo2MaxValue": 55.0}},
        {"generic": None, "cycling": None, "heatAltitudeAcclimation": {}},  # a day with nothing new
    ]
    assert parse_max_metrics(payload) == [
        (D, "vo2max_running", 52.5), (D, "fitness_age", 31.0), (D, "vo2max_cycling", 55.0),
    ]


def test_race_predictions_in_seconds():
    payload = [{"calendarDate": "2026-03-01", "time5K": 1260, "time10K": 2640, "timeHalfMarathon": 5880,
                "timeMarathon": None}]
    assert parse_race_predictions(payload) == [(D, "race_5k", 1260.0), (D, "race_10k", 2640.0), (D, "race_half", 5880.0)]
    assert parse_race_predictions({"calendarDate": "2026-03-01", "time5K": 1255}) == [(D, "race_5k", 1255.0)]  # latest


def test_endurance_score_weekly_groups_and_latest():
    payload = {"groupMap": {"2026-02-23": {"groupAverage": 6120.4, "groupMax": 6200}, "bad": {"groupAverage": 1}},
               "enduranceScoreDTO": {"calendarDate": "2026-03-01", "overallScore": 6190}}
    assert parse_endurance_score(payload) == [(date(2026, 2, 23), "endurance_score", 6120), (D, "endurance_score", 6190)]


def test_hill_score_daily_with_components():
    payload = {"hillScoreDTOList": [{"calendarDate": "2026-03-01", "overallScore": 48, "strengthScore": 50,
                                     "enduranceScore": 45}]}
    assert parse_hill_score(payload) == [(D, "hill_score", 48), (D, "hill_strength", 50), (D, "hill_endurance", 45)]


def test_unexpected_shapes_give_no_values():
    for parse in (parse_max_metrics, parse_race_predictions, parse_endurance_score, parse_hill_score):
        for payload in (None, {}, [], "oops", [1, 2], {"groupMap": [1], "hillScoreDTOList": {"a": 1}}, [{"calendarDate": "x"}]):
            assert parse(payload) == []
