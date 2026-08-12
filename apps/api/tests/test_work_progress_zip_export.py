"""Work Progress ZIP export path sanitisation and hierarchy tests."""

from __future__ import annotations

import io
import uuid
import zipfile
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.modules.auth.models import SystemRole, User
from app.modules.work_progress.service import (
    MAX_ZIP_ATTACHMENT_IDS,
    WorkProgressZipLimitError,
    bulk_download_review_attachments_zip,
)
from app.modules.work_progress.zip_export import (
    build_work_progress_zip_arcname,
    sanitize_zip_filename,
    sanitize_zip_path_component,
)


def _user(*, role: SystemRole, company_id: uuid.UUID | None = None, email: str = "u@example.com") -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=company_id,
        email=email,
        password_hash="h",
        system_role=role,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


def test_sanitize_blocks_traversal_and_drive_prefixes() -> None:
    assert ".." not in sanitize_zip_path_component("../etc/passwd")
    assert "/" not in sanitize_zip_path_component("../etc/passwd")
    assert "\\" not in sanitize_zip_path_component("..\\windows\\system32")
    assert ".." not in sanitize_zip_path_component("../../evil")
    assert "/" not in sanitize_zip_path_component("a/b/c")
    assert sanitize_zip_path_component("C:\\Secrets\\x") == "Secrets-x"


def test_sanitize_filename_strips_path_and_unsafe_chars() -> None:
    assert sanitize_zip_filename("../../evil.jpg") == "evil.jpg"
    assert sanitize_zip_filename("photo:name*.jpg") == "photo-name.jpg"
    assert sanitize_zip_filename("") == "picture.jpg"


def test_classified_hierarchy_level_zero() -> None:
    used: set[str] = set()
    arc = build_work_progress_zip_arcname(
        site_name="Kennington",
        work_category="brickwork_level",
        elevation="south",
        elevation_custom=None,
        level=0,
        legacy_title="",
        employee_name="Marius mrotaru",
        employee_email="m@ex.com",
        work_date=date(2026, 8, 12),
        original_filename="IMG_1234.jpg",
        used_arcnames=used,
    )
    assert arc == "Kennington/Brickwork level/South/Level 00/Marius mrotaru/12 Aug 2026/IMG_1234.jpg"


def test_custom_elevation_uses_display_inside_zip() -> None:
    used: set[str] = set()
    arc = build_work_progress_zip_arcname(
        site_name="Kennington",
        work_category="insulation",
        elevation="custom",
        elevation_custom="Elevation A / Courtyard Return",
        level=4,
        legacy_title=None,
        employee_name="Ion Gradina",
        employee_email=None,
        work_date=date(2026, 8, 5),
        original_filename="shot.jpg",
        used_arcnames=used,
    )
    assert "Elevation A - Courtyard Return" in arc
    assert "Custom / site-defined" not in arc
    assert "Level 04" in arc
    assert ".." not in arc


def test_custom_elevation_traversal_neutralized() -> None:
    used: set[str] = set()
    arc = build_work_progress_zip_arcname(
        site_name="Site",
        work_category="mastic",
        elevation="custom",
        elevation_custom="../escape",
        level=1,
        legacy_title=None,
        employee_name="A",
        employee_email=None,
        work_date=date(2026, 8, 1),
        original_filename="a.jpg",
        used_arcnames=used,
    )
    parts = arc.split("/")
    assert ".." not in parts
    assert all(p != ".." for p in parts)
    assert parts[2] == "escape"


def test_legacy_uses_title_not_fake_classification() -> None:
    used: set[str] = set()
    arc = build_work_progress_zip_arcname(
        site_name="Kennington",
        work_category=None,
        elevation=None,
        elevation_custom=None,
        level=None,
        legacy_title="Pointing",
        employee_name="Ion Gradina",
        employee_email=None,
        work_date=date(2026, 8, 5),
        original_filename="pic.jpg",
        used_arcnames=used,
    )
    assert arc.startswith("Kennington/Legacy/Pointing/")
    assert "Brickwork" not in arc


def test_legacy_unclassified_when_title_missing() -> None:
    used: set[str] = set()
    arc = build_work_progress_zip_arcname(
        site_name="Kennington",
        work_category=None,
        elevation=None,
        elevation_custom=None,
        level=None,
        legacy_title="  ",
        employee_name="A",
        employee_email=None,
        work_date=date(2026, 8, 5),
        original_filename="pic.jpg",
        used_arcnames=used,
    )
    assert "/Legacy/Unclassified/" in arc


def test_duplicate_filenames_get_suffixes() -> None:
    used: set[str] = set()
    kwargs = dict(
        site_name="Kennington",
        work_category="mastic",
        elevation="internal",
        elevation_custom=None,
        level=0,
        legacy_title=None,
        employee_name="Ion",
        employee_email=None,
        work_date=date(2026, 8, 12),
        original_filename="IMG_1234.jpg",
    )
    a = build_work_progress_zip_arcname(**kwargs, used_arcnames=used)
    b = build_work_progress_zip_arcname(**kwargs, used_arcnames=used)
    c = build_work_progress_zip_arcname(**kwargs, used_arcnames=used)
    assert a.endswith("IMG_1234.jpg")
    assert b.endswith("IMG_1234-2.jpg")
    assert c.endswith("IMG_1234-3.jpg")
    assert len({a, b, c}) == 3


def test_zip_download_writes_hierarchy_and_preserves_selected_only() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id, email="emp@ex.com")
    loc_id = uuid.uuid4()
    att = SimpleNamespace(
        id=uuid.uuid4(),
        storage_path="work-progress-files/a.jpg",
        original_filename="IMG_1234.jpg",
    )
    entry = SimpleNamespace(
        id=uuid.uuid4(),
        company_id=company_id,
        location_id=loc_id,
        work_date=date(2026, 8, 12),
        user_id=owner.id,
        work_category="brickwork_level",
        elevation="south",
        elevation_custom=None,
        level=0,
        title="",
    )
    backend = MagicMock()
    backend.object_byte_size.return_value = 4
    backend.exists.return_value = True
    backend.read_bytes.return_value = b"data"
    db = MagicMock()
    with (
        patch("app.modules.work_progress.service._ordered_bulk_attachment_rows", return_value=[(att, entry)]),
        patch("app.modules.work_progress.service._assert_bulk_attachment_scope", return_value=[(att, entry, owner)]),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
        patch("app.modules.work_progress.service.create_internal_audit_event"),
        patch("app.modules.work_progress.service.get_employee_profile_by_user_id", return_value=None),
        patch("app.modules.work_progress.service._location_name", return_value="Kennington"),
    ):
        result = bulk_download_review_attachments_zip(db, actor, [att.id])
    with zipfile.ZipFile(io.BytesIO(result)) as archive:
        names = archive.namelist()
        assert len(names) == 1
        assert names[0] == "Kennington/Brickwork level/South/Level 00/emp@ex.com/12 Aug 2026/IMG_1234.jpg"
        assert archive.read(names[0]) == b"data"
        assert all(".." not in n for n in names)


def test_zip_limit_48_still_enforced() -> None:
    actor = _user(role=SystemRole.ADMIN, company_id=uuid.uuid4())
    ids = [uuid.uuid4() for _ in range(MAX_ZIP_ATTACHMENT_IDS + 1)]
    with pytest.raises(WorkProgressZipLimitError) as exc:
        bulk_download_review_attachments_zip(MagicMock(), actor, ids)
    assert exc.value.code == "work_progress_zip_too_many_files"
