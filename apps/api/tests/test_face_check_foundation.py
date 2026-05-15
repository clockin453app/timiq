"""Face check foundation: consent, reference storage, shift status (no matching engine)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from app.modules.auth.limited_access import has_limited_access
from app.modules.auth.models import SystemRole, User
from app.modules.employee_profiles.face_reference_service import (
    FaceReferenceError,
    FaceReferencePermissionError,
    enroll_face_reference,
    remove_face_reference,
)
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.face_check.constants import (
    FACE_CHECK_NOT_ENROLLED,
    FACE_CHECK_UNAVAILABLE,
    MATCHING_ENGINE_NOT_ENABLED_REASON,
)
from app.modules.face_check.service import apply_face_check_to_shift, face_reference_configured
from app.modules.time_clock.models import TimeShift


def _user(*, active: bool = True, role: SystemRole = SystemRole.EMPLOYEE) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        email="emp@example.com",
        password_hash="hash",
        system_role=role,
        is_active=active,
        created_at=now,
        updated_at=now,
    )


def _profile(*, user: User, consent: bool = True, path: str | None = "face-references/x.jpg") -> EmployeeProfile:
    now = datetime.now(timezone.utc)
    return EmployeeProfile(
        id=uuid.uuid4(),
        user_id=user.id,
        company_id=user.company_id,
        face_check_consent_at=now if consent else None,
        face_reference_storage_path=path if consent else None,
        face_reference_enrolled_at=now if consent and path else None,
        face_reference_updated_at=now if consent and path else None,
    )


def test_face_reference_requires_consent() -> None:
    user = _user()
    db = MagicMock()
    with pytest.raises(FaceReferenceError, match="Consent"):
        enroll_face_reference(
            db,
            user,
            consent=False,
            content_type="image/jpeg",
            file_bytes=b"\xff\xd8\xff",
        )


def test_face_reference_configured_flag() -> None:
    user = _user()
    assert not face_reference_configured(_profile(user=user, consent=False, path=None))
    assert face_reference_configured(_profile(user=user))


def test_apply_face_check_not_enrolled() -> None:
    shift = TimeShift(
        user_id=uuid.uuid4(),
        location_id=uuid.uuid4(),
        status="open",
        clock_in_at=datetime.now(timezone.utc),
        clock_in_latitude=0.0,
        clock_in_longitude=0.0,
        clock_in_accuracy_meters=1.0,
        clock_in_distance_to_site_meters=1.0,
    )
    apply_face_check_to_shift(shift, None, selfie_captured=True)
    assert shift.face_check_status == FACE_CHECK_NOT_ENROLLED


def test_apply_face_check_unavailable_when_enrolled() -> None:
    user = _user()
    shift = TimeShift(
        user_id=user.id,
        location_id=uuid.uuid4(),
        status="open",
        clock_in_at=datetime.now(timezone.utc),
        clock_in_latitude=0.0,
        clock_in_longitude=0.0,
        clock_in_accuracy_meters=1.0,
        clock_in_distance_to_site_meters=1.0,
    )
    apply_face_check_to_shift(shift, _profile(user=user), selfie_captured=True)
    assert shift.face_check_status == FACE_CHECK_UNAVAILABLE
    assert shift.face_check_reason == MATCHING_ENGINE_NOT_ENABLED_REASON


@patch("app.modules.employee_profiles.face_reference_service.get_or_create_profile_for_user")
@patch("app.modules.employee_profiles.face_reference_service._write_reference_file")
@patch("app.modules.employee_profiles.face_reference_service.update_employee_profile")
@patch("app.modules.employee_profiles.face_reference_service.create_internal_audit_event")
def test_enroll_does_not_expose_storage_path_in_audit(
    mock_audit,
    mock_update,
    mock_write,
    mock_get_profile,
) -> None:
    user = _user()
    profile = _profile(user=user, consent=False, path=None)
    mock_get_profile.return_value = profile
    mock_write.return_value = "face-references/secret/path.jpg"

    enroll_face_reference(
        MagicMock(),
        user,
        consent=True,
        content_type="image/jpeg",
        file_bytes=b"\xff\xd8\xff" + b"x" * 100,
    )

    details = mock_audit.call_args.kwargs.get("details") or mock_audit.call_args[1].get("details")
    assert details is not None
    assert "path" not in details
    assert "storage" not in str(details).lower()


def test_limited_access_user_cannot_enrol() -> None:
    user = _user(active=False)
    assert has_limited_access(user)
    with pytest.raises(FaceReferencePermissionError, match="deactivated"):
        enroll_face_reference(
            MagicMock(),
            user,
            consent=True,
            content_type="image/jpeg",
            file_bytes=b"\xff\xd8\xff" + b"x" * 100,
        )


def test_face_reference_routes_require_active_user() -> None:
    from fastapi import HTTPException
    from fastapi.testclient import TestClient

    from app.main import app
    from app.modules.auth.dependencies import require_active_user

    def reject_active() -> User:
        raise HTTPException(status_code=403, detail="deactivated")

    app.dependency_overrides[require_active_user] = reject_active
    try:
        client = TestClient(app)
        assert client.post("/api/employee-profiles/me/face-reference").status_code == 403
        assert client.delete("/api/employee-profiles/me/face-reference").status_code == 403
    finally:
        app.dependency_overrides.clear()


@patch("app.modules.employee_profiles.face_reference_service.get_employee_profile_by_user_id")
@patch("app.modules.employee_profiles.face_reference_service.update_employee_profile")
@patch("app.modules.employee_profiles.face_reference_service._delete_storage_file")
@patch("app.modules.employee_profiles.face_reference_service.create_internal_audit_event")
def test_remove_clears_configured(
    mock_audit,
    mock_delete_file,
    mock_update,
    mock_get,
) -> None:
    user = _user()
    profile = _profile(user=user)
    mock_get.return_value = profile
    result = remove_face_reference(MagicMock(), user)
    assert result.face_reference_storage_path is None
    assert result.face_check_consent_at is None
