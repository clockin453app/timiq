"""Live attendance company scope for administrators."""

import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.modules.auth.models import SystemRole, User
from app.modules.live_attendance.permissions import (
    LiveAttendancePermissionError,
    resolve_live_attendance_company_id,
)


def _user(role: SystemRole, company_id: uuid.UUID | None) -> User:
    u = MagicMock(spec=User)
    u.system_role = role
    u.company_id = company_id
    return u


def test_administrator_requires_company_id() -> None:
    db = MagicMock()
    admin = _user(SystemRole.ADMINISTRATOR, None)
    with pytest.raises(LiveAttendancePermissionError, match="company_id is required"):
        resolve_live_attendance_company_id(db, admin, None)


def test_administrator_with_company_id() -> None:
    db = MagicMock()
    cid = uuid.uuid4()
    admin = _user(SystemRole.ADMINISTRATOR, None)
    with patch("app.core.company_scope.get_company_by_id", return_value=MagicMock()):
        assert resolve_live_attendance_company_id(db, admin, cid) == cid


def test_admin_returns_none_for_implicit_company() -> None:
    db = MagicMock()
    own = uuid.uuid4()
    admin = _user(SystemRole.ADMIN, own)
    assert resolve_live_attendance_company_id(db, admin, None) is None
