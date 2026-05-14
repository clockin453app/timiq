from __future__ import annotations

import re
import uuid
from pydantic import BaseModel, Field, field_validator

DATE_FORMATS = frozenset({"DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"})
TIME_FORMATS = frozenset({"12h", "24h"})
WEEK_START = frozenset({"monday", "sunday"})
CURRENCIES = frozenset({"GBP", "EUR", "USD"})
LOCALES = frozenset({"en-GB", "ro-RO"})

_HEX_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _trim_opt(v: str | None) -> str | None:
    if v is None:
        return None
    s = v.strip()
    return s or None


class CompanySettingsResponse(BaseModel):
    company_id: uuid.UUID
    timezone_name: str | None
    date_format: str | None
    time_format: str | None
    currency_code: str | None
    week_start_day: str | None
    company_display_name: str | None
    brand_primary_color: str | None
    brand_logo_configured: bool
    notifications_enabled: bool
    email_notifications_enabled: bool
    push_notifications_enabled: bool


class CompanySettingsPatchRequest(BaseModel):
    timezone_name: str | None = None
    date_format: str | None = None
    time_format: str | None = None
    currency_code: str | None = None
    week_start_day: str | None = None
    company_display_name: str | None = Field(default=None, max_length=200)
    brand_primary_color: str | None = None
    notifications_enabled: bool | None = None
    email_notifications_enabled: bool | None = None
    push_notifications_enabled: bool | None = None

    @field_validator("timezone_name", "date_format", "time_format", "currency_code", "week_start_day", mode="before")
    @classmethod
    def _trim(cls, v: object) -> object:
        if v is None or isinstance(v, bool):
            return v
        if isinstance(v, str):
            return _trim_opt(v)
        return v

    @field_validator("date_format")
    @classmethod
    def _df(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if v not in DATE_FORMATS:
            raise ValueError(f"date_format must be one of {sorted(DATE_FORMATS)}.")
        return v

    @field_validator("time_format")
    @classmethod
    def _tf(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if v not in TIME_FORMATS:
            raise ValueError(f"time_format must be one of {sorted(TIME_FORMATS)}.")
        return v

    @field_validator("currency_code")
    @classmethod
    def _cc(cls, v: str | None) -> str | None:
        if v is None:
            return None
        u = v.strip().upper()
        if u not in CURRENCIES:
            raise ValueError(f"currency_code must be one of {sorted(CURRENCIES)}.")
        return u

    @field_validator("week_start_day")
    @classmethod
    def _ws(cls, v: str | None) -> str | None:
        if v is None:
            return None
        sl = v.strip().lower()
        if sl not in WEEK_START:
            raise ValueError("week_start_day must be monday or sunday.")
        return sl

    @field_validator("timezone_name")
    @classmethod
    def _tz(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if len(v) > 64:
            raise ValueError("timezone_name is too long.")
        return v

    @field_validator("brand_primary_color")
    @classmethod
    def _color(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        if not _HEX_COLOR.match(s):
            raise ValueError("brand_primary_color must be a #RRGGBB hex value.")
        return s


class UserPreferencesResponse(BaseModel):
    user_id: uuid.UUID
    locale: str | None
    timezone_name: str | None
    date_format: str | None
    time_format: str | None
    compact_mode: bool
    notification_email_enabled: bool
    notification_in_app_enabled: bool
    push_notifications_enabled: bool  # user opt-in; delivery not configured app-wide


class UserPreferencesPatchRequest(BaseModel):
    locale: str | None = None
    timezone_name: str | None = None
    date_format: str | None = None
    time_format: str | None = None
    compact_mode: bool | None = None
    notification_email_enabled: bool | None = None
    notification_in_app_enabled: bool | None = None
    push_notifications_enabled: bool | None = None

    @field_validator("locale")
    @classmethod
    def _loc(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        if s not in LOCALES:
            raise ValueError(f"locale must be one of {sorted(LOCALES)}.")
        return s

    @field_validator("timezone_name")
    @classmethod
    def _tzu(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if len(v) > 64:
            raise ValueError("timezone_name is too long.")
        return v.strip()

    @field_validator("date_format")
    @classmethod
    def _dfu(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if v not in DATE_FORMATS:
            raise ValueError(f"date_format must be one of {sorted(DATE_FORMATS)}.")
        return v

    @field_validator("time_format")
    @classmethod
    def _tfu(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if v not in TIME_FORMATS:
            raise ValueError(f"time_format must be one of {sorted(TIME_FORMATS)}.")
        return v


class EffectiveSettingsResponse(BaseModel):
    """Merged display preferences; no secrets or storage paths."""

    company_id: uuid.UUID | None
    locale: str
    timezone_name: str
    date_format: str
    time_format: str
    currency_code: str
    week_start_day: str
    company_display_name: str | None
    brand_primary_color: str | None
    compact_mode: bool
    notification_in_app_effective: bool
    notification_email_effective: bool
    notification_push_effective: bool
