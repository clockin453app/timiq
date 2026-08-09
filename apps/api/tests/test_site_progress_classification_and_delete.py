"""Site Progress classification fields + delete access corrections."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from app.modules.auth.models import SystemRole, User
from app.modules.work_progress.classification import (
    ELEVATION_CUSTOM,
    ELEVATION_OPTIONS,
    WORK_CATEGORY_OPTIONS,
)
from app.modules.work_progress.schemas import WorkProgressCreateRequest
from app.modules.work_progress.service import (
    WorkProgressNotFoundError,
    WorkProgressPermissionError,
    WorkProgressValidationError,
    _assert_bulk_attachment_scope,
    _assert_review_access,
    _ordered_bulk_attachment_rows,
    _validate_classification,
    bulk_delete_review_attachments,
    permanently_delete_review_entry,
)


def _user(*, role: SystemRole, company_id: uuid.UUID | None = None) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=company_id or uuid.uuid4(),
        email=f"{role.value}@example.com",
        password_hash="h",
        system_role=role,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


def _create_body(**overrides: object) -> WorkProgressCreateRequest:
    base = {
        "work_date": date(2026, 8, 3),
        "location_id": uuid.uuid4(),
        "work_category": "insulation",
        "elevation": "north_east",
        "elevation_custom": None,
        "level": 3,
        "notes": None,
    }
    base.update(overrides)
    return WorkProgressCreateRequest(**base)  # type: ignore[arg-type]


@pytest.mark.parametrize("value,label", WORK_CATEGORY_OPTIONS)
def test_every_work_category_accepted(value: str, label: str) -> None:
    body = _create_body(work_category=value)
    category, _elevation, _custom, _level = _validate_classification(body)
    assert category == value
    assert label  # ensure labels populated


@pytest.mark.parametrize("value,label", ELEVATION_OPTIONS)
def test_every_elevation_accepted(value: str, label: str) -> None:
    custom = "Elevation A" if value == ELEVATION_CUSTOM else None
    body = _create_body(elevation=value, elevation_custom=custom)
    _category, elevation, custom_out, _level = _validate_classification(body)
    assert elevation == value
    if value == ELEVATION_CUSTOM:
        assert custom_out == "Elevation A"
    assert label


def test_missing_work_category_rejected_by_schema() -> None:
    with pytest.raises(ValidationError):
        WorkProgressCreateRequest(
            work_date=date(2026, 8, 3),
            location_id=uuid.uuid4(),
            elevation="north",
            level=1,
        )


def test_invalid_work_category_rejected() -> None:
    with pytest.raises(WorkProgressValidationError, match="work category"):
        _validate_classification(_create_body(work_category="not_a_category"))


def test_invalid_elevation_rejected() -> None:
    with pytest.raises(WorkProgressValidationError, match="elevation"):
        _validate_classification(_create_body(elevation="north_north_east"))


def test_custom_elevation_requires_name() -> None:
    with pytest.raises(WorkProgressValidationError, match="Elevation name"):
        _validate_classification(_create_body(elevation=ELEVATION_CUSTOM, elevation_custom="  "))


def test_custom_elevation_trims_whitespace() -> None:
    _c, _e, custom, _l = _validate_classification(
        _create_body(elevation=ELEVATION_CUSTOM, elevation_custom="  Elevation A  ")
    )
    assert custom == "Elevation A"


def test_custom_elevation_rejects_long_name() -> None:
    with pytest.raises(ValidationError):
        _create_body(elevation=ELEVATION_CUSTOM, elevation_custom="x" * 101)


def test_non_custom_rejects_elevation_name() -> None:
    with pytest.raises(WorkProgressValidationError, match="only allowed"):
        _validate_classification(_create_body(elevation="north", elevation_custom="Nope"))


@pytest.mark.parametrize("level", [0, 1, 9, 10, 20])
def test_level_bounds_accepted(level: int) -> None:
    _c, _e, _custom, out = _validate_classification(_create_body(level=level))
    assert out == level


@pytest.mark.parametrize("level", [-1, 21])
def test_level_out_of_range_rejected_by_schema(level: int) -> None:
    with pytest.raises(ValidationError):
        _create_body(level=level)


def test_company_admin_can_manage_admin_authored_submission() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.ADMIN, company_id=company_id)
    entry = SimpleNamespace(id=uuid.uuid4(), company_id=company_id, user_id=owner.id)
    with patch(
        "app.modules.work_progress.service.get_entry_with_owner",
        return_value=(entry, owner),
    ):
        got_entry, got_owner = _assert_review_access(MagicMock(), actor, entry.id)
    assert got_entry is entry
    assert got_owner is owner


def test_company_admin_cannot_manage_other_company_submission() -> None:
    actor = _user(role=SystemRole.ADMIN, company_id=uuid.uuid4())
    owner = _user(role=SystemRole.EMPLOYEE, company_id=uuid.uuid4())
    entry = SimpleNamespace(id=uuid.uuid4(), company_id=owner.company_id, user_id=owner.id)
    with patch(
        "app.modules.work_progress.service.get_entry_with_owner",
        return_value=(entry, owner),
    ):
        with pytest.raises(WorkProgressPermissionError):
            _assert_review_access(MagicMock(), actor, entry.id)


def test_permanent_delete_admin_owned_submission_succeeds() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.ADMIN, company_id=company_id)
    entry = SimpleNamespace(
        id=uuid.uuid4(),
        company_id=company_id,
        user_id=owner.id,
        status="submitted",
        work_date=date(2026, 8, 1),
        title="",
    )
    att = SimpleNamespace(id=uuid.uuid4(), entry_id=entry.id, storage_path="work-progress-files/a.jpg")
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
    assert result["deleted_submission_id"] == entry.id
    assert result["deleted_attachment_count"] == 1


def test_bulk_delete_skips_stale_ids_and_deletes_found() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    alive = SimpleNamespace(id=uuid.uuid4(), storage_path="work-progress-files/alive.jpg")
    entry = SimpleNamespace(id=uuid.uuid4(), company_id=company_id, user_id=owner.id)
    stale_id = uuid.uuid4()
    db = MagicMock()
    backend = MagicMock()
    backend.exists.return_value = False
    backend.get_backend_name.return_value = "local"
    with (
        patch(
            "app.modules.work_progress.service._ordered_bulk_attachment_rows",
            return_value=[(alive, entry)],
        ),
        patch(
            "app.modules.work_progress.service._assert_bulk_attachment_scope",
            return_value=[(alive, entry, owner)],
        ),
        patch("app.modules.work_progress.service.create_internal_audit_event"),
        patch("app.modules.work_progress.service.get_storage_backend", return_value=backend),
    ):
        result = bulk_delete_review_attachments(db, actor, [alive.id, stale_id])
    assert result["deleted_count"] == 1
    db.delete.assert_called_once_with(alive)


def test_ordered_bulk_rows_require_all_still_raises_for_zip() -> None:
    db = MagicMock()
    with patch(
        "app.modules.work_progress.service.list_attachments_by_ids_with_entries",
        return_value=[],
    ):
        with pytest.raises(WorkProgressNotFoundError):
            _ordered_bulk_attachment_rows(db, [uuid.uuid4()], require_all=True)


def test_ordered_bulk_rows_allow_missing_returns_empty() -> None:
    db = MagicMock()
    with patch(
        "app.modules.work_progress.service.list_attachments_by_ids_with_entries",
        return_value=[],
    ):
        assert _ordered_bulk_attachment_rows(db, [uuid.uuid4()], require_all=False) == []


def test_bulk_scope_allows_admin_owned_in_company() -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.ADMIN, company_id=company_id)
    attachment = SimpleNamespace(id=uuid.uuid4())
    entry = SimpleNamespace(user_id=owner.id, company_id=company_id)
    with patch("app.modules.work_progress.service.get_user_by_id", return_value=owner):
        out = _assert_bulk_attachment_scope(MagicMock(), actor, [(attachment, entry)])
    assert len(out) == 1
