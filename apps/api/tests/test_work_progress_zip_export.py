"""Work Progress ZIP export: flat folders, sanitisation, and data-integrity gates."""

from __future__ import annotations

import hashlib
import io
import os
import random
import re
import tempfile
import time
import tracemalloc
import uuid
import zipfile
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine, func, inspect as sa_inspect, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db import models as _models  # noqa: F401
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company
from app.modules.locations.models import Location
from app.modules.work_progress.classification import CLASSIFIED_PROGRESS_STATUS
from app.modules.work_progress.models import WorkProgressAttachment, WorkProgressEntry
from app.modules.work_progress.repository import list_review_entries
from app.modules.work_progress.service import (
    MAX_ZIP_ATTACHMENT_IDS,
    MAX_ZIP_SPOOL_MEMORY_BYTES,
    MAX_ZIP_TOTAL_BYTES,
    WorkProgressNotFoundError,
    WorkProgressZipLimitError,
    _classification_fields,
    _build_attachments_zip_spool,
    _iter_zip_spool,
    bulk_download_review_attachments_zip,
)
from app.modules.work_progress.zip_export import (
    build_work_progress_zip_arcname,
    parse_submit_audit_classification,
    resolve_zip_folder_classification,
    sanitize_zip_filename,
    sanitize_zip_path_component,
)
from app.modules.workplaces.models import Workplace


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


def _arc(**overrides):
    kwargs = dict(
        site_name="Kennington",
        work_category="brickwork_ties",
        elevation="north",
        elevation_custom=None,
        level=0,
        legacy_title="",
        employee_name="Petre Rotaru",
        employee_email="petre@ex.com",
        work_date=date(2026, 8, 15),
        original_filename="IMG_3298.jpg",
        used_arcnames=set(),
    )
    kwargs.update(overrides)
    return build_work_progress_zip_arcname(**kwargs)


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


def test_classified_flat_folder_level_zero() -> None:
    arc = _arc()
    assert arc == "Brickwork ties - North - Level 00 - Petre Rotaru - 15 Aug 2026/IMG_3298.jpg"
    assert arc.count("/") == 1


def test_photos_share_one_folder_per_entry() -> None:
    used: set[str] = set()
    folders: dict[str, str] = {}
    entry_id = uuid.uuid4()
    names = [
        _arc(
            original_filename=name,
            used_arcnames=used,
            entry_id=entry_id,
            used_folder_by_entry=folders,
        )
        for name in ("IMG_3298.jpg", "IMG_3301.jpg", "IMG_3302.jpg")
    ]
    dirs = {item.rsplit("/", 1)[0] for item in names}
    assert dirs == {"Brickwork ties - North - Level 00 - Petre Rotaru - 15 Aug 2026"}
    assert {item.rsplit("/", 1)[1] for item in names} == {
        "IMG_3298.jpg",
        "IMG_3301.jpg",
        "IMG_3302.jpg",
    }


def test_identical_metadata_different_entries_stay_separate() -> None:
    used: set[str] = set()
    folders: dict[str, str] = {}
    first = _arc(
        used_arcnames=used,
        entry_id=uuid.uuid4(),
        used_folder_by_entry=folders,
        original_filename="a.jpg",
    )
    second = _arc(
        used_arcnames=used,
        entry_id=uuid.uuid4(),
        used_folder_by_entry=folders,
        original_filename="b.jpg",
    )
    assert first.startswith("Brickwork ties - North - Level 00 - Petre Rotaru - 15 Aug 2026/")
    assert second.startswith("Brickwork ties - North - Level 00 - Petre Rotaru - 15 Aug 2026 (2)/")
    assert first.rsplit("/", 1)[0] != second.rsplit("/", 1)[0]


def test_one_site_omits_site_from_folder() -> None:
    arc = _arc(include_site=False)
    assert not arc.startswith("Kennington/")
    assert "Kennington - " not in arc


def test_multi_site_prefixes_site() -> None:
    arc = _arc(include_site=True)
    assert arc.startswith("Kennington - Brickwork ties - North - Level 00 - Petre Rotaru - 15 Aug 2026/")


def test_custom_elevation_uses_display_inside_zip() -> None:
    arc = _arc(
        work_category="insulation",
        elevation="custom",
        elevation_custom="Elevation A / Courtyard Return",
        level=4,
        employee_name="Ion Gradina",
        work_date=date(2026, 8, 5),
        original_filename="shot.jpg",
        used_arcnames=set(),
    )
    assert "Elevation A - Courtyard Return" in arc
    assert "Custom / site-defined" not in arc
    assert "Level 04" in arc
    assert arc.count("/") == 1
    assert ".." not in arc


def test_custom_elevation_traversal_neutralized() -> None:
    arc = _arc(
        site_name="Site",
        work_category="mastic",
        elevation="custom",
        elevation_custom="../escape",
        level=1,
        employee_name="A",
        work_date=date(2026, 8, 1),
        original_filename="a.jpg",
        used_arcnames=set(),
    )
    parts = arc.split("/")
    assert len(parts) == 2
    assert ".." not in parts
    assert "escape" in parts[0]


def test_legacy_uses_title_not_fake_classification() -> None:
    arc = _arc(
        work_category=None,
        elevation=None,
        level=None,
        legacy_title="Pointing",
        employee_name="Ion Gradina",
        work_date=date(2026, 8, 5),
        original_filename="pic.jpg",
        used_arcnames=set(),
    )
    assert arc == "Pointing - Ion Gradina - 05 Aug 2026/pic.jpg"
    assert "Brickwork" not in arc
    assert "/Legacy/" not in arc


def test_legacy_unclassified_when_title_missing() -> None:
    arc = _arc(
        work_category=None,
        elevation=None,
        level=None,
        legacy_title="  ",
        employee_name="A",
        work_date=date(2026, 8, 5),
        original_filename="pic.jpg",
        used_arcnames=set(),
    )
    assert arc.startswith("Unclassified - A - 05 Aug 2026/")
    assert "/Legacy/" not in arc


def test_duplicate_filenames_get_suffixes() -> None:
    used: set[str] = set()
    folders: dict[str, str] = {}
    entry_id = uuid.uuid4()
    kwargs = dict(
        work_category="mastic",
        elevation="internal",
        employee_name="Ion",
        work_date=date(2026, 8, 12),
        original_filename="IMG_1234.jpg",
        used_arcnames=used,
        entry_id=entry_id,
        used_folder_by_entry=folders,
    )
    first = _arc(**kwargs)
    second = _arc(**kwargs)
    third = _arc(**kwargs)
    assert first.endswith("IMG_1234.jpg")
    assert second.endswith("IMG_1234-2.jpg")
    assert third.endswith("IMG_1234-3.jpg")
    assert len({first, second, third}) == 3
    assert len({name.rsplit("/", 1)[0] for name in (first, second, third)}) == 1


def test_zip_download_writes_flat_folder_and_preserves_selected_only() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id, email="emp@ex.com")
    loc_id = uuid.uuid4()
    att = SimpleNamespace(
        id=uuid.uuid4(),
        storage_path="work-progress-files/a.jpg",
        original_filename="IMG_1234.jpg",
    )
    skipped = SimpleNamespace(id=uuid.uuid4())
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
    with (
        patch("app.modules.work_progress.service._ordered_bulk_attachment_rows", return_value=[(att, entry)]),
        patch("app.modules.work_progress.service._assert_bulk_attachment_scope", return_value=[(att, entry, owner)]),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
        patch("app.modules.work_progress.service.create_internal_audit_event"),
        patch("app.modules.work_progress.service.get_session_factory", return_value=MagicMock),
        patch("app.modules.work_progress.service.list_submit_audit_payloads_by_entry_ids", return_value={}),
        patch("app.modules.work_progress.service.get_employee_profile_by_user_id", return_value=None),
        patch("app.modules.work_progress.service._location_name", return_value="Kennington"),
    ):
        result = bulk_download_review_attachments_zip(MagicMock(), actor, [att.id])
    with zipfile.ZipFile(result) as archive:
        names = archive.namelist()
        assert names == ["Brickwork level - South - Level 00 - emp@ex.com - 12 Aug 2026/IMG_1234.jpg"]
        assert archive.read(names[0]) == b"data"
        assert str(skipped.id) not in names[0]
        assert names[0].count("/") == 1
    backend.delete_file.assert_not_called()


def test_selected_zip_rejects_more_than_selection_schema() -> None:
    actor = _user(role=SystemRole.ADMIN, company_id=uuid.uuid4())
    ids = [uuid.uuid4() for _ in range(MAX_ZIP_ATTACHMENT_IDS + 1)]
    with pytest.raises(WorkProgressZipLimitError) as exc:
        bulk_download_review_attachments_zip(MagicMock(), actor, ids)
    assert exc.value.code == "work_progress_zip_too_many_files"


def test_multi_site_zip_download_prefixes_site() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id, email="petre@ex.com")
    loc_a = uuid.uuid4()
    loc_b = uuid.uuid4()
    att_a = SimpleNamespace(id=uuid.uuid4(), storage_path="work-progress-files/a.jpg", original_filename="a.jpg")
    att_b = SimpleNamespace(id=uuid.uuid4(), storage_path="work-progress-files/b.jpg", original_filename="b.jpg")
    entry_a = SimpleNamespace(
        id=uuid.uuid4(),
        company_id=company_id,
        location_id=loc_a,
        work_date=date(2026, 8, 15),
        user_id=owner.id,
        work_category="brickwork_ties",
        elevation="north",
        elevation_custom=None,
        level=0,
        title="",
    )
    entry_b = SimpleNamespace(
        id=uuid.uuid4(),
        company_id=company_id,
        location_id=loc_b,
        work_date=date(2026, 8, 15),
        user_id=owner.id,
        work_category="insulation",
        elevation="south",
        elevation_custom=None,
        level=3,
        title="",
    )
    backend = MagicMock()
    backend.object_byte_size.return_value = 4
    backend.exists.return_value = True
    backend.read_bytes.return_value = b"data"

    def _site_name(_db, location_id):
        return "Kennington" if location_id == loc_a else "Battersea"

    with (
        patch(
            "app.modules.work_progress.service._ordered_bulk_attachment_rows",
            return_value=[(att_a, entry_a), (att_b, entry_b)],
        ),
        patch(
            "app.modules.work_progress.service._assert_bulk_attachment_scope",
            return_value=[(att_a, entry_a, owner), (att_b, entry_b, owner)],
        ),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
        patch("app.modules.work_progress.service.create_internal_audit_event"),
        patch("app.modules.work_progress.service.get_session_factory", return_value=MagicMock),
        patch("app.modules.work_progress.service.list_submit_audit_payloads_by_entry_ids", return_value={}),
        patch("app.modules.work_progress.service.get_employee_profile_by_user_id", return_value=None),
        patch("app.modules.work_progress.service._location_name", side_effect=_site_name),
    ):
        result = bulk_download_review_attachments_zip(MagicMock(), actor, [att_a.id, att_b.id])
    with zipfile.ZipFile(result) as archive:
        assert sorted(archive.namelist()) == [
            "Battersea - Insulation - South - Level 03 - petre@ex.com - 15 Aug 2026/b.jpg",
            "Kennington - Brickwork ties - North - Level 00 - petre@ex.com - 15 Aug 2026/a.jpg",
        ]


ENTRY_SNAPSHOT_FIELDS = (
    "id",
    "company_id",
    "user_id",
    "location_id",
    "workplace_id",
    "work_date",
    "title",
    "work_category",
    "elevation",
    "elevation_custom",
    "level",
    "progress_status",
    "percent_complete",
    "status",
    "created_at",
    "updated_at",
    "notes",
)

ATTACHMENT_SNAPSHOT_FIELDS = (
    "id",
    "entry_id",
    "original_filename",
    "storage_path",
    "file_size_bytes",
    "content_type",
    "original_size_bytes",
    "stored_size_bytes",
    "image_width",
    "image_height",
    "processing_version",
    "client_upload_id",
)


def _snapshot_row(obj, fields: tuple[str, ...]) -> dict:
    return {name: getattr(obj, name) for name in fields}


def _sqlite_engine():
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
    ]
    Base.metadata.create_all(bind=engine, tables=tables)
    return engine


def _integrity_world(session: Session) -> dict:
    now = datetime.now(timezone.utc)
    company = Company(
        id=uuid.uuid4(),
        name="Zip Integrity Co",
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    session.add(company)
    owner = User(
        id=uuid.uuid4(),
        company_id=company.id,
        email="petre@example.com",
        password_hash="h",
        system_role=SystemRole.EMPLOYEE,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    admin = User(
        id=uuid.uuid4(),
        company_id=company.id,
        email="admin@example.com",
        password_hash="h",
        system_role=SystemRole.ADMIN,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    session.add_all([owner, admin])
    workplace = Workplace(
        id=uuid.uuid4(),
        company_id=company.id,
        name="WP",
        created_at=now,
        updated_at=now,
    )
    session.add(workplace)
    kennington = Location(
        id=uuid.uuid4(),
        company_id=company.id,
        name="Kennington",
        latitude=51.49,
        longitude=-0.11,
        created_at=now,
        updated_at=now,
    )
    battersea = Location(
        id=uuid.uuid4(),
        company_id=company.id,
        name="Battersea",
        latitude=51.48,
        longitude=-0.14,
        created_at=now,
        updated_at=now,
    )
    session.add_all([kennington, battersea])

    def make_entry(
        *,
        category: str | None,
        elevation: str | None,
        level: int | None,
        title: str,
        location_id: uuid.UUID,
        work_date: date,
        status: str = "submitted",
        elevation_custom: str | None = None,
    ) -> WorkProgressEntry:
        row = WorkProgressEntry(
            id=uuid.uuid4(),
            user_id=owner.id,
            company_id=company.id,
            workplace_id=workplace.id,
            location_id=location_id,
            work_date=work_date,
            title=title,
            progress_status=CLASSIFIED_PROGRESS_STATUS if category else "in_progress",
            notes="keep-me",
            percent_complete=40,
            work_category=category,
            elevation=elevation,
            elevation_custom=elevation_custom,
            level=level,
            status=status,
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        return row

    classified = make_entry(
        category="brickwork_ties",
        elevation="north",
        level=0,
        title="",
        location_id=kennington.id,
        work_date=date(2026, 8, 15),
    )
    twin = make_entry(
        category="brickwork_ties",
        elevation="north",
        level=0,
        title="",
        location_id=kennington.id,
        work_date=date(2026, 8, 15),
    )
    legacy = make_entry(
        category=None,
        elevation=None,
        level=None,
        title="Pointing",
        location_id=kennington.id,
        work_date=date(2026, 8, 5),
    )
    archived = make_entry(
        category="insulation",
        elevation="south",
        level=3,
        title="",
        location_id=battersea.id,
        work_date=date(2026, 8, 10),
        status="archived",
    )
    session.flush()

    def photo(parent: WorkProgressEntry, name: str, key: str) -> WorkProgressAttachment:
        att = WorkProgressAttachment(
            id=uuid.uuid4(),
            entry_id=parent.id,
            original_filename=name,
            content_type="image/jpeg",
            file_size_bytes=4,
            storage_path=key,
            original_size_bytes=4,
            stored_size_bytes=4,
            stored_content_type="image/jpeg",
            image_width=10,
            image_height=8,
            processing_version="1",
            created_at=now,
        )
        session.add(att)
        return att

    photos = [
        photo(classified, "IMG_3298.jpg", "work-progress-files/a.jpg"),
        photo(classified, "IMG_3301.jpg", "work-progress-files/b.jpg"),
        photo(classified, "IMG_3301.jpg", "work-progress-files/c.jpg"),
        photo(twin, "twin.jpg", "work-progress-files/d.jpg"),
        photo(legacy, "old.jpg", "work-progress-files/e.jpg"),
        photo(archived, "arch.jpg", "work-progress-files/f.jpg"),
    ]
    session.commit()
    for row in (classified, twin, legacy, archived, *photos, owner, admin):
        session.refresh(row)
    return {
        "company": company,
        "owner": owner,
        "admin": admin,
        "kennington": kennington,
        "classified": classified,
        "twin": twin,
        "legacy": legacy,
        "archived": archived,
        "photos": photos,
    }


def test_zip_export_does_not_mutate_submissions_or_attachments() -> None:
    engine = _sqlite_engine()
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    session = factory()
    world = _integrity_world(session)
    classified = world["classified"]
    twin = world["twin"]
    legacy = world["legacy"]
    archived = world["archived"]
    photos = world["photos"]
    admin = world["admin"]
    selected = photos[:5]

    entry_snaps = {
        row.id: _snapshot_row(row, ENTRY_SNAPSHOT_FIELDS)
        for row in (classified, twin, legacy, archived)
    }
    att_snaps = {att.id: _snapshot_row(att, ATTACHMENT_SNAPSHOT_FIELDS) for att in photos}
    class_before = _classification_fields(classified)
    counts_before = {
        "entries": session.scalar(select(func.count()).select_from(WorkProgressEntry)),
        "active": session.scalar(
            select(func.count()).select_from(WorkProgressEntry).where(WorkProgressEntry.status != "archived"),
        ),
        "archived": session.scalar(
            select(func.count()).select_from(WorkProgressEntry).where(WorkProgressEntry.status == "archived"),
        ),
        "attachments": session.scalar(select(func.count()).select_from(WorkProgressAttachment)),
    }
    filter_before, filter_total_before = list_review_entries(
        session,
        company_id_filter=world["company"].id,
        user_id_filter=None,
        location_id_filter=world["kennington"].id,
        status_filter=None,
        date_from=None,
        date_to=None,
        title_search=None,
        work_category="brickwork_ties",
        elevation="north",
        level=0,
        limit=50,
        offset=0,
    )

    backend = MagicMock()
    backend.object_byte_size.return_value = 4
    backend.exists.return_value = True
    backend.read_bytes.return_value = b"data"
    audit_calls: list[object] = []
    ordered = [
        (photos[0], classified),
        (photos[1], classified),
        (photos[2], classified),
        (photos[3], twin),
        (photos[4], legacy),
    ]
    scoped = [(att, entry, world["owner"]) for att, entry in ordered]

    def _capture_audit(*args, **kwargs):
        for att in selected:
            assert sa_inspect(att).modified is False
        for row in (classified, twin, legacy, archived):
            assert sa_inspect(row).modified is False
        audit_calls.append((args, kwargs))
        return SimpleNamespace(id=uuid.uuid4())

    with (
        patch("app.modules.work_progress.service._ordered_bulk_attachment_rows", return_value=ordered),
        patch("app.modules.work_progress.service._assert_bulk_attachment_scope", return_value=scoped),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
        patch("app.modules.work_progress.service.create_internal_audit_event", side_effect=_capture_audit),
        patch("app.modules.work_progress.service.get_session_factory", return_value=MagicMock),
        patch("app.modules.work_progress.service.list_submit_audit_payloads_by_entry_ids", return_value={}),
        patch("app.modules.work_progress.service.get_employee_profile_by_user_id", return_value=None),
        patch("app.modules.work_progress.service.archive_review_entry") as archive_spy,
        patch("app.modules.work_progress.service.bulk_delete_review_attachments") as delete_spy,
    ):
        result = bulk_download_review_attachments_zip(session, admin, [att.id for att in selected])
        archive_spy.assert_not_called()
        delete_spy.assert_not_called()
    backend.delete_file.assert_not_called()

    with zipfile.ZipFile(result) as archive:
        names = archive.namelist()
        assert len(names) == 5
        assert len(set(names)) == 5
        assert all(n.count("/") == 1 for n in names)
        folders = {n.rsplit("/", 1)[0] for n in names}
        assert "Brickwork ties - North - Level 00 - petre@example.com - 15 Aug 2026" in folders
        assert "Brickwork ties - North - Level 00 - petre@example.com - 15 Aug 2026 (2)" in folders
        assert "Pointing - petre@example.com - 05 Aug 2026" in folders
        assert any(n.endswith("IMG_3301.jpg") for n in names)
        assert any(n.endswith("IMG_3301-2.jpg") for n in names)
        assert all(not n.startswith("Kennington/") for n in names)

    assert len(audit_calls) == 1
    args, kwargs = audit_calls[0]
    action = kwargs.get("action") or (args[2] if len(args) > 2 else None)
    assert action == "work_progress.attachments_bulk_downloaded"

    session.close()
    fresh = factory()
    try:
        reloaded_entries = {row.id: row for row in fresh.scalars(select(WorkProgressEntry)).all()}
        reloaded_atts = {row.id: row for row in fresh.scalars(select(WorkProgressAttachment)).all()}
        assert set(reloaded_entries) == set(entry_snaps)
        assert set(reloaded_atts) == set(att_snaps)
        for eid, snap in entry_snaps.items():
            assert _snapshot_row(reloaded_entries[eid], ENTRY_SNAPSHOT_FIELDS) == snap
        for aid, snap in att_snaps.items():
            assert _snapshot_row(reloaded_atts[aid], ATTACHMENT_SNAPSHOT_FIELDS) == snap
        counts_after = {
            "entries": fresh.scalar(select(func.count()).select_from(WorkProgressEntry)),
            "active": fresh.scalar(
                select(func.count()).select_from(WorkProgressEntry).where(WorkProgressEntry.status != "archived"),
            ),
            "archived": fresh.scalar(
                select(func.count()).select_from(WorkProgressEntry).where(WorkProgressEntry.status == "archived"),
            ),
            "attachments": fresh.scalar(select(func.count()).select_from(WorkProgressAttachment)),
        }
        assert counts_after == counts_before
        reloaded = reloaded_entries[classified.id]
        assert reloaded.work_category == "brickwork_ties"
        assert reloaded.elevation == "north"
        assert reloaded.level == 0
        assert _classification_fields(reloaded) == class_before
        filter_after, filter_total_after = list_review_entries(
            fresh,
            company_id_filter=world["company"].id,
            user_id_filter=None,
            location_id_filter=world["kennington"].id,
            status_filter=None,
            date_from=None,
            date_to=None,
            title_search=None,
            work_category="brickwork_ties",
            elevation="north",
            level=0,
            limit=50,
            offset=0,
        )
        assert filter_total_after == filter_total_before
        assert {row.id for row in filter_after} == {row.id for row in filter_before}
        assert reloaded_entries[archived.id].status == "archived"
        assert reloaded_entries[classified.id].status == "submitted"
        for att in reloaded_atts.values():
            assert att.entry_id in entry_snaps
            assert att.storage_path == att_snaps[att.id]["storage_path"]
    finally:
        fresh.close()
        engine.dispose()


def test_audit_fallback_classification_is_used_when_db_is_null() -> None:
    labels = resolve_zip_folder_classification(
        progress_status=CLASSIFIED_PROGRESS_STATUS,
        work_category=None,
        elevation=None,
        elevation_custom=None,
        level=None,
        submit_audit_payloads=[
            {
                "work_category": "brickwork_ties",
                "elevation": "north",
                "elevation_custom": None,
                "level": 0,
            }
        ],
    )
    assert labels.source == "audit"
    assert labels.work_category == "brickwork_ties"
    assert labels.level == 0
    arc = _arc(
        work_category=labels.work_category,
        elevation=labels.elevation,
        elevation_custom=labels.elevation_custom,
        level=labels.level,
        legacy_title="",
    )
    assert arc.startswith("Brickwork ties - North - Level 00 - Petre Rotaru - 15 Aug 2026/")


def test_duplicate_or_invalid_audit_stays_unclassified() -> None:
    payload = {
        "work_category": "brickwork_ties",
        "elevation": "north",
        "level": 0,
    }
    duplicate = resolve_zip_folder_classification(
        progress_status=CLASSIFIED_PROGRESS_STATUS,
        work_category=None,
        elevation=None,
        elevation_custom=None,
        level=None,
        submit_audit_payloads=[payload, payload],
    )
    assert duplicate.source == "unclassified"
    invalid = resolve_zip_folder_classification(
        progress_status=CLASSIFIED_PROGRESS_STATUS,
        work_category=None,
        elevation=None,
        elevation_custom=None,
        level=None,
        submit_audit_payloads=[{"work_category": "nope", "elevation": "north", "level": 0}],
    )
    assert invalid.source == "unclassified"
    assert parse_submit_audit_classification({"work_category": "brickwork_ties", "elevation": "north", "level": 99}) is None


def test_resolve_does_not_mutate_entry_namespace() -> None:
    entry = SimpleNamespace(
        progress_status=CLASSIFIED_PROGRESS_STATUS,
        work_category=None,
        elevation=None,
        elevation_custom=None,
        level=None,
    )
    labels = resolve_zip_folder_classification(
        progress_status=entry.progress_status,
        work_category=entry.work_category,
        elevation=entry.elevation,
        elevation_custom=entry.elevation_custom,
        level=entry.level,
        submit_audit_payloads=[
            {"work_category": "brickwork_ties", "elevation": "custom", "elevation_custom": "Core A", "level": 1}
        ],
    )
    assert labels.source == "audit"
    assert entry.work_category is None
    assert entry.elevation is None
    assert entry.level is None


def _scale_triples(count: int):
    company_id = uuid.uuid4()
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id, email="scale@ex.com")
    loc_id = uuid.uuid4()
    triples = []
    for index in range(count):
        entry = SimpleNamespace(
            id=uuid.uuid4(),
            company_id=company_id,
            location_id=loc_id,
            user_id=owner.id,
            work_date=date(2026, 8, 15),
            work_category="brickwork_ties",
            elevation="north",
            elevation_custom=None,
            level=0,
            title="",
            progress_status=CLASSIFIED_PROGRESS_STATUS,
        )
        att = SimpleNamespace(
            id=uuid.uuid4(),
            storage_path=f"work-progress-files/{index}.jpg",
            original_filename=f"IMG_{index:04d}.jpg",
        )
        triples.append((att, entry, owner))
    return triples


def _run_scale_zip(count: int) -> tuple[int, int]:
    triples = _scale_triples(count)
    backend = MagicMock()
    backend.object_byte_size.return_value = 32
    backend.exists.return_value = True
    backend.read_bytes.return_value = b"x" * 32
    with (
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
        patch("app.modules.work_progress.service.list_submit_audit_payloads_by_entry_ids", return_value={}),
        patch("app.modules.work_progress.service.get_employee_profile_by_user_id", return_value=None),
        patch("app.modules.work_progress.service._location_name", return_value="Kennington"),
    ):
        spool = _build_attachments_zip_spool(MagicMock(), triples)
    with zipfile.ZipFile(spool) as archive:
        names = [name for name in archive.namelist() if not name.endswith("/")]
        size = sum(info.file_size for info in archive.infolist())
    spool.close()
    return len(names), size


def test_synthetic_zip_scale_101_250_500() -> None:
    for count in (1, 30, 100, 101, 250, 500):
        members, _size = _run_scale_zip(count)
        assert members == count


def test_custom_elevation_and_level_20_folder() -> None:
    arc = _arc(elevation="custom", elevation_custom="Core A", level=20)
    assert "Core A" in arc
    assert "Level 20" in arc
    assert arc.count("/") == 1


# ---------------------------------------------------------------------------
# Realistic local synthetic scale (no DB, no production pictures).
# Payloads are generated one-at-a-time on each storage read.
# ---------------------------------------------------------------------------

_REALISTIC_PAYLOAD_BYTES = 256 * 1024
_UUID_IN_PATH = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    re.IGNORECASE,
)


def _deterministic_payload(storage_key: str, size: int) -> bytes:
    seed = int(hashlib.sha256(storage_key.encode("utf-8")).hexdigest()[:16], 16)
    return random.Random(seed).randbytes(size)


class _SequentialFakeStorage:
    """One payload at a time. Never holds a list of picture bodies."""

    def __init__(self, *, payload_size: int, metadata_size: int | None = None, missing: frozenset[str] = frozenset()):
        self.payload_size = payload_size
        self.metadata_size = payload_size if metadata_size is None else metadata_size
        self.missing = missing
        self.live_reads = 0
        self.max_live_reads = 0
        self.read_count = 0
        self.retained_payloads: list[bytes] = []

    def object_byte_size(self, key: str) -> int:
        return self.metadata_size

    def exists(self, key: str) -> bool:
        return key not in self.missing

    def read_bytes(self, key: str) -> bytes:
        if key in self.missing:
            raise FileNotFoundError(key)
        self.live_reads += 1
        self.max_live_reads = max(self.max_live_reads, self.live_reads)
        self.read_count += 1
        try:
            return _deterministic_payload(key, self.payload_size)
        finally:
            self.live_reads -= 1


class _TrackingSpooledTemporaryFile(tempfile.SpooledTemporaryFile):
    instances: list["_TrackingSpooledTemporaryFile"] = []

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.rolled_to_disk = False
        self.disk_path: str | None = None
        type(self).instances.append(self)

    def rollover(self):
        result = super().rollover()
        self.rolled_to_disk = True
        inner = getattr(self, "_file", None)
        self.disk_path = getattr(inner, "name", None)
        return result

    @classmethod
    def reset(cls) -> None:
        cls.instances = []


def _structured_scale_triples(submissions: int, pics_each: int):
    """50×10-style layout: mixed levels, custom elevation, audit, unclassified, folder collisions."""
    company_id = uuid.uuid4()
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id, email="scale@ex.com")
    loc_id = uuid.uuid4()
    triples = []
    audit_map: dict[uuid.UUID, list[dict[str, object]]] = {}
    same_date = date(2026, 8, 15)

    for submission in range(submissions):
        work_category = "brickwork_ties"
        elevation = "north"
        elevation_custom = None
        level: int | None = 0
        title = ""
        work_date = same_date
        progress_status = CLASSIFIED_PROGRESS_STATUS
        audit_payloads: list[dict[str, object]] | None = None

        if submission <= 2:
            level = 0
        elif submission <= 9:
            level = 0
            work_date = date(2026, 8, 16 + (submission - 3))
        elif submission <= 19:
            level = 1
            work_date = date(2026, 7, 1 + (submission - 10))
        elif submission <= 29:
            level = 10
            work_date = date(2026, 6, 1 + (submission - 20))
        elif submission <= 39:
            level = 20
            work_date = date(2026, 5, 1 + (submission - 30))
        elif submission <= 44:
            elevation = "custom"
            elevation_custom = "Core A"
            level = 0
            work_date = date(2026, 4, 1 + (submission - 40))
        elif submission <= 47:
            work_category = None  # type: ignore[assignment]
            elevation = None
            level = None
            work_date = date(2026, 3, 1 + (submission - 45))
            audit_payloads = [
                {
                    "work_category": "firebreaks",
                    "elevation": "west",
                    "elevation_custom": None,
                    "level": 1,
                }
            ]
        else:
            work_category = None  # type: ignore[assignment]
            elevation = None
            level = None
            title = ""
            work_date = date(2026, 2, 1 + (submission - 48))
            audit_payloads = []

        entry = SimpleNamespace(
            id=uuid.uuid4(),
            company_id=company_id,
            location_id=loc_id,
            user_id=owner.id,
            work_date=work_date,
            work_category=work_category,
            elevation=elevation,
            elevation_custom=elevation_custom,
            level=level,
            title=title,
            progress_status=progress_status,
        )
        if audit_payloads is not None:
            audit_map[entry.id] = audit_payloads
        for pic in range(pics_each):
            att = SimpleNamespace(
                id=uuid.uuid4(),
                storage_path=f"work-progress-files/sub{submission:02d}_{pic:02d}.bin",
                original_filename=f"IMG_{submission:02d}_{pic:02d}.jpg",
            )
            triples.append((att, entry, owner))
    return triples, audit_map


def _assert_zip_build_is_not_fully_buffered() -> None:
    import inspect

    from app.modules.work_progress import service as wp_service
    from app.modules.work_progress import zip_export as zip_export_mod

    build_src = inspect.getsource(wp_service._build_attachments_zip_spool)
    iter_src = inspect.getsource(wp_service._iter_zip_spool)
    zip_src = inspect.getsource(zip_export_mod)
    assert "getvalue" not in build_src
    assert "BytesIO" not in build_src
    assert "getvalue" not in iter_src
    assert "BytesIO" not in iter_src
    assert "getvalue" not in zip_src


def _run_realistic_zip(
    *,
    submissions: int,
    pics_each: int,
    payload_size: int = _REALISTIC_PAYLOAD_BYTES,
    metadata_size: int | None = None,
    missing: frozenset[str] = frozenset(),
    max_total_bytes: int | None = None,
    consume_stream: bool = True,
    measure_tracemalloc: bool = False,
):
    triples, audit_map = _structured_scale_triples(submissions, pics_each)
    backend = _SequentialFakeStorage(
        payload_size=payload_size,
        metadata_size=metadata_size,
        missing=missing,
    )
    _TrackingSpooledTemporaryFile.reset()
    patches = [
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
        patch("app.modules.work_progress.service.list_submit_audit_payloads_by_entry_ids", return_value=audit_map),
        patch("app.modules.work_progress.service.get_employee_profile_by_user_id", return_value=None),
        patch("app.modules.work_progress.service._location_name", return_value="Kennington"),
        patch(
            "app.modules.work_progress.service.tempfile.SpooledTemporaryFile",
            _TrackingSpooledTemporaryFile,
        ),
    ]
    if max_total_bytes is not None:
        patches.append(patch("app.modules.work_progress.service.MAX_ZIP_TOTAL_BYTES", max_total_bytes))

    started = time.perf_counter()
    snapshot = None
    if measure_tracemalloc:
        tracemalloc.start()
    try:
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            if max_total_bytes is not None:
                with patch("app.modules.work_progress.service.MAX_ZIP_TOTAL_BYTES", max_total_bytes):
                    spool = _build_attachments_zip_spool(MagicMock(), triples)
            else:
                spool = _build_attachments_zip_spool(MagicMock(), triples)
    finally:
        elapsed = time.perf_counter() - started
        if measure_tracemalloc:
            snapshot = tracemalloc.get_traced_memory()
            tracemalloc.stop()

    tracker = _TrackingSpooledTemporaryFile.instances[-1]
    zip_bytes = b"".join(_iter_zip_spool(spool)) if consume_stream else None
    return {
        "backend": backend,
        "tracker": tracker,
        "spool": spool,
        "zip_bytes": zip_bytes,
        "elapsed": elapsed,
        "tracemalloc": snapshot,
        "picture_count": submissions * pics_each,
        "payload_size": payload_size,
    }


class TestRealisticZipScale:
    def test_production_byte_cap_constant_unchanged(self) -> None:
        assert MAX_ZIP_TOTAL_BYTES == 512 * 1024 * 1024
        assert MAX_ZIP_SPOOL_MEMORY_BYTES == 16 * 1024 * 1024
        _assert_zip_build_is_not_fully_buffered()

    def test_scale_100_x_256kb(self) -> None:
        result = _run_realistic_zip(submissions=10, pics_each=10)
        self._assert_complete_archive(result, expected_pictures=100, expect_rollover=True)
        print(
            "LOCAL SYNTHETIC ONLY 100x256KB "
            f"members={result['member_count']} zip_bytes={result['zip_size']} "
            f"uncompressed={result['uncompressed']} elapsed_s={result['elapsed']:.3f} "
            f"rolled_to_disk={result['tracker'].rolled_to_disk} max_live={result['backend'].max_live_reads}",
            flush=True,
        )

    def test_scale_250_x_256kb(self) -> None:
        result = _run_realistic_zip(submissions=25, pics_each=10)
        self._assert_complete_archive(result, expected_pictures=250, expect_rollover=True)
        print(
            "LOCAL SYNTHETIC ONLY 250x256KB "
            f"members={result['member_count']} zip_bytes={result['zip_size']} "
            f"uncompressed={result['uncompressed']} elapsed_s={result['elapsed']:.3f} "
            f"rolled_to_disk={result['tracker'].rolled_to_disk} max_live={result['backend'].max_live_reads}",
            flush=True,
        )

    def test_scale_500_x_256kb_folder_structure(self) -> None:
        result = _run_realistic_zip(submissions=50, pics_each=10, measure_tracemalloc=True)
        self._assert_complete_archive(result, expected_pictures=500, expect_rollover=True)
        names = result["names"]
        folders = [name.split("/", 1)[0] for name in names]
        unique_folders = list(dict.fromkeys(folders))
        assert len(unique_folders) == 50
        for folder in unique_folders:
            in_folder = [name for name in names if name.startswith(folder + "/")]
            assert len(in_folder) == 10, folder
        assert any(" (2)" in folder for folder in unique_folders)
        assert any(" (3)" in folder for folder in unique_folders)
        assert any("Level 00" in folder for folder in unique_folders)
        assert any("Level 01" in folder for folder in unique_folders)
        assert any("Level 10" in folder for folder in unique_folders)
        assert any("Level 20" in folder for folder in unique_folders)
        assert any("Core A" in folder for folder in unique_folders)
        assert any("Firebreaks" in folder and "West" in folder for folder in unique_folders)
        assert any(folder.startswith("Unclassified") for folder in unique_folders)
        assert all(_UUID_IN_PATH.search(name) is None for name in names)
        current, peak = result["tracemalloc"]
        result["folder_count"] = len(unique_folders)
        print(
            "LOCAL SYNTHETIC ONLY 500x256KB "
            f"members={result['member_count']} folders={len(unique_folders)} "
            f"zip_bytes={result['zip_size']} uncompressed={result['uncompressed']} "
            f"elapsed_s={result['elapsed']:.3f} rolled_to_disk={result['tracker'].rolled_to_disk} "
            f"max_live={result['backend'].max_live_reads} "
            f"tracemalloc_current={current} tracemalloc_peak={peak}",
            flush=True,
        )

    def test_actual_byte_limit_no_partial_zip(self) -> None:
        cap = 5 * 1024 * 1024
        _TrackingSpooledTemporaryFile.reset()
        triples, audit_map = _structured_scale_triples(3, 10)
        backend = _SequentialFakeStorage(payload_size=_REALISTIC_PAYLOAD_BYTES)
        with (
            patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
            patch("app.modules.work_progress.service.list_submit_audit_payloads_by_entry_ids", return_value=audit_map),
            patch("app.modules.work_progress.service.get_employee_profile_by_user_id", return_value=None),
            patch("app.modules.work_progress.service._location_name", return_value="Kennington"),
            patch("app.modules.work_progress.service.tempfile.SpooledTemporaryFile", _TrackingSpooledTemporaryFile),
            patch("app.modules.work_progress.service.MAX_ZIP_TOTAL_BYTES", cap),
        ):
            with pytest.raises(WorkProgressZipLimitError) as raised:
                _build_attachments_zip_spool(MagicMock(), triples)
        err = raised.value
        assert err.http_status == 413
        assert err.code == "work_progress_zip_too_large"
        for spool in _TrackingSpooledTemporaryFile.instances:
            assert spool.closed
            if spool.disk_path:
                assert not os.path.exists(spool.disk_path)
        print(
            f"LOCAL SYNTHETIC ONLY actual-byte-limit cap={cap} "
            f"http_status={err.http_status} spool_instances={len(_TrackingSpooledTemporaryFile.instances)}",
            flush=True,
        )

    def test_metadata_underreport_running_guard(self) -> None:
        cap = 5 * 1024 * 1024
        _TrackingSpooledTemporaryFile.reset()
        triples, audit_map = _structured_scale_triples(3, 10)
        backend = _SequentialFakeStorage(
            payload_size=_REALISTIC_PAYLOAD_BYTES,
            metadata_size=1024,
        )
        metadata_total = backend.metadata_size * len(triples)
        assert metadata_total < cap
        with (
            patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
            patch("app.modules.work_progress.service.list_submit_audit_payloads_by_entry_ids", return_value=audit_map),
            patch("app.modules.work_progress.service.get_employee_profile_by_user_id", return_value=None),
            patch("app.modules.work_progress.service._location_name", return_value="Kennington"),
            patch("app.modules.work_progress.service.tempfile.SpooledTemporaryFile", _TrackingSpooledTemporaryFile),
            patch("app.modules.work_progress.service.MAX_ZIP_TOTAL_BYTES", cap),
        ):
            with pytest.raises(WorkProgressZipLimitError) as raised:
                _build_attachments_zip_spool(MagicMock(), triples)
        err = raised.value
        assert err.http_status == 413
        assert backend.read_count > 0
        assert backend.max_live_reads == 1
        assert _TrackingSpooledTemporaryFile.instances
        for spool in _TrackingSpooledTemporaryFile.instances:
            assert spool.closed
            if spool.disk_path:
                assert not os.path.exists(spool.disk_path)
        print(
            "LOCAL SYNTHETIC ONLY metadata-underreport "
            f"metadata_total={metadata_total} cap={cap} reads={backend.read_count} "
            f"http_status={err.http_status} spool_closed=True",
            flush=True,
        )

    def test_missing_source_object_fails_and_closes_spool(self) -> None:
        _TrackingSpooledTemporaryFile.reset()
        triples, audit_map = _structured_scale_triples(2, 5)
        missing_key = triples[7][0].storage_path
        backend = _SequentialFakeStorage(
            payload_size=_REALISTIC_PAYLOAD_BYTES,
            missing=frozenset({missing_key}),
        )
        with (
            patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
            patch("app.modules.work_progress.service.list_submit_audit_payloads_by_entry_ids", return_value=audit_map),
            patch("app.modules.work_progress.service.get_employee_profile_by_user_id", return_value=None),
            patch("app.modules.work_progress.service._location_name", return_value="Kennington"),
            patch("app.modules.work_progress.service.tempfile.SpooledTemporaryFile", _TrackingSpooledTemporaryFile),
        ):
            with pytest.raises(WorkProgressNotFoundError):
                _build_attachments_zip_spool(MagicMock(), triples)
        assert _TrackingSpooledTemporaryFile.instances
        for spool in _TrackingSpooledTemporaryFile.instances:
            assert spool.closed
            if spool.disk_path:
                assert not os.path.exists(spool.disk_path)
        print(
            "LOCAL SYNTHETIC ONLY missing-source-object "
            f"spool_closed=True instances={len(_TrackingSpooledTemporaryFile.instances)}",
            flush=True,
        )

    def test_success_stream_closes_tempfile(self) -> None:
        result = _run_realistic_zip(submissions=4, pics_each=5)
        self._assert_complete_archive(result, expected_pictures=20, expect_rollover=False)
        assert result["spool"].closed
        if result["tracker"].disk_path:
            assert not os.path.exists(result["tracker"].disk_path)

    @staticmethod
    def _assert_complete_archive(result: dict, *, expected_pictures: int, expect_rollover: bool) -> None:
        assert result["backend"].max_live_reads == 1
        assert result["backend"].read_count == expected_pictures
        assert result["backend"].retained_payloads == []
        tracker = result["tracker"]
        if expect_rollover:
            assert tracker.rolled_to_disk is True
            assert tracker._rolled is True
        assert result["zip_bytes"] is not None
        zip_bytes = result["zip_bytes"]
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
            bad = archive.testzip()
            assert bad is None
            names = [name for name in archive.namelist() if not name.endswith("/")]
            uncompressed = sum(info.file_size for info in archive.infolist() if not info.is_dir())
        assert len(names) == expected_pictures
        assert uncompressed == expected_pictures * result["payload_size"]
        assert result["spool"].closed
        result["names"] = names
        result["member_count"] = len(names)
        result["zip_size"] = len(zip_bytes)
        result["uncompressed"] = uncompressed
