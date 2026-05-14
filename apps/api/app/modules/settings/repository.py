from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.settings.models import CompanyAppSettings, UserPreference


def get_company_settings_by_company_id(
    db_session: Session,
    company_id: uuid.UUID,
) -> CompanyAppSettings | None:
    stmt = select(CompanyAppSettings).where(CompanyAppSettings.company_id == company_id)
    return db_session.execute(stmt).scalar_one_or_none()


def get_user_preferences_by_user_id(
    db_session: Session,
    user_id: uuid.UUID,
) -> UserPreference | None:
    stmt = select(UserPreference).where(UserPreference.user_id == user_id)
    return db_session.execute(stmt).scalar_one_or_none()


def ensure_company_settings_row(
    db_session: Session,
    company_id: uuid.UUID,
) -> CompanyAppSettings:
    row = get_company_settings_by_company_id(db_session, company_id)
    if row is not None:
        return row
    now = datetime.now(timezone.utc)
    row = CompanyAppSettings(
        company_id=company_id,
        created_at=now,
        updated_at=now,
    )
    db_session.add(row)
    db_session.flush()
    return row


def ensure_user_preferences_row(
    db_session: Session,
    user_id: uuid.UUID,
) -> UserPreference:
    row = get_user_preferences_by_user_id(db_session, user_id)
    if row is not None:
        return row
    now = datetime.now(timezone.utc)
    row = UserPreference(
        user_id=user_id,
        created_at=now,
        updated_at=now,
    )
    db_session.add(row)
    db_session.flush()
    return row


def touch_company_settings_updated(
    row: CompanyAppSettings,
    *,
    updated_by_user_id: uuid.UUID | None,
) -> None:
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by_user_id = updated_by_user_id


def touch_user_preferences_updated(row: UserPreference) -> None:
    row.updated_at = datetime.now(timezone.utc)
