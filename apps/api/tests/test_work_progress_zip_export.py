"""Work Progress ZIP export: flat folders, sanitisation, and data-integrity gates."""

from __future__ import annotations

import io
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
    WorkProgressZipLimitError,
    _classification_fields,
    bulk_download_review_attachments_zip,
)
from app.modules.work_progress.zip_export import (
    build_work_progress_zip_arcname,
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
        patch("app.modules.work_progress.service.get_employee_profile_by_user_id", return_value=None),
        patch("app.modules.work_progress.service._location_name", return_value="Kennington"),
    ):
        result = bulk_download_review_attachments_zip(MagicMock(), actor, [att.id])
    with zipfile.ZipFile(io.BytesIO(result)) as archive:
        names = archive.namelist()
        assert names == ["Brickwork level - South - Level 00 - emp@ex.com - 12 Aug 2026/IMG_1234.jpg"]
        assert archive.read(names[0]) == b"data"
        assert str(skipped.id) not in names[0]
        assert names[0].count("/") == 1
    backend.delete_file.assert_not_called()


def test_zip_limit_48_still_enforced() -> None:
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
        patch("app.modules.work_progress.service.get_employee_profile_by_user_id", return_value=None),
        patch("app.modules.work_progress.service._location_name", side_effect=_site_name),
    ):
        result = bulk_download_review_attachments_zip(MagicMock(), actor, [att_a.id, att_b.id])
    with zipfile.ZipFile(io.BytesIO(result)) as archive:
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
        patch("app.modules.work_progress.service.get_employee_profile_by_user_id", return_value=None),
        patch("app.modules.work_progress.service.archive_review_entry") as archive_spy,
        patch("app.modules.work_progress.service.bulk_delete_review_attachments") as delete_spy,
    ):
        result = bulk_download_review_attachments_zip(session, admin, [att.id for att in selected])
        archive_spy.assert_not_called()
        delete_spy.assert_not_called()
    backend.delete_file.assert_not_called()

    with zipfile.ZipFile(io.BytesIO(result)) as archive:
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
