from datetime import datetime, timezone

from app.modules.finance.audit_presentation import (
    LOOKUP_SQL,
    describe_audit,
    format_uk_timestamp,
    present_audit_row,
)
from app.modules.finance.register_query import audit_category, filter_rows, page_rows


def test_supplier_allocation_is_labelled_and_not_other() -> None:
    category, operation = describe_audit("supplier_payment_allocation", "payment_allocated")
    assert category == "Supplier payments"
    assert operation == "Supplier payment allocated"
    assert audit_category("supplier_payment", "payment_posted") == "Supplier payments"
    assert describe_audit("supplier_payment", "payment_draft_saved")[1] == "Payment draft saved"
    assert describe_audit("finance_cost_document", "cost_document_posted", {"document_type": "supplier_invoice"})[1] == "Supplier invoice posted"
    assert describe_audit("finance_cost_document", "cost_document_posted", {"document_type": "expense_receipt"})[1] == "Project expense posted"
    assert describe_audit("finance_cost_document", "cost_document_draft_saved")[1] == "Cost document draft saved"
    assert describe_audit("unknown_entity", "unknown_action") == ("Other evidenced financial actions", "Other recorded action")


def test_missing_history_is_not_replaced_by_the_current_record() -> None:
    shown = present_audit_row(
        {
            "entity_type": "supplier_payment_allocation",
            "action": "payment_allocated",
            "created_at": "2026-10-12T19:14:25+00:00",
            "actor_label": "finance.local@example.test",
            "reason": "Payment allocated.",
            "before_json": None,
            "after_json": None,
        },
        {"party": "Northstone", "amount": "700.0000", "reference": "NS-100", "currency": "GBP", "status": "posted", "related": "123"},
    )
    assert shown["recorded_uk"] == "12 Oct 2026, 20:14:25 (UK)"
    assert shown["historical_amount"] == "Not recorded"
    assert shown["amount_display"] == "£700.00 (current record)"
    assert shown["party_display"] == "Northstone (current record)"
    assert "were not recorded" in str(shown["evidence_note"])
    assert shown["counts_as_payment"] is False
    assert shown["raw_action"] == "payment_allocated"


def test_current_amount_does_not_replace_the_event_amount() -> None:
    shown = present_audit_row(
        {
            "entity_type": "finance_cost_document",
            "action": "cost_document_posted",
            "created_at": datetime(2026, 10, 25, 0, 30, tzinfo=timezone.utc),
            "actor_label": "",
            "after_json": {"document_type": "supplier_invoice", "gross_amount": "100.0000", "password": "secret"},
        },
        {"amount": "250.0000", "party": "Changed supplier", "status": "reversed"},
    )
    assert shown["recorded_uk"] == "25 Oct 2026, 01:30:00 (UK)"
    assert shown["historical_amount"] == "£100.00"
    assert shown["amount_display"] == "£100.00"
    assert shown["after_json"]["password"] == "Not available"
    assert shown["actor_label"] == "Not recorded"
    assert format_uk_timestamp(datetime(2026, 11, 1, 0, 30, tzinfo=timezone.utc)) == "1 Nov 2026, 00:30:00 (UK)"


def test_lookups_stay_in_company_and_do_not_read_payroll_secrets() -> None:
    assert set(LOOKUP_SQL) >= {"supplier_payment_allocation", "finance_worker_payment"}
    for statement in LOOKUP_SQL.values():
        assert "company_id = :company_id" in statement
        assert "password" not in statement.lower()
    worker = LOOKUP_SQL["finance_worker_payment"].lower()
    assert "worker.company_id = payment.company_id" in worker
    for forbidden in ("payable", "ni_", "tax_", "snapshot", "bank_account"):
        assert forbidden not in worker
    absent = present_audit_row(
        {"entity_type": "supplier_payment_allocation", "action": "payment_allocated", "actor_label": "owner@example.test"},
        None,
    )
    assert absent["party_display"] == "Not recorded"
    assert absent["amount_display"] == "Not recorded"


def test_audit_search_pagination_and_events_are_not_payments() -> None:
    rows = [
        {"id": "1", "action": "payment_draft_saved", "operation": "Payment draft saved", "created_at": "2026-10-12T10:00:00+00:00", "counts_as_payment": False},
        {"id": "2", "action": "payment_posted", "operation": "Supplier bank payment posted", "created_at": "2026-10-12T11:00:00+00:00", "counts_as_payment": False},
        {"id": "3", "action": "payment_allocated", "operation": "Supplier payment allocated", "created_at": "2026-10-12T12:00:00+00:00", "counts_as_payment": False},
    ]
    found, _ = filter_rows("audit", rows, query="allocated", date_field="recorded", date_from="2026-10-12", date_to="2026-10-12")
    assert [row["id"] for row in found] == ["3"]
    paged = page_rows(rows, limit=2, offset=0)
    assert paged["total"] == 3
    assert sum(1 for row in rows if row["counts_as_payment"]) == 0
