"""Standalone RAMS acknowledgement-register.pdf response headers and auth."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.auth.dependencies import require_admin_or_administrator
from app.modules.auth.models import SystemRole, User


def _user(*, role: SystemRole, company_id: uuid.UUID | None = None) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=company_id,
        email="admin@example.com",
        password_hash="hashed",
        system_role=role,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@patch("app.modules.rams.router.export_acknowledgement_register_pdf_bytes")
def test_acknowledgement_register_pdf_headers(mock_export: MagicMock, client: TestClient) -> None:
    assessment_id = uuid.uuid4()
    admin = _user(role=SystemRole.ADMIN, company_id=uuid.uuid4())
    mock_export.return_value = (b"%PDF-1.4 register-only", f"rams-acknowledgement-register-{assessment_id}.pdf")

    app.dependency_overrides[require_admin_or_administrator] = lambda: admin
    try:
        response = client.get(f"/api/rams/{assessment_id}/acknowledgement-register.pdf")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/pdf")
        disposition = response.headers.get("content-disposition", "")
        assert disposition.lower().endswith(".pdf\"") or disposition.lower().endswith(".pdf")
        assert "rams-acknowledgement-register-" in disposition
        assert response.content.startswith(b"%PDF")
        mock_export.assert_called_once()
    finally:
        app.dependency_overrides.pop(require_admin_or_administrator, None)


def test_acknowledgement_register_pdf_requires_auth(client: TestClient) -> None:
    response = client.get(f"/api/rams/{uuid.uuid4()}/acknowledgement-register.pdf")
    assert response.status_code in (401, 403)
