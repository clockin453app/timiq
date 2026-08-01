"""RAMS reading progress + acknowledgement gate (PostgreSQL).

Server authority: page count, version, checksum, and completion are never
trusted from the client.
"""

from __future__ import annotations

import io
import time
import uuid
from datetime import date, datetime, timezone

import pytest
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db import models as _models  # noqa: F401
from app.modules.audit.models import AuditEvent
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.rams.models import RamsAcknowledgement, RamsAssessment, RamsReadingProgress
from app.modules.rams.pdf_pages import count_pdf_pages, sha256_hex
from app.modules.rams.schemas import (
    RamsAcknowledgeRequest,
    RamsAcknowledgementsAddRequest,
    RamsReadingPageRequest,
)
from app.modules.rams import service as rams_service
from app.modules.rams.service import (
    RamsNotFoundError,
    RamsPermissionError,
    RamsValidationError,
    acknowledge_assessment,
    add_acknowledgements,
    create_assessment_from_uploaded_pdf,
    publish_assessment,
    record_reading_page,
    start_reading_progress,
)

LOCAL_ADMIN_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
DB_NAME = "timiq_rams_reading_progress_it"


def _pdf_bytes(page_count: int) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    for i in range(page_count):
        c.drawString(72, 800, f"RAMS page {i + 1} of {page_count}")
        c.showPage()
    c.save()
    data = buf.getvalue()
    assert count_pdf_pages(data) == page_count
    return data


def _png_data_url() -> str:
    import base64
    import struct
    import zlib

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = b"\x00\xff\x00\x00"
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    png = b"\x89PNG\r\n\x1a\n" + ihdr + idat + iend
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def _local_postgres_available() -> bool:
    try:
        eng = create_engine(LOCAL_ADMIN_URL, isolation_level="AUTOCOMMIT")
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _local_postgres_available(), reason="Local Postgres required")


@pytest.fixture()
def db_session(tmp_path, monkeypatch) -> Session:
    from app.core.config import settings
    from app.core.storage.factory import get_storage_backend

    monkeypatch.setattr(settings, "timiq_storage_backend", "local")
    monkeypatch.setattr(settings, "timiq_storage_root", str(tmp_path / "storage"))
    monkeypatch.setattr(rams_service, "_MIN_NEW_PAGE_INTERVAL_SECONDS", 0)
    get_storage_backend.cache_clear()

    admin = create_engine(LOCAL_ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.execute(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": DB_NAME}).scalar()
        if exists:
            conn.execute(text(f'DROP DATABASE "{DB_NAME}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{DB_NAME}"'))
    target = f"postgresql+psycopg://postgres:postgres@127.0.0.1:5432/{DB_NAME}"
    engine = create_engine(target)
    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()
        get_storage_backend.cache_clear()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE "{DB_NAME}" WITH (FORCE)'))
        admin.dispose()


def _seed(session: Session) -> dict:
    company = Company(id=uuid.uuid4(), name=f"RAMS Co {uuid.uuid4().hex[:6]}", is_active=True)
    other = Company(id=uuid.uuid4(), name=f"Other {uuid.uuid4().hex[:6]}", is_active=True)
    session.add_all([company, other])
    session.flush()
    admin = User(
        id=uuid.uuid4(),
        email=f"admin-{uuid.uuid4().hex[:6]}@ex.com",
        password_hash="x",
        system_role=SystemRole.ADMIN,
        company_id=company.id,
        is_active=True,
    )
    emp = User(
        id=uuid.uuid4(),
        email=f"emp-{uuid.uuid4().hex[:6]}@ex.com",
        password_hash="x",
        system_role=SystemRole.EMPLOYEE,
        company_id=company.id,
        is_active=True,
    )
    other_emp = User(
        id=uuid.uuid4(),
        email=f"oemp-{uuid.uuid4().hex[:6]}@ex.com",
        password_hash="x",
        system_role=SystemRole.EMPLOYEE,
        company_id=other.id,
        is_active=True,
    )
    loc = Location(
        id=uuid.uuid4(),
        company_id=company.id,
        name="Site A",
        address="1 Road",
        latitude=51.5,
        longitude=-0.1,
        geofence_radius_meters=100,
        is_active=True,
    )
    session.add_all([admin, emp, other_emp, loc])
    session.flush()
    session.add(EmployeeProfile(user_id=emp.id, company_id=company.id, first_name="E", last_name="One"))
    session.commit()
    return {"company": company, "other": other, "admin": admin, "emp": emp, "other_emp": other_emp, "location": loc}


def _published_uploaded(session: Session, world: dict, *, pages: int = 30) -> RamsAssessment:
    detail = create_assessment_from_uploaded_pdf(
        session,
        world["admin"],
        file_bytes=_pdf_bytes(pages),
        filename="site.pdf",
        content_type="application/pdf",
        title="Uploaded RAMS",
        location_id=world["location"].id,
        risk_level="medium",
        review_due_date=date(2026, 8, 1),
    )
    add_acknowledgements(
        session,
        world["admin"],
        detail.id,
        RamsAcknowledgementsAddRequest(user_ids=[world["emp"].id]),
    )
    publish_assessment(session, world["admin"], detail.id)
    row = session.get(RamsAssessment, detail.id)
    assert row is not None
    return row


def _ack_body() -> RamsAcknowledgeRequest:
    return RamsAcknowledgeRequest(
        read_understood_ack=True,
        acknowledgement_name="Employee One",
        signature_image_data=_png_data_url(),
    )


def _report_pages(session: Session, emp: User, assessment_id: uuid.UUID, pages: list[int]):
    last = None
    for page in pages:
        last = record_reading_page(
            session,
            emp,
            assessment_id,
            RamsReadingPageRequest(page_number=page),
        )
    return last


def test_server_derives_total_pages_ignores_client_fake_total(db_session: Session) -> None:
    world = _seed(db_session)
    row = _published_uploaded(db_session, world, pages=30)

    # start_reading_progress accepts no client total_pages — count comes from stored PDF.
    started = start_reading_progress(db_session, world["emp"], row.id)
    assert started.total_pages == 30
    assert started.document_sha256 == row.uploaded_pdf_checksum_sha256
    assert started.document_version == int(row.uploaded_pdf_version or 1)

    # Reporting a single page cannot collapse a 30-page document to completed.
    only_first = record_reading_page(
        db_session,
        world["emp"],
        row.id,
        RamsReadingPageRequest(page_number=1),
    )
    assert only_first.total_pages == 30
    assert only_first.status == "in_progress"
    assert only_first.completed_at is None

    with pytest.raises(RamsValidationError, match="between 1 and 30"):
        record_reading_page(
            db_session,
            world["emp"],
            row.id,
            RamsReadingPageRequest(page_number=99),
        )


def test_total_page_count_from_stored_pdf_bytes(db_session: Session) -> None:
    world = _seed(db_session)
    row = _published_uploaded(db_session, world, pages=30)
    from app.core.storage.factory import get_storage_backend

    stored = get_storage_backend().read_bytes(row.uploaded_pdf_storage_path)
    assert count_pdf_pages(stored) == 30
    assert sha256_hex(stored) == row.uploaded_pdf_checksum_sha256

    started = start_reading_progress(db_session, world["emp"], row.id)
    assert started.total_pages == count_pdf_pages(stored)


def test_out_of_range_page_numbers_rejected(db_session: Session) -> None:
    world = _seed(db_session)
    row = _published_uploaded(db_session, world, pages=30)
    start_reading_progress(db_session, world["emp"], row.id)

    with pytest.raises(RamsValidationError, match="between 1 and 30"):
        record_reading_page(
            db_session,
            world["emp"],
            row.id,
            RamsReadingPageRequest(page_number=31),
        )


def test_schema_rejects_page_zero_and_negative() -> None:
    with pytest.raises(Exception):
        RamsReadingPageRequest(page_number=0)
    with pytest.raises(Exception):
        RamsReadingPageRequest(page_number=-3)
    assert RamsReadingPageRequest(page_number=12).page_number == 12
    assert not hasattr(RamsReadingPageRequest(page_number=1), "completed")
    assert "completed" not in RamsReadingPageRequest.model_fields
    assert "total_pages" not in RamsReadingPageRequest.model_fields


def test_final_page_alone_does_not_complete(db_session: Session) -> None:
    world = _seed(db_session)
    row = _published_uploaded(db_session, world, pages=30)
    start_reading_progress(db_session, world["emp"], row.id)
    mid = record_reading_page(
        db_session,
        world["emp"],
        row.id,
        RamsReadingPageRequest(page_number=30),
    )
    assert mid.status == "in_progress"
    assert mid.viewed_pages == [30]
    assert mid.completed_at is None
    assert mid.first_unread_page == 1

    with pytest.raises(RamsValidationError, match="view all pages"):
        acknowledge_assessment(db_session, world["emp"], row.id, _ack_body())


def test_every_page_required_duplicates_idempotent_completed_at_server(db_session: Session) -> None:
    world = _seed(db_session)
    row = _published_uploaded(db_session, world, pages=5)
    start_reading_progress(db_session, world["emp"], row.id)

    before = datetime.now(timezone.utc)
    time.sleep(0.02)
    for page in (1, 2, 2, 3, 3, 4, 5, 5):
        resp = record_reading_page(
            db_session,
            world["emp"],
            row.id,
            RamsReadingPageRequest(page_number=page),
        )
    after = datetime.now(timezone.utc)

    assert resp.status == "completed"
    assert resp.viewed_pages == [1, 2, 3, 4, 5]
    assert resp.viewed_count == 5
    assert resp.highest_page_reached == 5
    assert resp.completed_at is not None
    assert before <= resp.completed_at <= after

    # Duplicate after complete remains complete and idempotent.
    again = record_reading_page(
        db_session,
        world["emp"],
        row.id,
        RamsReadingPageRequest(page_number=5),
    )
    assert again.status == "completed"
    assert again.completed_at == resp.completed_at
    assert again.viewed_count == 5


def test_document_replacement_invalidates_prior_completion(db_session: Session) -> None:
    from app.core.storage.factory import get_storage_backend

    world = _seed(db_session)
    row = _published_uploaded(db_session, world, pages=5)
    start_reading_progress(db_session, world["emp"], row.id)
    done = _report_pages(db_session, world["emp"], row.id, list(range(1, 6)))
    assert done is not None and done.status == "completed"

    old_version = int(row.uploaded_pdf_version or 1)
    old_checksum = row.uploaded_pdf_checksum_sha256
    new_pdf = _pdf_bytes(7)
    get_storage_backend().write_bytes(row.uploaded_pdf_storage_path, new_pdf)
    row.uploaded_pdf_checksum_sha256 = sha256_hex(new_pdf)
    row.uploaded_pdf_version = old_version + 1
    db_session.commit()
    db_session.refresh(row)

    assert row.uploaded_pdf_checksum_sha256 != old_checksum
    with pytest.raises(RamsValidationError, match="view all pages"):
        acknowledge_assessment(db_session, world["emp"], row.id, _ack_body())

    fresh = start_reading_progress(db_session, world["emp"], row.id)
    assert fresh.total_pages == 7
    assert fresh.status == "in_progress"
    assert fresh.completed_at is None
    assert fresh.viewed_count == 0


def test_ack_rejects_incomplete_and_forged_progress(db_session: Session) -> None:
    world = _seed(db_session)
    row = _published_uploaded(db_session, world, pages=30)

    with pytest.raises(RamsValidationError, match="view all pages"):
        acknowledge_assessment(db_session, world["emp"], row.id, _ack_body())

    start_reading_progress(db_session, world["emp"], row.id)
    # Forged: claim completed with only last page + fake total_pages=1.
    progress = db_session.scalar(
        select(RamsReadingProgress).where(RamsReadingProgress.assessment_id == row.id)
    )
    assert progress is not None
    progress.total_pages = 1
    progress.viewed_pages = [1]
    progress.highest_page_reached = 1
    progress.completed_at = datetime.now(timezone.utc)
    db_session.commit()

    with pytest.raises(RamsValidationError, match="view all pages"):
        acknowledge_assessment(db_session, world["emp"], row.id, _ack_body())

    # Still incomplete when only reporting the final page.
    progress.total_pages = 30
    progress.viewed_pages = [30]
    progress.completed_at = datetime.now(timezone.utc)
    db_session.commit()
    with pytest.raises(RamsValidationError, match="view all pages"):
        acknowledge_assessment(db_session, world["emp"], row.id, _ack_body())


def test_ack_succeeds_only_with_authoritative_completed_progress(db_session: Session) -> None:
    world = _seed(db_session)
    row = _published_uploaded(db_session, world, pages=30)
    started = start_reading_progress(db_session, world["emp"], row.id)
    assert started.total_pages == 30

    done = _report_pages(db_session, world["emp"], row.id, list(range(1, 31)))
    assert done is not None
    assert done.status == "completed"
    assert done.viewed_count == 30
    assert done.completed_at is not None

    detail = acknowledge_assessment(db_session, world["emp"], row.id, _ack_body())
    mine = next(a for a in detail.acknowledgements if a.user_id == world["emp"].id)
    assert mine.status == "acknowledged"

    events = list(
        db_session.scalars(
            select(AuditEvent).where(
                AuditEvent.action.in_(
                    ("rams.reading_started", "rams.reading_completed", "rams.acknowledged")
                )
            )
        ).all()
    )
    assert any(e.action == "rams.reading_started" for e in events)
    assert any(e.action == "rams.reading_completed" for e in events)
    assert any(e.action == "rams.acknowledged" for e in events)


def test_assignment_isolation(db_session: Session) -> None:
    world = _seed(db_session)
    row = _published_uploaded(db_session, world, pages=3)
    with pytest.raises(RamsNotFoundError):
        start_reading_progress(db_session, world["other_emp"], row.id)


def test_download_does_not_create_progress(db_session: Session) -> None:
    world = _seed(db_session)
    row = _published_uploaded(db_session, world, pages=3)
    from app.modules.rams.service import download_uploaded_rams_pdf

    download_uploaded_rams_pdf(db_session, world["emp"], row.id)
    assert (
        list(
            db_session.scalars(
                select(RamsReadingProgress).where(RamsReadingProgress.assessment_id == row.id)
            ).all()
        )
        == []
    )


def test_legacy_acknowledged_without_progress_stays_valid(db_session: Session) -> None:
    world = _seed(db_session)
    row = _published_uploaded(db_session, world, pages=3)
    att = db_session.scalar(
        select(RamsAcknowledgement).where(
            RamsAcknowledgement.assessment_id == row.id,
            RamsAcknowledgement.user_id == world["emp"].id,
        )
    )
    assert att is not None
    att.status = "acknowledged"
    att.acknowledgement_name = "Legacy"
    att.signature_method = "manual_paper"
    db_session.commit()
    assert att.status == "acknowledged"
    assert (
        list(
            db_session.scalars(
                select(RamsReadingProgress).where(RamsReadingProgress.assessment_id == row.id)
            ).all()
        )
        == []
    )


def test_employee_permission_for_unassigned(db_session: Session) -> None:
    world = _seed(db_session)
    detail = create_assessment_from_uploaded_pdf(
        db_session,
        world["admin"],
        file_bytes=_pdf_bytes(2),
        filename="x.pdf",
        content_type="application/pdf",
        title="No assign",
    )
    publish_assessment(db_session, world["admin"], detail.id)
    with pytest.raises((RamsNotFoundError, RamsPermissionError, RamsValidationError)):
        start_reading_progress(db_session, world["emp"], detail.id)


def test_checksum_mismatch_blocks_progress_and_ack(db_session: Session) -> None:
    from app.core.storage.factory import get_storage_backend

    world = _seed(db_session)
    row = _published_uploaded(db_session, world, pages=3)
    # Corrupt stored bytes without updating checksum — unexpected change.
    get_storage_backend().write_bytes(row.uploaded_pdf_storage_path, _pdf_bytes(4))
    with pytest.raises(RamsValidationError, match="changed unexpectedly"):
        start_reading_progress(db_session, world["emp"], row.id)
    with pytest.raises(RamsValidationError, match="view all pages"):
        acknowledge_assessment(db_session, world["emp"], row.id, _ack_body())
