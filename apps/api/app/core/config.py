from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = Field(
        default="local",
        validation_alias=AliasChoices("TIMIQ_ENV", "APP_ENV"),
    )
    app_name: str = Field(
        default="TimIQ API",
        validation_alias=AliasChoices("TIMIQ_APP_NAME", "APP_NAME"),
    )
    api_host: str = Field(
        default="127.0.0.1",
        validation_alias=AliasChoices("TIMIQ_API_HOST", "API_HOST"),
    )
    api_port: int = Field(
        default=8000,
        validation_alias=AliasChoices("TIMIQ_API_PORT", "API_PORT"),
    )
    database_url: str = Field(
        default="",
        validation_alias=AliasChoices("DATABASE_URL", "database_url"),
    )
    cors_allowed_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000",
        validation_alias=AliasChoices("CORS_ALLOWED_ORIGINS", "WEB_ORIGIN"),
    )
    session_secret: str = Field(
        default="change-this-with-a-secure-random-value",
        validation_alias=AliasChoices("SESSION_SECRET", "session_secret"),
    )

    google_drive_client_id: str = ""
    google_drive_client_secret: str = ""
    google_drive_redirect_uri: str = (
        "http://localhost:8000/api/integrations/google-drive/callback"
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()


def require_database_url() -> str:
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is missing from apps/api/.env")

    return settings.database_url