from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.locations.repository import get_location_by_id
from app.modules.site_access.repository import list_site_access_for_user
from app.modules.smart_forms.models import SmartFormSubmission, SmartFormTemplate
from app.modules.smart_forms import repository as sf_repo
from app.modules.smart_forms.schema_validate import (
    SchemaValidationError,
    assert_known_category,
    assert_known_submission_status,
    assert_known_template_status,
    validate_answers_against_schema,
    validate_template_schema,
)
from app.modules.smart_forms.schemas import (
    SmartFormReviewQueueItem,
    SmartFormReviewRequest,
    SmartFormSubmissionCreateRequest,
    SmartFormSubmissionPatchRequest,
    SmartFormSubmissionResponse,
    SmartFormSubmissionWithTemplateResponse,
    SmartFormTemplateCreateRequest,
    SmartFormTemplatePatchRequest,
    SmartFormTemplateResponse,
)


class SmartFormError(Exception):
    pass


class SmartFormNotFoundError(SmartFormError):
    pass


class SmartFormPermissionError(SmartFormError):
    pass


class SmartFormValidationError(SmartFormError):
    pass


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _submitter_company_id(user: User) -> uuid.UUID:
    if user.company_id is None:
        raise SmartFormValidationError("Your account is not linked to a company.")
    return user.company_id


def _display_name_for_user(db: Session, user_id: uuid.UUID) -> str | None:
    profile = get_employee_profile_by_user_id(db, user_id)
    if profile is None:
        return None
    first = (profile.first_name or "").strip()
    last = (profile.last_name or "").strip()
    name = f"{first} {last}".strip()
    return name or None


def _allowed_location_ids(db: Session, user: User) -> set[uuid.UUID]:
    if user.company_id is None:
        return set()
    allowed: set[uuid.UUID] = set()
    for access in list_site_access_for_user(db, user.id):
        loc = get_location_by_id(db, access.location_id)
        if loc is None or not loc.is_active:
            continue
        if loc.company_id != user.company_id:
            continue
        allowed.add(access.location_id)
    return allowed


def _validate_location_choice(
    db: Session,
    *,
    user: User,
    company_id: uuid.UUID,
    location_id: uuid.UUID | None,
    required: bool,
) -> None:
    if not required:
        if location_id is None:
            return
    else:
        if location_id is None:
            raise SmartFormValidationError("location_id is required for this template.")

    assert location_id is not None
    loc = get_location_by_id(db, location_id)
    if loc is None or loc.company_id != company_id:
        raise SmartFormValidationError("Location is not valid for your company.")
    if user.system_role == SystemRole.EMPLOYEE:
        allowed = _allowed_location_ids(db, user)
        if location_id not in allowed:
            raise SmartFormPermissionError("You do not have access to this location.")


def _submitter_can_fill_template(user: User, template: SmartFormTemplate) -> bool:
    """Active template visible to the user's company (including global)."""
    if user.company_id is None:
        return False
    if template.status != "active":
        return False
    if template.company_id is None:
        return True
    return template.company_id == user.company_id


def _admin_can_manage_template(user: User, template: SmartFormTemplate) -> bool:
    if user.system_role != SystemRole.ADMIN:
        return False
    if user.company_id is None:
        return False
    if template.company_id is None:
        return False
    return template.company_id == user.company_id


def _administrator_can_manage_template(_user: User, _template: SmartFormTemplate) -> bool:
    return True


def _can_view_template(actor: User, template: SmartFormTemplate) -> bool:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return True
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            return False
        return template.company_id is None or template.company_id == actor.company_id
    if actor.company_id is None:
        return False
    return _submitter_can_fill_template(actor, template)


def _template_to_response(row: SmartFormTemplate) -> SmartFormTemplateResponse:
    return SmartFormTemplateResponse.model_validate(row)


def _submission_to_response(row: SmartFormSubmission) -> SmartFormSubmissionResponse:
    return SmartFormSubmissionResponse.model_validate(row)


def list_templates(db: Session, actor: User) -> list[SmartFormTemplateResponse]:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        rows = sf_repo.list_all_templates_administrator(db)
        return [_template_to_response(r) for r in rows]
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            return []
        rows = sf_repo.list_templates_for_company_scope(
            db,
            company_id=actor.company_id,
            include_global=True,
            statuses=None,
        )
        return [_template_to_response(r) for r in rows]
    # employee
    if actor.company_id is None:
        return []
    rows = sf_repo.list_templates_for_company_scope(
        db,
        company_id=actor.company_id,
        include_global=True,
        statuses=["active"],
    )
    return [_template_to_response(r) for r in rows]


def get_template(db: Session, actor: User, template_id: uuid.UUID) -> SmartFormTemplateResponse:
    row = sf_repo.get_template(db, template_id)
    if row is None:
        raise SmartFormNotFoundError()
    if not _can_view_template(actor, row):
        raise SmartFormNotFoundError()
    return _template_to_response(row)


def create_template(
    db: Session,
    actor: User,
    body: SmartFormTemplateCreateRequest,
) -> SmartFormTemplateResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise SmartFormPermissionError("Employees cannot create templates.")
    company_id = body.company_id
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise SmartFormValidationError("Your account is not linked to a company.")
        if company_id is not None and company_id != actor.company_id:
            raise SmartFormPermissionError("You cannot create templates for another company.")
        company_id = actor.company_id
    elif actor.system_role == SystemRole.ADMINISTRATOR:
        pass  # company_id may be None (global)
    else:
        raise SmartFormPermissionError("You cannot create templates.")

    try:
        assert_known_category(body.category)
        assert_known_template_status(body.status)
        validate_template_schema(body.form_schema)
    except SchemaValidationError as exc:
        raise SmartFormValidationError(str(exc)) from exc

    now = _utc_now()
    row = SmartFormTemplate(
        company_id=company_id,
        name=body.name.strip(),
        description=body.description.strip() if body.description else None,
        category=body.category.strip(),
        status=body.status.strip(),
        version=1,
        schema_json=body.form_schema,
        requires_location=body.requires_location,
        requires_signature=body.requires_signature,
        allow_photos=body.allow_photos,
        created_by_user_id=actor.id,
        created_at=now,
        updated_at=now,
        archived_at=None,
    )
    sf_repo.save_template(db, row)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="smart_form.template_created",
        entity_type="smart_form_template",
        entity_id=str(row.id),
        company_id=row.company_id,
        details={
            "template_id": str(row.id),
            "category": row.category,
            "status": row.status,
            "actor_user_id": str(actor.id),
        },
    )
    return _template_to_response(row)


def _collect_changed_template_fields(
    row: SmartFormTemplate,
    body: SmartFormTemplatePatchRequest,
) -> list[str]:
    changed: list[str] = []
    if body.name is not None and body.name.strip() != row.name:
        changed.append("name")
    if body.description is not None and (body.description.strip() if body.description else None) != row.description:
        changed.append("description")
    if body.category is not None and body.category.strip() != row.category:
        changed.append("category")
    if body.status is not None and body.status.strip() != row.status:
        changed.append("status")
    if body.form_schema is not None and body.form_schema != row.schema_json:
        changed.append("schema_json")
    if body.requires_location is not None and body.requires_location != row.requires_location:
        changed.append("requires_location")
    if body.requires_signature is not None and body.requires_signature != row.requires_signature:
        changed.append("requires_signature")
    if body.allow_photos is not None and body.allow_photos != row.allow_photos:
        changed.append("allow_photos")
    return changed


def patch_template(
    db: Session,
    actor: User,
    template_id: uuid.UUID,
    body: SmartFormTemplatePatchRequest,
) -> SmartFormTemplateResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise SmartFormPermissionError("Employees cannot edit templates.")
    row = sf_repo.get_template(db, template_id)
    if row is None:
        raise SmartFormNotFoundError()
    if actor.system_role == SystemRole.ADMIN:
        if not _admin_can_manage_template(actor, row):
            raise SmartFormNotFoundError()
    elif actor.system_role == SystemRole.ADMINISTRATOR:
        if not _administrator_can_manage_template(actor, row):
            raise SmartFormNotFoundError()
    else:
        raise SmartFormPermissionError()

    prev_status = row.status
    changed = _collect_changed_template_fields(row, body)
    if body.category is not None:
        try:
            assert_known_category(body.category.strip())
        except SchemaValidationError as exc:
            raise SmartFormValidationError(str(exc)) from exc
    if body.status is not None:
        try:
            assert_known_template_status(body.status.strip())
        except SchemaValidationError as exc:
            raise SmartFormValidationError(str(exc)) from exc
    if body.form_schema is not None:
        try:
            validate_template_schema(body.form_schema)
        except SchemaValidationError as exc:
            raise SmartFormValidationError(str(exc)) from exc

    if body.name is not None:
        row.name = body.name.strip()
    if body.description is not None:
        row.description = body.description.strip() if body.description else None
    if body.category is not None:
        row.category = body.category.strip()
    if body.status is not None:
        row.status = body.status.strip()
        if row.status == "archived":
            row.archived_at = row.archived_at or _utc_now()
        else:
            row.archived_at = None
    if body.form_schema is not None:
        row.schema_json = body.form_schema
        row.version = row.version + 1
    if body.requires_location is not None:
        row.requires_location = body.requires_location
    if body.requires_signature is not None:
        row.requires_signature = body.requires_signature
    if body.allow_photos is not None:
        row.allow_photos = body.allow_photos
    row.updated_at = _utc_now()
    sf_repo.save_template(db, row)
    became_archived = prev_status != "archived" and row.status == "archived"
    audit_action = "smart_form.template_archived" if became_archived else "smart_form.template_updated"
    details: dict[str, Any] = {
        "template_id": str(row.id),
        "category": row.category,
        "status": row.status,
        "actor_user_id": str(actor.id),
    }
    if audit_action == "smart_form.template_updated":
        details["changed_fields"] = changed
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action=audit_action,
        entity_type="smart_form_template",
        entity_id=str(row.id),
        company_id=row.company_id,
        details=details,
    )
    return _template_to_response(row)


def archive_template(db: Session, actor: User, template_id: uuid.UUID) -> SmartFormTemplateResponse:
    return patch_template(db, actor, template_id, SmartFormTemplatePatchRequest(status="archived"))


def create_submission(
    db: Session,
    actor: User,
    template_id: uuid.UUID,
    body: SmartFormSubmissionCreateRequest,
) -> SmartFormSubmissionResponse:
    company_id = _submitter_company_id(actor)
    template = sf_repo.get_template(db, template_id)
    if template is None:
        raise SmartFormNotFoundError()
    if not _submitter_can_fill_template(actor, template):
        raise SmartFormNotFoundError()

    try:
        _validate_location_choice(
            db,
            user=actor,
            company_id=company_id,
            location_id=body.location_id,
            required=template.requires_location,
        )
    except SmartFormPermissionError:
        raise SmartFormNotFoundError() from None

    now = _utc_now()
    row = SmartFormSubmission(
        template_id=template.id,
        company_id=company_id,
        submitted_by_user_id=actor.id,
        location_id=body.location_id,
        status="draft",
        answers_json={},
        submitted_at=None,
        reviewed_by_user_id=None,
        reviewed_at=None,
        review_notes=None,
        signature_name=None,
        signature_image_path=None,
        created_at=now,
        updated_at=now,
    )
    sf_repo.save_submission(db, row)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="smart_form.submission_created",
        entity_type="smart_form_submission",
        entity_id=str(row.id),
        company_id=row.company_id,
        details={
            "template_id": str(template.id),
            "submission_id": str(row.id),
            "actor_user_id": str(actor.id),
            "status": row.status,
            "category": template.category,
        },
    )
    return _submission_to_response(row)


def _can_view_submission(db: Session, actor: User, row: SmartFormSubmission) -> bool:
    if row.submitted_by_user_id == actor.id:
        return True
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return True
    if actor.system_role == SystemRole.ADMIN:
        return actor.company_id is not None and row.company_id == actor.company_id
    return False


def get_submission(db: Session, actor: User, submission_id: uuid.UUID) -> SmartFormSubmissionWithTemplateResponse:
    row = sf_repo.get_submission(db, submission_id)
    if row is None:
        raise SmartFormNotFoundError()
    if not _can_view_submission(db, actor, row):
        raise SmartFormNotFoundError()
    template = sf_repo.get_template(db, row.template_id)
    if template is None:
        raise SmartFormNotFoundError()
    base = _submission_to_response(row)
    return SmartFormSubmissionWithTemplateResponse(
        **base.model_dump(),
        template_name=template.name,
        template_category=template.category,
    )


def list_my_submissions(db: Session, actor: User) -> list[SmartFormSubmissionWithTemplateResponse]:
    rows = sf_repo.list_submissions_for_user(db, actor.id)
    out: list[SmartFormSubmissionWithTemplateResponse] = []
    for row in rows:
        template = sf_repo.get_template(db, row.template_id)
        if template is None:
            continue
        base = _submission_to_response(row)
        out.append(
            SmartFormSubmissionWithTemplateResponse(
                **base.model_dump(),
                template_name=template.name,
                template_category=template.category,
            )
        )
    return out


def patch_submission(
    db: Session,
    actor: User,
    submission_id: uuid.UUID,
    body: SmartFormSubmissionPatchRequest,
) -> SmartFormSubmissionWithTemplateResponse:
    row = sf_repo.get_submission(db, submission_id)
    if row is None or row.submitted_by_user_id != actor.id:
        raise SmartFormNotFoundError()
    if row.status != "draft":
        raise SmartFormValidationError("Submitted forms cannot be edited.")

    template = sf_repo.get_template(db, row.template_id)
    if template is None:
        raise SmartFormNotFoundError()

    company_id = row.company_id
    if body.location_id is not None or template.requires_location:
        loc_id = body.location_id if body.location_id is not None else row.location_id
        try:
            _validate_location_choice(
                db,
                user=actor,
                company_id=company_id,
                location_id=loc_id,
                required=template.requires_location,
            )
        except SmartFormPermissionError:
            raise SmartFormNotFoundError() from None
        if body.location_id is not None:
            row.location_id = body.location_id

    merged_answers = dict(row.answers_json or {})
    if body.answers_json is not None:
        merged_answers.update(body.answers_json)
    try:
        validate_answers_against_schema(
            template.schema_json,
            merged_answers,
            require_all_required=False,
        )
    except SchemaValidationError as exc:
        raise SmartFormValidationError(str(exc)) from exc

    row.answers_json = merged_answers
    if body.signature_name is not None:
        row.signature_name = body.signature_name.strip() or None
    row.updated_at = _utc_now()
    sf_repo.save_submission(db, row)
    return get_submission(db, actor, row.id)


def submit_submission(db: Session, actor: User, submission_id: uuid.UUID) -> SmartFormSubmissionWithTemplateResponse:
    row = sf_repo.get_submission(db, submission_id)
    if row is None or row.submitted_by_user_id != actor.id:
        raise SmartFormNotFoundError()
    if row.status != "draft":
        raise SmartFormValidationError("This form has already been submitted.")
    template = sf_repo.get_template(db, row.template_id)
    if template is None or template.status != "active":
        raise SmartFormValidationError("This template is no longer available for submission.")

    try:
        _validate_location_choice(
            db,
            user=actor,
            company_id=row.company_id,
            location_id=row.location_id,
            required=template.requires_location,
        )
    except SmartFormPermissionError:
        raise SmartFormNotFoundError() from None

    try:
        validate_answers_against_schema(
            template.schema_json,
            row.answers_json or {},
            require_all_required=True,
        )
    except SchemaValidationError as exc:
        raise SmartFormValidationError(str(exc)) from exc

    if template.requires_signature:
        name = (row.signature_name or "").strip()
        if not name:
            raise SmartFormValidationError("signature_name is required for this template.")

    row.status = "submitted"
    row.submitted_at = _utc_now()
    row.updated_at = _utc_now()
    sf_repo.save_submission(db, row)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="smart_form.submission_submitted",
        entity_type="smart_form_submission",
        entity_id=str(row.id),
        company_id=row.company_id,
        details={
            "template_id": str(template.id),
            "submission_id": str(row.id),
            "actor_user_id": str(actor.id),
            "status": row.status,
            "category": template.category,
        },
    )
    return get_submission(db, actor, row.id)


def list_review_submissions_queue(
    db: Session,
    actor: User,
    *,
    status_filter: str | None,
    company_id_filter: uuid.UUID | None,
) -> list[SmartFormReviewQueueItem]:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise SmartFormPermissionError()
    company_scope: uuid.UUID | None
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            return []
        company_scope = actor.company_id
    else:
        company_scope = company_id_filter

    st = status_filter or "submitted"
    try:
        assert_known_submission_status(st)
    except SchemaValidationError as exc:
        raise SmartFormValidationError(str(exc)) from exc

    rows = sf_repo.list_submissions_for_review(db, company_id=company_scope, status_filter=st)
    items: list[SmartFormReviewQueueItem] = []
    for row in rows:
        template = sf_repo.get_template(db, row.template_id)
        if template is None:
            continue
        owner = get_user_by_id(db, row.submitted_by_user_id)
        loc = get_location_by_id(db, row.location_id) if row.location_id else None
        items.append(
            SmartFormReviewQueueItem(
                id=row.id,
                template_id=row.template_id,
                template_name=template.name,
                template_category=template.category,
                company_id=row.company_id,
                submitted_by_user_id=row.submitted_by_user_id,
                submitter_email=owner.email if owner else "",
                submitter_display=_display_name_for_user(db, row.submitted_by_user_id),
                location_id=row.location_id,
                location_name=loc.name if loc else None,
                status=row.status,
                submitted_at=row.submitted_at,
                updated_at=row.updated_at,
            )
        )
    return items


def review_submission(
    db: Session,
    actor: User,
    submission_id: uuid.UUID,
    body: SmartFormReviewRequest,
) -> SmartFormSubmissionWithTemplateResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise SmartFormPermissionError()
    row = sf_repo.get_submission(db, submission_id)
    if row is None:
        raise SmartFormNotFoundError()
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None or row.company_id != actor.company_id:
            raise SmartFormNotFoundError()
    if row.status != "submitted":
        raise SmartFormValidationError("Only submitted forms can be reviewed.")

    if body.decision == "rejected":
        notes = (body.review_notes or "").strip()
        if len(notes) < 1:
            raise SmartFormValidationError("Review notes are required when rejecting.")
        row.status = "rejected"
        action = "smart_form.submission_rejected"
    else:
        row.status = "reviewed"
        action = "smart_form.submission_reviewed"

    row.reviewed_by_user_id = actor.id
    row.reviewed_at = _utc_now()
    row.review_notes = body.review_notes.strip() if body.review_notes else None
    row.updated_at = _utc_now()
    sf_repo.save_submission(db, row)

    template = sf_repo.get_template(db, row.template_id)
    category = template.category if template else "unknown"
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action=action,
        entity_type="smart_form_submission",
        entity_id=str(row.id),
        company_id=row.company_id,
        details={
            "template_id": str(row.template_id),
            "submission_id": str(row.id),
            "actor_user_id": str(actor.id),
            "status": row.status,
            "category": category,
        },
    )
    return get_submission(db, actor, row.id)
