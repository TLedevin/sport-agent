from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Local development uses SQLite; Azure injects the SQL Server URL.
    database_url: str = "sqlite:///./local.db"

    # The password you type in the web app.
    app_password: str
    # Signs session tokens. Any long random string.
    session_secret: str
    session_max_age_days: int = 30

    # Allowed browser origin (CORS).
    frontend_url: str = "http://localhost:5173"

    # Local scripts only (never set in Azure): Garmin credentials from backend/.env.
    garmin_email: str | None = None
    garmin_password: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
