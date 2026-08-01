"""RAMS bulk acknowledgement assignment safety (PostgreSQL)."""

from __future__ import annotations

import uuid
from datetime import date

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
from app.modules.rams.models import RamsAcknowledgement, RamsAssessment
from app.modules.rams.schemas import (
    RamsAcknowledgementsAddRequest,
    RamsAssessmentCreateRequest,
    RamsBulkAcknowledgementsRequest,
)
from app.modules.rams.service import (
    RamsValidationError,
    add_acknowledgements,
    bulk_add_acknowledgements,
    create_assessment,
    preview_bulk_acknowledgements,
    publish_assessment,
    review_assessment,
    archive_assessment,
)
from app.modules.site_access.models import EmployeeLocationAccess

LOCAL_ADMIN_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
DB_NAME = "timiq_rams_bulk_assign_it"


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
    reason="Local Postgres required for RAMS bulk assignment tests",
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
    company = Company(id=uuid.uuid4(), name=f"RAMS Co {uuid.uuid4().hex[:6]}", is_active=True)
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
                first_name="R",
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


def _create_draft(session: Session, admin: User, company_id: uuid.UUID, **kwargs) -> RamsAssessment:
    detail = create_assessment(
        session,
        admin,
        RamsAssessmentCreateRequest(
            company_id=company_id,
            title=kwargs.get("title", "Site RAMS"),
            work_activity="Brickwork",
            location_id=kwargs.get("location_id"),
            risk_level="medium",
            review_due_date=date(2026, 8, 1),
            no_special_ppe=True,
        ),
    )
    row = session.get(RamsAssessment, detail.id)
    assert row is not None
    return row


def test_company_bulk_assignment_eligibility_and_idempotency(db_session: Session) -> None:
    world = _seed(db_session)
    row = _create_draft(db_session, world["admin"], world["company"].id)
    add_acknowledgements(
        db_session,
        world["admin"],
        row.id,
        RamsAcknowledgementsAddRequest(user_ids=[world["emp1"].id]),
    )
    preview = preview_bulk_acknowledgements(db_session, world["admin"], row.id, scope="company")
    assert preview.total_eligible == 3
    assert preview.already_assigned == 1
    assert preview.will_add == 2

    result = bulk_add_acknowledgements(
        db_session,
        world["admin"],
        row.id,
        RamsBulkAcknowledgementsRequest(scope="company"),
    )
    assert result.scope == "company"
    assert result.added == 2
    assert result.skipped_already_assigned == 1
    assert result.total_eligible == 3

    acks = list(
        db_session.scalars(select(RamsAcknowledgement).where(RamsAcknowledgement.assessment_id == row.id)).all()
    )
    user_ids = {a.user_id for a in acks}
    assert world["emp1"].id in user_ids
    assert world["emp2"].id in user_ids
    assert world["emp3"].id in user_ids
    assert world["inactive"].id not in user_ids
    assert world["admin"].id not in user_ids
    assert world["other_emp"].id not in user_ids

    again = bulk_add_acknowledgements(
        db_session,
        world["admin"],
        row.id,
        RamsBulkAcknowledgementsRequest(scope="company"),
    )
    assert again.added == 0
    assert again.skipped_already_assigned == 3
    assert (
        len(
            list(
                db_session.scalars(
                    select(RamsAcknowledgement).where(RamsAcknowledgement.assessment_id == row.id)
                ).all()
            )
        )
        == 3
    )

    events = list(
        db_session.scalars(
            select(AuditEvent).where(AuditEvent.action == "rams.acknowledgements_bulk_added")
        ).all()
    )
    assert len(events) == 2


def test_site_bulk_assignment_and_no_site_error(db_session: Session) -> None:
    world = _seed(db_session)
    no_site = _create_draft(db_session, world["admin"], world["company"].id)
    with pytest.raises(RamsValidationError, match="location"):
        bulk_add_acknowledgements(
            db_session,
            world["admin"],
            no_site.id,
            RamsBulkAcknowledgementsRequest(scope="site"),
        )

    row = _create_draft(
        db_session,
        world["admin"],
        world["company"].id,
        location_id=world["location"].id,
    )
    assert row.location_id == world["location"].id
    result = bulk_add_acknowledgements(
        db_session,
        world["admin"],
        row.id,
        RamsBulkAcknowledgementsRequest(scope="site"),
    )
    assert result.scope == "site"
    assert result.site_id == world["location"].id
    assert result.added == 2
    ids = {
        a.user_id
        for a in db_session.scalars(
            select(RamsAcknowledgement).where(RamsAcknowledgement.assessment_id == row.id)
        ).all()
    }
    assert world["emp1"].id in ids
    assert world["emp2"].id in ids
    assert world["emp3"].id not in ids
    assert world["inactive"].id not in ids


def test_bulk_audit_failure_rolls_back(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    world = _seed(db_session)
    row = _create_draft(db_session, world["admin"], world["company"].id)

    def _boom(*_a, **_k):
        raise RuntimeError("bulk audit failed")

    monkeypatch.setattr(
        "app.modules.rams.service.create_internal_audit_event",
        _boom,
    )
    with pytest.raises(RuntimeError, match="bulk audit failed"):
        bulk_add_acknowledgements(
            db_session,
            world["admin"],
            row.id,
            RamsBulkAcknowledgementsRequest(scope="company"),
        )
    assert (
        list(
            db_session.scalars(
                select(RamsAcknowledgement).where(RamsAcknowledgement.assessment_id == row.id)
            ).all()
        )
        == []
    )


def test_reviewed_and_archived_block_assignment(db_session: Session) -> None:
    world = _seed(db_session)
    row = _create_draft(db_session, world["admin"], world["company"].id)
    add_acknowledgements(
        db_session,
        world["admin"],
        row.id,
        RamsAcknowledgementsAddRequest(user_ids=[world["emp1"].id]),
    )
    # Template publish needs a hazard — set status via service path used by uploaded/template
    from app.modules.rams.schemas import RamsHazardCreateRequest
    from app.modules.rams.service import create_hazard

    create_hazard(
        db_session,
        world["admin"],
        row.id,
        RamsHazardCreateRequest(
            hazard="Falls",
            who_might_be_harmed="Workers",
            initial_likelihood=3,
            initial_severity=3,
            control_measures="Scaffold",
            residual_likelihood=2,
            residual_severity=2,
        ),
    )
    publish_assessment(db_session, world["admin"], row.id)
    review_assessment(db_session, world["admin"], row.id)

    with pytest.raises(RamsValidationError):
        add_acknowledgements(
            db_session,
            world["admin"],
            row.id,
            RamsAcknowledgementsAddRequest(user_ids=[world["emp2"].id]),
        )
    with pytest.raises(RamsValidationError):
        bulk_add_acknowledgements(
            db_session,
            world["admin"],
            row.id,
            RamsBulkAcknowledgementsRequest(scope="company"),
        )

    row2 = _create_draft(db_session, world["admin"], world["company"].id)
    create_hazard(
        db_session,
        world["admin"],
        row2.id,
        RamsHazardCreateRequest(
            hazard="Cuts",
            who_might_be_harmed="Workers",
            initial_likelihood=2,
            initial_severity=2,
            control_measures="Gloves",
            residual_likelihood=1,
            residual_severity=1,
        ),
    )
    publish_assessment(db_session, world["admin"], row2.id)
    archive_assessment(db_session, world["admin"], row2.id)
    with pytest.raises(RamsValidationError):
        bulk_add_acknowledgements(
            db_session,
            world["admin"],
            row2.id,
            RamsBulkAcknowledgementsRequest(scope="company"),
        )


def test_individual_assignment_still_works(db_session: Session) -> None:
    world = _seed(db_session)
    row = _create_draft(db_session, world["admin"], world["company"].id)
    detail = add_acknowledgements(
        db_session,
        world["admin"],
        row.id,
        RamsAcknowledgementsAddRequest(user_ids=[world["emp1"].id]),
    )
    assert any(a.user_id == world["emp1"].id for a in detail.acknowledgements)
