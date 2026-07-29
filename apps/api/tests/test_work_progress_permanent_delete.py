"""Permanent delete submission: transaction, auth, storage cleanup."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.auth.dependencies import require_active_user
from app.modules.auth.models import SystemRole, User
from app.modules.work_progress.service import (
    WorkProgressNotFoundError,
    WorkProgressPermissionError,
    WorkProgressValidationError,
    archive_review_entry,
    permanently_delete_review_entry,
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


def _entry(
    *,
    company_id: uuid.UUID,
    owner_id: uuid.UUID,
    status: str = "submitted",
    title: str = "Site photos",
) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        company_id=company_id,
        user_id=owner_id,
        status=status,
        work_date=date(2026, 7, 1),
        title=title,
    )


def _attachment(entry_id: uuid.UUID, path: str = "work-progress-files/a.jpg") -> SimpleNamespace:
    return SimpleNamespace(id=uuid.uuid4(), entry_id=entry_id, storage_path=path)


def test_permanent_delete_zero_attachments() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    entry = _entry(company_id=company_id, owner_id=owner.id)
    db = MagicMock()
    backend = MagicMock()
    backend.exists.return_value = False
    backend.get_backend_name.return_value = "local"

    with (
        patch("app.modules.work_progress.service._assert_review_access", return_value=(entry, owner)),
        patch("app.modules.work_progress.service.list_attachments_for_entry", return_value=[]),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
    ):
        result = permanently_delete_review_entry(db, actor, entry.id)

    db.delete.assert_called_once_with(entry)
    db.add.assert_called_once()
    db.commit.assert_called_once()
    db.rollback.assert_not_called()
    assert result["deleted_submission_id"] == entry.id
    assert result["deleted_attachment_count"] == 0
    assert result["storage_cleanup_ok"] == 0
    assert result["storage_cleanup_failed"] == 0
    assert result["warning"] is None
    backend.delete_file.assert_not_called()


def test_permanent_delete_several_attachments_atomically() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    entry = _entry(company_id=company_id, owner_id=owner.id)
    atts = [_attachment(entry.id, f"work-progress-files/{i}.jpg") for i in range(3)]
    db = MagicMock()
    backend = MagicMock()
    backend.exists.return_value = False
    backend.get_backend_name.return_value = "local"

    with (
        patch("app.modules.work_progress.service._assert_review_access", return_value=(entry, owner)),
        patch("app.modules.work_progress.service.list_attachments_for_entry", return_value=atts),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
    ):
        result = permanently_delete_review_entry(db, actor, entry.id)

    deleted = [c.args[0] for c in db.delete.call_args_list]
    assert deleted == [*atts, entry]
    assert result["deleted_attachment_count"] == 3
    assert result["storage_cleanup_ok"] == 3
    assert result["storage_cleanup_failed"] == 0
    audit = db.add.call_args.args[0]
    assert audit.action == "work_progress.submission_permanently_deleted"
    assert audit.entity_type == "work_progress_entry"
    assert audit.entity_id == str(entry.id)
    assert audit.details["attachment_count"] == 3
    assert audit.details["owner_user_id"] == str(owner.id)
    assert "storage_path" not in audit.details
    assert "original_filename" not in audit.details
    assert "work-progress-files" not in str(audit.details)


def test_audit_failure_rolls_back_and_skips_storage() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    entry = _entry(company_id=company_id, owner_id=owner.id)
    att = _attachment(entry.id)
    db = MagicMock()
    db.commit.side_effect = RuntimeError("audit/db failed")
    backend = MagicMock()

    with (
        patch("app.modules.work_progress.service._assert_review_access", return_value=(entry, owner)),
        patch("app.modules.work_progress.service.list_attachments_for_entry", return_value=[att]),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend) as storage,
    ):
        with pytest.raises(RuntimeError, match="audit/db failed"):
            permanently_delete_review_entry(db, actor, entry.id)

    db.rollback.assert_called_once()
    storage.assert_not_called()
    backend.delete_file.assert_not_called()


def test_commit_failure_prevents_storage_cleanup() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    entry = _entry(company_id=company_id, owner_id=owner.id)
    db = MagicMock()
    db.commit.side_effect = Exception("commit boom")

    with (
        patch("app.modules.work_progress.service._assert_review_access", return_value=(entry, owner)),
        patch("app.modules.work_progress.service.list_attachments_for_entry", return_value=[]),
        patch("app.modules.work_progress.service.get_storage_backend") as storage,
    ):
        with pytest.raises(Exception, match="commit boom"):
            permanently_delete_review_entry(db, actor, entry.id)

    db.rollback.assert_called_once()
    storage.assert_not_called()


def test_storage_cleanup_starts_only_after_commit() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    entry = _entry(company_id=company_id, owner_id=owner.id)
    att = _attachment(entry.id)
    events: list[str] = []
    db = MagicMock()
    db.delete.side_effect = lambda _row: events.append("delete-staged")
    db.add.side_effect = lambda _evt: events.append("audit-staged")
    db.commit.side_effect = lambda: events.append("committed")
    backend = MagicMock()
    backend.exists.side_effect = lambda _key: events.append("storage-started") or False
    backend.get_backend_name.return_value = "local"

    with (
        patch("app.modules.work_progress.service._assert_review_access", return_value=(entry, owner)),
        patch("app.modules.work_progress.service.list_attachments_for_entry", return_value=[att]),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
    ):
        permanently_delete_review_entry(db, actor, entry.id)

    assert events.index("delete-staged") < events.index("committed")
    assert events.index("audit-staged") < events.index("committed")
    assert events.index("committed") < events.index("storage-started")


def test_cross_company_maps_to_not_found() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    db = MagicMock()
    with patch(
        "app.modules.work_progress.service._assert_review_access",
        side_effect=WorkProgressPermissionError(),
    ):
        with pytest.raises(WorkProgressNotFoundError):
            permanently_delete_review_entry(db, actor, uuid.uuid4())
    db.commit.assert_not_called()


def test_missing_and_unauthorized_both_raise_not_found() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    db = MagicMock()

    with patch(
        "app.modules.work_progress.service._assert_review_access",
        side_effect=WorkProgressNotFoundError(),
    ):
        with pytest.raises(WorkProgressNotFoundError):
            permanently_delete_review_entry(db, actor, uuid.uuid4())

    with patch(
        "app.modules.work_progress.service._assert_review_access",
        side_effect=WorkProgressPermissionError(),
    ):
        with pytest.raises(WorkProgressNotFoundError):
            permanently_delete_review_entry(db, actor, uuid.uuid4())


def test_employee_role_rejected() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    db = MagicMock()
    with pytest.raises(WorkProgressPermissionError):
        permanently_delete_review_entry(db, actor, uuid.uuid4())
    db.commit.assert_not_called()


def test_rejects_attachment_belonging_to_other_submission() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    entry = _entry(company_id=company_id, owner_id=owner.id)
    foreign = _attachment(uuid.uuid4())
    db = MagicMock()

    with (
        patch("app.modules.work_progress.service._assert_review_access", return_value=(entry, owner)),
        patch("app.modules.work_progress.service.list_attachments_for_entry", return_value=[foreign]),
        patch("app.modules.work_progress.service.get_storage_backend") as storage,
    ):
        with pytest.raises(WorkProgressValidationError):
            permanently_delete_review_entry(db, actor, entry.id)

    db.commit.assert_not_called()
    storage.assert_not_called()


def test_missing_original_and_thumb_are_not_failures() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    entry = _entry(company_id=company_id, owner_id=owner.id)
    att = _attachment(entry.id)
    db = MagicMock()
    backend = MagicMock()
    backend.exists.return_value = False
    backend.get_backend_name.return_value = "local"

    with (
        patch("app.modules.work_progress.service._assert_review_access", return_value=(entry, owner)),
        patch("app.modules.work_progress.service.list_attachments_for_entry", return_value=[att]),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
    ):
        result = permanently_delete_review_entry(db, actor, entry.id)

    assert result["storage_cleanup_ok"] == 1
    assert result["storage_cleanup_failed"] == 0
    assert result["warning"] is None
    backend.delete_file.assert_not_called()


def test_existing_original_delete_failure_counts_one_attachment() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    entry = _entry(company_id=company_id, owner_id=owner.id)
    att = _attachment(entry.id)
    db = MagicMock()
    backend = MagicMock()
    backend.exists.return_value = True
    backend.delete_file.side_effect = [RuntimeError("orig"), None]
    backend.get_backend_name.return_value = "local"

    with (
        patch("app.modules.work_progress.service._assert_review_access", return_value=(entry, owner)),
        patch("app.modules.work_progress.service.list_attachments_for_entry", return_value=[att]),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
    ):
        result = permanently_delete_review_entry(db, actor, entry.id)

    assert result["storage_cleanup_ok"] == 0
    assert result["storage_cleanup_failed"] == 1
    assert "Support has been notified" in (result["warning"] or "")
    assert "work-progress-files" not in str(result)


def test_existing_thumb_delete_failure_counts_one_attachment() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    entry = _entry(company_id=company_id, owner_id=owner.id)
    att = _attachment(entry.id)
    db = MagicMock()
    backend = MagicMock()
    backend.exists.return_value = True
    backend.delete_file.side_effect = [None, RuntimeError("thumb")]
    backend.get_backend_name.return_value = "local"

    with (
        patch("app.modules.work_progress.service._assert_review_access", return_value=(entry, owner)),
        patch("app.modules.work_progress.service.list_attachments_for_entry", return_value=[att]),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
    ):
        result = permanently_delete_review_entry(db, actor, entry.id)

    assert result["storage_cleanup_failed"] == 1
    assert result["storage_cleanup_ok"] == 0


def test_both_object_failures_still_one_failed_attachment() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    entry = _entry(company_id=company_id, owner_id=owner.id)
    att = _attachment(entry.id)
    db = MagicMock()
    backend = MagicMock()
    backend.exists.return_value = True
    backend.delete_file.side_effect = RuntimeError("boom")
    backend.get_backend_name.return_value = "local"

    with (
        patch("app.modules.work_progress.service._assert_review_access", return_value=(entry, owner)),
        patch("app.modules.work_progress.service.list_attachments_for_entry", return_value=[att]),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
    ):
        result = permanently_delete_review_entry(db, actor, entry.id)

    assert result["storage_cleanup_failed"] == 1
    assert result["deleted_attachment_count"] == 1


def test_response_and_audit_omit_storage_paths() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    entry = _entry(company_id=company_id, owner_id=owner.id, title="Roofing progress east wing")
    att = _attachment(entry.id, "work-progress-files/secret.jpg")
    db = MagicMock()
    backend = MagicMock()
    backend.exists.return_value = False
    backend.get_backend_name.return_value = "local"

    with (
        patch("app.modules.work_progress.service._assert_review_access", return_value=(entry, owner)),
        patch("app.modules.work_progress.service.list_attachments_for_entry", return_value=[att]),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
    ):
        result = permanently_delete_review_entry(db, actor, entry.id)

    blob = str(result)
    assert "work-progress-files/secret.jpg" not in blob
    audit = db.add.call_args.args[0]
    assert "storage_path" not in audit.details
    assert "secret.jpg" not in str(audit.details)
    assert "work-progress-files" not in str(audit.details)
    assert audit.details["title"] == "Roofing progress east wing"


def test_archived_submission_may_be_permanently_deleted() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    entry = _entry(company_id=company_id, owner_id=owner.id, status="archived")
    db = MagicMock()
    backend = MagicMock()
    backend.exists.return_value = False
    backend.get_backend_name.return_value = "local"

    with (
        patch("app.modules.work_progress.service._assert_review_access", return_value=(entry, owner)),
        patch("app.modules.work_progress.service.list_attachments_for_entry", return_value=[]),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
    ):
        result = permanently_delete_review_entry(db, actor, entry.id)

    assert result["deleted_submission_id"] == entry.id
    audit = db.add.call_args.args[0]
    assert audit.details["previous_status"] == "archived"


def test_archive_still_preserves_rows_and_files() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    entry = _entry(company_id=company_id, owner_id=owner.id)
    with (
        patch("app.modules.work_progress.service._assert_review_access", return_value=(entry, owner)),
        patch("app.modules.work_progress.service.save_entry") as save,
        patch("app.modules.work_progress.service.create_internal_audit_event"),
        patch("app.modules.work_progress.service.get_storage_backend") as storage,
    ):
        archive_review_entry(MagicMock(), actor, entry.id)
    save.assert_called_once()
    storage.assert_not_called()
    assert entry.status == "archived"


def test_permanent_delete_route_registered_and_not_shadowed() -> None:
    from app.modules.work_progress.router import router

    paths = {(getattr(r, "path", None), tuple(sorted(r.methods or []))) for r in router.routes}
    assert ("/api/work-progress/review/{progress_id}/permanent-delete", ("POST",)) in paths
    assert ("/api/work-progress/review/{progress_id}", ("DELETE",)) in paths


def test_route_rejects_employee_with_403_and_no_side_effects() -> None:
    """Real require_admin_or_administrator dependency must block employees at the route."""
    employee = _user(role=SystemRole.EMPLOYEE, company_id=uuid.uuid4())
    app.dependency_overrides[require_active_user] = lambda: employee
    client = TestClient(app)
    try:
        with (
            patch("app.modules.work_progress.router.permanently_delete_review_entry") as service,
            patch("app.modules.work_progress.service.list_attachments_for_entry") as load_atts,
            patch("app.modules.work_progress.service.get_storage_backend") as storage,
            patch("app.modules.work_progress.service.AuditEvent") as audit_event,
        ):
            response = client.post(
                f"/api/work-progress/review/{uuid.uuid4()}/permanent-delete",
            )
        assert response.status_code == 403
        service.assert_not_called()
        load_atts.assert_not_called()
        storage.assert_not_called()
        audit_event.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def test_router_maps_not_found_opaquely() -> None:
    from fastapi import HTTPException

    from app.modules.work_progress.router import post_work_progress_review_permanent_delete

    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    with patch(
        "app.modules.work_progress.router.permanently_delete_review_entry",
        side_effect=WorkProgressNotFoundError(),
    ):
        with pytest.raises(HTTPException) as missing:
            post_work_progress_review_permanent_delete(uuid.uuid4(), MagicMock(), actor)

    with patch(
        "app.modules.work_progress.router.permanently_delete_review_entry",
        side_effect=WorkProgressPermissionError(),
    ):
        with pytest.raises(HTTPException) as unauthorized:
            post_work_progress_review_permanent_delete(uuid.uuid4(), MagicMock(), actor)

    assert missing.value.status_code == 404
    assert unauthorized.value.status_code == 404
    assert missing.value.detail == unauthorized.value.detail == "Not found."
