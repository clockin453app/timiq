"""Unit tests for Site Progress classification recovery helpers."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db import models as _models  # noqa: F401
from app.modules.audit.models import AuditEvent
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.work_progress.classification import CLASSIFIED_PROGRESS_STATUS
from app.modules.work_progress.models import WorkProgressAttachment, WorkProgressEntry
from app.modules.workplaces.models import Workplace
from scripts.recover_site_progress_classification import (
    _parse_level,
    gate_exact_18,
    scan_candidates,
)


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(_type, _compiler, **_kw):  # noqa: ANN001
    return "JSON"


def _session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    tables = [
        Company.__table__,
        User.__table__,
        EmployeeProfile.__table__,
        Workplace.__table__,
        Location.__table__,
        WorkProgressEntry.__table__,
        WorkProgressAttachment.__table__,
        AuditEvent.__table__,
    ]
    Base.metadata.create_all(bind=engine, tables=tables)
    return sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)()


def test_parse_level_accepts_zero() -> None:
    assert _parse_level(0) == 0
    assert _parse_level("0") == 0
    assert _parse_level(20) == 20
    assert _parse_level(None) is None
    assert _parse_level(True) is None


def test_scan_marks_legacy_and_recoverable_and_rejects_duplicate_audit() -> None:
    session = _session()
    try:
        now = datetime.now(timezone.utc)
        company = Company(id=uuid.uuid4(), name="Co", is_active=True, created_at=now, updated_at=now)
        session.add(company)
        user = User(
            id=uuid.uuid4(),
            company_id=company.id,
            email="e@ex.com",
            password_hash="h",
            system_role=SystemRole.EMPLOYEE,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        session.add(user)
        wp = Workplace(id=uuid.uuid4(), company_id=company.id, name="WP", created_at=now, updated_at=now)
        session.add(wp)
        loc = Location(
            id=uuid.uuid4(),
            company_id=company.id,
            name="Kennington",
            latitude=1.0,
            longitude=2.0,
            created_at=now,
            updated_at=now,
        )
        session.add(loc)

        legacy = WorkProgressEntry(
            id=uuid.uuid4(),
            user_id=user.id,
            company_id=company.id,
            workplace_id=wp.id,
            location_id=loc.id,
            work_date=date(2026, 8, 4),
            title="Pointing",
            progress_status="in_progress",
            percent_complete=None,
            status="submitted",
            created_at=now,
            updated_at=now,
        )
        classified = WorkProgressEntry(
            id=uuid.uuid4(),
            user_id=user.id,
            company_id=company.id,
            workplace_id=wp.id,
            location_id=loc.id,
            work_date=date(2026, 8, 12),
            title="",
            progress_status=CLASSIFIED_PROGRESS_STATUS,
            percent_complete=None,
            status="submitted",
            created_at=now,
            updated_at=now,
        )
        ambiguous = WorkProgressEntry(
            id=uuid.uuid4(),
            user_id=user.id,
            company_id=company.id,
            workplace_id=wp.id,
            location_id=loc.id,
            work_date=date(2026, 8, 12),
            title="",
            progress_status=CLASSIFIED_PROGRESS_STATUS,
            percent_complete=None,
            status="submitted",
            created_at=now,
            updated_at=now,
        )
        session.add_all([legacy, classified, ambiguous])
        session.add(
            AuditEvent(
                id=uuid.uuid4(),
                actor_user_id=user.id,
                company_id=company.id,
                action="work_progress.submitted",
                entity_type="work_progress_entry",
                entity_id=str(classified.id),
                details={"work_category": "mastic", "elevation": "internal", "level": 0},
                created_at=now,
            )
        )
        session.add(
            AuditEvent(
                id=uuid.uuid4(),
                actor_user_id=user.id,
                company_id=company.id,
                action="work_progress.submitted",
                entity_type="work_progress_entry",
                entity_id=str(ambiguous.id),
                details={"work_category": "mastic", "elevation": "internal", "level": 0},
                created_at=now,
            )
        )
        session.add(
            AuditEvent(
                id=uuid.uuid4(),
                actor_user_id=user.id,
                company_id=company.id,
                action="work_progress.submitted",
                entity_type="work_progress_entry",
                entity_id=str(ambiguous.id),
                details={"work_category": "dpc", "elevation": "north", "level": 1},
                created_at=now,
            )
        )
        session.commit()

        report = scan_candidates(session)
        assert len(report.legacy_skipped) == 1
        assert report.legacy_skipped[0].entry_id == str(legacy.id)
        assert len(report.recoverable) == 1
        assert report.recoverable[0].after_work_category == "mastic"
        assert report.recoverable[0].after_elevation == "internal"
        assert report.recoverable[0].after_level == 0
        assert len(report.ambiguous) == 1
        assert not gate_exact_18(report)
    finally:
        session.close()


def test_invalid_enum_and_level_rejected() -> None:
    session = _session()
    try:
        now = datetime.now(timezone.utc)
        company = Company(id=uuid.uuid4(), name="Co2", is_active=True, created_at=now, updated_at=now)
        session.add(company)
        user = User(
            id=uuid.uuid4(),
            company_id=company.id,
            email="e2@ex.com",
            password_hash="h",
            system_role=SystemRole.EMPLOYEE,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        session.add(user)
        wp = Workplace(id=uuid.uuid4(), company_id=company.id, name="WP", created_at=now, updated_at=now)
        session.add(wp)
        loc = Location(
            id=uuid.uuid4(),
            company_id=company.id,
            name="Site",
            latitude=1.0,
            longitude=2.0,
            created_at=now,
            updated_at=now,
        )
        session.add(loc)
        entry = WorkProgressEntry(
            id=uuid.uuid4(),
            user_id=user.id,
            company_id=company.id,
            workplace_id=wp.id,
            location_id=loc.id,
            work_date=date(2026, 8, 12),
            title="",
            progress_status=CLASSIFIED_PROGRESS_STATUS,
            status="submitted",
            created_at=now,
            updated_at=now,
        )
        session.add(entry)
        session.add(
            AuditEvent(
                id=uuid.uuid4(),
                actor_user_id=user.id,
                company_id=company.id,
                action="work_progress.submitted",
                entity_type="work_progress_entry",
                entity_id=str(entry.id),
                details={"work_category": "not_real", "elevation": "south", "level": 99},
                created_at=now,
            )
        )
        session.commit()
        report = scan_candidates(session)
        assert len(report.invalid) == 1
        assert len(report.recoverable) == 0
    finally:
        session.close()
