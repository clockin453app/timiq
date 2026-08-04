"""Corrective simplification checks for Work Progress Pictures."""

from __future__ import annotations

import asyncio
import io
import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock, MagicMock, patch

import pytest
from fastapi import UploadFile

from app.main import app
from app.modules.auth.models import SystemRole, User
from app.modules.dashboard.service import _build_needs_attention_items
from app.modules.work_progress.service import (
    MAX_BULK_ATTACHMENT_IDS,
    WorkProgressNotFoundError,
    _assert_bulk_attachment_scope,
    archive_review_entry,
    bulk_delete_review_attachments,
    download_work_progress_thumbnail,
    list_employee_filter_options,
    list_review,
    list_review_attachment_gallery,
)
from app.modules.work_progress.thumbnail import generate_work_progress_thumbnail_best_effort


def _user(role: SystemRole, company_id: uuid.UUID | None, *, active: bool = True, email: str = "u@example.com") -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=company_id,
        email=email,
        password_hash="hash",
        system_role=role,
        is_active=active,
        created_at=now,
        updated_at=now,
    )


def test_static_work_progress_routes_precede_dynamic_review_route() -> None:
    paths = [route.path for route in app.routes]
    dynamic = paths.index("/api/work-progress/review/{progress_id}")
    assert paths.index("/api/work-progress/review/employee-filter-options") < dynamic
    assert paths.index("/api/work-progress/review/report.pdf") < dynamic
    assert "/api/work-progress/files/{file_id}/thumbnail" in paths


def test_dashboard_has_no_work_progress_review_attention_item() -> None:
    items = _build_needs_attention_items(
        long_open_shifts=0,
        missing_hourly_rate=0,
        payroll_reports=[],
        payroll_readiness=None,
        onboarding_pending=0,
        employees_without_site_access=0,
    )
    assert all(item.code != "work_progress_pending_review" for item in items)


def test_submission_list_uses_one_grouped_attachment_count_query() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMIN, company_id)
    owner = _user(SystemRole.EMPLOYEE, company_id, email="employee@example.com")
    row = SimpleNamespace(
        id=uuid.uuid4(),
        user_id=owner.id,
        company_id=company_id,
        location_id=uuid.uuid4(),
        work_date=date(2026, 7, 29),
        title="Ties",
        progress_status="in_progress",
        status="submitted",
        created_at=datetime.now(timezone.utc),
    )
    with (
        patch("app.modules.work_progress.service._resolve_review_list_filters", return_value=(company_id, None, None, None, None, None)),
        patch("app.modules.work_progress.service.list_review_entries", return_value=([row], 1)) as list_entries,
        patch("app.modules.work_progress.service.count_attachments_for_entry_ids", return_value={row.id: 7}) as counts,
        patch("app.modules.work_progress.service.get_user_by_id", return_value=owner),
        patch("app.modules.work_progress.service.get_employee_profile_by_user_id", return_value=SimpleNamespace(first_name="Jane", last_name="Doe")),
        patch("app.modules.work_progress.service.get_company_by_id", return_value=SimpleNamespace(name="Acme")),
        patch("app.modules.work_progress.service._location_name", return_value="Site One"),
    ):
        result = list_review(
            MagicMock(),
            actor,
            company_id=None,
            user_id=None,
            location_id=None,
            status_filter=None,
            include_archived=False,
            date_from=None,
            date_to=None,
            title_search=None,
            limit=25,
            offset=25,
        )
    assert result.total == 1
    assert result.items[0].attachment_count == 7
    counts.assert_called_once_with(ANY, [row.id])
    assert list_entries.call_args.kwargs["limit"] == 25
    assert list_entries.call_args.kwargs["offset"] == 25


def test_gallery_passes_entry_and_archived_filters_to_both_queries() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMIN, company_id)
    owner = _user(SystemRole.EMPLOYEE, company_id)
    entry_id = uuid.uuid4()
    entry = SimpleNamespace(id=entry_id, company_id=company_id)
    with (
        patch("app.modules.work_progress.service._resolve_review_list_filters", return_value=(company_id, None, None, None, None, None)),
        patch("app.modules.work_progress.service._assert_review_access", return_value=(entry, owner)),
        patch("app.modules.work_progress.service.count_review_attachments", return_value=0) as count,
        patch("app.modules.work_progress.service.list_review_attachments_page", return_value=[]) as page,
    ):
        result = list_review_attachment_gallery(
            MagicMock(),
            actor,
            company_id=None,
            user_id=None,
            location_id=None,
            status_filter=None,
            include_archived=True,
            entry_id=entry_id,
            date_from=None,
            date_to=None,
            title_search=None,
            limit=48,
            offset=0,
        )
    assert result.total == 0
    assert count.call_args.kwargs["entry_id_filter"] == entry_id
    assert count.call_args.kwargs["include_archived"] is True
    assert page.call_args.kwargs["entry_id_filter"] == entry_id


def test_employee_options_include_inactive_and_exclude_management_roles() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMIN, company_id)
    active = _user(SystemRole.EMPLOYEE, company_id, email="active@example.com")
    inactive = _user(SystemRole.EMPLOYEE, company_id, active=False, email="inactive@example.com")
    admin = _user(SystemRole.ADMIN, company_id, email="admin@example.com")
    other = _user(SystemRole.EMPLOYEE, uuid.uuid4(), email="other@example.com")
    rows = [
        (active, "Jane", "Doe", None),
        (inactive, "John", "Smith", None),
        (admin, "Manager", "User", None),
        (other, "Other", "Company", None),
    ]
    with (
        patch("app.core.company_scope.resolve_operational_company_id", return_value=company_id),
        patch("app.modules.auth.repository.list_users_visible_to_user_with_profile_names", return_value=rows),
    ):
        items = list_employee_filter_options(MagicMock(), actor, company_id=None)
    assert {item["email"] for item in items} == {"active@example.com", "inactive@example.com"}
    inactive_item = next(item for item in items if item["email"] == "inactive@example.com")
    assert inactive_item["is_active"] is False
    assert next(item for item in items if item["email"] == "active@example.com")["display_name"] == "Jane Doe"


def test_mixed_company_bulk_scope_is_opaque() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMIN, company_id)
    other_owner = _user(SystemRole.EMPLOYEE, uuid.uuid4())
    attachment = SimpleNamespace(id=uuid.uuid4())
    entry = SimpleNamespace(user_id=other_owner.id)
    with patch("app.modules.work_progress.service.get_user_by_id", return_value=other_owner):
        with pytest.raises(WorkProgressNotFoundError):
            _assert_bulk_attachment_scope(MagicMock(), actor, [(attachment, entry)])


def test_invalid_bulk_id_stops_before_database_or_storage_mutation() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMIN, company_id)
    db = MagicMock()
    with (
        patch("app.modules.work_progress.service._ordered_bulk_attachment_rows", side_effect=WorkProgressNotFoundError()),
        patch("app.modules.work_progress.service.get_storage_backend") as storage,
    ):
        with pytest.raises(WorkProgressNotFoundError):
            bulk_delete_review_attachments(db, actor, [uuid.uuid4()])
    db.delete.assert_not_called()
    storage.assert_not_called()


def test_bulk_delete_rejects_more_than_200_unique_ids_before_lookup() -> None:
    actor = _user(SystemRole.ADMIN, uuid.uuid4())
    ids = [uuid.uuid4() for _ in range(MAX_BULK_ATTACHMENT_IDS + 1)]
    with patch("app.modules.work_progress.service._ordered_bulk_attachment_rows") as lookup:
        with pytest.raises(ValueError, match="200"):
            bulk_delete_review_attachments(MagicMock(), actor, ids)
    lookup.assert_not_called()


def test_bulk_delete_commit_completes_before_storage_cleanup() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMIN, company_id)
    owner = _user(SystemRole.EMPLOYEE, company_id)
    attachment = SimpleNamespace(id=uuid.uuid4(), storage_path="work-progress-files/a.jpg")
    entry = SimpleNamespace(id=uuid.uuid4(), company_id=company_id, user_id=owner.id)
    events: list[str] = []
    db = MagicMock()
    db.delete.side_effect = lambda _row: events.append("delete-staged")
    backend = MagicMock()
    backend.exists.side_effect = lambda _key: events.append("storage-started") or False
    backend.get_backend_name.return_value = "local"

    def commit_audit(**_kwargs):
        events.append("audit-and-delete-committed")

    with (
        patch("app.modules.work_progress.service._ordered_bulk_attachment_rows", return_value=[(attachment, entry)]),
        patch("app.modules.work_progress.service._assert_bulk_attachment_scope", return_value=[(attachment, entry, owner)]),
        patch("app.modules.work_progress.service.create_internal_audit_event", side_effect=commit_audit),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
    ):
        bulk_delete_review_attachments(db, actor, [attachment.id])

    assert events.index("delete-staged") < events.index("audit-and-delete-committed")
    assert events.index("audit-and-delete-committed") < events.index("storage-started")


def test_archive_preserves_attachments_and_storage_objects() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMIN, company_id)
    owner = _user(SystemRole.EMPLOYEE, company_id)
    entry = SimpleNamespace(id=uuid.uuid4(), company_id=company_id, status="submitted")
    with (
        patch("app.modules.work_progress.service._assert_review_access", return_value=(entry, owner)),
        patch("app.modules.work_progress.service.save_entry") as save,
        patch("app.modules.work_progress.service.create_internal_audit_event"),
        patch("app.modules.work_progress.service.get_storage_backend") as storage,
    ):
        archive_review_entry(MagicMock(), actor, entry.id)
    save.assert_called_once()
    storage.assert_not_called()


def test_upload_route_does_not_schedule_inline_thumbnail_generation() -> None:
    from app.modules.work_progress.router import post_work_progress_me_file

    company_id = uuid.uuid4()
    actor = _user(SystemRole.EMPLOYEE, company_id)
    detail = SimpleNamespace(
        company_id=company_id,
        attachments=[SimpleNamespace(id=uuid.uuid4(), created_at=datetime.now(timezone.utc))],
    )
    upload = UploadFile(filename="new.jpg", file=io.BytesIO(b"jpeg"), headers={"content-type": "image/jpeg"})
    with patch("app.modules.work_progress.router.upload_my_entry_file", return_value=detail) as upload_fn:
        result = post_work_progress_me_file(
            uuid.uuid4(),
            upload,
            None,
            MagicMock(),
            actor,
        )
    assert result is detail
    upload_fn.assert_called_once()


def test_best_effort_thumbnail_failure_never_escapes() -> None:
    with patch(
        "app.modules.work_progress.thumbnail.ensure_thumbnail_bytes",
        side_effect=RuntimeError("thumbnail failed"),
    ):
        assert (
            generate_work_progress_thumbnail_best_effort(
                attachment_id=uuid.uuid4(),
                storage_path="work-progress-files/new.jpg",
                max_source_bytes=10,
            )
            is None
        )


def test_thumbnail_forbidden_and_missing_are_both_opaque_not_found() -> None:
    actor = _user(SystemRole.ADMIN, uuid.uuid4())
    for error in (PermissionError(), WorkProgressNotFoundError()):
        mapped_error = (
            __import__("app.modules.work_progress.service", fromlist=["WorkProgressPermissionError"]).WorkProgressPermissionError()
            if isinstance(error, PermissionError)
            else error
        )
        with patch("app.modules.work_progress.service.resolve_attachment_access", side_effect=mapped_error):
            with pytest.raises(WorkProgressNotFoundError):
                download_work_progress_thumbnail(MagicMock(), actor, uuid.uuid4())


def test_thumbnail_request_does_not_create_file_download_audit() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMIN, company_id)
    owner = _user(SystemRole.EMPLOYEE, company_id)
    attachment = SimpleNamespace(
        id=uuid.uuid4(),
        storage_path="work-progress-files/a.jpg",
        stored_content_type="image/jpeg",
        content_type="image/jpeg",
    )
    entry = SimpleNamespace(company_id=company_id)
    with (
        patch("app.modules.work_progress.service.resolve_attachment_access", return_value=(attachment, entry, owner)),
        patch("app.modules.work_progress.thumbnail.ensure_thumbnail_bytes", return_value=b"jpeg"),
        patch("app.modules.work_progress.service.create_internal_audit_event") as audit,
    ):
        assert download_work_progress_thumbnail(MagicMock(), actor, attachment.id) == b"jpeg"
    audit.assert_not_called()
