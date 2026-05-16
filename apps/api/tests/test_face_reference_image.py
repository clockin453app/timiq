"""Protected employee face reference image endpoint."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import SystemRole, User
from app.modules.employee_profiles.face_reference_service import (
    FaceReferencePermissionError,
    resolve_face_reference_image,
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


@patch("app.modules.employee_profiles.router.resolve_face_reference_image")
def test_face_reference_image_endpoint_returns_image_content_type(mock_resolve: MagicMock) -> None:
    company_id = uuid.uuid4()
    admin = _user(role=SystemRole.ADMIN, company_id=company_id)
    subject = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    mock_resolve.return_value = (b"\xff\xd8\xffimage", "image/jpeg", "face-reference", subject)
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        response = TestClient(app).get(f"/api/employee-profiles/users/{subject.id}/face-reference-image")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content.startswith(b"\xff\xd8\xff")


@patch("app.modules.employee_profiles.router.resolve_face_reference_image")
def test_face_reference_image_endpoint_missing_reference_returns_404(mock_resolve: MagicMock) -> None:
    from app.modules.employee_profiles.face_reference_service import FaceReferenceNotFoundError

    admin = _user(role=SystemRole.ADMIN, company_id=uuid.uuid4())
    mock_resolve.side_effect = FaceReferenceNotFoundError("Face reference photo not found.")
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        response = TestClient(app).get(f"/api/employee-profiles/users/{uuid.uuid4()}/face-reference-image")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404


@patch("app.modules.employee_profiles.face_reference_service.get_user_by_id")
def test_company_admin_cannot_fetch_other_company_reference(mock_get_user: MagicMock) -> None:
    own_company = uuid.uuid4()
    other_company = uuid.uuid4()
    admin = _user(role=SystemRole.ADMIN, company_id=own_company)
    subject = _user(role=SystemRole.EMPLOYEE, company_id=other_company)
    mock_get_user.return_value = subject

    with pytest.raises(FaceReferencePermissionError):
        resolve_face_reference_image(MagicMock(), admin, subject.id)


@patch("app.modules.employee_profiles.face_reference_service.get_user_by_id")
def test_employee_cannot_fetch_another_employee_reference(mock_get_user: MagicMock) -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    subject = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    mock_get_user.return_value = subject

    with pytest.raises(FaceReferencePermissionError):
        resolve_face_reference_image(MagicMock(), actor, subject.id)


@patch("app.modules.employee_profiles.face_reference_service.create_internal_audit_event")
@patch("app.modules.employee_profiles.face_reference_service.get_storage_backend")
@patch("app.modules.employee_profiles.face_reference_service.get_employee_profile_by_user_id")
@patch("app.modules.employee_profiles.face_reference_service.get_user_by_id")
def test_face_reference_image_audit_contains_no_storage_path(
    mock_get_user: MagicMock,
    mock_get_profile: MagicMock,
    mock_storage: MagicMock,
    mock_audit: MagicMock,
) -> None:
    company_id = uuid.uuid4()
    admin = _user(role=SystemRole.ADMIN, company_id=company_id)
    subject = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    profile = SimpleNamespace(
        id=uuid.uuid4(),
        user_id=subject.id,
        company_id=company_id,
        face_check_consent_at=datetime.now(timezone.utc),
        face_reference_storage_path="face-references/secret/path.jpg",
    )
    mock_get_user.return_value = subject
    mock_get_profile.return_value = profile
    mock_storage.return_value = SimpleNamespace(
        exists=MagicMock(return_value=True),
        read_bytes=MagicMock(return_value=b"\xff\xd8\xffimage"),
    )

    body, media_type, _filename, _subject = resolve_face_reference_image(MagicMock(), admin, subject.id)

    assert body.startswith(b"\xff\xd8\xff")
    assert media_type == "image/jpeg"
    details = mock_audit.call_args.kwargs.get("details") or mock_audit.call_args[0][5]
    assert "path" not in details
    assert "storage" not in str(details).lower()
