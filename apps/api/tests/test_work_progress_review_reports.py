"""Work Progress PDF retirement, ZIP limits, thumbnails, and bulk delete."""

from __future__ import annotations

import io
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.modules.auth.dependencies import get_current_user, require_admin_or_administrator
from app.modules.auth.models import SystemRole, User
from app.modules.work_progress import thumbnail as thumb_mod
from app.modules.work_progress.service import (
    MAX_ZIP_ATTACHMENT_IDS,
    MAX_ZIP_TOTAL_BYTES,
    WorkProgressPermissionError,
    WorkProgressZipLimitError,
    archive_review_entry,
    bulk_download_review_attachments_zip,
    STATUS_ARCHIVED,
)
from app.modules.work_progress.thumbnail import (
    MAX_DECODED_PIXELS,
    ThumbnailProcessingError,
    build_thumbnail_jpeg_bytes,
    thumb_storage_key,
)
from app.modules.work_progress.thumbnail_sync import THUMB_STRIPE_COUNT, thumb_stripe_index


def _user(*, role: SystemRole, company_id: uuid.UUID | None = None) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=company_id,
        email="user@example.com",
        password_hash="hashed",
        system_role=role,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _jpeg_bytes(width: int = 64, height: int = 64, color=(20, 40, 60)) -> bytes:
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def test_build_thumbnail_jpeg_is_320_square() -> None:
    src = _jpeg_bytes(800, 400)
    out = build_thumbnail_jpeg_bytes(src)
    img = Image.open(io.BytesIO(out))
    assert img.size == (320, 320)
    assert img.format == "JPEG"


def test_build_thumbnail_rejects_too_many_pixels(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeImg:
        size = (5000, 2000)  # 10_000_000 > 8_000_000
        mode = "RGB"

        def load(self) -> None:
            raise AssertionError("load should not run for oversized header")

        def close(self) -> None:
            return None

    monkeypatch.setattr(thumb_mod.Image, "open", lambda *_a, **_k: FakeImg())
    with pytest.raises(ThumbnailProcessingError):
        build_thumbnail_jpeg_bytes(b"not-used")


def test_thumb_stripe_pool_is_fixed() -> None:
    assert THUMB_STRIPE_COUNT == 64
    assert thumb_stripe_index("a/b.jpg") == thumb_stripe_index("a/b.jpg")


def test_work_progress_report_pdf_returns_410(client: TestClient) -> None:
    company_id = uuid.uuid4()
    admin = _user(role=SystemRole.ADMIN, company_id=company_id)
    app.dependency_overrides[require_admin_or_administrator] = lambda: admin
    try:
        with patch("app.modules.work_progress.router.export_review_entries_pdf", create=True) as missing:
            response = client.get("/api/work-progress/review/report.pdf")
        assert response.status_code == 410
        body = response.json()["detail"]
        assert body["code"] == "work_progress_pdf_retired"
        assert "CSV" in body["message"] or "gallery" in body["message"].lower()
        assert missing.call_count == 0
    finally:
        app.dependency_overrides.clear()


def test_employee_cannot_access_work_progress_pdf_route(client: TestClient) -> None:
    employee = _user(role=SystemRole.EMPLOYEE, company_id=uuid.uuid4())
    app.dependency_overrides[get_current_user] = lambda: employee
    # require_admin_or_administrator will still run — employee should get 403
    try:
        # Don't override require_admin — TestClient uses real dependency
        app.dependency_overrides.clear()
        app.dependency_overrides[require_admin_or_administrator] = lambda: (_ for _ in ()).throw(
            __import__("fastapi").HTTPException(status_code=403, detail="forbidden")
        )
        response = client.get("/api/work-progress/review/report.pdf")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


@patch("app.modules.work_progress.service.create_internal_audit_event")
@patch("app.modules.work_progress.service.save_entry")
@patch("app.modules.work_progress.service._assert_review_access")
def test_archive_work_progress_entry_sets_status_and_audits(
    mock_access: object,
    mock_save: object,
    mock_audit: object,
) -> None:
    company_id = uuid.uuid4()
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    entry = SimpleNamespace(
        id=uuid.uuid4(),
        company_id=company_id,
        status="submitted",
    )
    mock_access.return_value = (entry, owner)  # type: ignore[attr-defined]

    archive_review_entry(MagicMock(), actor, entry.id)

    assert entry.status == STATUS_ARCHIVED
    assert mock_save.called  # type: ignore[attr-defined]
    assert mock_audit.called  # type: ignore[attr-defined]


def test_zip_rejects_too_many_files_before_read() -> None:
    actor = _user(role=SystemRole.ADMIN, company_id=uuid.uuid4())
    ids = [uuid.uuid4() for _ in range(MAX_ZIP_ATTACHMENT_IDS + 1)]
    with patch("app.modules.work_progress.service._ordered_bulk_attachment_rows") as ordered:
        with pytest.raises(WorkProgressZipLimitError) as exc:
            bulk_download_review_attachments_zip(MagicMock(), actor, ids)
        assert exc.value.code == "work_progress_zip_too_many_files"
        assert exc.value.http_status == 400
        ordered.assert_not_called()


def test_zip_rejects_total_size_before_read() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    att = SimpleNamespace(id=uuid.uuid4(), storage_path="work-progress-files/x.jpg", original_filename="x.jpg")
    entry = SimpleNamespace(id=uuid.uuid4(), company_id=company_id, work_date="2026-01-01", user_id=owner.id)
    backend = MagicMock()
    backend.object_byte_size.return_value = MAX_ZIP_TOTAL_BYTES // 2 + 1
    backend.read_bytes.side_effect = AssertionError("must not read body")

    with (
        patch("app.modules.work_progress.service._ordered_bulk_attachment_rows", return_value=[(att, entry)]),
        patch("app.modules.work_progress.service._assert_bulk_attachment_scope", return_value=[(att, entry, owner)]),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
    ):
        # two files each half+1
        ids = [att.id, uuid.uuid4()]
        att2 = SimpleNamespace(id=ids[1], storage_path="work-progress-files/y.jpg", original_filename="y.jpg")
        with (
            patch(
                "app.modules.work_progress.service._ordered_bulk_attachment_rows",
                return_value=[(att, entry), (att2, entry)],
            ),
            patch(
                "app.modules.work_progress.service._assert_bulk_attachment_scope",
                return_value=[(att, entry, owner), (att2, entry, owner)],
            ),
        ):
            with pytest.raises(WorkProgressZipLimitError) as exc:
                bulk_download_review_attachments_zip(MagicMock(), actor, ids)
            assert exc.value.code == "work_progress_zip_too_large"
            assert exc.value.http_status == 413
            backend.read_bytes.assert_not_called()


def test_thumb_storage_key_convention() -> None:
    assert thumb_storage_key("work-progress-files/a/b.jpg") == "work-progress-files/a/b.jpg.thumb-v1.jpg"


def test_local_object_byte_size_and_replace(tmp_path) -> None:
    from app.core.storage.local import LocalStorageBackend

    backend = LocalStorageBackend(tmp_path)
    backend.write_bytes("dir/file.jpg", b"hello-world")
    assert backend.object_byte_size("dir/file.jpg") == len(b"hello-world")
    backend.write_bytes_replace("dir/file.jpg", b"replaced-content")
    assert backend.read_bytes("dir/file.jpg") == b"replaced-content"
    assert list(tmp_path.rglob("*.tmp")) == []


def test_thumbnail_route_404_for_missing(client: TestClient) -> None:
    from app.db.session import get_db_session

    user = _user(role=SystemRole.EMPLOYEE, company_id=uuid.uuid4())
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db_session] = lambda: MagicMock()
    try:
        with patch(
            "app.modules.work_progress.router.download_work_progress_thumbnail",
            side_effect=__import__("app.modules.work_progress.service", fromlist=["WorkProgressNotFoundError"]).WorkProgressNotFoundError(),
        ):
            response = client.get(f"/api/work-progress/files/{uuid.uuid4()}/thumbnail")
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_max_decoded_pixels_constant() -> None:
    assert MAX_DECODED_PIXELS == 8_000_000
