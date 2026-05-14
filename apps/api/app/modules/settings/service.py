from __future__ import annotations

import uuid

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.settings.models import CompanyAppSettings, UserPreference
from app.modules.settings.repository import (
    ensure_company_settings_row,
    ensure_user_preferences_row,
    get_company_settings_by_company_id,
    get_user_preferences_by_user_id,
    touch_company_settings_updated,
    touch_user_preferences_updated,
)
from app.modules.settings.schemas import (
    CompanySettingsPatchRequest,
    CompanySettingsResponse,
    EffectiveSettingsResponse,
    UserPreferencesPatchRequest,
    UserPreferencesResponse,
)

DEFAULT_TIMEZONE = "Europe/London"
DEFAULT_DATE_FORMAT = "DD/MM/YYYY"
DEFAULT_TIME_FORMAT = "24h"
DEFAULT_CURRENCY = "GBP"
DEFAULT_WEEK_START = "monday"
DEFAULT_LOCALE = "en-GB"


class SettingsPermissionError(Exception):
    pass


def resolve_company_id_for_company_endpoints(
    actor: User,
    company_id_query: uuid.UUID | None,
) -> uuid.UUID:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if company_id_query is None:
            raise SettingsPermissionError("company_id query parameter is required for administrators.")
        return company_id_query
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise SettingsPermissionError("Your account is not linked to a company.")
        if company_id_query is not None and company_id_query != actor.company_id:
            raise SettingsPermissionError("You cannot access settings for another company.")
        return actor.company_id
    raise SettingsPermissionError("You do not have permission to access company settings.")


def resolve_company_id_for_effective(
    actor: User,
    company_id_query: uuid.UUID | None,
) -> uuid.UUID | None:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if company_id_query is not None:
            return company_id_query
        return actor.company_id
    if actor.system_role == SystemRole.ADMIN:
        return actor.company_id
    return actor.company_id


def _coalesce_str(value: str | None, default: str) -> str:
    if value is None or not str(value).strip():
        return default
    return str(value).strip()


def _coalesce_opt_str(value: str | None) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def company_settings_to_response(
    company_id: uuid.UUID,
    row: CompanyAppSettings | None,
) -> CompanySettingsResponse:
    if row is None:
        return CompanySettingsResponse(
            company_id=company_id,
            timezone_name=None,
            date_format=None,
            time_format=None,
            currency_code=None,
            week_start_day=None,
            company_display_name=None,
            brand_primary_color=None,
            brand_logo_configured=False,
            notifications_enabled=True,
            email_notifications_enabled=False,
            push_notifications_enabled=False,
        )
    path = row.brand_logo_storage_path
    logo_cfg = bool(path and str(path).strip())
    return CompanySettingsResponse(
        company_id=company_id,
        timezone_name=_coalesce_opt_str(row.timezone_name),
        date_format=_coalesce_opt_str(row.date_format),
        time_format=_coalesce_opt_str(row.time_format),
        currency_code=_coalesce_opt_str(row.currency_code),
        week_start_day=_coalesce_opt_str(row.week_start_day),
        company_display_name=_coalesce_opt_str(row.company_display_name),
        brand_primary_color=_coalesce_opt_str(row.brand_primary_color),
        brand_logo_configured=logo_cfg,
        notifications_enabled=bool(row.notifications_enabled),
        email_notifications_enabled=bool(row.email_notifications_enabled),
        push_notifications_enabled=bool(row.push_notifications_enabled),
    )


def user_preferences_to_response(user_id: uuid.UUID, row: UserPreference | None) -> UserPreferencesResponse:
    if row is None:
        return UserPreferencesResponse(
            user_id=user_id,
            locale=None,
            timezone_name=None,
            date_format=None,
            time_format=None,
            compact_mode=False,
            notification_email_enabled=True,
            notification_in_app_enabled=True,
            push_notifications_enabled=False,
        )
    return UserPreferencesResponse(
        user_id=user_id,
        locale=_coalesce_opt_str(row.locale),
        timezone_name=_coalesce_opt_str(row.timezone_name),
        date_format=_coalesce_opt_str(row.date_format),
        time_format=_coalesce_opt_str(row.time_format),
        compact_mode=bool(row.compact_mode),
        notification_email_enabled=bool(row.notification_email_enabled),
        notification_in_app_enabled=bool(row.notification_in_app_enabled),
        push_notifications_enabled=bool(row.push_notifications_enabled),
    )


def compute_effective_settings(
    *,
    company_id: uuid.UUID | None,
    company_row: CompanyAppSettings | None,
    user_row: UserPreference | None,
) -> EffectiveSettingsResponse:
    c_tz = company_row.timezone_name if company_row else None
    c_df = company_row.date_format if company_row else None
    c_tf = company_row.time_format if company_row else None
    c_cur = company_row.currency_code if company_row else None
    c_ws = company_row.week_start_day if company_row else None
    c_disp = company_row.company_display_name if company_row else None
    c_color = company_row.brand_primary_color if company_row else None
    c_master = True if company_row is None else bool(company_row.notifications_enabled)
    c_email = False if company_row is None else bool(company_row.email_notifications_enabled)
    c_push = False if company_row is None else bool(company_row.push_notifications_enabled)

    u_loc = user_row.locale if user_row else None
    u_tz = user_row.timezone_name if user_row else None
    u_df = user_row.date_format if user_row else None
    u_tf = user_row.time_format if user_row else None
    u_compact = False if user_row is None else bool(user_row.compact_mode)
    u_in_app = True if user_row is None else bool(user_row.notification_in_app_enabled)
    u_email = True if user_row is None else bool(user_row.notification_email_enabled)
    u_push = False if user_row is None else bool(user_row.push_notifications_enabled)

    tz = _coalesce_str(u_tz, _coalesce_str(c_tz, DEFAULT_TIMEZONE))
    df = _coalesce_str(u_df, _coalesce_str(c_df, DEFAULT_DATE_FORMAT))
    tf = _coalesce_str(u_tf, _coalesce_str(c_tf, DEFAULT_TIME_FORMAT))
    cur = _coalesce_str(c_cur, DEFAULT_CURRENCY).upper()
    ws_raw = _coalesce_str(c_ws, DEFAULT_WEEK_START).lower()
    locale = _coalesce_str(u_loc, DEFAULT_LOCALE)

    in_app_eff = c_master and u_in_app
    email_eff = c_master and c_email and u_email
    push_eff = c_master and c_push and u_push

    # TODO(Batch 43+): when product connects delivery, align in-app messaging with
    # ``notification_in_app_effective`` / company master toggles.

    return EffectiveSettingsResponse(
        company_id=company_id,
        locale=locale,
        timezone_name=tz,
        date_format=df,
        time_format=tf,
        currency_code=cur,
        week_start_day=ws_raw,
        company_display_name=_coalesce_opt_str(c_disp),
        brand_primary_color=_coalesce_opt_str(c_color),
        compact_mode=u_compact,
        notification_in_app_effective=in_app_eff,
        notification_email_effective=email_eff,
        notification_push_effective=push_eff,
    )


def _patch_changed_keys(model: BaseModel) -> list[str]:
    return sorted(model.model_dump(exclude_unset=True).keys())


def get_company_settings(
    db_session: Session,
    actor: User,
    company_id_query: uuid.UUID | None,
) -> CompanySettingsResponse:
    cid = resolve_company_id_for_company_endpoints(actor, company_id_query)
    row = get_company_settings_by_company_id(db_session, cid)
    return company_settings_to_response(cid, row)


def patch_company_settings(
    db_session: Session,
    actor: User,
    body: CompanySettingsPatchRequest,
    company_id_query: uuid.UUID | None,
) -> CompanySettingsResponse:
    cid = resolve_company_id_for_company_endpoints(actor, company_id_query)
    row = ensure_company_settings_row(db_session, cid)
    data = body.model_dump(exclude_unset=True)
    for key, val in data.items():
        setattr(row, key, val)
    touch_company_settings_updated(row, updated_by_user_id=actor.id)
    db_session.flush()
    create_internal_audit_event(
        db_session,
        actor,
        action="settings.company_updated",
        entity_type="company_app_settings",
        entity_id=str(cid),
        company_id=cid,
        details={
            "actor_user_id": str(actor.id),
            "company_id": str(cid),
            "changed_fields": _patch_changed_keys(body),
        },
    )
    db_session.refresh(row)
    return company_settings_to_response(cid, row)


def get_my_preferences(db_session: Session, actor: User) -> UserPreferencesResponse:
    row = get_user_preferences_by_user_id(db_session, actor.id)
    return user_preferences_to_response(actor.id, row)


def patch_my_preferences(
    db_session: Session,
    actor: User,
    body: UserPreferencesPatchRequest,
) -> UserPreferencesResponse:
    row = ensure_user_preferences_row(db_session, actor.id)
    data = body.model_dump(exclude_unset=True)
    for key, val in data.items():
        setattr(row, key, val)
    touch_user_preferences_updated(row)
    db_session.flush()
    audit_company = actor.company_id if actor.system_role != SystemRole.ADMINISTRATOR else None
    create_internal_audit_event(
        db_session,
        actor,
        action="settings.user_preferences_updated",
        entity_type="user_preferences",
        entity_id=str(actor.id),
        company_id=audit_company,
        details={
            "actor_user_id": str(actor.id),
            "user_id": str(actor.id),
            "changed_fields": _patch_changed_keys(body),
        },
    )
    db_session.refresh(row)
    return user_preferences_to_response(actor.id, row)


def get_effective_settings(
    db_session: Session,
    actor: User,
    company_id_query: uuid.UUID | None,
) -> EffectiveSettingsResponse:
    cid = resolve_company_id_for_effective(actor, company_id_query)
    company_row = get_company_settings_by_company_id(db_session, cid) if cid is not None else None
    user_row = get_user_preferences_by_user_id(db_session, actor.id)
    return compute_effective_settings(company_id=cid, company_row=company_row, user_row=user_row)
