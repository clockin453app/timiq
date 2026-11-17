"""D4-C1 supplier payment service tests.

Database-free tests cover input and posting shape. PostgreSQL tests run only
when FINANCE_D4C_DATABASE_TESTS is set and the connection is the approved
local timiq_test_finance_d2 database. Those tests roll back their transaction.
"""

from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.modules.finance.supplier_payment_errors import SupplierPaymentError
from app.modules.finance.supplier_payment_rules import (
    PaymentDraft,
    posting_blockers,
    require_positive_money,
)
from app.modules.finance.supplier_payment_schemas import (
    AllocationBatchInput,
    SupplierPaymentDraftInput,
)

TODAY = date(2026, 10, 10)


def test_draft_input_rejects_float_zero_and_unknown_method() -> None:
    with pytest.raises(ValidationError):
        SupplierPaymentDraftInput(amount=10.5, payment_date=TODAY)
    with pytest.raises(ValidationError):
        SupplierPaymentDraftInput(amount=Decimal("0.0000"), payment_date=TODAY)
    with pytest.raises(ValidationError):
        SupplierPaymentDraftInput(amount=Decimal("10.00001"), payment_date=TODAY)
    with pytest.raises(ValidationError):
        SupplierPaymentDraftInput(
            amount=Decimal("10.0000"),
            payment_date=TODAY,
            payment_method="wire",
        )


def test_positive_money_and_posting_shape() -> None:
    assert require_positive_money(Decimal("10.2500")) == Decimal("10.2500")
    with pytest.raises(SupplierPaymentError) as exc:
        require_positive_money(Decimal("-1.0000"))
    assert exc.value.code == "INVALID_AMOUNT"
    blockers = posting_blockers(
        PaymentDraft(counterparty_id=None, payment_date=None, payment_method=None, amount=Decimal("10.0000"))
    )
    assert {item.code for item in blockers} == {"REQUIRED_FIELD"}
    assert posting_blockers(
        PaymentDraft(
            counterparty_id=uuid.uuid4(),
            payment_date=TODAY,
            payment_method="bank_transfer",
            amount=Decimal("10.0000"),
        )
    ) == []


def _database_tests_enabled() -> bool:
    return os.environ.get("FINANCE_D4C_DATABASE_TESTS", "").strip().lower() in {"1", "yes", "true"}


@pytest.mark.skipif(not _database_tests_enabled(), reason="FINANCE_D4C_DATABASE_TESTS is not set")
def test_database_supplier_payment_service() -> None:
    from sqlalchemy import create_engine, func, select, text
    from sqlalchemy.orm import Session

    from app.modules.finance.cost_register_schemas import CostAllocationInput, CostDraftInput, CostLineInput
    from app.modules.finance.cost_register_service import create_cost_draft, post_cost_document
    from app.modules.finance.models import FinanceCostDocument
    from app.modules.finance.supplier_payment_models import FinanceSupplierPaymentAllocation
    from app.modules.finance.supplier_payment_schemas import ReversalInput
    from app.modules.finance.supplier_payment_service import (
        allocate_supplier_payment,
        create_supplier_payment_draft,
        get_supplier_payment,
        post_supplier_payment,
        reverse_supplier_payment,
        reverse_supplier_payment_allocation,
        supplier_document_outstanding,
        update_supplier_payment_draft,
        validate_supplier_payment,
    )
    from app.testing.database_safety import validate_test_database_url

    import app.db.models  # noqa: F401

    if os.environ.get("TIMIQ_ENV", "").strip().lower() != "test":
        pytest.fail("FINANCE_D4C_DATABASE_TESTS requires TIMIQ_ENV=test")
    url = validate_test_database_url(os.environ["TEST_DATABASE_URL"], timiq_env="test")
    engine = create_engine(url)
    try:
        with engine.connect() as probe:
            row = probe.execute(
                text(
                    "SELECT current_database(), inet_server_addr(), inet_server_port(), "
                    "current_setting('server_version'), current_setting('data_directory'), "
                    "(SELECT version_num FROM alembic_version)"
                )
            ).one()
        address = str(row[1] or "")
        if row[0] != "timiq_test_finance_d2" or not address.startswith("127.0.0.1"):
            pytest.fail("Refusing database tests because the server identity does not match")
        if row[2] != 5433 or not str(row[3]).startswith("16"):
            pytest.fail("Refusing database tests because the server version or port does not match")
        if os.path.normcase(os.path.normpath(row[4])) != os.path.normcase(
            os.path.normpath(r"D:\PostgreSQLData\16")
        ):
            pytest.fail("Refusing database tests because the data directory does not match")
        if row[5] != "a7c8d9e0f1a2":
            pytest.fail("Refusing database tests because the Alembic revision is not a7c8d9e0f1a2")

        with engine.connect() as connection:
            transaction = connection.begin()
            connection.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
            session = Session(bind=connection, autoflush=False, join_transaction_mode="create_savepoint")
            try:
                _run_service_scenario(
                    session,
                    text,
                    func,
                    select,
                    CostAllocationInput,
                    CostDraftInput,
                    CostLineInput,
                    FinanceCostDocument,
                    FinanceSupplierPaymentAllocation,
                    ReversalInput,
                    create_cost_draft,
                    post_cost_document,
                    allocate_supplier_payment,
                    create_supplier_payment_draft,
                    get_supplier_payment,
                    post_supplier_payment,
                    reverse_supplier_payment,
                    reverse_supplier_payment_allocation,
                    supplier_document_outstanding,
                    update_supplier_payment_draft,
                    validate_supplier_payment,
                )
            finally:
                session.close()
                transaction.rollback()
    finally:
        engine.dispose()


def _run_service_scenario(
    session,
    text,
    func,
    select,
    allocation_input,
    draft_input,
    line_input,
    cost_document_model,
    allocation_model,
    reversal_input,
    create_cost_draft,
    post_cost_document,
    allocate_supplier_payment,
    create_supplier_payment_draft,
    get_supplier_payment,
    post_supplier_payment,
    reverse_supplier_payment,
    reverse_supplier_payment_allocation,
    supplier_document_outstanding,
    update_supplier_payment_draft,
    validate_supplier_payment,
) -> None:
    company_id = uuid.uuid4()
    other_company_id = uuid.uuid4()
    actor_id = uuid.uuid4()
    supplier_id = uuid.uuid4()
    other_supplier_id = uuid.uuid4()
    foreign_supplier_id = uuid.uuid4()
    customer_id = uuid.uuid4()
    project_id = uuid.uuid4()
    code_id = uuid.uuid4()
    _insert_company(session, text, company_id, "Finance D4C")
    _insert_company(session, text, other_company_id, "Finance D4C Other")
    _insert_supplier(session, text, supplier_id, company_id, "Fictional Aggregates Ltd")
    _insert_supplier(session, text, other_supplier_id, company_id, "Other Supplier")
    _insert_supplier(session, text, foreign_supplier_id, other_company_id, "Foreign Supplier")
    _insert_counterparty(session, text, customer_id, company_id, "customer", "Fictional Customer")
    _insert_project(session, text, project_id, company_id)
    _insert_code(session, text, code_id, company_id)
    payroll_before = session.execute(text("SELECT count(*) FROM payroll_items")).scalar_one()
    shifts_before = session.execute(text("SELECT count(*) FROM time_shifts")).scalar_one()

    with pytest.raises(SupplierPaymentError) as customer_error:
        create_supplier_payment_draft(
            session,
            company_id=company_id,
            actor_user_id=actor_id,
            payload=SupplierPaymentDraftInput(
                counterparty_id=customer_id,
                payment_date=TODAY,
                amount=Decimal("10.0000"),
            ),
        )
    assert customer_error.value.code == "REQUIRED_FIELD"

    incomplete = create_supplier_payment_draft(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        payload=SupplierPaymentDraftInput(counterparty_id=supplier_id, amount=Decimal("25.0000")),
    )
    assert incomplete.status == "draft"
    assert incomplete.available_amount == Decimal("0.0000")
    assert validate_supplier_payment(session, company_id=company_id, payment_id=incomplete.id).ready_to_post is False
    with pytest.raises(SupplierPaymentError) as incomplete_post:
        post_supplier_payment(session, company_id=company_id, actor_user_id=actor_id, payment_id=incomplete.id)
    assert incomplete_post.value.code == "REQUIRED_FIELD"
    assert get_supplier_payment(session, company_id=company_id, payment_id=incomplete.id).status == "draft"

    edited = update_supplier_payment_draft(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        payment_id=incomplete.id,
        payload=SupplierPaymentDraftInput(
            counterparty_id=supplier_id,
            payment_date=TODAY,
            payment_method="bank_transfer",
            external_reference="  pay-c1  ",
            amount=Decimal("500.0000"),
            notes=" Fictional transfer ",
        ),
    )
    assert edited.amount == Decimal("500.0000")
    assert edited.normalized_reference == "PAY-C1"
    assert edited.notes == "Fictional transfer"
    posted = post_supplier_payment(session, company_id=company_id, actor_user_id=actor_id, payment_id=incomplete.id)
    assert posted.status == "posted"
    assert posted.available_amount == Decimal("500.0000")
    assert posted.allocated_amount == Decimal("0.0000")
    assert validate_supplier_payment(session, company_id=company_id, payment_id=incomplete.id).ready_to_post is False
    with pytest.raises(SupplierPaymentError) as immutable:
        update_supplier_payment_draft(
            session,
            company_id=company_id,
            actor_user_id=actor_id,
            payment_id=incomplete.id,
            payload=SupplierPaymentDraftInput(
                counterparty_id=supplier_id,
                payment_date=TODAY,
                amount=Decimal("1.0000"),
            ),
        )
    assert immutable.value.code == "IMMUTABLE_PAYMENT"
    with pytest.raises(SupplierPaymentError) as hidden:
        get_supplier_payment(session, company_id=other_company_id, payment_id=incomplete.id)
    assert hidden.value.code == "PAYMENT_NOT_FOUND"

    invoice = _post_document(
        session,
        create_cost_draft,
        post_cost_document,
        draft_input,
        line_input,
        allocation_input,
        company_id,
        supplier_id,
        project_id,
        code_id,
        actor_id,
        "supplier_invoice",
        "D4C-1200",
        "1000.0000",
        "200.0000",
        "200.0000",
    )
    before_cost = _cost_snapshot(session, cost_document_model, invoice.id)
    settled = allocate_supplier_payment(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        payment_id=posted.id,
        payload=AllocationBatchInput(
            allocations=[{"cost_document_id": invoice.id, "amount": Decimal("500.0000")}]
        ),
    )
    assert settled.allocated_amount == Decimal("500.0000")
    assert settled.available_amount == Decimal("0.0000")
    assert settled.allocations[0].reversed is False
    assert supplier_document_outstanding(session, company_id=company_id, document_id=invoice.id) == Decimal("700.0000")
    assert _cost_snapshot(session, cost_document_model, invoice.id) == before_cost
    with pytest.raises(SupplierPaymentError) as foreign_outstanding:
        supplier_document_outstanding(session, company_id=other_company_id, document_id=invoice.id)
    assert foreign_outstanding.value.code == "DOCUMENT_NOT_FOUND"

    shared = _post_payment(session, create_supplier_payment_draft, post_supplier_payment, company_id, supplier_id, actor_id, "800.0000", "PAY-SHARED")
    first = _post_document(
        session, create_cost_draft, post_cost_document, draft_input, line_input, allocation_input,
        company_id, supplier_id, project_id, code_id, actor_id, "supplier_invoice", "D4C-600",
        "600.0000", "0.0000", "0.0000",
    )
    second = _post_document(
        session, create_cost_draft, post_cost_document, draft_input, line_input, allocation_input,
        company_id, supplier_id, project_id, code_id, actor_id, "supplier_invoice", "D4C-400",
        "400.0000", "0.0000", "0.0000",
    )
    multi = allocate_supplier_payment(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        payment_id=shared.id,
        payload=AllocationBatchInput(
            allocations=[
                {"cost_document_id": first.id, "amount": Decimal("600.0000")},
                {"cost_document_id": second.id, "amount": Decimal("100.0000")},
            ]
        ),
    )
    assert multi.allocated_amount == Decimal("700.0000")
    assert multi.available_amount == Decimal("100.0000")
    assert [row.allocation_number for row in multi.allocations] == [1, 2]
    assert supplier_document_outstanding(session, company_id=company_id, document_id=first.id) == Decimal("0.0000")
    assert supplier_document_outstanding(session, company_id=company_id, document_id=second.id) == Decimal("300.0000")

    before_rows = _allocation_count(session, func, select, allocation_model, shared.id)
    with pytest.raises(SupplierPaymentError) as over_payment:
        allocate_supplier_payment(
            session,
            company_id=company_id,
            actor_user_id=actor_id,
            payment_id=shared.id,
            payload=AllocationBatchInput(
                allocations=[{"cost_document_id": second.id, "amount": Decimal("101.0000")}]
            ),
        )
    assert over_payment.value.code == "ALLOCATION_REJECTED"
    assert "unallocated payment amount" in over_payment.value.message
    assert _allocation_count(session, func, select, allocation_model, shared.id) == before_rows

    room = _post_payment(session, create_supplier_payment_draft, post_supplier_payment, company_id, supplier_id, actor_id, "1000.0000", "PAY-ROOM")
    with pytest.raises(SupplierPaymentError) as over_invoice:
        allocate_supplier_payment(
            session,
            company_id=company_id,
            actor_user_id=actor_id,
            payment_id=room.id,
            payload=AllocationBatchInput(
                allocations=[{"cost_document_id": second.id, "amount": Decimal("301.0000")}]
            ),
        )
    assert "outstanding balance" in over_invoice.value.message
    assert _allocation_count(session, func, select, allocation_model, room.id) == 0

    with pytest.raises(SupplierPaymentError) as batch_error:
        allocate_supplier_payment(
            session,
            company_id=company_id,
            actor_user_id=actor_id,
            payment_id=room.id,
            payload=AllocationBatchInput(
                allocations=[
                    {"cost_document_id": invoice.id, "amount": Decimal("100.0000")},
                    {"cost_document_id": second.id, "amount": Decimal("301.0000")},
                ]
            ),
        )
    assert batch_error.value.code == "ALLOCATION_REJECTED"
    assert _allocation_count(session, func, select, allocation_model, room.id) == 0
    assert supplier_document_outstanding(session, company_id=company_id, document_id=invoice.id) == Decimal("700.0000")

    foreign_invoice = _post_document(
        session, create_cost_draft, post_cost_document, draft_input, line_input, allocation_input,
        other_company_id, foreign_supplier_id, _insert_project(session, text, uuid.uuid4(), other_company_id),
        _insert_code(session, text, uuid.uuid4(), other_company_id), actor_id, "supplier_invoice", "D4C-FOREIGN",
        "50.0000", "0.0000", "0.0000",
    )
    with pytest.raises(SupplierPaymentError) as company_error:
        allocate_supplier_payment(
            session,
            company_id=company_id,
            actor_user_id=actor_id,
            payment_id=room.id,
            payload=AllocationBatchInput(
                allocations=[{"cost_document_id": foreign_invoice.id, "amount": Decimal("10.0000")}]
            ),
        )
    assert company_error.value.code == "REFERENCE_NOT_IN_COMPANY"

    wrong_invoice = _post_document(
        session, create_cost_draft, post_cost_document, draft_input, line_input, allocation_input,
        company_id, other_supplier_id, project_id, code_id, actor_id, "supplier_invoice", "D4C-WRONG",
        "50.0000", "0.0000", "0.0000",
    )
    with pytest.raises(SupplierPaymentError) as supplier_error:
        allocate_supplier_payment(
            session,
            company_id=company_id,
            actor_user_id=actor_id,
            payment_id=room.id,
            payload=AllocationBatchInput(
                allocations=[{"cost_document_id": wrong_invoice.id, "amount": Decimal("10.0000")}]
            ),
        )
    assert supplier_error.value.code == "ALLOCATION_REJECTED"
    assert "same supplier" in supplier_error.value.message

    partial_allocation = next(row for row in multi.allocations if row.amount == Decimal("100.0000"))
    restored = reverse_supplier_payment_allocation(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        allocation_id=partial_allocation.id,
        payload=reversal_input(reason="Fictional correction"),
    )
    assert restored.available_amount == Decimal("200.0000")
    assert restored.allocated_amount == Decimal("600.0000")
    reversed_row = next(row for row in restored.allocations if row.id == partial_allocation.id)
    assert reversed_row.status == "posted"
    assert reversed_row.reversed is True
    assert supplier_document_outstanding(session, company_id=company_id, document_id=second.id) == Decimal("400.0000")

    with pytest.raises(SupplierPaymentError) as blocked_payment:
        reverse_supplier_payment(
            session,
            company_id=company_id,
            actor_user_id=actor_id,
            payment_id=shared.id,
            payload=reversal_input(reason="Too soon"),
        )
    assert blocked_payment.value.code == "REVERSAL_REJECTED"
    assert "allocations" in blocked_payment.value.message
    assert get_supplier_payment(session, company_id=company_id, payment_id=shared.id).reversal is None

    full_allocation = next(row for row in restored.allocations if row.amount == Decimal("600.0000"))
    cleared = reverse_supplier_payment_allocation(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        allocation_id=full_allocation.id,
        payload=reversal_input(reason="Clear settlement"),
    )
    assert cleared.allocated_amount == Decimal("0.0000")
    assert cleared.available_amount == Decimal("800.0000")
    reversed_payment = reverse_supplier_payment(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        payment_id=shared.id,
        payload=reversal_input(reason="Fictional reversal"),
    )
    assert reversed_payment.status == "posted"
    assert reversed_payment.amount == Decimal("800.0000")
    assert reversed_payment.available_amount == Decimal("0.0000")
    assert reversed_payment.reversal is not None
    assert reversed_payment.reversal.amount == Decimal("800.0000")
    assert supplier_document_outstanding(session, company_id=company_id, document_id=first.id) == Decimal("600.0000")
    with pytest.raises(SupplierPaymentError) as reversed_allocation:
        allocate_supplier_payment(
            session,
            company_id=company_id,
            actor_user_id=actor_id,
            payment_id=shared.id,
            payload=AllocationBatchInput(
                allocations=[{"cost_document_id": first.id, "amount": Decimal("10.0000")}]
            ),
        )
    assert reversed_allocation.value.code == "ALLOCATION_REJECTED"
    with pytest.raises(SupplierPaymentError) as duplicate_reversal:
        reverse_supplier_payment(
            session,
            company_id=company_id,
            actor_user_id=actor_id,
            payment_id=shared.id,
            payload=reversal_input(reason="Again"),
        )
    assert duplicate_reversal.value.code == "DUPLICATE_REVERSAL"

    receipt = _post_document(
        session, create_cost_draft, post_cost_document, draft_input, line_input, allocation_input,
        company_id, supplier_id, project_id, code_id, actor_id, "expense_receipt", None,
        "40.0000", "0.0000", "0.0000",
    )
    receipt_before = _cost_snapshot(session, cost_document_model, receipt.id)
    receipt_payment = _post_payment(
        session, create_supplier_payment_draft, post_supplier_payment, company_id, supplier_id, actor_id, "40.0000", "PAY-RECEIPT"
    )
    allocate_supplier_payment(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        payment_id=receipt_payment.id,
        payload=AllocationBatchInput(
            allocations=[{"cost_document_id": receipt.id, "amount": Decimal("40.0000")}]
        ),
    )
    assert supplier_document_outstanding(session, company_id=company_id, document_id=receipt.id) == Decimal("0.0000")
    assert _cost_snapshot(session, cost_document_model, receipt.id) == receipt_before

    assert session.execute(text("SELECT count(*) FROM payroll_items")).scalar_one() == payroll_before
    assert session.execute(text("SELECT count(*) FROM time_shifts")).scalar_one() == shifts_before


def _post_payment(session, create_draft, post_payment, company_id, supplier_id, actor_id, amount: str, reference: str):
    created = create_draft(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        payload=SupplierPaymentDraftInput(
            counterparty_id=supplier_id,
            payment_date=TODAY,
            payment_method="bank_transfer",
            external_reference=reference,
            amount=Decimal(amount),
        ),
    )
    return post_payment(session, company_id=company_id, actor_user_id=actor_id, payment_id=created.id)


def _post_document(
    session,
    create_cost_draft,
    post_cost_document,
    draft_input,
    line_input,
    allocation_input,
    company_id,
    supplier_id,
    project_id,
    code_id,
    actor_id,
    document_type: str,
    reference: str | None,
    net: str,
    tax: str,
    recoverable: str,
):
    non_recoverable = Decimal(tax) - Decimal(recoverable)
    created = create_cost_draft(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        payload=draft_input(
            document_type=document_type,
            counterparty_id=supplier_id,
            external_reference=reference,
            service_date=TODAY,
            document_date=TODAY,
            tax_point_date=TODAY,
            lines=[
                line_input(
                    line_number=1,
                    description="Fictional supply",
                    net_amount=Decimal(net),
                    tax_treatment="standard",
                    tax_amount=Decimal(tax),
                    recoverable_amount=Decimal(recoverable),
                    allocations=[
                        allocation_input(
                            allocation_number=1,
                            project_id=project_id,
                            cost_code_id=code_id,
                            amount_net=Decimal(net),
                            amount_non_recoverable=non_recoverable,
                        )
                    ],
                )
            ],
        ),
    )
    posted = post_cost_document(session, company_id=company_id, actor_user_id=actor_id, document_id=created.id)
    return posted.document


def _cost_snapshot(session, model, document_id) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    document = session.get(model, document_id)
    assert document is not None
    session.refresh(document)
    return (
        Decimal(document.net_amount),
        Decimal(document.tax_amount),
        Decimal(document.eligible_amount),
        Decimal(document.gross_amount),
    )


def _allocation_count(session, func, select, model, payment_id) -> int:
    return int(
        session.scalar(
            select(func.count()).select_from(model).where(model.payment_id == payment_id)
        )
        or 0
    )


def _insert_company(session, text, company_id, name: str) -> None:
    session.execute(
        text(
            "INSERT INTO companies (id, name, is_active, created_at, updated_at) "
            "VALUES (:id, :name, true, now(), now())"
        ),
        {"id": company_id, "name": f"{name} {company_id.hex[:8]}"},
    )


def _insert_supplier(session, text, supplier_id, company_id, name: str) -> None:
    _insert_counterparty(session, text, supplier_id, company_id, "supplier", name)


def _insert_counterparty(session, text, counterparty_id, company_id, counterparty_type: str, name: str) -> None:
    session.execute(
        text(
            "INSERT INTO finance_counterparties "
            "(id, company_id, counterparty_type, name, normalized_name, is_active, created_at, updated_at) "
            "VALUES (:id, :company_id, :counterparty_type, :name, :normalized_name, true, now(), now())"
        ),
        {
            "id": counterparty_id,
            "company_id": company_id,
            "counterparty_type": counterparty_type,
            "name": name,
            "normalized_name": name.upper(),
        },
    )


def _insert_project(session, text, project_id, company_id):
    session.execute(
        text(
            "INSERT INTO finance_projects (id, company_id, name, status, created_at, updated_at) "
            "VALUES (:id, :company_id, :name, 'active', now(), now())"
        ),
        {"id": project_id, "company_id": company_id, "name": f"D4C {project_id.hex[:8]}"},
    )
    return project_id


def _insert_code(session, text, code_id, company_id):
    session.execute(
        text(
            "INSERT INTO finance_cost_codes (id, company_id, code, name, is_active, created_at, updated_at) "
            "VALUES (:id, :company_id, :code, 'Materials', true, now(), now())"
        ),
        {"id": code_id, "company_id": company_id, "code": f"C{code_id.hex[:8]}"},
    )
    return code_id
