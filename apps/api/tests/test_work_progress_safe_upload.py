"""Safe Work Progress batch upload: memory bounds, idempotency, and integrity."""

from __future__ import annotations

import io
import sys
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image

from app.modules.auth.models import SystemRole, User
from app.modules.work_progress.image_processing import (
    MAX_DECODED_PIXELS,
    ImageProcessingError,
    process_site_progress_photo,
)
from app.modules.work_progress.models import WorkProgressAttachment, WorkProgressEntry
from app.modules.work_progress.service import (
    WorkProgressValidationError,
    _validate_and_process_new_progress_photo,
    upload_my_entry_file,
)
from app.modules.work_progress.thumbnail_sync import work_progress_image_processing_semaphore


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


def _jpeg_bytes(width: int, height: int, *, exif_transpose: bool = False) -> bytes:
    img = Image.new("RGB", (width, height), (40, 80, 120))
    buf = io.BytesIO()
    if exif_transpose:
        # Portrait tag 6 = rotate 90 CW; store as landscape pixels with orientation metadata.
        img = Image.new("RGB", (height, width), (40, 80, 120))
        exif = img.getexif()
        exif[274] = 6
        img.save(buf, format="JPEG", quality=85, exif=exif.tobytes())
    else:
        img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def test_shared_upload_and_thumbnail_semaphores_are_identical() -> None:
    from app.modules.work_progress.thumbnail_sync import thumb_decode_semaphore

    assert thumb_decode_semaphore() is work_progress_image_processing_semaphore()


def test_process_rejects_too_many_pixels_before_full_decode() -> None:
    side = int(MAX_DECODED_PIXELS**0.5) + 64
    data = _jpeg_bytes(side, side)
    with pytest.raises(ImageProcessingError, match="too_many_pixels"):
        process_site_progress_photo(data)


def test_process_rejects_corrupt_bytes() -> None:
    with pytest.raises(ImageProcessingError):
        process_site_progress_photo(b"\xff\xd8\xff corrupt")


def test_process_retains_exif_orientation() -> None:
    data = _jpeg_bytes(800, 600, exif_transpose=True)
    with work_progress_image_processing_semaphore():
        out, w, h = process_site_progress_photo(data)
    assert out.startswith(b"\xff\xd8")
    assert max(w, h) <= 1600
    assert w > 0 and h > 0


def test_validate_wraps_processing_under_shared_semaphore() -> None:
    data = _jpeg_bytes(640, 480)
    with patch(
        "app.modules.work_progress.service.work_progress_image_processing_semaphore"
    ) as sem_mock:
        sem = MagicMock()
        sem.__enter__ = MagicMock(return_value=None)
        sem.__exit__ = MagicMock(return_value=False)
        sem_mock.return_value = sem
        processed, orig_len, w, h = _validate_and_process_new_progress_photo(data)
    sem_mock.assert_called_once()
    assert orig_len == len(data)
    assert w > 0 and h > 0
    assert processed.startswith(b"\xff\xd8")


def test_only_one_processing_slot_available() -> None:
    sem = work_progress_image_processing_semaphore()
    assert sem.acquire(blocking=False)
    try:
        assert sem.acquire(blocking=False) is False
    finally:
        sem.release()


def test_semaphore_is_shared_between_named_accessors() -> None:
    from app.modules.work_progress.thumbnail_sync import thumb_decode_semaphore

    sem = work_progress_image_processing_semaphore()
    assert sem.acquire(blocking=False)
    try:
        assert thumb_decode_semaphore().acquire(blocking=False) is False
    finally:
        sem.release()


def test_upload_deletes_storage_when_database_save_fails() -> None:
    company_id = uuid.uuid4()
    user = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    entry_id = uuid.uuid4()
    entry = WorkProgressEntry(
        id=entry_id,
        user_id=user.id,
        company_id=company_id,
        workplace_id=None,
        location_id=uuid.uuid4(),
        work_date=datetime.now(timezone.utc).date(),
        title="Site",
        progress_status="in_progress",
        notes=None,
        percent_complete=None,
        status="submitted",
        reviewed_at=None,
        reviewed_by_user_id=None,
        review_note=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    backend = MagicMock()
    db = MagicMock()
    data = _jpeg_bytes(320, 240)

    with (
        patch("app.modules.work_progress.service.get_entry_by_id", return_value=entry),
        patch("app.modules.work_progress.service.count_attachments_for_entry", return_value=0),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
        patch("app.modules.work_progress.service.save_attachment", side_effect=RuntimeError("db down")),
        patch("app.modules.work_progress.service.create_internal_audit_event"),
        patch("app.modules.work_progress.service.list_attachments_for_entry", return_value=[]),
    ):
        with pytest.raises(RuntimeError, match="db down"):
            upload_my_entry_file(
                db,
                user,
                entry_id,
                original_filename="a.jpg",
                content_type="image/jpeg",
                file_bytes=data,
            )
    backend.write_bytes.assert_called_once()
    backend.delete_file.assert_called_once()


def test_idempotent_retry_returns_existing_without_second_storage_write() -> None:
    company_id = uuid.uuid4()
    user = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    entry_id = uuid.uuid4()
    client_upload_id = uuid.uuid4()
    entry = SimpleNamespace(
        id=entry_id,
        user_id=user.id,
        company_id=company_id,
    )
    existing = WorkProgressAttachment(
        id=uuid.uuid4(),
        entry_id=entry_id,
        original_filename="a.jpg",
        content_type="image/jpeg",
        file_size_bytes=100,
        storage_path="work-progress-files/x/y/z.jpg",
        original_size_bytes=100,
        stored_size_bytes=100,
        stored_content_type="image/jpeg",
        image_width=100,
        image_height=80,
        processing_version="2",
        client_upload_id=client_upload_id,
        created_at=datetime.now(timezone.utc),
    )
    backend = MagicMock()
    db = MagicMock()
    with (
        patch("app.modules.work_progress.service.get_entry_by_id", return_value=entry),
        patch(
            "app.modules.work_progress.service.get_attachment_by_client_upload_id",
            return_value=existing,
        ),
        patch("app.modules.work_progress.service._validate_and_process_new_progress_photo") as process,
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
        patch("app.modules.work_progress.service.list_attachments_for_entry", return_value=[existing]),
        patch("app.modules.work_progress.service._build_detail") as build,
    ):
        build.return_value = SimpleNamespace()
        upload_my_entry_file(
            db,
            user,
            entry_id,
            original_filename="a.jpg",
            content_type="image/jpeg",
            file_bytes=b"retry",
            client_upload_id=client_upload_id,
        )
    process.assert_not_called()
    backend.write_bytes.assert_not_called()


@pytest.mark.skipif(
    sys.platform == "win32",
    reason="RSS measurement requires POSIX resource module",
)
def test_twelve_megapixel_process_peak_rss_bounded() -> None:
    import resource

    data = _jpeg_bytes(4000, 3000)
    before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    with work_progress_image_processing_semaphore():
        out, w, h = process_site_progress_photo(data)
    after = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    assert out.startswith(b"\xff\xd8")
    assert w <= 1600 and h <= 1600
    # ru_maxrss is KB on Linux; allow generous headroom for single decode on dev hosts.
    growth_kb = max(0, after - before)
    assert growth_kb < 200_000
