"""Uploaded RAMS PDF workflow tests (PostgreSQL disposable DB)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db import models as _models  # noqa: F401
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company
from app.modules.locations.models import Location
from app.modules.rams.models import RamsAcknowledgement, RamsAssessment
from app.modules.rams.pdf_upload import validate_uploaded_rams_pdf, UploadedRamsPdfValidationError
from app.modules.rams.service import (
    RamsNotFoundError,
    RamsPermissionError,
    RamsValidationError,
    create_assessment_from_uploaded_pdf,
    delete_assessment_hard,
    download_uploaded_rams_pdf,
    publish_assessment,
    replace_draft_uploaded_pdf,
)

LOCAL_ADMIN_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
DB_NAME = "timiq_rams_upload_pdf_it"
MINI_PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


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
    employee = User(
        id=uuid.uuid4(),
        email=f"emp-{uuid.uuid4().hex[:6]}@ex.com",
        password_hash="x",
        system_role=SystemRole.EMPLOYEE,
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
    session.add_all([admin, employee, other_admin, location])
    session.commit()
    return {
        "company": company,
        "other": other,
        "admin": admin,
        "employee": employee,
        "other_admin": other_admin,
        "location": location,
    }


def test_validate_rejects_non_pdf_and_empty() -> None:
    with pytest.raises(UploadedRamsPdfValidationError):
        validate_uploaded_rams_pdf(filename="a.pdf", content_type="application/pdf", file_bytes=b"")
    with pytest.raises(UploadedRamsPdfValidationError):
        validate_uploaded_rams_pdf(filename="a.pdf", content_type="application/pdf", file_bytes=b"not-a-pdf")
    with pytest.raises(UploadedRamsPdfValidationError):
        validate_uploaded_rams_pdf(filename="a.docx", content_type="application/msword", file_bytes=MINI_PDF)
    name, media, digest = validate_uploaded_rams_pdf(
        filename="../../evil name.pdf",
        content_type="application/octet-stream",
        file_bytes=MINI_PDF,
    )
    assert name.endswith(".pdf")
    assert ".." not in name
    assert media == "application/pdf"
    assert len(digest) == 64


def test_authorised_upload_starts_draft(db_session: Session) -> None:
    world = _seed(db_session)
    detail = create_assessment_from_uploaded_pdf(
        db_session,
        world["admin"],
        file_bytes=MINI_PDF,
        filename="site-rams.pdf",
        content_type="application/pdf",
        title="Uploaded site RAMS",
        location_id=world["location"].id,
        produced_by_name="Site Manager",
        risk_level="high",
    )
    assert detail.status == "draft"
    assert detail.source_type == "uploaded_pdf"
    assert detail.uploaded_pdf is not None
    assert detail.uploaded_pdf.original_filename.endswith(".pdf")
    assert detail.uploaded_pdf.file_size_bytes == len(MINI_PDF)
    assert detail.hazards == []
    assert detail.document_sections is None
    row = db_session.get(RamsAssessment, detail.id)
    assert row is not None
    assert row.uploaded_pdf_storage_path


def test_employee_and_cross_company_upload_forbidden(db_session: Session) -> None:
    world = _seed(db_session)
    with pytest.raises(RamsPermissionError):
        create_assessment_from_uploaded_pdf(
            db_session,
            world["employee"],
            file_bytes=MINI_PDF,
            filename="a.pdf",
            content_type="application/pdf",
            title="Nope",
        )
    with pytest.raises(RamsPermissionError):
        create_assessment_from_uploaded_pdf(
            db_session,
            world["other_admin"],
            file_bytes=MINI_PDF,
            filename="a.pdf",
            content_type="application/pdf",
            title="Nope",
            company_id=world["company"].id,
        )


def test_publish_without_hazards_and_download_auth(db_session: Session) -> None:
    world = _seed(db_session)
    detail = create_assessment_from_uploaded_pdf(
        db_session,
        world["admin"],
        file_bytes=MINI_PDF,
        filename="a.pdf",
        content_type="application/pdf",
        title="Pub RAMS",
        location_id=world["location"].id,
    )
    published = publish_assessment(db_session, world["admin"], detail.id)
    assert published.status == "published"
    body, name = download_uploaded_rams_pdf(db_session, world["admin"], detail.id)
    assert body.startswith(b"%PDF")
    assert name.endswith(".pdf")
    with pytest.raises(Exception):
        download_uploaded_rams_pdf(db_session, world["employee"], detail.id)


def test_replace_draft_allowed_blocked_after_ack(db_session: Session) -> None:
    world = _seed(db_session)
    detail = create_assessment_from_uploaded_pdf(
        db_session,
        world["admin"],
        file_bytes=MINI_PDF,
        filename="a.pdf",
        content_type="application/pdf",
        title="Replace me",
    )
    replaced = replace_draft_uploaded_pdf(
        db_session,
        world["admin"],
        detail.id,
        file_bytes=MINI_PDF + b"\n",
        filename="b.pdf",
        content_type="application/pdf",
    )
    assert replaced.uploaded_pdf is not None
    assert replaced.uploaded_pdf.version == 2
    publish_assessment(db_session, world["admin"], detail.id)
    with pytest.raises(RamsValidationError):
        replace_draft_uploaded_pdf(
            db_session,
            world["admin"],
            detail.id,
            file_bytes=MINI_PDF,
            filename="c.pdf",
            content_type="application/pdf",
        )


def test_draft_delete_removes_file(db_session: Session) -> None:
    world = _seed(db_session)
    detail = create_assessment_from_uploaded_pdf(
        db_session,
        world["admin"],
        file_bytes=MINI_PDF,
        filename="del.pdf",
        content_type="application/pdf",
        title="Delete me",
    )
    row = db_session.get(RamsAssessment, detail.id)
    assert row is not None
    path = row.uploaded_pdf_storage_path
    from app.core.storage.factory import get_storage_backend

    assert get_storage_backend().exists(path)
    delete_assessment_hard(db_session, world["admin"], detail.id)
    assert db_session.get(RamsAssessment, detail.id) is None
    assert not get_storage_backend().exists(path)


def test_published_hard_delete_blocked(db_session: Session) -> None:
    world = _seed(db_session)
    detail = create_assessment_from_uploaded_pdf(
        db_session,
        world["admin"],
        file_bytes=MINI_PDF,
        filename="a.pdf",
        content_type="application/pdf",
        title="Keep",
    )
    publish_assessment(db_session, world["admin"], detail.id)
    with pytest.raises(RamsValidationError):
        delete_assessment_hard(db_session, world["admin"], detail.id)


def test_failed_create_removes_new_storage_object(db_session: Session, monkeypatch) -> None:
    world = _seed(db_session)
    from app.core.storage.factory import get_storage_backend
    from app.modules.rams import repository as rams_repo

    written: list[str] = []
    backend = get_storage_backend()
    original_write = backend.write_bytes

    def tracking_write(path: str, data: bytes) -> None:
        written.append(path)
        original_write(path, data)

    monkeypatch.setattr(backend, "write_bytes", tracking_write)

    def boom(*_a, **_k):
        raise RuntimeError("db/audit failed")

    monkeypatch.setattr(rams_repo, "save_assessment", boom)
    with pytest.raises(RuntimeError, match="db/audit failed"):
        create_assessment_from_uploaded_pdf(
            db_session,
            world["admin"],
            file_bytes=MINI_PDF,
            filename="fail.pdf",
            content_type="application/pdf",
            title="Fail create",
        )
    assert written
    assert not backend.exists(written[0])


def test_failed_replace_preserves_previous_pdf(db_session: Session, monkeypatch) -> None:
    world = _seed(db_session)
    from app.core.storage.factory import get_storage_backend
    from app.modules.rams import repository as rams_repo

    detail = create_assessment_from_uploaded_pdf(
        db_session,
        world["admin"],
        file_bytes=MINI_PDF,
        filename="keep.pdf",
        content_type="application/pdf",
        title="Keep PDF",
    )
    row = db_session.get(RamsAssessment, detail.id)
    assert row is not None
    old_path = row.uploaded_pdf_storage_path
    backend = get_storage_backend()
    assert backend.exists(old_path)
    old_bytes = backend.read_bytes(old_path)

    def boom(*_a, **_k):
        raise RuntimeError("replace commit failed")

    monkeypatch.setattr(rams_repo, "save_assessment", boom)
    with pytest.raises(RuntimeError, match="replace commit failed"):
        replace_draft_uploaded_pdf(
            db_session,
            world["admin"],
            detail.id,
            file_bytes=MINI_PDF + b"\n%new\n",
            filename="new.pdf",
            content_type="application/pdf",
        )
    db_session.rollback()
    row = db_session.get(RamsAssessment, detail.id)
    assert row is not None
    assert row.uploaded_pdf_storage_path == old_path
    assert backend.exists(old_path)
    assert backend.read_bytes(old_path) == old_bytes


def test_successful_replace_deletes_old_object(db_session: Session) -> None:
    world = _seed(db_session)
    from app.core.storage.factory import get_storage_backend

    detail = create_assessment_from_uploaded_pdf(
        db_session,
        world["admin"],
        file_bytes=MINI_PDF,
        filename="v1.pdf",
        content_type="application/pdf",
        title="Replace ok",
    )
    row = db_session.get(RamsAssessment, detail.id)
    assert row is not None
    old_path = row.uploaded_pdf_storage_path
    backend = get_storage_backend()
    replaced = replace_draft_uploaded_pdf(
        db_session,
        world["admin"],
        detail.id,
        file_bytes=MINI_PDF + b"\n%v2\n",
        filename="v2.pdf",
        content_type="application/pdf",
    )
    assert replaced.uploaded_pdf is not None
    assert replaced.uploaded_pdf.version == 2
    db_session.refresh(row)
    assert row.uploaded_pdf_storage_path != old_path
    assert backend.exists(row.uploaded_pdf_storage_path)
    assert not backend.exists(old_path)


def test_assigned_employee_can_download_cross_company_blocked(db_session: Session) -> None:
    from app.modules.rams.schemas import RamsAcknowledgementsAddRequest
    from app.modules.rams.service import add_acknowledgements

    world = _seed(db_session)
    detail = create_assessment_from_uploaded_pdf(
        db_session,
        world["admin"],
        file_bytes=MINI_PDF,
        filename="assign.pdf",
        content_type="application/pdf",
        title="Assigned",
        location_id=world["location"].id,
    )
    publish_assessment(db_session, world["admin"], detail.id)
    with pytest.raises(RamsNotFoundError):
        download_uploaded_rams_pdf(db_session, world["employee"], detail.id)

    add_acknowledgements(
        db_session,
        world["admin"],
        detail.id,
        RamsAcknowledgementsAddRequest(user_ids=[world["employee"].id]),
    )
    body, _name = download_uploaded_rams_pdf(db_session, world["employee"], detail.id)
    assert body.startswith(b"%PDF")

    with pytest.raises(RamsNotFoundError):
        download_uploaded_rams_pdf(db_session, world["other_admin"], detail.id)
