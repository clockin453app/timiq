from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy.orm import Session

from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.accounting.repository import (
    get_export_mapping,
    get_settings,
    list_export_runs,
    upsert_export_mapping,
    upsert_settings,
)
from app.modules.accounting.schemas import (
    AccountingExportMappingPatchRequest,
    AccountingExportMappingResponse,
    AccountingExportRunListResponse,
    AccountingExportRunResponse,
    AccountingSettingsResponse,
    AccountingSettingsUpsertRequest,
)


class AccountingPermissionError(Exception):
    pass


def _resolve_company_id(actor: User, company_id: uuid.UUID | None) -> uuid.UUID:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if company_id is None:
            raise AccountingPermissionError("Select a company.")
        return company_id
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise AccountingPermissionError("Your account is not linked to a company.")
        if company_id is not None and company_id != actor.company_id:
            raise AccountingPermissionError("You cannot use another company's data.")
        return actor.company_id
    raise AccountingPermissionError("You do not have permission.")


def resolve_accounting_company_for_export(actor: User, company_id: uuid.UUID | None) -> uuid.UUID:
    """Company scope for accounting exports and mapping (administrator must pass company_id)."""
    return _resolve_company_id(actor, company_id)


def get_accounting_settings(db_session: Session, actor: User, company_id: uuid.UUID | None) -> AccountingSettingsResponse:
    cid = _resolve_company_id(actor, company_id)
    row = get_settings(db_session, cid)
    if row is None:
        return AccountingSettingsResponse(
            company_id=cid,
            provider_key="none",
            notes=None,
            updated_by_user_id=None,
            updated_at=None,
        )
    return AccountingSettingsResponse.model_validate(row)


def save_accounting_settings(
    db_session: Session,
    actor: User,
    body: AccountingSettingsUpsertRequest,
) -> AccountingSettingsResponse:
    cid = _resolve_company_id(actor, body.company_id if actor.system_role == SystemRole.ADMINISTRATOR else None)
    row = upsert_settings(
        db_session,
        company_id=cid,
        provider_key=body.provider_key,
        notes=(body.notes or "").strip() or None,
        updated_by_user_id=actor.id,
    )
    create_internal_audit_event(
        db_session,
        actor,
        action="accounting.settings_saved",
        entity_type="company_accounting_settings",
        entity_id=str(cid),
        company_id=cid,
        details={"provider_key": row.provider_key, "company_id": str(cid)},
    )
    return AccountingSettingsResponse.model_validate(row)


_MAPPING_FIELDS = (
    "nominal_code_wages",
    "nominal_code_cis",
    "nominal_code_materials",
    "nominal_code_tools",
    "nominal_code_equipment",
    "nominal_code_subcontractor",
    "tax_code",
)


def list_accounting_export_runs(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    limit: int,
) -> AccountingExportRunListResponse:
    cid = _resolve_company_id(actor, company_id)
    rows = list_export_runs(db_session, cid, limit=min(max(limit, 1), 200))
    items: list[AccountingExportRunResponse] = []
    for r in rows:
        ta = r.total_amount
        dec = Decimal(str(ta)) if ta is not None else None
        items.append(
            AccountingExportRunResponse(
                id=r.id,
                company_id=r.company_id,
                provider=r.provider,
                export_type=r.export_type,
                date_from=r.date_from,
                date_to=r.date_to,
                status=r.status,
                created_by_user_id=r.created_by_user_id,
                created_at=r.created_at,
                row_count=r.row_count,
                total_amount=dec,
                file_name=r.file_name,
                notes=r.notes,
            )
        )
    return AccountingExportRunListResponse(items=items)


def get_accounting_export_mapping(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    provider: str,
) -> AccountingExportMappingResponse:
    cid = _resolve_company_id(actor, company_id)
    p = str(provider).strip().lower()
    row = get_export_mapping(db_session, cid, p)
    if row is None:
        return AccountingExportMappingResponse(
            company_id=cid,
            provider=p,
            nominal_code_wages=None,
            nominal_code_cis=None,
            nominal_code_materials=None,
            nominal_code_tools=None,
            nominal_code_equipment=None,
            nominal_code_subcontractor=None,
            tax_code=None,
            created_at=None,
            updated_at=None,
        )
    return AccountingExportMappingResponse.model_validate(row)


def patch_accounting_export_mapping(
    db_session: Session,
    actor: User,
    body: AccountingExportMappingPatchRequest,
) -> AccountingExportMappingResponse:
    cid = _resolve_company_id(actor, body.company_id if actor.system_role == SystemRole.ADMINISTRATOR else None)
    prov = str(body.provider).strip().lower()
    touched = body.model_dump(exclude_unset=True, exclude={"company_id", "provider"})
    existing = get_export_mapping(db_session, cid, prov)
    merged: dict[str, str | None] = {}
    for field in _MAPPING_FIELDS:
        if field in touched:
            merged[field] = touched[field]
        elif existing is not None:
            merged[field] = getattr(existing, field)
        else:
            merged[field] = None
    row = upsert_export_mapping(
        db_session,
        company_id=cid,
        provider=prov,
        nominal_code_wages=merged["nominal_code_wages"],
        nominal_code_cis=merged["nominal_code_cis"],
        nominal_code_materials=merged["nominal_code_materials"],
        nominal_code_tools=merged["nominal_code_tools"],
        nominal_code_equipment=merged["nominal_code_equipment"],
        nominal_code_subcontractor=merged["nominal_code_subcontractor"],
        tax_code=merged["tax_code"],
    )
    fields_updated = sorted([k for k in touched if k in _MAPPING_FIELDS])
    create_internal_audit_event(
        db_session,
        actor,
        action="accounting.settings_updated",
        entity_type="accounting_export_settings",
        entity_id=str(cid),
        company_id=cid,
        details={
            "company_id": str(cid),
            "provider": prov,
            "mapping_fields_updated": fields_updated,
            "updated_by": str(actor.id),
        },
    )
    return AccountingExportMappingResponse.model_validate(row)
