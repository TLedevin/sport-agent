from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app.db import Base, add_missing_columns


def test_columns_added_to_a_model_are_added_to_existing_tables():
    engine = create_engine("sqlite://", poolclass=StaticPool)
    # race_results as it was first created, before race_distance existed.
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE race_results (activity_id BIGINT PRIMARY KEY, official_time FLOAT, overall_rank INTEGER,"
            " overall_total INTEGER, gender VARCHAR(8), gender_rank INTEGER, gender_total INTEGER,"
            " category VARCHAR(32), category_rank INTEGER, category_total INTEGER, updated_at DATETIME)"
        ))
        conn.execute(text("INSERT INTO race_results (activity_id, official_time, updated_at) VALUES (1, 2580, '2026-05-10')"))
    Base.metadata.create_all(engine)  # creates the other tables, leaves this one alone

    assert add_missing_columns(engine) == ["race_results.race_distance"]
    assert "race_distance" in {c["name"] for c in inspect(engine).get_columns("race_results")}
    with engine.begin() as conn:  # existing rows are kept, with no value in the new column
        assert conn.execute(text("SELECT official_time, race_distance FROM race_results")).one() == (2580, None)
    assert add_missing_columns(engine) == []  # nothing left to do
