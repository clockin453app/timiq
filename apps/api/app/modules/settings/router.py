from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import (
    require_admin_or_administrator,
    require_authenticated_employee,
)
from app.modules.auth.models import User
from app.modules.settings.schemas import (
    CompanySettingsPatchRequest,
    CompanySettingsResponse,
    EffectiveSettingsResponse,
    UserPreferencesPatchRequest,
    UserPreferencesResponse,
)
from app.modules.settings.service import (
    SettingsPermissionError,
    get_company_settings,
    get_effective_settings,
    get_my_preferences,
    patch_company_settings,
    patch_my_preferences,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _settings_perm_http(exc: SettingsPermissionError) -> HTTPException:
    msg = str(exc)
    code = status.HTTP_400_BAD_REQUEST if "required for administrators" in msg else status.HTTP_403_FORBIDDEN
    return HTTPException(status_code=code, detail=msg)


@router.get("/me", response_model=UserPreferencesResponse)
def read_my_preferences(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee),
) -> UserPreferencesResponse:
    return get_my_preferences(db_session, current_user)


@router.patch("/me", response_model=UserPreferencesResponse)
def update_my_preferences(
    body: UserPreferencesPatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee),
) -> UserPreferencesResponse:
    return patch_my_preferences(db_session, current_user, body)


@router.get("/effective", response_model=EffectiveSettingsResponse)
def read_effective_settings(
    company_id: uuid.UUID | None = Query(
        default=None,
        description="Optional company context for platform administrators.",
    ),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee),
) -> EffectiveSettingsResponse:
    return get_effective_settings(db_session, current_user, company_id)


@router.get("/company", response_model=CompanySettingsResponse)
def read_company_settings(
    company_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> CompanySettingsResponse:
    try:
        return get_company_settings(db_session, current_user, company_id)
    except SettingsPermissionError as exc:
        raise _settings_perm_http(exc) from exc


@router.patch("/company", response_model=CompanySettingsResponse)
def update_company_settings(
    body: CompanySettingsPatchRequest,
    company_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> CompanySettingsResponse:
    try:
        return patch_company_settings(db_session, current_user, body, company_id)
    except SettingsPermissionError as exc:
        raise _settings_perm_http(exc) from exc
