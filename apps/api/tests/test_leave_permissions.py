"""Leave permission guards (mocked database)."""

import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.modules.auth.models import SystemRole, User
from app.modules.leave.service import LeavePermissionError, approve_leave_request, get_leave_request


def _user(role: SystemRole, company_id: uuid.UUID | None, user_id: uuid.UUID) -> User:
    u = MagicMock(spec=User)
    u.system_role = role
    u.company_id = company_id
    u.id = user_id
    return u


def test_employee_cannot_approve_leave() -> None:
    db = MagicMock()
    emp = _user(SystemRole.EMPLOYEE, uuid.uuid4(), uuid.uuid4())
    with pytest.raises(LeavePermissionError, match="Admin"):
        approve_leave_request(db, emp, uuid.uuid4())


def test_employee_cannot_view_other_users_leave() -> None:
    db = MagicMock()
    cid = uuid.uuid4()
    me_id = uuid.uuid4()
    other_id = uuid.uuid4()
    emp = _user(SystemRole.EMPLOYEE, cid, me_id)
    row = MagicMock()
    row.user_id = other_id
    row.company_id = cid
    rid = uuid.uuid4()
    with patch("app.modules.leave.service.leave_repo.get_request", return_value=row):
        with pytest.raises(LeavePermissionError, match="cannot view"):
            get_leave_request(db, emp, rid)
