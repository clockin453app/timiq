"""Face match engine v1: threshold, shift status, audit safety."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.modules.auth.models import SystemRole, User
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.face_check.constants import (
    FACE_CHECK_NEEDS_REVIEW,
    FACE_CHECK_NOT_ENROLLED,
    FACE_CHECK_PASSED,
    FACE_CHECK_UNAVAILABLE,
    REASON_MATCHING_ENGINE_ERROR,
)
from app.modules.face_check.engine import FaceMatchResult, compare_reference_to_selfie
from app.modules.face_check.service import apply_face_check_to_shift
from app.modules.time_clock.models import TimeShift


def _user() -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        email="emp@example.com",
        password_hash="hash",
        system_role=SystemRole.EMPLOYEE,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


def _profile(user: User) -> EmployeeProfile:
    now = datetime.now(timezone.utc)
    return EmployeeProfile(
        id=uuid.uuid4(),
        user_id=user.id,
        company_id=user.company_id,
        face_check_consent_at=now,
        face_reference_storage_path="face-references/ref.jpg",
        face_reference_enrolled_at=now,
        face_reference_updated_at=now,
    )


def _shift(user_id: uuid.UUID) -> TimeShift:
    return TimeShift(
        user_id=user_id,
        location_id=uuid.uuid4(),
        status="open",
        clock_in_at=datetime.now(timezone.utc),
        clock_in_latitude=0.0,
        clock_in_longitude=0.0,
        clock_in_accuracy_meters=1.0,
        clock_in_distance_to_site_meters=1.0,
    )


@patch("app.modules.face_check.service._read_storage_bytes", return_value=b"ref")
@patch("app.modules.face_check.service.compare_reference_to_selfie")
def test_apply_not_enrolled_without_reference(mock_compare, mock_read) -> None:
    shift = _shift(uuid.uuid4())
    result = apply_face_check_to_shift(shift, None, selfie_captured=True, selfie_bytes=b"x")
    assert result is not None
    assert result.status == FACE_CHECK_NOT_ENROLLED
    assert shift.face_check_status == FACE_CHECK_NOT_ENROLLED
    mock_compare.assert_not_called()
    mock_read.assert_not_called()


@patch("app.modules.face_check.service._read_storage_bytes", return_value=b"ref")
@patch(
    "app.modules.face_check.service.compare_reference_to_selfie",
    return_value=FaceMatchResult(status=FACE_CHECK_PASSED, confidence=0.82, reason=None),
)
def test_apply_passed_saves_confidence(mock_compare, mock_read) -> None:
    user = _user()
    shift = _shift(user.id)
    apply_face_check_to_shift(
        shift,
        _profile(user),
        selfie_captured=True,
        selfie_bytes=b"selfie",
    )
    assert shift.face_check_status == FACE_CHECK_PASSED
    assert shift.face_match_confidence == 0.82
    mock_compare.assert_called_once()


@patch("app.modules.face_check.service._read_storage_bytes", return_value=b"ref")
@patch(
    "app.modules.face_check.service.compare_reference_to_selfie",
    return_value=FaceMatchResult(status=FACE_CHECK_NEEDS_REVIEW, confidence=0.64, reason=None),
)
def test_apply_needs_review_does_not_block(mock_compare, mock_read) -> None:
    user = _user()
    shift = _shift(user.id)
    result = apply_face_check_to_shift(
        shift,
        _profile(user),
        selfie_captured=True,
        selfie_bytes=b"selfie",
    )
    assert result is not None
    assert shift.face_check_status == FACE_CHECK_NEEDS_REVIEW
    assert shift.face_match_confidence == 0.64


@patch("app.modules.face_check.service._read_storage_bytes", return_value=b"ref")
@patch(
    "app.modules.face_check.service.compare_reference_to_selfie",
    return_value=FaceMatchResult(
        status=FACE_CHECK_UNAVAILABLE,
        confidence=None,
        reason=REASON_MATCHING_ENGINE_ERROR,
    ),
)
def test_apply_unavailable_safe_reason(mock_compare, mock_read) -> None:
    user = _user()
    shift = _shift(user.id)
    apply_face_check_to_shift(
        shift,
        _profile(user),
        selfie_captured=True,
        selfie_bytes=b"selfie",
    )
    assert shift.face_check_status == FACE_CHECK_UNAVAILABLE
    assert shift.face_check_reason == REASON_MATCHING_ENGINE_ERROR


def test_engine_threshold_passed_vs_review() -> None:
    from app.modules.face_check.engine import classify_confidence

    passed = classify_confidence(0.82, 0.70)
    assert passed.status == FACE_CHECK_PASSED
    review = classify_confidence(0.64, 0.70)
    assert review.status == FACE_CHECK_NEEDS_REVIEW


def test_compare_empty_selfie_unavailable() -> None:
    result = compare_reference_to_selfie(b"ref", b"")
    assert result.status == FACE_CHECK_UNAVAILABLE
    assert result.reason is not None


@patch("app.modules.time_clock.service.create_internal_audit_event")
def test_audit_face_match_has_no_paths(mock_audit) -> None:
    from app.modules.time_clock.service import _audit_face_match_checked

    user = _user()
    shift = _shift(user.id)
    shift.id = uuid.uuid4()
    db = MagicMock()
    _audit_face_match_checked(
        db_session=db,
        actor=user,
        shift=shift,
        result=FaceMatchResult(status=FACE_CHECK_PASSED, confidence=0.91, reason=None),
    )
    details = mock_audit.call_args.kwargs.get("details") or mock_audit.call_args[1]["details"]
    blob = str(details).lower()
    assert "path" not in blob
    assert "storage" not in blob
    assert "image" not in blob
    assert details["confidence"] == 0.91
