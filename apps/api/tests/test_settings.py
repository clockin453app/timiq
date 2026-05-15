"""App settings merge and schema validation (no database)."""

import uuid
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.modules.settings.models import CompanyAppSettings, UserPreference
from app.modules.settings.schemas import CompanySettingsPatchRequest, UserPreferencesPatchRequest
from app.modules.settings.service import compute_effective_settings


def test_effective_merge_user_overrides_company() -> None:
    cid = uuid.uuid4()
    now = datetime.now(timezone.utc)
    co = CompanyAppSettings(
        id=uuid.uuid4(),
        company_id=cid,
        timezone_name="Europe/Bucharest",
        date_format="YYYY-MM-DD",
        time_format="12h",
        currency_code="EUR",
        week_start_day="sunday",
        company_display_name="Acme",
        brand_primary_color="#112233",
        brand_logo_storage_path=None,
        notifications_enabled=True,
        email_notifications_enabled=True,
        push_notifications_enabled=False,
        updated_by_user_id=None,
        created_at=now,
        updated_at=now,
    )
    u = UserPreference(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        locale="ro-RO",
        timezone_name="Europe/London",
        date_format=None,
        time_format="24h",
        compact_mode=True,
        notification_email_enabled=False,
        notification_in_app_enabled=True,
        push_notifications_enabled=True,
        created_at=now,
        updated_at=now,
    )
    eff = compute_effective_settings(company_id=cid, company_row=co, user_row=u)
    assert eff.locale == "ro-RO"
    assert eff.timezone_name == "Europe/London"
    assert eff.date_format == "YYYY-MM-DD"
    assert eff.time_format == "24h"
    assert eff.currency_code == "EUR"
    assert eff.week_start_day == "sunday"
    assert eff.company_display_name == "Acme"
    assert eff.brand_primary_color == "#112233"
    assert eff.compact_mode is True
    assert eff.notification_in_app_effective is True
    assert eff.notification_email_effective is False


def test_effective_defaults_without_rows() -> None:
    eff = compute_effective_settings(company_id=None, company_row=None, user_row=None)
    assert eff.company_id is None
    assert eff.locale == "en-GB"
    assert eff.timezone_name == "Europe/London"
    assert eff.currency_code == "GBP"


def test_company_patch_rejects_bad_currency() -> None:
    with pytest.raises(ValidationError):
        CompanySettingsPatchRequest(currency_code="JPY")


def test_user_patch_accepts_ro_locale() -> None:
    body = UserPreferencesPatchRequest(locale="ro-RO")
    assert body.locale == "ro-RO"


def test_user_patch_accepts_pl_locale() -> None:
    body = UserPreferencesPatchRequest(locale="pl-PL")
    assert body.locale == "pl-PL"


def test_user_patch_accepts_es_locale() -> None:
    body = UserPreferencesPatchRequest(locale="es-ES")
    assert body.locale == "es-ES"


def test_user_patch_accepts_ru_locale() -> None:
    body = UserPreferencesPatchRequest(locale="ru-RU")
    assert body.locale == "ru-RU"
