from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.companies.repository import get_company_by_id
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.privacy.models import PrivacyPolicyAcknowledgement, PrivacyRequest
from app.modules.privacy.repository import (
    count_clock_selfies_for_user,
    count_onboarding_documents_for_user,
    count_paid_payroll_items_for_user,
    count_payroll_items_for_user,
    count_shift_breaks_for_user,
    count_time_shifts_for_user,
    count_work_progress_attachments_for_user,
    get_latest_ack_for_user,
    get_privacy_request,
    list_privacy_requests_for_management,
    list_privacy_requests_for_user,
    save_ack,
    save_privacy_request,
)
from app.modules.privacy.schemas import (
    PrivacyAccountSummary,
    PrivacyAckResponse,
    PrivacyAdminRequestDetailResponse,
    PrivacyAdminRequestListItem,
    PrivacyAdminRequestPatchRequest,
    PrivacyAuditCategories,
    PrivacyDocumentsCategories,
    PrivacyInventoryResponse,
    PrivacyInventorySection,
    PrivacyMeRequestCancelRequest,
    PrivacyMeRequestCreateRequest,
    PrivacyMeRequestResponse,
    PrivacyMeSummaryResponse,
    PrivacyPayrollCategories,
    PrivacyProfileDataCategories,
    PrivacyTrackingCategories,
    REQUEST_TYPES,
)

CURRENT_POLICY_VERSION = "2026-05-12"


def build_inventory() -> PrivacyInventoryResponse:
    return PrivacyInventoryResponse(
        version=CURRENT_POLICY_VERSION,
        intro=(
            "TimIQ processes workforce and payroll data strictly for operating the service you use. "
            "This summary lists categories of data — not your individual values."
        ),
        sections=[
            PrivacyInventorySection(
                title="Identity & account",
                items=[
                    "Email address and authentication credentials (password stored as a secure hash only).",
                    "System role (employee, company admin, or system administrator).",
                    "Company association for access control.",
                ],
            ),
            PrivacyInventorySection(
                title="Workforce & time",
                items=[
                    "Clock times, GPS coordinates used for attendance validation, and break records.",
                    "Selfie metadata and references required for clock events (not displayed in this portal).",
                    "Timesheets and time records derived from shifts.",
                ],
            ),
            PrivacyInventorySection(
                title="Payroll",
                items=[
                    "Payroll periods, calculated amounts, and payment status for authorised payroll users.",
                    "Hourly rate and tax snapshots used for calculations (access restricted by role).",
                ],
            ),
            PrivacyInventorySection(
                title="Onboarding & documents",
                items=[
                    "Starter form submissions and document references stored through the file service.",
                    "Access is limited to the submitting employee and authorised company administrators.",
                ],
            ),
            PrivacyInventorySection(
                title="Audit & security",
                items=[
                    "Security and administrative audit events (who did what, when — without sensitive payloads).",
                ],
            ),
        ],
    )


def record_acknowledgement(db_session: Session, actor: User, policy_version: str) -> PrivacyAckResponse:
    row = PrivacyPolicyAcknowledgement(
        user_id=actor.id,
        policy_version=policy_version.strip(),
        acknowledged_at=datetime.now(timezone.utc),
    )
    save_ack(db_session, row)
    create_internal_audit_event(
        db_session,
        actor,
        action="privacy.policy_acknowledged",
        entity_type="privacy_policy",
        entity_id=policy_version.strip(),
        company_id=actor.company_id,
        details={"policy_version": policy_version.strip()},
    )
    return PrivacyAckResponse(policy_version=row.policy_version, acknowledged_at=row.acknowledged_at)


def latest_ack(db_session: Session, actor: User) -> PrivacyAckResponse | None:
    row = get_latest_ack_for_user(db_session, actor.id)
    if row is None:
        return None
    return PrivacyAckResponse(policy_version=row.policy_version, acknowledged_at=row.acknowledged_at)


RETENTION_NOTICE = (
    "Retention periods for workforce, time, and payroll records depend on your employer's legal obligations "
    "and how this TimIQ deployment is operated. Automatic erasure is not performed by this portal in v1; "
    "your company administrator can explain what is retained and for how long."
)


class PrivacyPermissionError(Exception):
    pass


class PrivacyNotFoundError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _nonempty_str(val: str | None) -> bool:
    return bool(val and str(val).strip())


def _requester_display(profile, email: str) -> str:
    if profile is not None:
        n = f"{(profile.first_name or '').strip()} {(profile.last_name or '').strip()}".strip()
        if n:
            return n
    return email


def _audit_company(actor: User, row: PrivacyRequest) -> uuid.UUID | None:
    return row.company_id if row.company_id is not None else actor.company_id


def build_me_summary(db_session: Session, actor: User) -> PrivacyMeSummaryResponse:
    company_name = None
    if actor.company_id is not None:
        co = get_company_by_id(db_session, actor.company_id)
        company_name = co.name if co is not None else None

    profile = get_employee_profile_by_user_id(db_session, actor.id)
    name_contact = False
    if profile is not None:
        name_contact = (
            _nonempty_str(profile.first_name)
            or _nonempty_str(profile.last_name)
            or _nonempty_str(profile.phone)
        )

    shifts = count_time_shifts_for_user(db_session, actor.id)
    selfies = count_clock_selfies_for_user(db_session, actor.id)
    breaks = count_shift_breaks_for_user(db_session, actor.id)
    onboarding_docs = count_onboarding_documents_for_user(db_session, actor.id)
    wp_attach = count_work_progress_attachments_for_user(db_session, actor.id)
    payroll_items = count_payroll_items_for_user(db_session, actor.id)
    paid_items = count_paid_payroll_items_for_user(db_session, actor.id)

    return PrivacyMeSummaryResponse(
        account=PrivacyAccountSummary(
            email=actor.email,
            role=actor.system_role.value,
            company_name=company_name,
        ),
        profile_data_categories=PrivacyProfileDataCategories(
            name_contact_stored=name_contact,
            job_title_stored=_nonempty_str(profile.job_title) if profile else False,
            emergency_contact_stored=(
                (_nonempty_str(profile.emergency_contact_name) or _nonempty_str(profile.emergency_contact_phone))
                if profile
                else False
            ),
            national_insurance_number_stored=_nonempty_str(profile.national_insurance_number) if profile else False,
            utr_stored=_nonempty_str(profile.utr_number) if profile else False,
        ),
        tracking_categories=PrivacyTrackingCategories(
            clock_shift_records_count=shifts,
            gps_may_be_recorded_at_clock_events=shifts > 0,
            clock_selfie_records_count=selfies,
            break_records_count=breaks,
        ),
        documents_categories=PrivacyDocumentsCategories(
            onboarding_document_count=onboarding_docs,
            work_progress_attachment_count=wp_attach,
        ),
        payroll_categories=PrivacyPayrollCategories(
            payroll_history_item_count=payroll_items,
            paid_payroll_records_count=paid_items,
        ),
        audit_categories=PrivacyAuditCategories(
            description=(
                "Administrative actions relevant to your account may be recorded in the audit log "
                "for security and compliance. Raw audit payloads are not shown in this portal."
            ),
        ),
        retention_notice=RETENTION_NOTICE,
    )


def submit_me_request(
    db_session: Session,
    actor: User,
    body: PrivacyMeRequestCreateRequest,
) -> PrivacyMeRequestResponse:
    if body.request_type not in REQUEST_TYPES:
        raise PrivacyPermissionError("Invalid request type.")
    msg = body.message.strip()
    if not msg:
        raise PrivacyPermissionError("Message cannot be empty.")
    t = _now()
    row = PrivacyRequest(
        company_id=actor.company_id,
        user_id=actor.id,
        request_type=body.request_type,
        status="submitted",
        subject=(body.subject.strip() if body.subject else None) or None,
        message=msg[:8000],
        submitted_at=t,
        updated_at=t,
    )
    save_privacy_request(db_session, row)
    create_internal_audit_event(
        db_session,
        actor,
        action="privacy.request_submitted",
        entity_type="privacy_request",
        entity_id=str(row.id),
        company_id=actor.company_id,
        details={
            "privacy_request_id": str(row.id),
            "request_type": row.request_type,
            "status": row.status,
        },
    )
    return PrivacyMeRequestResponse.model_validate(row)


def list_me_requests(
    db_session: Session,
    actor: User,
    *,
    limit: int,
    offset: int,
) -> list[PrivacyMeRequestResponse]:
    rows = list_privacy_requests_for_user(db_session, user_id=actor.id, limit=limit, offset=offset)
    return [PrivacyMeRequestResponse.model_validate(r) for r in rows]


def get_me_request(db_session: Session, actor: User, request_id: uuid.UUID) -> PrivacyMeRequestResponse:
    row = get_privacy_request(db_session, request_id)
    if row is None or row.user_id != actor.id:
        raise PrivacyNotFoundError()
    return PrivacyMeRequestResponse.model_validate(row)


def patch_me_request_cancel(
    db_session: Session,
    actor: User,
    request_id: uuid.UUID,
    _body: PrivacyMeRequestCancelRequest,
) -> PrivacyMeRequestResponse:
    row = get_privacy_request(db_session, request_id)
    if row is None or row.user_id != actor.id:
        raise PrivacyNotFoundError()
    if row.status != "submitted":
        raise PrivacyPermissionError("Only submitted requests can be cancelled.")
    row.status = "cancelled"
    row.updated_at = _now()
    save_privacy_request(db_session, row)
    create_internal_audit_event(
        db_session,
        actor,
        action="privacy.request_updated",
        entity_type="privacy_request",
        entity_id=str(row.id),
        company_id=_audit_company(actor, row),
        details={"privacy_request_id": str(row.id), "status": row.status},
    )
    return PrivacyMeRequestResponse.model_validate(row)


def _ensure_management(actor: User) -> None:
    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise PrivacyPermissionError("You do not have permission.")


def _can_access_request_row(actor: User, row: PrivacyRequest) -> bool:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return True
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            return False
        return row.company_id == actor.company_id
    return row.user_id == actor.id


def list_management_requests(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    limit: int,
    offset: int,
) -> list[PrivacyAdminRequestListItem]:
    _ensure_management(actor)
    if actor.system_role == SystemRole.ADMIN:
        rows = list_privacy_requests_for_management(
            db_session,
            company_id=actor.company_id,
            include_all_companies=False,
            limit=limit,
            offset=offset,
        )
    else:
        rows = list_privacy_requests_for_management(
            db_session,
            company_id=company_id,
            include_all_companies=company_id is None,
            limit=limit,
            offset=offset,
        )
    out: list[PrivacyAdminRequestListItem] = []
    for r in rows:
        u = get_user_by_id(db_session, r.user_id)
        email = u.email if u is not None else ""
        prof = get_employee_profile_by_user_id(db_session, r.user_id)
        out.append(
            PrivacyAdminRequestListItem(
                id=r.id,
                company_id=r.company_id,
                user_id=r.user_id,
                user_email=email,
                requester_display=_requester_display(prof, email),
                request_type=r.request_type,
                status=r.status,
                subject=r.subject,
                submitted_at=r.submitted_at,
                updated_at=r.updated_at,
            ),
        )
    return out


def get_management_request_detail(
    db_session: Session,
    actor: User,
    request_id: uuid.UUID,
) -> PrivacyAdminRequestDetailResponse:
    _ensure_management(actor)
    row = get_privacy_request(db_session, request_id)
    if row is None or not _can_access_request_row(actor, row):
        raise PrivacyNotFoundError()
    u = get_user_by_id(db_session, row.user_id)
    email = u.email if u is not None else ""
    prof = get_employee_profile_by_user_id(db_session, row.user_id)
    data = PrivacyMeRequestResponse.model_validate(row).model_dump()
    data["user_email"] = email
    data["requester_display"] = _requester_display(prof, email)
    return PrivacyAdminRequestDetailResponse(**data)


def patch_management_request(
    db_session: Session,
    actor: User,
    request_id: uuid.UUID,
    body: PrivacyAdminRequestPatchRequest,
) -> PrivacyAdminRequestDetailResponse:
    _ensure_management(actor)
    row = get_privacy_request(db_session, request_id)
    if row is None or not _can_access_request_row(actor, row):
        raise PrivacyNotFoundError()
    prev = row.status
    if body.status is not None:
        row.status = body.status
        if body.status in ("completed", "rejected"):
            row.completed_at = _now()
        elif body.status == "in_review":
            row.completed_at = None
    if body.admin_response is not None:
        row.admin_response = body.admin_response
    row.handled_by_user_id = actor.id
    row.updated_at = _now()
    save_privacy_request(db_session, row)
    create_internal_audit_event(
        db_session,
        actor,
        action="privacy.request_updated",
        entity_type="privacy_request",
        entity_id=str(row.id),
        company_id=_audit_company(actor, row),
        details={
            "privacy_request_id": str(row.id),
            "status": row.status,
            "previous_status": prev,
        },
    )
    return get_management_request_detail(db_session, actor, request_id)


def close_management_request(db_session: Session, actor: User, request_id: uuid.UUID) -> PrivacyAdminRequestDetailResponse:
    _ensure_management(actor)
    row = get_privacy_request(db_session, request_id)
    if row is None or not _can_access_request_row(actor, row):
        raise PrivacyNotFoundError()
    if row.status in ("completed", "rejected", "cancelled"):
        raise PrivacyPermissionError("Request is already closed.")
    row.status = "completed"
    row.completed_at = _now()
    row.handled_by_user_id = actor.id
    row.updated_at = _now()
    save_privacy_request(db_session, row)
    create_internal_audit_event(
        db_session,
        actor,
        action="privacy.request_closed",
        entity_type="privacy_request",
        entity_id=str(row.id),
        company_id=_audit_company(actor, row),
        details={"privacy_request_id": str(row.id), "status": row.status},
    )
    return get_management_request_detail(db_session, actor, request_id)
