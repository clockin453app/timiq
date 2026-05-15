from pydantic import AliasChoices, Field, model_validator
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
    session_cookie_samesite: str = Field(
        default="lax",
        validation_alias=AliasChoices("SESSION_COOKIE_SAMESITE", "session_cookie_samesite"),
    )

    google_drive_client_id: str = ""
    google_drive_client_secret: str = ""
    google_drive_redirect_uri: str = (
        "http://localhost:8000/api/integrations/google-drive/callback"
    )

    # Private blob storage: DB stores relative keys only; never expose keys or signed URLs in public JSON.
    timiq_storage_backend: str = Field(
        default="local",
        validation_alias=AliasChoices("TIMIQ_STORAGE_BACKEND", "timiq_storage_backend"),
    )
    timiq_storage_root: str = Field(
        default="",
        validation_alias=AliasChoices("TIMIQ_STORAGE_ROOT", "timiq_storage_root"),
    )
    timiq_s3_bucket: str = Field(
        default="",
        validation_alias=AliasChoices("TIMIQ_S3_BUCKET", "timiq_s3_bucket"),
    )
    timiq_s3_region: str = Field(
        default="",
        validation_alias=AliasChoices("TIMIQ_S3_REGION", "timiq_s3_region"),
    )
    timiq_s3_endpoint_url: str = Field(
        default="",
        validation_alias=AliasChoices("TIMIQ_S3_ENDPOINT_URL", "timiq_s3_endpoint_url"),
    )
    timiq_s3_access_key_id: str = Field(
        default="",
        validation_alias=AliasChoices("TIMIQ_S3_ACCESS_KEY_ID", "timiq_s3_access_key_id"),
    )
    timiq_s3_secret_access_key: str = Field(
        default="",
        validation_alias=AliasChoices("TIMIQ_S3_SECRET_ACCESS_KEY", "timiq_s3_secret_access_key"),
    )
    timiq_s3_prefix: str = Field(
        default="",
        validation_alias=AliasChoices("TIMIQ_S3_PREFIX", "timiq_s3_prefix"),
    )
    timiq_s3_force_path_style: bool = Field(
        default=False,
        validation_alias=AliasChoices("TIMIQ_S3_FORCE_PATH_STYLE", "timiq_s3_force_path_style"),
    )

    # Transactional email (password reset, invites, verification). Optional; see docs/env-production-checklist.md.
    timiq_email_enabled: bool = Field(
        default=False,
        validation_alias=AliasChoices("TIMIQ_EMAIL_ENABLED", "timiq_email_enabled"),
    )
    timiq_email_from: str = Field(
        default="",
        validation_alias=AliasChoices("TIMIQ_EMAIL_FROM", "timiq_email_from"),
    )
    timiq_smtp_host: str = Field(
        default="",
        validation_alias=AliasChoices("TIMIQ_SMTP_HOST", "timiq_smtp_host"),
    )
    timiq_smtp_port: int = Field(
        default=587,
        validation_alias=AliasChoices("TIMIQ_SMTP_PORT", "timiq_smtp_port"),
    )
    timiq_smtp_username: str = Field(
        default="",
        validation_alias=AliasChoices("TIMIQ_SMTP_USERNAME", "timiq_smtp_username"),
    )
    timiq_smtp_password: str = Field(
        default="",
        validation_alias=AliasChoices("TIMIQ_SMTP_PASSWORD", "timiq_smtp_password"),
    )
    timiq_smtp_use_tls: bool = Field(
        default=True,
        validation_alias=AliasChoices("TIMIQ_SMTP_USE_TLS", "timiq_smtp_use_tls"),
    )
    timiq_web_app_url: str = Field(
        default="http://localhost:3000",
        validation_alias=AliasChoices("TIMIQ_WEB_APP_URL", "timiq_web_app_url"),
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @model_validator(mode="after")
    def _validate_storage_settings(self) -> Settings:
        backend = self.timiq_storage_backend.strip().lower()
        if backend not in ("local", "s3"):
            raise ValueError("TIMIQ_STORAGE_BACKEND must be 'local' or 's3'.")
        if backend == "s3":
            if not self.timiq_s3_bucket.strip():
                raise ValueError("TIMIQ_S3_BUCKET is required when TIMIQ_STORAGE_BACKEND=s3.")
            if not self.timiq_s3_access_key_id.strip() or not self.timiq_s3_secret_access_key.strip():
                raise ValueError(
                    "TIMIQ_S3_ACCESS_KEY_ID and TIMIQ_S3_SECRET_ACCESS_KEY are required when TIMIQ_STORAGE_BACKEND=s3.",
                )
        return self


settings = Settings()


def require_database_url() -> str:
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is missing from apps/api/.env")

    return settings.database_url