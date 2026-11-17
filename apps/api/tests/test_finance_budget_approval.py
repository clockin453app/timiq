"""Budget approval must not retire the current budget when the new draft is rejected."""

import inspect
import uuid
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import DBAPIError

from app.modules.finance.commercial_router import _run, finance_register
from app.modules.finance.commercial_service import approve_budget
from app.modules.finance.ledger_service import FinanceLedgerError


def _result(value=None, rowcount=1):
    item = MagicMock()
    item.scalar_one_or_none.return_value = value
    item.rowcount = rowcount
    return item


def test_missing_budget_does_not_change_another_version() -> None:
    session = MagicMock()
    session.execute.return_value = _result(None)
    with pytest.raises(FinanceLedgerError) as denied:
        approve_budget(session, company_id=uuid.uuid4(), actor_user_id=uuid.uuid4(), version_id=uuid.uuid4())
    assert denied.value.code == "NOT_FOUND"
    assert session.execute.call_count == 1
    assert "UPDATE" not in str(session.execute.call_args.args[0])


def test_repeated_approval_does_not_supersede_the_current_budget() -> None:
    session = MagicMock()
    project_id = uuid.uuid4()
    session.execute.side_effect = [_result(project_id), _result(project_id), _result("approved")]
    with pytest.raises(FinanceLedgerError) as denied:
        approve_budget(session, company_id=uuid.uuid4(), actor_user_id=uuid.uuid4(), version_id=uuid.uuid4())
    assert denied.value.code == "INVALID_STATUS"
    sql = " ".join(str(call.args[0]) for call in session.execute.call_args_list)
    assert "superseded" not in sql
    session.begin_nested.assert_not_called()


def test_rejected_draft_approval_rolls_back_the_supersede() -> None:
    session = MagicMock()
    project_id = uuid.uuid4()
    current_id = uuid.uuid4()
    session.execute.side_effect = [
        _result(project_id),
        _result(project_id),
        _result("draft"),
        _result(current_id),
        _result(rowcount=1),
        _result(rowcount=0),
    ]
    with pytest.raises(FinanceLedgerError) as denied:
        approve_budget(session, company_id=uuid.uuid4(), actor_user_id=uuid.uuid4(), version_id=uuid.uuid4())
    assert denied.value.code == "INVALID_STATUS"
    session.begin_nested.return_value.rollback.assert_called_once()
    session.begin_nested.return_value.commit.assert_not_called()
    session.add.assert_not_called()


def test_successful_approval_keeps_the_audit_inside_the_open_transaction() -> None:
    session = MagicMock()
    project_id = uuid.uuid4()
    version_id = uuid.uuid4()
    session.execute.side_effect = [
        _result(project_id),
        _result(project_id),
        _result("draft"),
        _result(None),
        _result(rowcount=1),
        _result(rowcount=1),
    ]
    approve_budget(session, company_id=uuid.uuid4(), actor_user_id=uuid.uuid4(), version_id=version_id)
    session.begin_nested.return_value.commit.assert_called()
    session.commit.assert_not_called()
    session.add.assert_called_once()
    sql = " ".join(str(call.args[0]) for call in session.execute.call_args_list)
    assert "FOR UPDATE" in sql
    assert "status = 'draft'" in sql


def test_budget_line_trigger_rolls_back_without_approving() -> None:
    session = MagicMock()
    project_id = uuid.uuid4()

    def execute(statement, _params=None):
        sql = str(statement)
        if "SELECT project_id" in sql:
            return _result(project_id)
        if "FROM finance_projects" in sql:
            return _result(project_id)
        if "SELECT status" in sql:
            return _result("draft")
        if "status = 'approved'" in sql and "UPDATE" not in sql:
            return _result(None)
        raise DBAPIError("UPDATE", {}, Exception("approved budget requires a line"))

    session.execute.side_effect = execute
    with pytest.raises(FinanceLedgerError) as denied:
        approve_budget(session, company_id=uuid.uuid4(), actor_user_id=uuid.uuid4(), version_id=uuid.uuid4())
    assert denied.value.code == "DATABASE_REJECTED"
    assert "approved budget requires a line" in denied.value.message
    session.begin_nested.return_value.rollback.assert_called_once()
    session.begin_nested.return_value.commit.assert_not_called()
    session.add.assert_not_called()


def test_router_rolls_back_when_approval_is_rejected() -> None:
    session = MagicMock()

    def reject():
        raise FinanceLedgerError("INVALID_STATUS", "Only a draft budget version can be approved.")

    with pytest.raises(HTTPException) as denied:
        _run(session, reject)
    assert denied.value.status_code == 400
    session.rollback.assert_called_once()
    session.commit.assert_not_called()


def test_cash_register_queries_expose_effective_amounts_without_writing() -> None:
    from app.modules.finance.commercial_router import FINANCE_REGISTER_STATEMENTS

    source = "\n".join(FINANCE_REGISTER_STATEMENTS.values())
    route = inspect.getsource(finance_register)
    assert "AS cash_allocated" in source
    assert "AS credit_applied" in source
    assert "AS receipt_reversed" in source
    assert "AS payment_reversed" in source
    assert "UPDATE " not in source
    assert "UPDATE " not in route
    assert "finance_customer_receipt_reversals" in source
    assert "finance_supplier_payment_reversals" in source
