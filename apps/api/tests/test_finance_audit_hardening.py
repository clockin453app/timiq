"""Database-free checks for future audit rows and customer-invoice duplicates."""

from datetime import date
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.modules.finance.audit import record_finance_audit
from app.modules.finance.ledger_service import FinanceLedgerError, create_customer_invoice


def test_audit_row_stays_in_the_open_transaction() -> None:
    session = MagicMock()
    company_id = uuid4()
    actor_id = uuid4()
    entity_id = uuid4()
    record_finance_audit(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        entity_type="finance_customer_receipt",
        entity_id=entity_id,
        action="receipt_posted",
        reason="Customer receipt posted.",
        after={"amount": "10.0000"},
    )
    session.add.assert_called_once()
    session.commit.assert_not_called()
    session.flush.assert_not_called()
    event = session.add.call_args.args[0]
    assert event.company_id == company_id
    assert event.actor_user_id == actor_id
    assert event.entity_id == entity_id
    assert event.action == "receipt_posted"
    assert event.after_json == {"amount": "10.0000"}


def test_audit_action_must_fit_the_existing_column() -> None:
    with pytest.raises(ValueError):
        record_finance_audit(
            MagicMock(),
            company_id=uuid4(),
            actor_user_id=None,
            entity_type="finance_project",
            entity_id=uuid4(),
            action="x" * 33,
            reason="Too long.",
        )


def test_duplicate_posted_customer_invoice_is_rejected_before_insert() -> None:
    session = MagicMock()
    session.execute.return_value.first.return_value = (uuid4(),)
    with pytest.raises(FinanceLedgerError) as denied:
        create_customer_invoice(
            session,
            company_id=uuid4(),
            actor_user_id=uuid4(),
            counterparty_id=uuid4(),
            project_id=None,
            document_kind="invoice",
            external_reference=" inv-1 ",
            document_date=date(2026, 10, 12),
            due_date=date(2026, 11, 12),
            lines=[{"net_amount": "100.0000", "tax_amount": "20.0000", "description": "Work"}],
        )
    assert denied.value.code == "DUPLICATE_REFERENCE"
    session.execute.assert_called_once()
    statement = str(session.execute.call_args.args[0])
    assert "INSERT" not in statement.upper()
    assert "normalized_reference" in statement
    assert "status = 'posted'" in statement
    session.add.assert_not_called()
