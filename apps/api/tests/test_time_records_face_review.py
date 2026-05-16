"""Protected face-check review endpoints for Time Records."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.modules.auth.dependencies import require_admin_or_administrator
from app.modules.auth.models import SystemRole, User
from app.modules.time_records.service import resolve_time_record_face_review_image


def _user(*, role: SystemRole, company_id: uuid.UUID | None = None, active: bool = True) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=company_id,
        email="user@example.com",
        password_hash="hashed",
        system_role=role,
        is_active=active,
        created_at=now,
        updated_at=now,
    )


def test_face_review_metadata_contains_no_storage_path() -> None:
    company_id = uuid.uuid4()
    shift_id = uuid.uuid4()
    admin = _user(role=SystemRole.ADMIN, company_id=company_id)
    payload = {
        "shift_id": str(shift_id),
        "employee": {
            "user_id": str(uuid.uuid4()),
            "display_name": "Employee One",
            "email": "employee@example.com",
        },
        "location_name": "Site A",
        "clock_in_at": datetime.now(timezone.utc).isoformat(),
        "clock_out_at": None,
        "shift_status": "open",
        "face_check_status": "needs_review",
        "face_match_confidence": 0.42,
        "face_check_reason": "low_confidence",
        "has_reference_photo": True,
        "has_clock_in_selfie": True,
        "has_clock_out_selfie": False,
    }

    with patch("app.modules.time_records.router.get_time_record_face_review", return_value=payload):
        app.dependency_overrides[require_admin_or_administrator] = lambda: admin
        try:
            response = TestClient(app).get(f"/api/time-records/{shift_id}/face-review")
        finally:
            app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert "storage_path" not in str(body)
    assert "face_reference_storage_path" not in str(body)


@patch("app.modules.time_records.router.resolve_time_record_face_review_image")
def test_face_review_reference_image_returns_image_content_type(mock_resolve: MagicMock) -> None:
    company_id = uuid.uuid4()
    shift_id = uuid.uuid4()
    admin = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    mock_resolve.return_value = (b"\xff\xd8\xffimage", "image/jpeg", "face-review-reference", owner)

    app.dependency_overrides[require_admin_or_administrator] = lambda: admin
    try:
        response = TestClient(app).get(f"/api/time-records/{shift_id}/face-review/reference-image")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content.startswith(b"\xff\xd8\xff")


def test_face_review_image_denies_company_admin_for_other_company() -> None:
    own_company = uuid.uuid4()
    other_company = uuid.uuid4()
    shift_id = uuid.uuid4()
    admin = _user(role=SystemRole.ADMIN, company_id=own_company)
    owner = _user(role=SystemRole.EMPLOYEE, company_id=other_company)
    shift = SimpleNamespace(id=shift_id, user_id=owner.id)
    location = SimpleNamespace(name="Other site")

    with patch(
        "app.modules.time_records.service._load_face_review_shift_context",
        return_value=(shift, location, owner, None),
    ):
        data = {
            "exists": MagicMock(return_value=True),
            "read_bytes": MagicMock(return_value=b"image"),
        }
        with patch("app.modules.time_records.service.get_storage_backend", return_value=SimpleNamespace(**data)):
            try:
                resolve_time_record_face_review_image(MagicMock(), admin, shift_id, "reference")
            except Exception as exc:
                assert "cannot view" in str(exc).lower()
            else:
                raise AssertionError("Expected cross-company admin image access to fail.")


def test_employee_cannot_view_face_review_image() -> None:
    company_id = uuid.uuid4()
    shift_id = uuid.uuid4()
    employee = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    response = TestClient(app).get(f"/api/time-records/{shift_id}/face-review/clock-in-selfie")
    assert response.status_code in (401, 403)

