"""Regression: classified Site Progress create must persist classification columns."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db import models as _models  # noqa: F401
from app.modules.audit.models import AuditEvent
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company
from app.modules.locations.models import Location
from app.modules.work_progress.classification import CLASSIFIED_PROGRESS_STATUS, ELEVATION_CUSTOM
from app.modules.work_progress.models import WorkProgressEntry
from app.modules.work_progress.schemas import WorkProgressCreateRequest
from app.modules.work_progress.service import (
    WorkProgressValidationError,
    _assert_persisted_classification,
    create_my_entry,
)
from app.modules.workplaces.models import Workplace


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
        Workplace.__table__,
        Location.__table__,
        WorkProgressEntry.__table__,
        AuditEvent.__table__,
    ]
    Base.metadata.create_all(bind=engine, tables=tables)
    return sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)()


def _seed(session: Session) -> dict:
    now = datetime.now(timezone.utc)
    company = Company(id=uuid.uuid4(), name=f"Co {uuid.uuid4().hex[:6]}", is_active=True, created_at=now, updated_at=now)
    session.add(company)
    user = User(
        id=uuid.uuid4(),
        company_id=company.id,
        email=f"emp-{uuid.uuid4().hex[:6]}@ex.com",
        password_hash="h",
        system_role=SystemRole.EMPLOYEE,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    session.add(user)
    workplace = Workplace(
        id=uuid.uuid4(),
        company_id=company.id,
        name="WP",
        created_at=now,
        updated_at=now,
    )
    session.add(workplace)
    location = Location(
        id=uuid.uuid4(),
        company_id=company.id,
        name="Kennington",
        latitude=51.49,
        longitude=-0.11,
        created_at=now,
        updated_at=now,
    )
    session.add(location)
    session.commit()
    return {"company": company, "user": user, "location": location, "workplace": workplace}


def test_assert_persisted_classification_accepts_level_zero() -> None:
    row = WorkProgressEntry(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        location_id=uuid.uuid4(),
        work_date=date(2026, 8, 12),
        title="",
        progress_status=CLASSIFIED_PROGRESS_STATUS,
        work_category="brickwork_level",
        elevation="south",
        elevation_custom=None,
        level=0,
        status="submitted",
    )
    _assert_persisted_classification(
        row,
        category="brickwork_level",
        elevation="south",
        elevation_custom=None,
        level=0,
    )


def test_assert_persisted_classification_rejects_null_level_zero_expected() -> None:
    row = WorkProgressEntry(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        location_id=uuid.uuid4(),
        work_date=date(2026, 8, 12),
        title="",
        progress_status=CLASSIFIED_PROGRESS_STATUS,
        work_category="brickwork_level",
        elevation="south",
        elevation_custom=None,
        level=None,
        status="submitted",
    )
    with pytest.raises(WorkProgressValidationError, match="level"):
        _assert_persisted_classification(
            row,
            category="brickwork_level",
            elevation="south",
            elevation_custom=None,
            level=0,
        )


@pytest.mark.parametrize("level", [0, 20])
def test_create_my_entry_persists_classification_and_audit(level: int) -> None:
    session = _session()
    try:
        world = _seed(session)
        user = world["user"]
        location = world["location"]
        body = WorkProgressCreateRequest(
            work_date=date(2026, 8, 12),
            location_id=location.id,
            work_category="brickwork_level",
            elevation="south",
            level=level,
            notes=None,
        )
        with (
            patch(
                "app.modules.work_progress.service._allowed_location_ids",
                return_value={location.id},
            ),
            patch(
                "app.modules.work_progress.service.get_location_by_id",
                return_value=location,
            ),
        ):
            detail = create_my_entry(session, user, body)

        assert detail.work_category == "brickwork_level"
        assert detail.elevation == "south"
        assert detail.level == level
        assert detail.level_display == f"{level:02d}"
        assert detail.work_category_label == "Brickwork level"
        assert detail.elevation_display == "South"

        row = session.get(WorkProgressEntry, detail.id)
        assert row is not None
        assert row.work_category == "brickwork_level"
        assert row.elevation == "south"
        assert row.elevation_custom is None
        assert row.level == level
        assert row.level == 0 if level == 0 else level
        assert row.title == ""
        assert row.progress_status == CLASSIFIED_PROGRESS_STATUS
        assert row.percent_complete is None

        audit = session.scalars(
            select(AuditEvent).where(
                AuditEvent.action == "work_progress.submitted",
                AuditEvent.entity_id == str(detail.id),
            )
        ).one()
        assert audit.details["work_category"] == "brickwork_level"
        assert audit.details["elevation"] == "south"
        assert audit.details["level"] == level
    finally:
        session.close()


def test_create_my_entry_persists_custom_elevation() -> None:
    session = _session()
    try:
        world = _seed(session)
        user = world["user"]
        location = world["location"]
        body = WorkProgressCreateRequest(
            work_date=date(2026, 8, 12),
            location_id=location.id,
            work_category="insulation",
            elevation=ELEVATION_CUSTOM,
            elevation_custom="Elevation A",
            level=4,
        )
        with (
            patch(
                "app.modules.work_progress.service._allowed_location_ids",
                return_value={location.id},
            ),
            patch(
                "app.modules.work_progress.service.get_location_by_id",
                return_value=location,
            ),
        ):
            detail = create_my_entry(session, user, body)

        row = session.get(WorkProgressEntry, detail.id)
        assert row is not None
        assert row.elevation == ELEVATION_CUSTOM
        assert row.elevation_custom == "Elevation A"
        assert row.level == 4
        assert detail.elevation_display == "Elevation A"

        audit = session.scalars(
            select(AuditEvent).where(
                AuditEvent.action == "work_progress.submitted",
                AuditEvent.entity_id == str(detail.id),
            )
        ).one()
        assert audit.details["elevation"] == ELEVATION_CUSTOM
        assert audit.details["elevation_custom"] == "Elevation A"
        assert audit.details["level"] == 4
    finally:
        session.close()


def test_create_aborts_audit_when_persisted_classification_missing() -> None:
    session = _session()
    try:
        world = _seed(session)
        user = world["user"]
        location = world["location"]
        body = WorkProgressCreateRequest(
            work_date=date(2026, 8, 12),
            location_id=location.id,
            work_category="mastic",
            elevation="internal",
            level=0,
        )

        real_get = __import__(
            "app.modules.work_progress.service", fromlist=["get_entry_by_id"]
        ).get_entry_by_id

        def wipe_classification(db, entry_id):
            row = real_get(db, entry_id)
            if row is not None:
                row.work_category = None
                row.elevation = None
                row.elevation_custom = None
                row.level = None
                db.commit()
            return real_get(db, entry_id)

        with (
            patch(
                "app.modules.work_progress.service._allowed_location_ids",
                return_value={location.id},
            ),
            patch(
                "app.modules.work_progress.service.get_location_by_id",
                return_value=location,
            ),
            patch(
                "app.modules.work_progress.service.get_entry_by_id",
                side_effect=wipe_classification,
            ),
            patch("app.modules.work_progress.service.create_internal_audit_event") as audit,
        ):
            with pytest.raises(WorkProgressValidationError, match="failed to persist"):
                create_my_entry(session, user, body)
        audit.assert_not_called()
    finally:
        session.close()
