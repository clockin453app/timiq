import contextvars
from typing import Any

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict

_constructor_timiq_web_app_url: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "constructor_timiq_web_app_url",
    default=None,
)


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
        validation_alias=AliasChoices("CORS_ALLOWED_ORIGINS", "cors_allowed_origins"),
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
        validation_alias=AliasChoices(
            "TIMIQ_EMAIL_ENABLED",
            "SMTP_ENABLED",
            "timiq_email_enabled",
        ),
    )
    timiq_email_from: str = Field(
        default="",
        validation_alias=AliasChoices(
            "TIMIQ_EMAIL_FROM",
            "SMTP_FROM_EMAIL",
            "timiq_email_from",
        ),
    )
    timiq_email_from_name: str = Field(
        default="",
        validation_alias=AliasChoices(
            "TIMIQ_EMAIL_FROM_NAME",
            "SMTP_FROM_NAME",
            "timiq_email_from_name",
        ),
    )
    timiq_smtp_host: str = Field(
        default="",
        validation_alias=AliasChoices("TIMIQ_SMTP_HOST", "SMTP_HOST", "timiq_smtp_host"),
    )
    timiq_smtp_port: int = Field(
        default=587,
        validation_alias=AliasChoices("TIMIQ_SMTP_PORT", "SMTP_PORT", "timiq_smtp_port"),
    )
    timiq_smtp_username: str = Field(
        default="",
        validation_alias=AliasChoices(
            "TIMIQ_SMTP_USERNAME",
            "SMTP_USERNAME",
            "timiq_smtp_username",
        ),
    )
    timiq_smtp_password: str = Field(
        default="",
        validation_alias=AliasChoices(
            "TIMIQ_SMTP_PASSWORD",
            "SMTP_PASSWORD",
            "timiq_smtp_password",
        ),
    )
    timiq_smtp_use_tls: bool = Field(
        default=True,
        validation_alias=AliasChoices(
            "TIMIQ_SMTP_USE_TLS",
            "SMTP_USE_TLS",
            "timiq_smtp_use_tls",
        ),
    )
    face_check_match_threshold: float = Field(
        default=0.70,
        ge=0.50,
        le=0.95,
        validation_alias=AliasChoices(
            "FACE_CHECK_MATCH_THRESHOLD",
            "face_check_match_threshold",
        ),
    )

    timiq_web_app_url: str = Field(
        default="http://localhost:3000",
        # WEB_ORIGIN is mapped in __init__ only — do not add it here or process env
        # WEB_ORIGIN=localhost in CI would override explicit constructor values.
        validation_alias=AliasChoices(
            "TIMIQ_WEB_APP_URL",
            "timiq_web_app_url",
        ),
    )
    timiq_attendance_notification_job_enabled: bool = Field(
        default=False,
        validation_alias=AliasChoices(
            "TIMIQ_ATTENDANCE_NOTIFICATION_JOB_ENABLED",
            "timiq_attendance_notification_job_enabled",
        ),
    )
    timiq_web_push_enabled: bool = Field(
        default=False,
        validation_alias=AliasChoices("TIMIQ_WEB_PUSH_ENABLED", "timiq_web_push_enabled"),
    )
    timiq_web_push_vapid_public_key: str = Field(
        default="",
        validation_alias=AliasChoices("TIMIQ_WEB_PUSH_VAPID_PUBLIC_KEY", "timiq_web_push_vapid_public_key"),
    )
    timiq_web_push_vapid_private_key: str = Field(
        default="",
        validation_alias=AliasChoices("TIMIQ_WEB_PUSH_VAPID_PRIVATE_KEY", "timiq_web_push_vapid_private_key"),
    )
    timiq_web_push_subject: str = Field(
        default="mailto:admin@example.com",
        validation_alias=AliasChoices("TIMIQ_WEB_PUSH_SUBJECT", "timiq_web_push_subject"),
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    @property
    def web_origin(self) -> str:
        return self.timiq_web_app_url

    def __init__(self, **data: Any) -> None:
        normalized = dict(data)
        explicit = normalized.get("timiq_web_app_url")
        resolved_web_app_url: str | None = None
        if explicit is not None and str(explicit).strip():
            resolved_web_app_url = str(explicit).strip()
        else:
            timiq_url = normalized.get("TIMIQ_WEB_APP_URL")
            web_origin = normalized.get("WEB_ORIGIN")
            if timiq_url is not None and str(timiq_url).strip():
                resolved_web_app_url = str(timiq_url).strip()
            elif web_origin is not None and str(web_origin).strip():
                resolved_web_app_url = str(web_origin).strip()
        token: contextvars.Token[str | None] | None = None
        if resolved_web_app_url is not None:
            normalized["timiq_web_app_url"] = resolved_web_app_url
            normalized.pop("TIMIQ_WEB_APP_URL", None)
            normalized.pop("WEB_ORIGIN", None)
            token = _constructor_timiq_web_app_url.set(resolved_web_app_url)
        try:
            super().__init__(**normalized)
        finally:
            if token is not None:
                _constructor_timiq_web_app_url.reset(token)

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        if _constructor_timiq_web_app_url.get() is not None:
            return (init_settings,)
        return (
            dotenv_settings,
            env_settings,
            file_secret_settings,
            init_settings,
        )

    @model_validator(mode="before")
    @classmethod
    def _normalize_web_app_url_keys(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        explicit = data.get("timiq_web_app_url")
        if explicit is not None and str(explicit).strip():
            data["timiq_web_app_url"] = str(explicit).strip()
            return data
        timiq_url = data.get("TIMIQ_WEB_APP_URL")
        if timiq_url is not None and str(timiq_url).strip():
            data["timiq_web_app_url"] = str(timiq_url).strip()
            return data
        # WEB_ORIGIN constructor kwarg only (not a Field env alias).
        web_origin = data.get("WEB_ORIGIN")
        if web_origin is not None and str(web_origin).strip():
            data["timiq_web_app_url"] = str(web_origin).strip()
        return data

    @model_validator(mode="after")
    def _validate_storage_settings(self) -> "Settings":
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

    @model_validator(mode="after")
    def _validate_production_web_origin(self) -> "Settings":
        env = self.app_env.strip().lower()
        if env not in ("production", "prod"):
            return self
        from app.core.web_origin_validation import (
            is_localhost_web_origin,
            looks_like_api_web_origin,
            parse_web_origin,
        )

        try:
            origin = parse_web_origin(self.timiq_web_app_url)
        except ValueError as exc:
            raise ValueError(
                "WEB_ORIGIN or TIMIQ_WEB_APP_URL must be set to the public web app URL in production.",
            ) from exc
        if is_localhost_web_origin(origin):
            raise ValueError(
                "WEB_ORIGIN / TIMIQ_WEB_APP_URL must not be localhost in production.",
            )
        if looks_like_api_web_origin(origin):
            raise ValueError(
                "WEB_ORIGIN / TIMIQ_WEB_APP_URL must point to the web app, not the API service.",
            )
        return self


settings = Settings()


def require_database_url() -> str:
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is missing from apps/api/.env")

    return settings.database_url