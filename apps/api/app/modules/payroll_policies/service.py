from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import CompanyTimePolicy
from app.modules.companies.service import ensure_company_time_policy
from app.modules.locations.models import Location
from app.modules.locations.repository import get_location_by_id, list_locations_by_company
from app.modules.payroll_policies.effective_policy import merge_location_time_policy, resolve_early_clock_in_for_site
from app.modules.payroll_policies.repository import (
    delete_policy_for_location,
    get_policy_by_location_id,
    list_policies_for_company,
    upsert_policy,
)
from app.modules.payroll_policies.schemas import (
    CompanyTimePolicyFields,
    SitePayrollPolicyEffectiveResponse,
    SitePayrollPolicyListItem,
    SitePayrollPolicyListResponse,
    SitePayrollPolicyRow,
    SitePayrollPolicyUpsertRequest,
)
from app.modules.time_clock.models import TimeShift


class PayrollPolicyPermissionError(Exception):
    pass


def _resolve_company_id(actor: User, company_id: uuid.UUID | None) -> uuid.UUID:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if company_id is None:
            raise PayrollPolicyPermissionError("Select a company.")
        return company_id
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise PayrollPolicyPermissionError("Your account is not linked to a company.")
        if company_id is not None and company_id != actor.company_id:
            raise PayrollPolicyPermissionError("You cannot manage another company's sites.")
        return actor.company_id
    raise PayrollPolicyPermissionError("You do not have permission.")


def _assert_location_in_company(db_session: Session, company_id: uuid.UUID, location_id: uuid.UUID) -> Location:
    loc = get_location_by_id(db_session, location_id)
    if loc is None or loc.company_id != company_id:
        raise PayrollPolicyPermissionError("Location not found for this company.")
    return loc


def _company_fields(p: CompanyTimePolicy) -> CompanyTimePolicyFields:
    return CompanyTimePolicyFields(
        standard_start_time=p.standard_start_time,
        break_deduction_after_minutes=p.break_deduction_after_minutes,
        break_deduction_minutes=p.break_deduction_minutes,
        rounding_increment_minutes=p.rounding_increment_minutes,
        rounding_mode=p.rounding_mode,
    )


def _fallback_company_policy() -> CompanyTimePolicy:
    now = datetime.now(timezone.utc)
    return CompanyTimePolicy(
        company_id=uuid.UUID(int=0),
        standard_start_time="08:00",
        overtime_after_hours=8.5,
        overtime_multiplier=1.5,
        rounding_increment_minutes=30,
        rounding_mode="nearest",
        break_deduction_minutes=30,
        break_deduction_after_minutes=360,
        rule_effective_from=now,
        rule_note="",
        timezone_name="Europe/London",
        created_at=now,
        updated_at=now,
    )


def effective_early_access_for_shift(
    db_session: Session,
    location: Location,
    *,
    profile_early_access: bool,
) -> bool:
    site = get_policy_by_location_id(db_session, location.id)
    if site is None or not site.is_enabled:
        return bool(profile_early_access)
    return resolve_early_clock_in_for_site(
        profile_early_access=bool(profile_early_access),
        site_allow_early=site.allow_early_clock_in,
    )


def effective_time_policy_for_shift(
    db_session: Session,
    shift: TimeShift,
    location: Location,
) -> CompanyTimePolicy:
    """Merged site + company time policy for shift metrics (read-only company row may be returned)."""
    cid = shift.company_id or location.company_id
    if cid is None:
        return _fallback_company_policy()
    company = ensure_company_time_policy(db_session, cid)
    site = get_policy_by_location_id(db_session, location.id)
    return merge_location_time_policy(company, site)


def time_policy_source_for_shift(db_session: Session, location: Location) -> str:
    site = get_policy_by_location_id(db_session, location.id)
    if site is not None and site.is_enabled:
        return "site"
    return "company"


def list_site_policies(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
) -> SitePayrollPolicyListResponse:
    cid = _resolve_company_id(actor, company_id)
    locs = list_locations_by_company(db_session, cid)
    rows = {p.location_id: p for p in list_policies_for_company(db_session, cid)}
    items: list[SitePayrollPolicyListItem] = []
    for loc in locs:
        p = rows.get(loc.id)
        items.append(
            SitePayrollPolicyListItem(
                location_id=loc.id,
                location_name=loc.name,
                is_active=bool(loc.is_active),
                has_policy_row=p is not None,
                is_enabled=bool(p.is_enabled) if p is not None else False,
            )
        )
    return SitePayrollPolicyListResponse(company_id=cid, items=items)


def get_site_policy_effective(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    location_id: uuid.UUID,
) -> SitePayrollPolicyEffectiveResponse:
    cid = _resolve_company_id(actor, company_id)
    loc = _assert_location_in_company(db_session, cid, location_id)
    company = ensure_company_time_policy(db_session, cid)
    site_row = get_policy_by_location_id(db_session, location_id)
    merged = merge_location_time_policy(company, site_row)
    src = "site" if site_row is not None and site_row.is_enabled else "company"
    override = SitePayrollPolicyRow.model_validate(site_row) if site_row is not None else None
    return SitePayrollPolicyEffectiveResponse(
        location_id=loc.id,
        location_name=loc.name,
        company_id=cid,
        company_fallback=_company_fields(company),
        override=override,
        merged_effective=_company_fields(merged),
        policy_source=src,
    )


def put_site_policy(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    location_id: uuid.UUID,
    body: SitePayrollPolicyUpsertRequest,
) -> SitePayrollPolicyEffectiveResponse:
    cid = _resolve_company_id(actor, company_id)
    _assert_location_in_company(db_session, cid, location_id)
    row, created = upsert_policy(
        db_session,
        company_id=cid,
        location_id=location_id,
        is_enabled=body.is_enabled,
        standard_start_time=body.standard_start_time,
        allow_early_clock_in=body.allow_early_clock_in,
        break_deduction_after_minutes=body.break_deduction_after_minutes,
        break_deduction_minutes=body.break_deduction_minutes,
        rounding_increment_minutes=body.rounding_increment_minutes,
        rounding_mode=body.rounding_mode,
        notes=body.notes,
        actor_user_id=actor.id,
    )
    action = "payroll_policy.site_created" if created else "payroll_policy.site_updated"
    changed = sorted(body.model_dump(exclude_unset=True).keys())
    create_internal_audit_event(
        db_session,
        actor,
        action=action,
        entity_type="location_payroll_policy",
        entity_id=str(row.id),
        company_id=cid,
        details={
            "company_id": str(cid),
            "location_id": str(location_id),
            "changed_fields": changed,
            "actor_user_id": str(actor.id),
        },
    )
    return get_site_policy_effective(
        db_session,
        actor,
        company_id=cid if actor.system_role == SystemRole.ADMINISTRATOR else None,
        location_id=location_id,
    )


def delete_site_policy(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    location_id: uuid.UUID,
) -> None:
    cid = _resolve_company_id(actor, company_id)
    _assert_location_in_company(db_session, cid, location_id)
    existed = get_policy_by_location_id(db_session, location_id) is not None
    if not existed:
        return
    delete_policy_for_location(db_session, location_id)
    create_internal_audit_event(
        db_session,
        actor,
        action="payroll_policy.site_disabled",
        entity_type="location_payroll_policy",
        entity_id=str(location_id),
        company_id=cid,
        details={
            "company_id": str(cid),
            "location_id": str(location_id),
            "changed_fields": ["removed"],
            "actor_user_id": str(actor.id),
        },
    )
