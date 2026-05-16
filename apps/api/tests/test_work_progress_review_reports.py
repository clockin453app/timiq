"""Work progress review PDF/archive smoke tests."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.auth.dependencies import require_admin_or_administrator
from app.modules.auth.models import SystemRole, User
from app.modules.work_progress.pdf_export import build_work_progress_report_pdf
from app.modules.work_progress.service import (
    STATUS_ARCHIVED,
    WorkProgressPermissionError,
    archive_review_entry,
    export_review_entries_pdf,
)


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


def test_build_work_progress_report_pdf_returns_pdf_bytes() -> None:
    body = build_work_progress_report_pdf(
        company_name="Acme Ltd",
        date_from=date(2026, 5, 1),
        date_to=date(2026, 5, 16),
        filters={"status": "submitted"},
        summary={
            "total_submissions": 0,
            "total_attachments": 0,
            "submitted_count": 0,
            "reviewed_count": 0,
        },
        entries=[],
    )
    assert body.startswith(b"%PDF")
    assert len(body) > 200


@patch("app.modules.work_progress.router.export_review_entries_pdf")
def test_work_progress_report_pdf_response_headers(mock_export: object, client: TestClient) -> None:
    company_id = uuid.uuid4()
    admin = _user(role=SystemRole.ADMIN, company_id=company_id)
    mock_export.return_value = (b"%PDF-1.4 work progress", "timiq-work-progress-report-2026-05-01-to-2026-05-16.pdf")  # type: ignore[attr-defined]

    app.dependency_overrides[require_admin_or_administrator] = lambda: admin
    try:
        response = client.get(
            f"/api/work-progress/review/report.pdf?company_id={company_id}&date_from=2026-05-01&date_to=2026-05-16",
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        disposition = response.headers.get("content-disposition", "")
        assert "attachment" in disposition
        assert "timiq-work-progress-report-2026-05-01-to-2026-05-16.pdf" in disposition
        assert response.content.startswith(b"%PDF")
    finally:
        app.dependency_overrides.clear()


def test_employee_cannot_export_work_progress_review_pdf() -> None:
    employee = _user(role=SystemRole.EMPLOYEE, company_id=uuid.uuid4())
    with pytest.raises(WorkProgressPermissionError):
        export_review_entries_pdf(
            MagicMock(),
            employee,
            company_id=None,
            user_id=None,
            location_id=None,
            status_filter=None,
            date_from=None,
            date_to=None,
            title_search=None,
        )


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
