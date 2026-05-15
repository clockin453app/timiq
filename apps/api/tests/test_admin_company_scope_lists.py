"""Administrator list endpoints require explicit company_id."""

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.core.company_scope import COMPANY_ID_REQUIRED_MESSAGE
from app.modules.auth.models import SystemRole, User
from app.modules.site_access.service import SiteAccessError, list_site_access_visible_to_user
from app.modules.workplaces.service import WorkplaceError, list_workplaces_visible_to_user


def _admin() -> User:
    u = MagicMock(spec=User)
    u.system_role = SystemRole.ADMINISTRATOR
    u.company_id = None
    return u


def test_site_access_admin_requires_company_id() -> None:
    db = MagicMock()
    with pytest.raises(SiteAccessError, match=COMPANY_ID_REQUIRED_MESSAGE):
        list_site_access_visible_to_user(db, _admin(), company_id=None)


def test_workplaces_admin_requires_company_id() -> None:
    db = MagicMock()
    with pytest.raises(WorkplaceError, match=COMPANY_ID_REQUIRED_MESSAGE):
        list_workplaces_visible_to_user(db, _admin(), company_id=None)


def test_workplaces_admin_scoped_to_company() -> None:
    db = MagicMock()
    cid = uuid.uuid4()
    wp = MagicMock()
    with patch(
        "app.core.company_scope.resolve_operational_company_id",
        return_value=cid,
    ):
        with patch(
            "app.modules.workplaces.service.list_workplaces_by_company",
            return_value=[wp],
        ) as list_mock:
            rows = list_workplaces_visible_to_user(db, _admin(), company_id=cid)
    assert rows == [wp]
    list_mock.assert_called_once_with(db, cid)
