"""RAMS printable acknowledgement register PDF (service-level, PostgreSQL)."""

from __future__ import annotations

import io
import uuid
from datetime import date
from io import BytesIO

import pytest
from pypdf import PdfReader
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db import models as _models  # noqa: F401
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.rams import service as rams_service
from app.modules.rams.models import RamsAcknowledgement, RamsAssessment
from app.modules.rams.pdf_pages import count_pdf_pages
from app.modules.rams.schemas import (
    RamsAcknowledgeRequest,
    RamsAcknowledgementsAddRequest,
    RamsReadingPageRequest,
)
from app.modules.rams.service import (
    RamsNotFoundError,
    RamsPermissionError,
    acknowledge_assessment,
    add_acknowledgements,
    create_assessment_from_uploaded_pdf,
    export_acknowledgement_register_pdf_bytes,
    export_signed_record_pdf_bytes,
    publish_assessment,
    record_reading_page,
    start_reading_progress,
)

LOCAL_ADMIN_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
DB_NAME = "timiq_rams_ack_register_pdf_it"


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

    admin_eng = create_engine(LOCAL_ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin_eng.connect() as conn:
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
        with admin_eng.connect() as conn:
            conn.execute(text(f'DROP DATABASE "{DB_NAME}" WITH (FORCE)'))
        admin_eng.dispose()


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
    other_admin = User(
        id=uuid.uuid4(),
        email=f"oadmin-{uuid.uuid4().hex[:6]}@ex.com",
        password_hash="x",
        system_role=SystemRole.ADMIN,
        company_id=other.id,
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
    pending = User(
        id=uuid.uuid4(),
        email=f"pending-{uuid.uuid4().hex[:6]}@ex.com",
        password_hash="x",
        system_role=SystemRole.EMPLOYEE,
        company_id=company.id,
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
    session.add_all([admin, other_admin, emp, pending, loc])
    session.flush()
    session.add(
        EmployeeProfile(
            user_id=emp.id,
            company_id=company.id,
            first_name="E",
            last_name="One",
            job_title="Bricklayer",
        ),
    )
    session.add(
        EmployeeProfile(
            user_id=pending.id,
            company_id=company.id,
            first_name="P",
            last_name="Ending",
            job_title="Labourer",
        ),
    )
    session.commit()
    return {
        "company": company,
        "other": other,
        "admin": admin,
        "other_admin": other_admin,
        "emp": emp,
        "pending": pending,
        "location": loc,
    }


def _ack_body() -> RamsAcknowledgeRequest:
    return RamsAcknowledgeRequest(
        read_understood_ack=True,
        acknowledgement_name="Employee One",
        signature_image_data=_png_data_url(),
    )


def _report_pages(session: Session, actor: User, assessment_id: uuid.UUID, pages: list[int]) -> None:
    for page in pages:
        record_reading_page(
            session,
            actor,
            assessment_id,
            RamsReadingPageRequest(page_number=page),
        )


def test_register_pdf_job_role_signature_pending_and_isolation(db_session: Session) -> None:
    world = _seed(db_session)
    pages = 3
    detail = create_assessment_from_uploaded_pdf(
        db_session,
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
        db_session,
        world["admin"],
        detail.id,
        RamsAcknowledgementsAddRequest(user_ids=[world["emp"].id, world["pending"].id]),
    )
    publish_assessment(db_session, world["admin"], detail.id)
    start_reading_progress(db_session, world["emp"], detail.id)
    _report_pages(db_session, world["emp"], detail.id, list(range(1, pages + 1)))
    acknowledge_assessment(db_session, world["emp"], detail.id, _ack_body())

    ack = db_session.scalar(
        select(RamsAcknowledgement).where(
            RamsAcknowledgement.assessment_id == detail.id,
            RamsAcknowledgement.user_id == world["emp"].id,
        )
    )
    assert ack is not None
    assert ack.job_role_at_signing == "Bricklayer"
    assert (ack.signature_image_path or "").strip()

    raw, filename = export_acknowledgement_register_pdf_bytes(db_session, world["admin"], detail.id)
    assert filename.endswith(".pdf")
    assert raw.startswith(b"%PDF")
    register_pages = PdfReader(BytesIO(raw)).pages
    text = "\n".join((p.extract_text() or "") for p in register_pages)
    assert "Bricklayer" in text
    assert "Labourer" in text
    assert "E One" in text or "Employee One" in text or "E" in text
    assert "Job role" in text
    assert "Employee name" in text
    assert "Signature" in text
    assert "Date" in text
    assert "RAMS page 1" not in text
    assert b"/Image" in raw or b"XObject" in raw or b"PNG" in raw or b"IDAT" in raw

    signed_raw, signed_name = export_signed_record_pdf_bytes(db_session, world["admin"], detail.id)
    assert signed_name.endswith(".pdf")
    signed_reader = PdfReader(BytesIO(signed_raw))
    assert len(signed_reader.pages) == pages + len(register_pages)
    first_text = signed_reader.pages[0].extract_text() or ""
    assert "RAMS page 1" in first_text
    last_text = signed_reader.pages[-1].extract_text() or ""
    assert "Job role" in last_text or "acknowledgement" in last_text.lower()

    with pytest.raises((RamsNotFoundError, RamsPermissionError)):
        export_acknowledgement_register_pdf_bytes(db_session, world["other_admin"], detail.id)

    with pytest.raises(RamsPermissionError):
        export_acknowledgement_register_pdf_bytes(db_session, world["emp"], detail.id)
