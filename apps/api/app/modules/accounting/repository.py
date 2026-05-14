from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.accounting.models import (
    AccountingExportRun,
    AccountingExportSettings,
    CompanyAccountingSettings,
)


def get_settings(db_session: Session, company_id: uuid.UUID) -> CompanyAccountingSettings | None:
    return db_session.get(CompanyAccountingSettings, company_id)


def upsert_settings(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    provider_key: str,
    notes: str | None,
    updated_by_user_id: uuid.UUID,
) -> CompanyAccountingSettings:
    row = db_session.get(CompanyAccountingSettings, company_id)
    now = datetime.now(timezone.utc)
    if row is None:
        row = CompanyAccountingSettings(
            company_id=company_id,
            provider_key=provider_key,
            notes=notes,
            updated_by_user_id=updated_by_user_id,
            updated_at=now,
        )
        db_session.add(row)
    else:
        row.provider_key = provider_key
        row.notes = notes
        row.updated_by_user_id = updated_by_user_id
        row.updated_at = now
    db_session.flush()
    return row


def list_export_runs(
    db_session: Session,
    company_id: uuid.UUID,
    *,
    limit: int = 50,
) -> list[AccountingExportRun]:
    statement = (
        select(AccountingExportRun)
        .where(AccountingExportRun.company_id == company_id)
        .order_by(AccountingExportRun.created_at.desc())
        .limit(limit)
    )
    return list(db_session.scalars(statement).all())


def payroll_export_run_overlaps_date_range(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    range_start: date,
    range_end: date,
) -> bool:
    """True if a recorded payroll CSV export's date range overlaps [range_start, range_end] inclusive."""
    statement = (
        select(AccountingExportRun.id)
        .where(AccountingExportRun.company_id == company_id)
        .where(AccountingExportRun.export_type.in_(("payroll_items", "payroll_summary")))
        .where(AccountingExportRun.date_from <= range_end)
        .where(AccountingExportRun.date_to >= range_start)
        .limit(1)
    )
    return db_session.scalar(statement) is not None


def add_export_run(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    provider: str,
    export_type: str,
    date_from: date,
    date_to: date,
    status: str,
    created_by_user_id: uuid.UUID | None,
    row_count: int,
    total_amount: Decimal | None,
    file_name: str,
    notes: str | None,
    filters_json: dict | None,
) -> AccountingExportRun:
    row = AccountingExportRun(
        company_id=company_id,
        provider=provider,
        export_type=export_type,
        date_from=date_from,
        date_to=date_to,
        status=status,
        created_by_user_id=created_by_user_id,
        row_count=row_count,
        total_amount=float(total_amount) if total_amount is not None else None,
        file_name=file_name,
        notes=notes,
        filters_json=filters_json,
    )
    db_session.add(row)
    db_session.flush()
    return row


def get_export_mapping(
    db_session: Session,
    company_id: uuid.UUID,
    provider: str,
) -> AccountingExportSettings | None:
    statement = select(AccountingExportSettings).where(
        AccountingExportSettings.company_id == company_id,
        AccountingExportSettings.provider == provider,
    )
    return db_session.scalar(statement)


def upsert_export_mapping(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    provider: str,
    nominal_code_wages: str | None,
    nominal_code_cis: str | None,
    nominal_code_materials: str | None,
    nominal_code_tools: str | None,
    nominal_code_equipment: str | None,
    nominal_code_subcontractor: str | None,
    tax_code: str | None,
) -> AccountingExportSettings:
    now = datetime.now(timezone.utc)
    row = get_export_mapping(db_session, company_id, provider)
    if row is None:
        row = AccountingExportSettings(
            company_id=company_id,
            provider=provider,
            nominal_code_wages=nominal_code_wages,
            nominal_code_cis=nominal_code_cis,
            nominal_code_materials=nominal_code_materials,
            nominal_code_tools=nominal_code_tools,
            nominal_code_equipment=nominal_code_equipment,
            nominal_code_subcontractor=nominal_code_subcontractor,
            tax_code=tax_code,
            created_at=now,
            updated_at=now,
        )
        db_session.add(row)
    else:
        row.nominal_code_wages = nominal_code_wages
        row.nominal_code_cis = nominal_code_cis
        row.nominal_code_materials = nominal_code_materials
        row.nominal_code_tools = nominal_code_tools
        row.nominal_code_equipment = nominal_code_equipment
        row.nominal_code_subcontractor = nominal_code_subcontractor
        row.tax_code = tax_code
        row.updated_at = now
    db_session.flush()
    return row
