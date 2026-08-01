"""Toolbox Talks delete/void/bulk-assignment safety (PostgreSQL)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db import models as _models  # noqa: F401
from app.modules.audit.models import AuditEvent
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.site_access.models import EmployeeLocationAccess
from app.modules.toolbox_talks.models import ToolboxTalk, ToolboxTalkAttendee
from app.modules.toolbox_talks.schemas import (
    ToolboxTalkAttendeesAddRequest,
    ToolboxTalkBulkAttendeesRequest,
    ToolboxTalkCreateRequest,
    ToolboxTalkVoidRequest,
)
from app.modules.toolbox_talks.service import (
    ToolboxTalkPermissionError,
    ToolboxTalkValidationError,
    add_attendees,
    bulk_add_attendees,
    complete_talk,
    create_talk,
    delete_talk_hard,
    list_talks_me,
    preview_bulk_attendees,
    publish_talk,
    remove_attendee,
    sign_talk,
    void_talk,
)
from app.modules.toolbox_talks.schemas import ToolboxTalkSignRequest

LOCAL_ADMIN_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
DB_NAME = "timiq_toolbox_talks_safety_it"


def _local_postgres_available() -> bool:
    try:
        eng = create_engine(LOCAL_ADMIN_URL, isolation_level="AUTOCOMMIT")
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _local_postgres_available(),
    reason="Local Postgres required for Toolbox Talks safety tests",
)


@pytest.fixture()
def db_session() -> Session:
    admin = create_engine(LOCAL_ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :n"),
            {"n": DB_NAME},
        ).scalar()
        if exists:
            conn.execute(text(f'DROP DATABASE "{DB_NAME}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{DB_NAME}"'))

    target_url = f"postgresql+psycopg://postgres:postgres@127.0.0.1:5432/{DB_NAME}"
    engine = create_engine(target_url)
    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE "{DB_NAME}" WITH (FORCE)'))
        admin.dispose()


def _user(
    *,
    company_id: uuid.UUID | None,
    role: SystemRole,
    email: str | None = None,
    active: bool = True,
) -> User:
    return User(
        id=uuid.uuid4(),
        email=email or f"{uuid.uuid4().hex[:8]}@ex.com",
        password_hash="x",
        system_role=role,
        company_id=company_id,
        is_active=active,
    )


def _seed(session: Session) -> dict:
    company = Company(id=uuid.uuid4(), name=f"TT Co {uuid.uuid4().hex[:6]}", is_active=True)
    other = Company(id=uuid.uuid4(), name=f"Other {uuid.uuid4().hex[:6]}", is_active=True)
    admin = _user(company_id=company.id, role=SystemRole.ADMIN)
    administrator = _user(company_id=None, role=SystemRole.ADMINISTRATOR)
    emp1 = _user(company_id=company.id, role=SystemRole.EMPLOYEE)
    emp2 = _user(company_id=company.id, role=SystemRole.EMPLOYEE)
    emp3 = _user(company_id=company.id, role=SystemRole.EMPLOYEE)
    inactive = _user(company_id=company.id, role=SystemRole.EMPLOYEE, active=False)
    other_emp = _user(company_id=other.id, role=SystemRole.EMPLOYEE)
    location = Location(
        id=uuid.uuid4(),
        company_id=company.id,
        name="Site A",
        address="1 Road",
        latitude=51.5,
        longitude=-0.1,
        geofence_radius_meters=100,
        is_active=True,
    )
    session.add_all([company, other])
    session.flush()
    session.add_all([admin, administrator, emp1, emp2, emp3, inactive, other_emp, location])
    session.flush()
    for emp in (emp1, emp2, emp3, inactive, other_emp):
        session.add(
            EmployeeProfile(
                user_id=emp.id,
                company_id=emp.company_id,
                first_name="T",
                last_name="E",
            )
        )
    session.add(EmployeeLocationAccess(user_id=emp1.id, location_id=location.id))
    session.add(EmployeeLocationAccess(user_id=emp2.id, location_id=location.id))
    session.add(EmployeeLocationAccess(user_id=inactive.id, location_id=location.id))
    session.commit()
    return {
        "company": company,
        "other": other,
        "admin": admin,
        "administrator": administrator,
        "emp1": emp1,
        "emp2": emp2,
        "emp3": emp3,
        "inactive": inactive,
        "other_emp": other_emp,
        "location": location,
    }


def _create_draft(session: Session, admin: User, company_id: uuid.UUID, **kwargs) -> ToolboxTalk:
    detail = create_talk(
        session,
        admin,
        ToolboxTalkCreateRequest(
            company_id=company_id,
            title=kwargs.get("title", "Safety brief"),
            topic="ppe",
            talk_body="Wear PPE at all times.",
            location_id=kwargs.get("location_id"),
            scheduled_date=date(2026, 8, 1),
        ),
    )
    talk = session.get(ToolboxTalk, detail.id)
    assert talk is not None
    return talk


def test_authorised_draft_delete_with_pending_attendees(db_session: Session) -> None:
    world = _seed(db_session)
    talk = _create_draft(db_session, world["admin"], world["company"].id)
    add_attendees(
        db_session,
        world["admin"],
        talk.id,
        ToolboxTalkAttendeesAddRequest(user_ids=[world["emp1"].id]),
    )
    delete_talk_hard(db_session, world["admin"], talk.id)
    assert db_session.get(ToolboxTalk, talk.id) is None
    assert list(db_session.scalars(select(ToolboxTalkAttendee).where(ToolboxTalkAttendee.talk_id == talk.id))) == []
    events = list(
        db_session.scalars(select(AuditEvent).where(AuditEvent.action == "toolbox_talk.deleted")).all()
    )
    assert len(events) == 1
    assert events[0].details.get("pending_attendee_count") == 1


def test_delete_blocked_for_signed_or_declined_or_non_draft(db_session: Session) -> None:
    world = _seed(db_session)
    talk = _create_draft(db_session, world["admin"], world["company"].id)
    add_attendees(
        db_session,
        world["admin"],
        talk.id,
        ToolboxTalkAttendeesAddRequest(user_ids=[world["emp1"].id, world["emp2"].id]),
    )
    publish_talk(db_session, world["admin"], talk.id)
    # Decline creates evidence
    from app.modules.toolbox_talks.schemas import ToolboxTalkDeclineRequest
    from app.modules.toolbox_talks.service import decline_talk

    decline_talk(
        db_session,
        world["emp2"],
        talk.id,
        ToolboxTalkDeclineRequest(reason="Cannot attend today"),
    )
    talk_row = db_session.get(ToolboxTalk, talk.id)
    assert talk_row is not None
    talk_row.status = "draft"
    db_session.commit()
    with pytest.raises(ToolboxTalkValidationError, match="compliance"):
        delete_talk_hard(db_session, world["admin"], talk.id)

    talk2 = _create_draft(db_session, world["admin"], world["company"].id)
    publish_talk(db_session, world["admin"], talk2.id)
    with pytest.raises(ToolboxTalkValidationError, match="Only draft"):
        delete_talk_hard(db_session, world["admin"], talk2.id)


def test_employee_and_cross_company_delete_forbidden(db_session: Session) -> None:
    world = _seed(db_session)
    talk = _create_draft(db_session, world["admin"], world["company"].id)
    with pytest.raises(ToolboxTalkPermissionError):
        delete_talk_hard(db_session, world["emp1"], talk.id)
    other_admin = _user(company_id=world["other"].id, role=SystemRole.ADMIN)
    db_session.add(other_admin)
    db_session.commit()
    from app.modules.toolbox_talks.service import ToolboxTalkNotFoundError

    with pytest.raises(ToolboxTalkNotFoundError):
        delete_talk_hard(db_session, other_admin, talk.id)


def test_delete_audit_failure_rolls_back(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    world = _seed(db_session)
    talk = _create_draft(db_session, world["admin"], world["company"].id)
    talk_id = talk.id

    def _boom(*_a, **_k):
        raise RuntimeError("audit failed")

    monkeypatch.setattr(
        "app.modules.toolbox_talks.service.create_internal_audit_event",
        _boom,
    )
    with pytest.raises(RuntimeError, match="audit failed"):
        delete_talk_hard(db_session, world["admin"], talk_id)
    assert db_session.get(ToolboxTalk, talk_id) is not None


def test_void_published_preserves_signatures_and_blocks_further_actions(db_session: Session) -> None:
    world = _seed(db_session)
    talk = _create_draft(
        db_session,
        world["admin"],
        world["company"].id,
        location_id=world["location"].id,
    )
    add_attendees(
        db_session,
        world["admin"],
        talk.id,
        ToolboxTalkAttendeesAddRequest(user_ids=[world["emp1"].id, world["emp2"].id]),
    )
    publish_talk(db_session, world["admin"], talk.id)

    # Minimal valid PNG data URL for sign
    tiny_png = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    signed = sign_talk(
        db_session,
        world["emp1"],
        talk.id,
        ToolboxTalkSignRequest(
            attended_ack=True,
            signature_name="Emp One",
            signature_image_data=tiny_png,
        ),
    )
    att_before = next(a for a in signed.attendees if a.user_id == world["emp1"].id)
    assert att_before.status == "signed"
    assert att_before.signature_name == "Emp One"
    signed_at = att_before.signed_at

    voided = void_talk(
        db_session,
        world["admin"],
        talk.id,
        ToolboxTalkVoidRequest(reason="Incorrect safety instructions"),
    )
    assert voided.status == "voided"
    assert voided.void_reason == "Incorrect safety instructions"
    assert voided.voided_at is not None
    att_after = next(a for a in voided.attendees if a.user_id == world["emp1"].id)
    assert att_after.status == "signed"
    assert att_after.signature_name == "Emp One"
    assert att_after.signed_at == signed_at
    assert len(voided.attendees) == 2

    mine = list_talks_me(db_session, world["emp2"])
    assert any(t.id == talk.id and t.status == "voided" for t in mine)
    # Pending list excludes voided (emp2 still pending but talk not published)
    from app.modules.toolbox_talks import repository as tt_repo

    assert tt_repo.count_pending_sign_for_user(db_session, world["emp2"].id) == 0

    with pytest.raises(ToolboxTalkValidationError):
        add_attendees(
            db_session,
            world["admin"],
            talk.id,
            ToolboxTalkAttendeesAddRequest(user_ids=[world["emp3"].id]),
        )
    with pytest.raises(ToolboxTalkValidationError):
        sign_talk(
            db_session,
            world["emp2"],
            talk.id,
            ToolboxTalkSignRequest(
                attended_ack=True,
                signature_name="Emp Two",
                signature_image_data=tiny_png,
            ),
        )
    with pytest.raises(ToolboxTalkValidationError, match="already voided"):
        void_talk(
            db_session,
            world["admin"],
            talk.id,
            ToolboxTalkVoidRequest(reason="Again"),
        )
    with pytest.raises(ToolboxTalkValidationError, match="Only draft"):
        delete_talk_hard(db_session, world["admin"], talk.id)


def test_void_reason_required_and_cross_company_blocked(db_session: Session) -> None:
    world = _seed(db_session)
    talk = _create_draft(db_session, world["admin"], world["company"].id)
    publish_talk(db_session, world["admin"], talk.id)
    with pytest.raises(Exception):
        void_talk(db_session, world["admin"], talk.id, ToolboxTalkVoidRequest(reason="   "))
    other_admin = _user(company_id=world["other"].id, role=SystemRole.ADMIN)
    db_session.add(other_admin)
    db_session.commit()
    from app.modules.toolbox_talks.service import ToolboxTalkNotFoundError

    with pytest.raises(ToolboxTalkNotFoundError):
        void_talk(
            db_session,
            other_admin,
            talk.id,
            ToolboxTalkVoidRequest(reason="Wrong company"),
        )


def test_void_audit_failure_rolls_back(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    world = _seed(db_session)
    talk = _create_draft(db_session, world["admin"], world["company"].id)
    publish_talk(db_session, world["admin"], talk.id)

    def _boom(*_a, **_k):
        raise RuntimeError("void audit failed")

    monkeypatch.setattr(
        "app.modules.toolbox_talks.service.create_internal_audit_event",
        _boom,
    )
    with pytest.raises(RuntimeError, match="void audit failed"):
        void_talk(
            db_session,
            world["admin"],
            talk.id,
            ToolboxTalkVoidRequest(reason="Mistake"),
        )
    refreshed = db_session.get(ToolboxTalk, talk.id)
    assert refreshed is not None
    assert refreshed.status == "published"
    assert refreshed.voided_at is None


def test_company_bulk_assignment_eligibility_and_idempotency(db_session: Session) -> None:
    world = _seed(db_session)
    talk = _create_draft(db_session, world["admin"], world["company"].id)  # no site
    add_attendees(
        db_session,
        world["admin"],
        talk.id,
        ToolboxTalkAttendeesAddRequest(user_ids=[world["emp1"].id]),
    )
    preview = preview_bulk_attendees(db_session, world["admin"], talk.id, scope="company")
    assert preview.total_eligible == 3  # emp1, emp2, emp3 active employees
    assert preview.already_assigned == 1
    assert preview.will_add == 2

    result = bulk_add_attendees(
        db_session,
        world["admin"],
        talk.id,
        ToolboxTalkBulkAttendeesRequest(scope="company"),
    )
    assert result.scope == "company"
    assert result.added == 2
    assert result.skipped_already_assigned == 1
    assert result.total_eligible == 3

    attendees = list(
        db_session.scalars(select(ToolboxTalkAttendee).where(ToolboxTalkAttendee.talk_id == talk.id)).all()
    )
    user_ids = {a.user_id for a in attendees}
    assert world["emp1"].id in user_ids
    assert world["emp2"].id in user_ids
    assert world["emp3"].id in user_ids
    assert world["inactive"].id not in user_ids
    assert world["admin"].id not in user_ids
    assert world["other_emp"].id not in user_ids

    again = bulk_add_attendees(
        db_session,
        world["admin"],
        talk.id,
        ToolboxTalkBulkAttendeesRequest(scope="company"),
    )
    assert again.added == 0
    assert again.skipped_already_assigned == 3
    assert len(attendees) == 3 or len(
        list(db_session.scalars(select(ToolboxTalkAttendee).where(ToolboxTalkAttendee.talk_id == talk.id)).all())
    ) == 3

    events = list(
        db_session.scalars(
            select(AuditEvent).where(AuditEvent.action == "toolbox_talk.attendees_bulk_added")
        ).all()
    )
    assert len(events) == 2


def test_site_bulk_assignment_and_no_site_error(db_session: Session) -> None:
    world = _seed(db_session)
    no_site = _create_draft(db_session, world["admin"], world["company"].id)
    with pytest.raises(ToolboxTalkValidationError, match="location"):
        bulk_add_attendees(
            db_session,
            world["admin"],
            no_site.id,
            ToolboxTalkBulkAttendeesRequest(scope="site"),
        )

    talk = _create_draft(
        db_session,
        world["admin"],
        world["company"].id,
        location_id=world["location"].id,
    )
    result = bulk_add_attendees(
        db_session,
        world["admin"],
        talk.id,
        ToolboxTalkBulkAttendeesRequest(scope="site"),
    )
    assert result.scope == "site"
    assert result.site_id == world["location"].id
    assert result.added == 2  # emp1, emp2 site access; inactive excluded
    ids = {
        a.user_id
        for a in db_session.scalars(
            select(ToolboxTalkAttendee).where(ToolboxTalkAttendee.talk_id == talk.id)
        ).all()
    }
    assert world["emp1"].id in ids
    assert world["emp2"].id in ids
    assert world["emp3"].id not in ids
    assert world["inactive"].id not in ids


def test_bulk_audit_failure_rolls_back(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    world = _seed(db_session)
    talk = _create_draft(db_session, world["admin"], world["company"].id)

    def _boom(*_a, **_k):
        raise RuntimeError("bulk audit failed")

    monkeypatch.setattr(
        "app.modules.toolbox_talks.service.create_internal_audit_event",
        _boom,
    )
    with pytest.raises(RuntimeError, match="bulk audit failed"):
        bulk_add_attendees(
            db_session,
            world["admin"],
            talk.id,
            ToolboxTalkBulkAttendeesRequest(scope="company"),
        )
    assert (
        list(db_session.scalars(select(ToolboxTalkAttendee).where(ToolboxTalkAttendee.talk_id == talk.id)).all())
        == []
    )


def test_completed_and_archived_block_assignment_and_removal(db_session: Session) -> None:
    world = _seed(db_session)
    talk = _create_draft(db_session, world["admin"], world["company"].id)
    add_attendees(
        db_session,
        world["admin"],
        talk.id,
        ToolboxTalkAttendeesAddRequest(user_ids=[world["emp1"].id]),
    )
    publish_talk(db_session, world["admin"], talk.id)
    complete_talk(db_session, world["admin"], talk.id)

    with pytest.raises(ToolboxTalkValidationError):
        add_attendees(
            db_session,
            world["admin"],
            talk.id,
            ToolboxTalkAttendeesAddRequest(user_ids=[world["emp2"].id]),
        )
    with pytest.raises(ToolboxTalkValidationError):
        bulk_add_attendees(
            db_session,
            world["admin"],
            talk.id,
            ToolboxTalkBulkAttendeesRequest(scope="company"),
        )
    with pytest.raises(ToolboxTalkValidationError):
        remove_attendee(db_session, world["admin"], talk.id, world["emp1"].id)

    talk2 = _create_draft(db_session, world["admin"], world["company"].id)
    add_attendees(
        db_session,
        world["admin"],
        talk2.id,
        ToolboxTalkAttendeesAddRequest(user_ids=[world["emp1"].id]),
    )
    publish_talk(db_session, world["admin"], talk2.id)
    from app.modules.toolbox_talks.service import archive_talk

    archive_talk(db_session, world["admin"], talk2.id)
    with pytest.raises(ToolboxTalkValidationError):
        add_attendees(
            db_session,
            world["admin"],
            talk2.id,
            ToolboxTalkAttendeesAddRequest(user_ids=[world["emp2"].id]),
        )


def test_pending_removable_signed_not_removable_on_published(db_session: Session) -> None:
    world = _seed(db_session)
    talk = _create_draft(db_session, world["admin"], world["company"].id)
    add_attendees(
        db_session,
        world["admin"],
        talk.id,
        ToolboxTalkAttendeesAddRequest(user_ids=[world["emp1"].id, world["emp2"].id]),
    )
    publish_talk(db_session, world["admin"], talk.id)
    remove_attendee(db_session, world["admin"], talk.id, world["emp2"].id)
    assert (
        db_session.scalars(
            select(ToolboxTalkAttendee).where(
                ToolboxTalkAttendee.talk_id == talk.id,
                ToolboxTalkAttendee.user_id == world["emp2"].id,
            )
        ).first()
        is None
    )

    tiny_png = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    sign_talk(
        db_session,
        world["emp1"],
        talk.id,
        ToolboxTalkSignRequest(
            attended_ack=True,
            signature_name="Emp One",
            signature_image_data=tiny_png,
        ),
    )
    with pytest.raises(ToolboxTalkValidationError, match="pending"):
        remove_attendee(db_session, world["admin"], talk.id, world["emp1"].id)
