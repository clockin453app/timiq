"""Additional Work Progress gallery safety tests."""

from __future__ import annotations

import io
import threading
import uuid
import warnings
import zipfile
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image

from app.modules.auth.models import SystemRole, User
from app.modules.work_progress.service import (
    MAX_STORED_JPEG_BYTES,
    MAX_ZIP_TOTAL_BYTES,
    WorkProgressNotFoundError,
    WorkProgressZipLimitError,
    bulk_delete_review_attachments,
    bulk_download_review_attachments_zip,
)
from app.modules.work_progress.thumbnail import (
    ThumbnailProcessingError,
    build_thumbnail_jpeg_bytes,
    ensure_thumbnail_bytes,
    thumb_storage_key,
)


def _user(*, role: SystemRole, company_id: uuid.UUID | None = None) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=company_id,
        email="u@example.com",
        password_hash="h",
        system_role=role,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


def test_ensure_thumbnail_rejects_oversized_before_read() -> None:
    att = SimpleNamespace(id=uuid.uuid4(), storage_path="work-progress-files/big.jpg")
    backend = MagicMock()
    backend.exists.return_value = False
    backend.object_byte_size.return_value = MAX_STORED_JPEG_BYTES + 1
    backend.get_backend_name.return_value = "local"
    backend.read_bytes.side_effect = AssertionError("must not read")

    with patch("app.modules.work_progress.thumbnail.get_storage_backend", return_value=backend):
        with pytest.raises(ThumbnailProcessingError):
            ensure_thumbnail_bytes(attachment=att, max_source_bytes=MAX_STORED_JPEG_BYTES, company_id=uuid.uuid4())
    backend.read_bytes.assert_not_called()


def test_bulk_delete_returns_counts_and_skips_missing_thumb() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    att = SimpleNamespace(id=uuid.uuid4(), storage_path="work-progress-files/a.jpg")
    entry = SimpleNamespace(id=uuid.uuid4(), company_id=company_id, user_id=owner.id)
    backend = MagicMock()

    def exists(path: str) -> bool:
        return path == "work-progress-files/a.jpg"

    backend.exists.side_effect = exists
    backend.get_backend_name.return_value = "local"

    db = MagicMock()
    with (
        patch("app.modules.work_progress.service._ordered_bulk_attachment_rows", return_value=[(att, entry)]),
        patch("app.modules.work_progress.service._assert_bulk_attachment_scope", return_value=[(att, entry, owner)]),
        patch("app.modules.work_progress.service.create_internal_audit_event") as audit,
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
    ):
        result = bulk_delete_review_attachments(db, actor, [att.id])

    db.delete.assert_called_once_with(att)
    assert audit.called
    assert result["deleted_count"] == 1
    assert result["storage_cleanup_failed"] == 0
    assert result["storage_cleanup_ok"] == 1
    assert result["warning"] is None


def test_bulk_delete_counts_failed_original() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    att = SimpleNamespace(id=uuid.uuid4(), storage_path="work-progress-files/a.jpg")
    entry = SimpleNamespace(id=uuid.uuid4(), company_id=company_id, user_id=owner.id)
    backend = MagicMock()
    backend.exists.return_value = True
    backend.delete_file.side_effect = OSError("deny")
    backend.get_backend_name.return_value = "local"

    with (
        patch("app.modules.work_progress.service._ordered_bulk_attachment_rows", return_value=[(att, entry)]),
        patch("app.modules.work_progress.service._assert_bulk_attachment_scope", return_value=[(att, entry, owner)]),
        patch("app.modules.work_progress.service.create_internal_audit_event"),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
    ):
        result = bulk_delete_review_attachments(MagicMock(), actor, [att.id])

    assert result["deleted_count"] == 1
    assert result["storage_cleanup_failed"] >= 1
    assert result["warning"] is not None
    assert "storage" in result["warning"].lower()
    assert "/" not in (result["warning"] or "")


def test_six_megabyte_jpeg_accepted_for_thumb_build() -> None:
    img = Image.new("RGB", (1200, 900), (10, 20, 30))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    encoded = buf.getvalue()
    data = encoded + (b"\0" * (6 * 1024 * 1024 - len(encoded)))
    assert 5 * 1024 * 1024 < len(data) < MAX_STORED_JPEG_BYTES
    from app.modules.work_progress.thumbnail import build_thumbnail_jpeg_bytes

    out = build_thumbnail_jpeg_bytes(data)
    assert out[:2] == b"\xff\xd8"


def _jpeg() -> bytes:
    image = Image.new("RGB", (640, 480), (30, 60, 90))
    with io.BytesIO() as buffer:
        image.save(buffer, format="JPEG", quality=85)
        return buffer.getvalue()


def test_thumbnail_cache_miss_generates_and_publishes() -> None:
    source = _jpeg()
    att = SimpleNamespace(id=uuid.uuid4(), storage_path="work-progress-files/cache-miss.jpg")
    backend = MagicMock()
    backend.exists.side_effect = lambda key: False
    backend.object_byte_size.return_value = len(source)
    backend.read_bytes.return_value = source
    backend.get_backend_name.return_value = "local"
    with patch("app.modules.work_progress.thumbnail.get_storage_backend", return_value=backend):
        result = ensure_thumbnail_bytes(attachment=att, max_source_bytes=MAX_STORED_JPEG_BYTES)
    assert result.startswith(b"\xff\xd8")
    backend.write_bytes_replace.assert_called_once()


def test_thumbnail_cache_hit_does_not_read_original() -> None:
    cached = b"\xff\xd8cached"
    att = SimpleNamespace(id=uuid.uuid4(), storage_path="work-progress-files/cache-hit.jpg")
    backend = MagicMock()
    backend.exists.return_value = True
    backend.read_bytes.return_value = cached
    with patch("app.modules.work_progress.thumbnail.get_storage_backend", return_value=backend):
        assert ensure_thumbnail_bytes(attachment=att, max_source_bytes=MAX_STORED_JPEG_BYTES) == cached
    backend.object_byte_size.assert_not_called()
    backend.write_bytes_replace.assert_not_called()


def test_thumbnail_post_read_size_guard() -> None:
    att = SimpleNamespace(id=uuid.uuid4(), storage_path="work-progress-files/changed.jpg")
    backend = MagicMock()
    backend.exists.return_value = False
    backend.object_byte_size.return_value = 10
    backend.read_bytes.return_value = b"x" * (MAX_STORED_JPEG_BYTES + 1)
    backend.get_backend_name.return_value = "local"
    with patch("app.modules.work_progress.thumbnail.get_storage_backend", return_value=backend):
        with pytest.raises(ThumbnailProcessingError, match="source_too_large"):
            ensure_thumbnail_bytes(attachment=att, max_source_bytes=MAX_STORED_JPEG_BYTES)
    backend.write_bytes_replace.assert_not_called()


def test_thumbnail_corrupt_original_is_rejected() -> None:
    with pytest.raises(ThumbnailProcessingError, match="corrupt"):
        build_thumbnail_jpeg_bytes(b"not-an-image")


def test_thumbnail_missing_original_does_not_decode() -> None:
    att = SimpleNamespace(id=uuid.uuid4(), storage_path="work-progress-files/missing.jpg")
    backend = MagicMock()
    backend.exists.return_value = False
    backend.object_byte_size.side_effect = FileNotFoundError()
    with patch("app.modules.work_progress.thumbnail.get_storage_backend", return_value=backend):
        with pytest.raises(FileNotFoundError):
            ensure_thumbnail_bytes(attachment=att, max_source_bytes=MAX_STORED_JPEG_BYTES)
    backend.read_bytes.assert_not_called()


def test_thumbnail_warning_and_error_are_processing_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    for error in (Image.DecompressionBombWarning("warning"), Image.DecompressionBombError("error")):
        monkeypatch.setattr("app.modules.work_progress.thumbnail.Image.open", MagicMock(side_effect=error))
        with pytest.raises(ThumbnailProcessingError, match="decompression_bomb"):
            build_thumbnail_jpeg_bytes(b"bytes")


def test_thumbnail_does_not_change_global_pillow_pixel_policy() -> None:
    before = Image.MAX_IMAGE_PIXELS
    build_thumbnail_jpeg_bytes(_jpeg())
    assert Image.MAX_IMAGE_PIXELS == before


def test_thumbnail_exif_orientation_path_is_applied() -> None:
    source = _jpeg()
    with patch("app.modules.work_progress.thumbnail.ImageOps.exif_transpose", wraps=__import__(
        "app.modules.work_progress.thumbnail", fromlist=["ImageOps"]
    ).ImageOps.exif_transpose) as transpose:
        result = build_thumbnail_jpeg_bytes(source)
    assert result.startswith(b"\xff\xd8")
    transpose.assert_called_once()


def test_zip_valid_request_returns_readable_archive() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    att = SimpleNamespace(id=uuid.uuid4(), storage_path="work-progress-files/a.jpg", original_filename="a.jpg")
    entry = SimpleNamespace(
        id=uuid.uuid4(),
        company_id=company_id,
        location_id=uuid.uuid4(),
        work_date="2026-07-29",
        user_id=owner.id,
        work_category="mastic",
        elevation="internal",
        elevation_custom=None,
        level=0,
        title="",
    )
    backend = MagicMock()
    backend.object_byte_size.return_value = 4
    backend.exists.return_value = True
    backend.read_bytes.return_value = b"data"
    with (
        patch("app.modules.work_progress.service._ordered_bulk_attachment_rows", return_value=[(att, entry)]),
        patch("app.modules.work_progress.service._assert_bulk_attachment_scope", return_value=[(att, entry, owner)]),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
        patch("app.modules.work_progress.service.create_internal_audit_event"),
        patch("app.modules.work_progress.service.get_employee_profile_by_user_id", return_value=None),
        patch("app.modules.work_progress.service._location_name", return_value="Kennington"),
    ):
        result = bulk_download_review_attachments_zip(MagicMock(), actor, [att.id])
    with zipfile.ZipFile(io.BytesIO(result)) as archive:
        name = archive.namelist()[0]
        assert archive.read(name) == b"data"
        assert name.startswith("Kennington/Mastic/Internal/Level 00/")
        assert name.endswith("/a.jpg")
        assert ".." not in name


def test_zip_actual_bytes_over_limit_are_rejected() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    att = SimpleNamespace(id=uuid.uuid4(), storage_path="work-progress-files/grown.jpg", original_filename="grown.jpg")
    entry = SimpleNamespace(id=uuid.uuid4(), company_id=company_id, work_date="2026-07-29", user_id=owner.id)
    backend = MagicMock()
    backend.object_byte_size.return_value = 1
    backend.exists.return_value = True
    backend.read_bytes.return_value = b"x" * (MAX_ZIP_TOTAL_BYTES + 1)
    with (
        patch("app.modules.work_progress.service._ordered_bulk_attachment_rows", return_value=[(att, entry)]),
        patch("app.modules.work_progress.service._assert_bulk_attachment_scope", return_value=[(att, entry, owner)]),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
    ):
        with pytest.raises(WorkProgressZipLimitError) as exc:
            bulk_download_review_attachments_zip(MagicMock(), actor, [att.id])
    assert exc.value.http_status == 413


def test_zip_generation_semaphore_serializes_body_reads() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    entry = SimpleNamespace(
        id=uuid.uuid4(),
        company_id=company_id,
        location_id=uuid.uuid4(),
        work_date="2026-07-29",
        user_id=owner.id,
        work_category=None,
        elevation=None,
        elevation_custom=None,
        level=None,
        title="Legacy",
    )
    active = 0
    peak = 0
    guard = threading.Lock()
    backend = MagicMock()
    backend.object_byte_size.return_value = 4
    backend.exists.return_value = True

    def read_bytes(_key: str) -> bytes:
        nonlocal active, peak
        with guard:
            active += 1
            peak = max(peak, active)
        threading.Event().wait(0.03)
        with guard:
            active -= 1
        return b"data"

    backend.read_bytes.side_effect = read_bytes

    def run(index: int) -> None:
        att = SimpleNamespace(
            id=uuid.uuid4(),
            storage_path=f"work-progress-files/{index}.jpg",
            original_filename=f"{index}.jpg",
        )
        with (
            patch("app.modules.work_progress.service._ordered_bulk_attachment_rows", return_value=[(att, entry)]),
            patch("app.modules.work_progress.service._assert_bulk_attachment_scope", return_value=[(att, entry, owner)]),
            patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
            patch("app.modules.work_progress.service.create_internal_audit_event"),
        ):
            bulk_download_review_attachments_zip(MagicMock(), actor, [att.id])

    with (
        patch(
            "app.modules.work_progress.service.get_employee_profile_by_user_id",
            return_value=SimpleNamespace(first_name="Pat", last_name="Lee"),
        ),
        patch("app.modules.work_progress.service._location_name", return_value="Site"),
    ):
        threads = [threading.Thread(target=run, args=(i,)) for i in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    assert peak == 1


def test_bulk_delete_counts_attachments_not_objects() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    attachments = [
        SimpleNamespace(id=uuid.uuid4(), storage_path=f"work-progress-files/{index}.jpg")
        for index in range(2)
    ]
    entry = SimpleNamespace(id=uuid.uuid4(), company_id=company_id, user_id=owner.id)
    rows = [(attachment, entry) for attachment in attachments]
    triples = [(attachment, entry, owner) for attachment in attachments]
    backend = MagicMock()
    backend.exists.return_value = True
    backend.get_backend_name.return_value = "local"
    with (
        patch("app.modules.work_progress.service._ordered_bulk_attachment_rows", return_value=rows),
        patch("app.modules.work_progress.service._assert_bulk_attachment_scope", return_value=triples),
        patch("app.modules.work_progress.service.create_internal_audit_event"),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
    ):
        result = bulk_delete_review_attachments(MagicMock(), actor, [attachment.id for attachment in attachments])
    assert result == {
        "deleted_count": 2,
        "storage_cleanup_ok": 2,
        "storage_cleanup_failed": 0,
        "warning": None,
    }


def test_bulk_delete_one_failed_original_counts_one_failed_attachment() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    attachments = [
        SimpleNamespace(id=uuid.uuid4(), storage_path=f"work-progress-files/{index}.jpg")
        for index in range(2)
    ]
    entry = SimpleNamespace(id=uuid.uuid4(), company_id=company_id, user_id=owner.id)
    rows = [(attachment, entry) for attachment in attachments]
    triples = [(attachment, entry, owner) for attachment in attachments]
    backend = MagicMock()
    backend.exists.return_value = True
    backend.get_backend_name.return_value = "local"

    def delete(path: str) -> None:
        if path == attachments[0].storage_path:
            raise OSError("failed")

    backend.delete_file.side_effect = delete
    with (
        patch("app.modules.work_progress.service._ordered_bulk_attachment_rows", return_value=rows),
        patch("app.modules.work_progress.service._assert_bulk_attachment_scope", return_value=triples),
        patch("app.modules.work_progress.service.create_internal_audit_event"),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
    ):
        result = bulk_delete_review_attachments(MagicMock(), actor, [attachment.id for attachment in attachments])
    assert result["deleted_count"] == 2
    assert result["storage_cleanup_ok"] == 1
    assert result["storage_cleanup_failed"] == 1
    assert "/" not in str(result["warning"])
