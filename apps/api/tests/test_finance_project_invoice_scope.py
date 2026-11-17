import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.modules.finance.cost_register_errors import REFERENCE_NOT_IN_COMPANY, CostRegisterError
from app.modules.finance.cost_register_rules import (
    AllocationDraft,
    DocumentDraft,
    LineDraft,
    cost_audit_snapshot,
    posting_blockers,
)
from app.modules.finance.cost_register_service import _require_company_row
from app.modules.finance.models import FinanceProject
from app.modules.finance.project_report_links import (
    document_projects,
    project_cost_rows,
    project_supplier_cash,
    sum_amount,
)
from app.modules.finance.register_service import REPORT_SHEETS
from app.modules.finance.supplier_payment_rules import (
    AllocationRequest,
    allocation_conflict,
    payment_audit_snapshot,
)

TODAY = date(2026, 10, 11)


def _allocation(project_id, net, code=None, number=1, overhead=False):
    return AllocationDraft(number, project_id, code or uuid.uuid4(), overhead, Decimal(net), Decimal("0"))


def _invoice(lines, document_type="supplier_invoice"):
    return DocumentDraft(
        document_type,
        uuid.uuid4(),
        "NS-101",
        TODAY,
        TODAY,
        TODAY,
        None,
        None,
        lines,
    )


def _line(net, allocations):
    return LineDraft(1, "Materials", Decimal(net), "zero", Decimal("0"), Decimal("0"), allocations)


def test_five_separate_invoices_keep_one_project_each() -> None:
    projects = [uuid.uuid4() for _ in range(5)]
    amounts = ["300", "250", "200", "250", "200"]
    documents = [
        _invoice((_line(amount, (_allocation(project, amount),)),))
        for project, amount in zip(projects, amounts, strict=True)
    ]
    assert all(posting_blockers(document) == [] for document in documents)
    assert sum(Decimal(amount) for amount in amounts) == Decimal("1200")
    for document, project in zip(documents, projects, strict=True):
        found = {item.project_id for line in document.lines for item in line.allocations}
        assert found == {project}


def test_two_cost_codes_on_one_project_are_accepted() -> None:
    project = uuid.uuid4()
    document = _invoice((
        _line("300", (_allocation(project, "180", number=1), _allocation(project, "120", number=2))),
    ))
    assert posting_blockers(document) == []


def test_missing_project_is_blocked_and_two_projects_are_allowed() -> None:
    missing = _invoice((_line("300", (_allocation(None, "300"),)),))
    project_a = uuid.uuid4()
    project_b = uuid.uuid4()
    split = _invoice((
        _line("300", (_allocation(project_a, "180", number=1), _allocation(project_b, "120", number=2))),
    ))
    assert any("name a Finance project" in item.message for item in posting_blockers(missing))
    assert posting_blockers(split) == []
    found = {item.project_id for line in split.lines for item in line.allocations}
    assert found == {project_a, project_b}


def test_allocation_totals_must_equal_line_net_for_split_invoice() -> None:
    project_a = uuid.uuid4()
    project_b = uuid.uuid4()
    under = _invoice((
        _line(
            "1200",
            (_allocation(project_a, "500", number=1), _allocation(project_b, "600", number=2)),
        ),
    ))
    blockers = posting_blockers(under)
    assert any("Allocation totals must equal" in item.message for item in blockers)


def test_company_overhead_invoice_does_not_need_a_project() -> None:
    document = _invoice((_line("80", (_allocation(None, "80", overhead=True),)),))
    assert posting_blockers(document) == []


def test_credit_follows_the_source_project_and_can_cover_a_historical_split() -> None:
    project = uuid.uuid4()
    other = uuid.uuid4()
    credit = DocumentDraft(
        "supplier_credit",
        uuid.uuid4(),
        "NS-101-CN",
        TODAY,
        TODAY,
        TODAY,
        uuid.uuid4(),
        None,
        (_line("-100", (_allocation(other, "-100"),)),),
    )
    wrong = posting_blockers(credit, source_projects=frozenset({project}))
    assert any("source invoice" in item.message for item in wrong)
    matching = DocumentDraft(
        "supplier_credit",
        uuid.uuid4(),
        "NS-101-CN",
        TODAY,
        TODAY,
        TODAY,
        uuid.uuid4(),
        None,
        (_line("-100", (_allocation(project, "-100"),)),),
    )
    assert posting_blockers(matching, source_projects=frozenset({project})) == []
    harbour = uuid.uuid4()
    mill = uuid.uuid4()
    historical = DocumentDraft(
        "supplier_credit",
        uuid.uuid4(),
        "SPLIT-CN",
        TODAY,
        TODAY,
        TODAY,
        uuid.uuid4(),
        None,
        (_line("-1000", (_allocation(harbour, "-600", number=1), _allocation(mill, "-400", number=2))),),
    )
    assert posting_blockers(historical, source_projects=frozenset({harbour, mill})) == []


def test_other_company_project_is_rejected_without_a_database() -> None:
    class Missing:
        def scalar(self, _statement):
            return None

    with pytest.raises(CostRegisterError) as exc:
        _require_company_row(Missing(), FinanceProject, uuid.uuid4(), uuid.uuid4(), "Project")
    assert exc.value.code == REFERENCE_NOT_IN_COMPANY


def test_partial_payments_and_one_transfer_across_two_invoices() -> None:
    supplier = uuid.uuid4()
    invoice = uuid.uuid4()
    other = uuid.uuid4()
    first = allocation_conflict(
        payment_supplier_id=supplier,
        available=Decimal("100"),
        requests=[AllocationRequest(invoice, supplier, "supplier_invoice", "posted", Decimal("300"), Decimal("100"))],
    )
    second = allocation_conflict(
        payment_supplier_id=supplier,
        available=Decimal("200"),
        requests=[AllocationRequest(invoice, supplier, "supplier_invoice", "posted", Decimal("200"), Decimal("200"))],
    )
    assert first is None and second is None
    overpay = allocation_conflict(
        payment_supplier_id=supplier,
        available=Decimal("50"),
        requests=[AllocationRequest(invoice, supplier, "supplier_invoice", "posted", Decimal("20"), Decimal("50"))],
    )
    mismatch = allocation_conflict(
        payment_supplier_id=supplier,
        available=Decimal("10"),
        requests=[AllocationRequest(invoice, uuid.uuid4(), "supplier_invoice", "posted", Decimal("10"), Decimal("10"))],
    )
    duplicate = allocation_conflict(
        payment_supplier_id=supplier,
        available=Decimal("20"),
        requests=[
            AllocationRequest(invoice, supplier, "supplier_invoice", "posted", Decimal("20"), Decimal("10")),
            AllocationRequest(invoice, supplier, "supplier_invoice", "posted", Decimal("20"), Decimal("10")),
        ],
    )
    consolidated = allocation_conflict(
        payment_supplier_id=supplier,
        available=Decimal("1200"),
        requests=[
            AllocationRequest(invoice, supplier, "supplier_invoice", "posted", Decimal("300"), Decimal("300")),
            AllocationRequest(other, supplier, "supplier_invoice", "posted", Decimal("900"), Decimal("900")),
        ],
    )
    assert overpay == "Payment allocation exceeds the supplier outstanding balance."
    assert "same supplier" in mismatch
    assert "only once" in duplicate
    assert consolidated is None


def test_historical_split_cost_is_not_copied_and_cash_is_not_multiplied() -> None:
    costs = [
        {"allocation_id": "h", "document_id": "split", "project_id": "harbour", "amount_eligible": "600"},
        {"allocation_id": "m", "document_id": "split", "project_id": "mill", "amount_eligible": "400"},
    ]
    projects = document_projects(costs)
    payment = [{"payment_allocation_id": "once", "document_id": "split", "allocation_amount": "1000", "payment_date": "2026-10-01", "payment_id": "pay"}] * 5
    cash, unassigned = project_supplier_cash(payment, projects, "harbour")
    assert sum_amount(project_cost_rows(costs, "harbour"), "amount_eligible") == Decimal("600")
    assert sum_amount(project_cost_rows(costs, "mill"), "amount_eligible") == Decimal("400")
    assert cash == []
    assert sum_amount(unassigned, "allocation_amount") == Decimal("1000")
    assert len(REPORT_SHEETS) == 17


def test_audit_snapshots_record_the_document_and_one_payment() -> None:
    project = str(uuid.uuid4())
    cost = cost_audit_snapshot(
        document_type="supplier_invoice",
        status="posted",
        external_reference="NS-101",
        currency_code="GBP",
        net_amount=Decimal("300"),
        tax_amount=Decimal("0"),
        recoverable_amount=Decimal("0"),
        non_recoverable_amount=Decimal("0"),
        eligible_amount=Decimal("300"),
        gross_amount=Decimal("300"),
        project_ids=[project],
    )
    payment = payment_audit_snapshot(
        amount=Decimal("100"),
        currency_code="GBP",
        payment_date=TODAY,
        external_reference="BACS-100",
        cost_document_id=uuid.uuid4(),
        project_id=project,
    )
    assert cost["project_ids"] == [project]
    assert cost["gross_amount"] == "300"
    assert payment["amount"] == "100"
    assert payment["external_reference"] == "BACS-100"
    assert "counts_as_payment" not in payment
