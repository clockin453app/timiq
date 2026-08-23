"""Classified Site Progress create must persist via independent DB reads.

Same-session ORM reads with expire_on_commit=False are not authoritative.
"""

from __future__ import annotations

import io
import uuid
from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image
from sqlalchemy import create_engine, select, update
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
from app.modules.work_progress.classification import CLASSIFIED_PROGRESS_STATUS, ELEVATION_CUSTOM
from app.modules.work_progress.models import WorkProgressAttachment, WorkProgressEntry
from app.modules.work_progress.schemas import WorkProgressCreateRequest
from app.modules.work_progress.service import (
    WorkProgressValidationError,
    _assert_persisted_classification,
    archive_review_entry,
    bulk_download_review_attachments_zip,
    create_my_entry,
    list_review,
    upload_my_entry_file,
)
from app.modules.workplaces.models import Workplace


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(_type, _compiler, **_kw):  # noqa: ANN001
    return "JSON"


def _engine():
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
        WorkProgressAttachment.__table__,
        EmployeeProfile.__table__,
        AuditEvent.__table__,
    ]
    Base.metadata.create_all(bind=engine, tables=tables)
    return engine


def _session_factory(engine):
    return sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)


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
    admin = User(
        id=uuid.uuid4(),
        company_id=company.id,
        email=f"admin-{uuid.uuid4().hex[:6]}@ex.com",
        password_hash="h",
        system_role=SystemRole.ADMIN,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    session.add_all([user, admin])
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
    return {"company": company, "user": user, "admin": admin, "location": location, "workplace": workplace}


def _create_body(location_id, *, category="brickwork_ties", elevation="north", level=0, custom=None):
    return WorkProgressCreateRequest(
        work_date=date(2026, 8, 12),
        location_id=location_id,
        work_category=category,
        elevation=elevation,
        elevation_custom=custom,
        level=level,
        notes=None,
    )


def _create(session: Session, user: User, location, body: WorkProgressCreateRequest):
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
        return create_my_entry(session, user, body)


def _independent_load(factory, entry_id: uuid.UUID) -> WorkProgressEntry:
    session = factory()
    try:
        row = session.get(WorkProgressEntry, entry_id)
        assert row is not None
        session.expunge(row)
        return row
    finally:
        session.close()


def _independent_audit(factory, entry_id: uuid.UUID) -> AuditEvent:
    session = factory()
    try:
        audit = session.scalars(
            select(AuditEvent).where(
                AuditEvent.action == "work_progress.submitted",
                AuditEvent.entity_id == str(entry_id),
            )
        ).one()
        session.expunge(audit)
        return audit
    finally:
        session.close()


def test_assert_persisted_classification_accepts_level_zero() -> None:
    row = WorkProgressEntry(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        location_id=uuid.uuid4(),
        work_date=date(2026, 8, 12),
        title="",
        progress_status=CLASSIFIED_PROGRESS_STATUS,
        work_category="brickwork_ties",
        elevation="north",
        elevation_custom=None,
        level=0,
        status="submitted",
    )
    _assert_persisted_classification(
        row,
        category="brickwork_ties",
        elevation="north",
        elevation_custom=None,
        level=0,
    )


def test_same_session_identity_map_is_not_authoritative() -> None:
    """expire_on_commit=False can hide a later independent DB write."""
    engine = _engine()
    factory = _session_factory(engine)
    s1 = factory()
    try:
        world = _seed(s1)
        now = datetime.now(timezone.utc)
        entry_id = uuid.uuid4()
        row = WorkProgressEntry(
            id=entry_id,
            user_id=world["user"].id,
            company_id=world["company"].id,
            location_id=world["location"].id,
            work_date=date(2026, 8, 12),
            title="",
            progress_status=CLASSIFIED_PROGRESS_STATUS,
            work_category="brickwork_ties",
            elevation="north",
            elevation_custom=None,
            level=0,
            status="submitted",
            created_at=now,
            updated_at=now,
        )
        s1.add(row)
        s1.commit()
        cached = s1.get(WorkProgressEntry, entry_id)
        assert cached is not None
        assert cached.work_category == "brickwork_ties"
        assert cached.level == 0

        with engine.connect() as conn:
            conn.execute(
                update(WorkProgressEntry)
                .where(WorkProgressEntry.id == entry_id)
                .values(work_category=None, elevation=None, elevation_custom=None, level=None),
            )
            conn.commit()

        assert cached.work_category == "brickwork_ties"
        assert cached.level == 0
        fresh = _independent_load(factory, entry_id)
        assert fresh.work_category is None
        assert fresh.elevation is None
        assert fresh.level is None
    finally:
        s1.close()


@pytest.mark.parametrize("level", [0, 1, 20])
def test_create_persists_classification_across_two_fresh_sessions(level: int) -> None:
    engine = _engine()
    factory = _session_factory(engine)
    creator = factory()
    try:
        world = _seed(creator)
        body = _create_body(world["location"].id, level=level)
        detail = _create(creator, world["user"], world["location"], body)
        creator.close()

        first = _independent_load(factory, detail.id)
        assert first.work_category == "brickwork_ties"
        assert first.elevation == "north"
        assert first.elevation_custom is None
        assert first.level == level
        assert first.level == 0 if level == 0 else first.level
        assert first.title == ""
        assert first.progress_status == CLASSIFIED_PROGRESS_STATUS

        second = _independent_load(factory, detail.id)
        assert second.work_category == first.work_category
        assert second.elevation == first.elevation
        assert second.level == first.level

        audit = _independent_audit(factory, detail.id)
        assert audit.details["work_category"] == "brickwork_ties"
        assert audit.details["elevation"] == "north"
        assert audit.details["level"] == level
        assert audit.details["work_category"] == second.work_category
        assert audit.details["elevation"] == second.elevation
        assert audit.details["level"] == second.level
    finally:
        creator.close()


def test_create_persists_custom_elevation_independently() -> None:
    engine = _engine()
    factory = _session_factory(engine)
    creator = factory()
    try:
        world = _seed(creator)
        body = _create_body(
            world["location"].id,
            category="insulation",
            elevation=ELEVATION_CUSTOM,
            custom="Elevation A",
            level=4,
        )
        detail = _create(creator, world["user"], world["location"], body)
        creator.close()
        row = _independent_load(factory, detail.id)
        assert row.elevation == ELEVATION_CUSTOM
        assert row.elevation_custom == "Elevation A"
        assert row.level == 4
        audit = _independent_audit(factory, detail.id)
        assert audit.details["elevation"] == ELEVATION_CUSTOM
        assert audit.details["elevation_custom"] == "Elevation A"
        assert audit.details["level"] == 4
    finally:
        creator.close()


def test_create_rolls_back_when_returning_classification_is_null() -> None:
    engine = _engine()
    factory = _session_factory(engine)
    session = factory()
    try:
        world = _seed(session)
        body = _create_body(world["location"].id)
        real_execute = session.execute

        def wipe_returning(stmt, *args, **kwargs):
            result = real_execute(stmt, *args, **kwargs)
            if getattr(stmt, "is_insert", False) or str(stmt).lower().startswith("insert"):
                row = result.one()

                class _NullRow:
                    id = row.id
                    company_id = row.company_id
                    location_id = row.location_id
                    work_date = row.work_date
                    work_category = None
                    elevation = None
                    elevation_custom = None
                    level = None

                class _One:
                    def one(self):
                        return _NullRow()

                return _One()
            return result

        with (
            patch(
                "app.modules.work_progress.service._allowed_location_ids",
                return_value={world["location"].id},
            ),
            patch(
                "app.modules.work_progress.service.get_location_by_id",
                return_value=world["location"],
            ),
            patch.object(session, "execute", side_effect=wipe_returning),
            patch("app.modules.work_progress.service.create_internal_audit_event") as audit,
        ):
            with pytest.raises(WorkProgressValidationError, match="failed to persist"):
                create_my_entry(session, world["user"], body)
        audit.assert_not_called()
        leftover = _independent_load(factory, world["user"].id) if False else None
        del leftover
        empty = factory()
        try:
            count = empty.scalar(select(WorkProgressEntry.id).limit(1))
            assert count is None
        finally:
            empty.close()
    finally:
        session.close()


def test_photo_upload_does_not_clear_classification() -> None:
    engine = _engine()
    factory = _session_factory(engine)
    creator = factory()
    try:
        world = _seed(creator)
        detail = _create(creator, world["user"], world["location"], _create_body(world["location"].id))
        before = _independent_load(factory, detail.id)
        buf = io.BytesIO()
        Image.new("RGB", (32, 32), (10, 20, 30)).save(buf, format="JPEG")
        jpeg = buf.getvalue()
        backend = MagicMock()
        backend.write_bytes.return_value = None
        with (
            patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
            patch("app.modules.work_progress.service.create_internal_audit_event"),
        ):
            upload_my_entry_file(
                creator,
                world["user"],
                detail.id,
                original_filename="shot.jpg",
                content_type="image/jpeg",
                file_bytes=jpeg,
            )
        creator.close()
        after = _independent_load(factory, detail.id)
        assert after.work_category == before.work_category == "brickwork_ties"
        assert after.elevation == before.elevation == "north"
        assert after.level == before.level == 0
        atts = factory()
        try:
            files = list(atts.scalars(select(WorkProgressAttachment).where(WorkProgressAttachment.entry_id == detail.id)))
            assert len(files) == 1
        finally:
            atts.close()
    finally:
        creator.close()


def test_list_filters_and_zip_do_not_mutate_classification() -> None:
    engine = _engine()
    factory = _session_factory(engine)
    session = factory()
    try:
        world = _seed(session)
        detail = _create(session, world["user"], world["location"], _create_body(world["location"].id, level=0))
        snap = _independent_load(factory, detail.id)

        listed = list_review(
            session,
            world["admin"],
            company_id=None,
            user_id=None,
            location_id=world["location"].id,
            status_filter=None,
            include_archived=False,
            date_from=None,
            date_to=None,
            title_search=None,
            limit=50,
            offset=0,
            work_category="brickwork_ties",
            elevation="north",
            level=0,
        )
        assert listed.total == 1
        assert listed.items[0].work_category == "brickwork_ties"
        assert listed.items[0].elevation == "north"
        assert listed.items[0].level == 0

        buf = io.BytesIO()
        Image.new("RGB", (32, 32), (10, 20, 30)).save(buf, format="JPEG")
        jpeg = buf.getvalue()
        backend = MagicMock()
        backend.write_bytes.return_value = None
        backend.object_byte_size.return_value = len(jpeg)
        backend.exists.return_value = True
        backend.read_bytes.return_value = jpeg
        with (
            patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
            patch("app.modules.work_progress.service.create_internal_audit_event"),
        ):
            uploaded = upload_my_entry_file(
                session,
                world["user"],
                detail.id,
                original_filename="shot.jpg",
                content_type="image/jpeg",
                file_bytes=jpeg,
            )
            att_id = uploaded.attachments[0].id
            bulk_download_review_attachments_zip(session, world["admin"], [att_id])
        archive_review_entry(session, world["admin"], detail.id)
        session.close()

        after = _independent_load(factory, detail.id)
        assert after.work_category == snap.work_category
        assert after.elevation == snap.elevation
        assert after.elevation_custom == snap.elevation_custom
        assert after.level == snap.level == 0
        assert after.status == "archived"
    finally:
        session.close()
