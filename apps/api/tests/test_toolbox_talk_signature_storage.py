"""Toolbox Talk drawn-signature storage integrity and PDF evidence."""

from __future__ import annotations

import io
import uuid
from datetime import datetime, timezone

import pytest
from PIL import Image
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.storage.factory import get_storage_backend
from app.db.base import Base
from app.db import models as _models  # noqa: F401
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company
from app.modules.locations.models import Location
from app.modules.toolbox_talks.models import ToolboxTalk, ToolboxTalkAttendee
from app.modules.toolbox_talks.pdf_export import (
    ToolboxTalkAttendeePdfRow,
    build_toolbox_talk_pdf,
    pdf_embedded_image_count,
    pdf_text_haystack,
)
from app.modules.toolbox_talks.schemas import (
    ToolboxTalkAttendeesAddRequest,
    ToolboxTalkCreateRequest,
    ToolboxTalkSignRequest,
)
from app.modules.toolbox_talks.service import (
    ToolboxTalkNotFoundError,
    ToolboxTalkValidationError,
    _read_attendee_signature_png,
    _signature_cell_for_export,
    add_attendees,
    create_talk,
    export_talk_pdf_bytes,
    get_talk_for_viewer,
    publish_talk,
    sign_talk,
)

LOCAL_ADMIN_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
DB_NAME = "timiq_toolbox_talk_sig_storage_it"

TINY_PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _local_postgres_available() -> bool:
    try:
        eng = create_engine(LOCAL_ADMIN_URL, isolation_level="AUTOCOMMIT")
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _local_postgres_available(), reason="Local Postgres required")


def _png_bytes(*, color: tuple[int, int, int] = (10, 20, 30)) -> bytes:
    img = Image.new("RGB", (80, 30), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _png_data_url(png: bytes | None = None) -> str:
    import base64

    raw = png or _png_bytes()
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")


@pytest.fixture()
def db_session(tmp_path, monkeypatch) -> Session:
    from app.core.config import settings

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
    company = Company(id=uuid.uuid4(), name=f"Sig Co {uuid.uuid4().hex[:6]}", is_active=True)
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
        name="Site",
        address="1 Rd",
        latitude=51.5,
        longitude=-0.1,
        geofence_radius_meters=100,
        is_active=True,
    )
    session.add_all([admin, emp, other_admin, location])
    session.commit()
    return {"company": company, "other": other, "admin": admin, "emp": emp, "other_admin": other_admin, "location": location}


def _published_talk(session: Session, world: dict) -> ToolboxTalk:
    detail = create_talk(
        session,
        world["admin"],
        ToolboxTalkCreateRequest(
            company_id=world["company"].id,
            title="Sig talk",
            topic="manual_handling",
            talk_body="Purpose\nTest body for signature storage.\n\nSign-off declaration\nUnderstood.",
            location_id=world["location"].id,
            scheduled_date=None,
        ),
    )
    add_attendees(
        session,
        world["admin"],
        detail.id,
        ToolboxTalkAttendeesAddRequest(user_ids=[world["emp"].id]),
    )
    publish_talk(session, world["admin"], detail.id)
    talk = session.get(ToolboxTalk, detail.id)
    assert talk is not None
    return talk


def _attendee(session: Session, talk_id: uuid.UUID, user_id: uuid.UUID) -> ToolboxTalkAttendee:
    from sqlalchemy import select

    row = session.scalar(
        select(ToolboxTalkAttendee).where(
            ToolboxTalkAttendee.talk_id == talk_id,
            ToolboxTalkAttendee.user_id == user_id,
        )
    )
    assert row is not None
    return row


def test_drawn_signature_persists_png_and_path(db_session: Session) -> None:
    world = _seed(db_session)
    talk = _published_talk(db_session, world)
    png = _png_bytes(color=(11, 22, 33))
    detail = sign_talk(
        db_session,
        world["emp"],
        talk.id,
        ToolboxTalkSignRequest(
            attended_ack=True,
            signature_name="Drawn Emp",
            signature_image_data=_png_data_url(png),
        ),
    )
    att = _attendee(db_session, talk.id, world["emp"].id)
    assert att.status == "signed"
    assert att.signature_method == "app_signature"
    assert att.signature_name == "Drawn Emp"
    assert att.signature_image_path
    assert att.signature_image_path.startswith(f"toolbox-talk-signatures/{world['company'].id}/{talk.id}/{world['emp'].id}/")
    assert not att.signature_image_path.startswith("/") and ":" not in att.signature_image_path[:3]
    backend = get_storage_backend()
    assert backend.get_backend_name() == "local"
    assert backend.exists(att.signature_image_path)
    stored = backend.read_bytes(att.signature_image_path)
    assert stored == png
    assert stored.startswith(b"\x89PNG")
    assert detail.attendees[0].has_signature is True
    assert detail.attendees[0].signature_image_available is True


def test_sign_and_pdf_use_same_storage_backend_and_embed(db_session: Session) -> None:
    world = _seed(db_session)
    talk = _published_talk(db_session, world)
    png = _png_bytes(color=(200, 10, 10))
    sign_talk(
        db_session,
        world["emp"],
        talk.id,
        ToolboxTalkSignRequest(attended_ack=True, signature_name="Drawn Emp", signature_image_data=_png_data_url(png)),
    )
    att = _attendee(db_session, talk.id, world["emp"].id)
    write_backend = get_storage_backend()
    read_backend = get_storage_backend()
    assert write_backend is read_backend
    assert write_backend.exists(att.signature_image_path)
    assert write_backend.read_bytes(att.signature_image_path) == png

    pdf, _name = export_talk_pdf_bytes(db_session, world["admin"], talk.id)
    assert pdf[:4] == b"%PDF"
    hay = pdf_text_haystack(pdf)
    assert b"Signature unavailable" not in hay
    assert b"toolbox-talk-signatures/" not in hay
    assert pdf_embedded_image_count(pdf) >= 1
    assert b"Drawn Emp" in hay


def test_storage_failure_prevents_signed_status(db_session: Session, monkeypatch) -> None:
    world = _seed(db_session)
    talk = _published_talk(db_session, world)
    backend = get_storage_backend()

    def boom(*_a, **_k):
        raise OSError("disk full")

    monkeypatch.setattr(backend, "write_bytes", boom)
    with pytest.raises(ToolboxTalkValidationError, match="Could not store your signature image"):
        sign_talk(
            db_session,
            world["emp"],
            talk.id,
            ToolboxTalkSignRequest(
                attended_ack=True,
                signature_name="Should Fail",
                signature_image_data=_png_data_url(),
            ),
        )
    att = _attendee(db_session, talk.id, world["emp"].id)
    assert att.status == "pending"
    assert att.signature_image_path is None
    assert att.signed_at is None
    assert att.signature_name is None


def test_db_failure_after_storage_rolls_back_and_deletes_object(db_session: Session, monkeypatch) -> None:
    world = _seed(db_session)
    talk = _published_talk(db_session, world)
    from app.modules.toolbox_talks import repository as tt_repo

    written: list[str] = []
    backend = get_storage_backend()
    original_write = backend.write_bytes

    def track_write(path: str, data: bytes) -> None:
        written.append(path)
        original_write(path, data)

    monkeypatch.setattr(backend, "write_bytes", track_write)

    def boom(*_a, **_k):
        raise RuntimeError("db commit failed")

    monkeypatch.setattr(tt_repo, "save_attendee", boom)
    with pytest.raises(RuntimeError, match="db commit failed"):
        sign_talk(
            db_session,
            world["emp"],
            talk.id,
            ToolboxTalkSignRequest(
                attended_ack=True,
                signature_name="Rollback",
                signature_image_data=_png_data_url(),
            ),
        )
    att = _attendee(db_session, talk.id, world["emp"].id)
    assert att.status == "pending"
    assert att.signature_image_path is None
    assert written
    assert not backend.exists(written[0])


def test_missing_object_honest_fallback_does_not_fabricate(db_session: Session) -> None:
    world = _seed(db_session)
    talk = _published_talk(db_session, world)
    sign_talk(
        db_session,
        world["emp"],
        talk.id,
        ToolboxTalkSignRequest(attended_ack=True, signature_name="Drawn Emp", signature_image_data=_png_data_url()),
    )
    att = _attendee(db_session, talk.id, world["emp"].id)
    path = att.signature_image_path
    get_storage_backend().delete_file(path)
    assert not get_storage_backend().exists(path)

    raw, reason = _read_attendee_signature_png(att)
    assert raw is None and reason == "missing_object"
    pdf, _ = export_talk_pdf_bytes(db_session, world["admin"], talk.id)
    hay = pdf_text_haystack(pdf)
    assert b"Signature unavailable" in hay
    assert b"Drawn Emp" in hay
    assert att.signed_at is not None
    assert pdf_embedded_image_count(pdf) == 0

    admin_detail = get_talk_for_viewer(db_session, world["admin"], talk.id)
    row = admin_detail.attendees[0]
    assert row.signature_evidence_warning
    assert row.signature_image_available is False
    assert row.signature_name == "Drawn Emp"
    assert row.signed_at is not None


def test_corrupt_image_honest_fallback(db_session: Session) -> None:
    world = _seed(db_session)
    talk = _published_talk(db_session, world)
    sign_talk(
        db_session,
        world["emp"],
        talk.id,
        ToolboxTalkSignRequest(attended_ack=True, signature_name="Drawn Emp", signature_image_data=_png_data_url()),
    )
    att = _attendee(db_session, talk.id, world["emp"].id)
    get_storage_backend().write_bytes(att.signature_image_path, b"not-a-png")
    raw, reason = _read_attendee_signature_png(att)
    assert raw is None and reason == "corrupt"
    pdf, _ = export_talk_pdf_bytes(db_session, world["admin"], talk.id)
    assert b"Signature unavailable" in pdf_text_haystack(pdf)


def test_old_signed_row_without_image_not_fabricated() -> None:
    att = ToolboxTalkAttendee(
        id=uuid.uuid4(),
        talk_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        status="signed",
        signature_method="app_signature",
        signature_name="Legacy",
        signature_image_path=None,
        signed_at=datetime.now(timezone.utc),
    )
    raw, reason = _read_attendee_signature_png(att)
    assert raw is None and reason == "missing_path"
    img, text = _signature_cell_for_export(att, image_bytes=None, load_reason=reason)
    assert img is None and text == "Signature unavailable"
    pdf = build_toolbox_talk_pdf(
        company_name="Co",
        title="Talk",
        topic_display="Topic",
        location_name="Site",
        scheduled="1 Aug 2026",
        talk_status="published",
        presenter_display="P",
        talk_body="Body",
        attendees_rows=[
            ToolboxTalkAttendeePdfRow(
                employee="Legacy (l@e.com)",
                status="signed",
                signed_date="1 Aug 2026",
                printed_name="Legacy",
                signature_text="Signature unavailable",
            ),
        ],
    )
    hay = pdf_text_haystack(pdf)
    assert b"Signature unavailable" in hay
    assert b"Legacy" in hay
    assert pdf_embedded_image_count(pdf) == 0


def test_cross_company_pdf_blocked(db_session: Session) -> None:
    world = _seed(db_session)
    talk = _published_talk(db_session, world)
    sign_talk(
        db_session,
        world["emp"],
        talk.id,
        ToolboxTalkSignRequest(attended_ack=True, signature_name="Drawn Emp", signature_image_data=_png_data_url()),
    )
    with pytest.raises(ToolboxTalkNotFoundError):
        export_talk_pdf_bytes(db_session, world["other_admin"], talk.id)


def test_storage_survives_backend_cache_clear(db_session: Session) -> None:
    """Simulate service recycle: clear lru_cache, re-resolve same root, object still present."""
    world = _seed(db_session)
    talk = _published_talk(db_session, world)
    png = _png_bytes()
    sign_talk(
        db_session,
        world["emp"],
        talk.id,
        ToolboxTalkSignRequest(attended_ack=True, signature_name="Drawn Emp", signature_image_data=_png_data_url(png)),
    )
    att = _attendee(db_session, talk.id, world["emp"].id)
    path = att.signature_image_path
    get_storage_backend.cache_clear()
    backend = get_storage_backend()
    assert backend.exists(path)
    assert backend.read_bytes(path) == png
    pdf, _ = export_talk_pdf_bytes(db_session, world["admin"], talk.id)
    assert pdf_embedded_image_count(pdf) >= 1
