"""Face check setup notification in bell summary."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from app.modules.auth.models import SystemRole, User
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.notifications.service import (
    face_check_setup_notification_item,
    get_notification_summary,
)


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


def _profile(*, user: User, configured: bool) -> EmployeeProfile:
    now = datetime.now(timezone.utc)
    return EmployeeProfile(
        id=uuid.uuid4(),
        user_id=user.id,
        company_id=user.company_id,
        face_check_consent_at=now if configured else None,
        face_reference_storage_path="face-references/x.jpg" if configured else None,
        face_reference_enrolled_at=now if configured else None,
        face_reference_updated_at=now if configured else None,
    )


@patch("app.modules.notifications.service.get_employee_profile_by_user_id")
def test_active_employee_without_reference_gets_notification(mock_get_profile) -> None:
    user = _user()
    mock_get_profile.return_value = _profile(user=user, configured=False)
    item = face_check_setup_notification_item(MagicMock(), user)
    assert item is not None
    assert item.kind == "face_check_setup"
    assert item.title == "Set up face check"
    assert item.href == "/profile#face-check"
    assert item.priority == "high"
    assert item.category == "account"
    assert item.count == 1
    assert item.is_seen is False
    blob = str(item.model_dump()).lower()
    assert "path" not in blob
    assert "storage" not in blob


@patch("app.modules.notifications.service.get_employee_profile_by_user_id")
def test_active_employee_with_reference_no_notification(mock_get_profile) -> None:
    user = _user()
    mock_get_profile.return_value = _profile(user=user, configured=True)
    assert face_check_setup_notification_item(MagicMock(), user) is None


@patch("app.modules.notifications.service.get_employee_profile_by_user_id")
def test_deactivated_employee_no_notification(mock_get_profile) -> None:
    user = _user(active=False)
    assert face_check_setup_notification_item(MagicMock(), user) is None
    mock_get_profile.assert_not_called()


def test_admin_no_face_setup_notification() -> None:
    user = _user(role=SystemRole.ADMIN)
    assert face_check_setup_notification_item(MagicMock(), user) is None


@patch("app.modules.notifications.service.time_clock_repo")
@patch("app.modules.notifications.service.payroll_repo")
@patch("app.modules.notifications.service.leave_repo")
@patch("app.modules.notifications.service.time_records_repo")
@patch("app.modules.notifications.service.sf_repo")
@patch("app.modules.notifications.service.tt_repo")
@patch("app.modules.notifications.service.rams_repo")
@patch("app.modules.notifications.service.ensure_company_time_policy")
@patch("app.modules.notifications.service.message_bell_items", return_value=[])
@patch("app.modules.notifications.service.count_unread_visible_announcements", return_value=0)
@patch("app.modules.notifications.service.get_employee_profile_by_user_id")
def test_summary_includes_face_setup_for_employee(
    mock_get_profile,
    _mock_ann,
    _mock_msg,
    mock_policy,
    mock_rams,
    mock_tt,
    mock_sf,
    mock_tr,
    mock_leave,
    mock_payroll,
    mock_tc,
) -> None:
    user = _user()
    mock_get_profile.return_value = _profile(user=user, configured=False)
    mock_policy.return_value = MagicMock(timezone_name="UTC")
    mock_rams.count_pending_acknowledgements_for_user.return_value = 0
    mock_tt.count_pending_sign_for_user.return_value = 0
    mock_sf.count_draft_submissions_for_user.return_value = 0
    mock_payroll.count_approved_paid_items_for_user_since_week_start.return_value = 0
    mock_tr.count_completed_shifts_for_user_payroll_week.return_value = 0
    mock_leave.count_user_leave_status_since.return_value = 0

    summary = get_notification_summary(MagicMock(), user, company_id=None)
    kinds = [i.kind for i in summary.items]
    assert "face_check_setup" in kinds
