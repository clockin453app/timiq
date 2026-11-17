"""Rollback scenario for the commercial Finance workflows on revision f5."""

from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest


def _enabled() -> bool:
    return os.environ.get("FINANCE_F5_DATABASE_TESTS", "").strip().lower() in {"1", "yes", "true"}


@pytest.mark.skipif(not _enabled(), reason="FINANCE_F5_DATABASE_TESTS is not set")
def test_database_construction_company_scenario() -> None:
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session

    from app.modules.finance.commercial_service import (
        approve_budget,
        approve_daywork,
        create_application,
        create_budget,
        create_certificate,
        create_commitment,
        create_cost_code,
        create_counterparty,
        create_funding,
        create_opening_balance,
        create_project,
        create_receipt,
        create_retention_release,
        draw_commitment,
        project_cvr,
        review_opening_balance,
        save_daywork,
        save_variation,
        supplier_position,
        transition_variation,
    )
    from app.modules.finance.cost_register_schemas import CostAllocationInput, CostDraftInput, CostLineInput
    from app.modules.finance.cost_register_service import create_cost_draft, post_cost_document
    from app.modules.finance.ledger_service import create_customer_invoice
    from app.modules.finance.supplier_payment_schemas import AllocationBatchInput, SupplierPaymentDraftInput
    from app.modules.finance.supplier_payment_service import (
        allocate_supplier_payment,
        create_supplier_payment_draft,
        post_supplier_payment,
        supplier_document_outstanding,
    )
    from app.testing.database_safety import validate_test_database_url

    import app.db.models  # noqa: F401

    if os.environ.get("TIMIQ_ENV", "").strip().lower() != "test":
        pytest.fail("FINANCE_F5_DATABASE_TESTS requires TIMIQ_ENV=test")
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
        if row[0] != "timiq_test_finance_d2" or not str(row[1] or "").startswith("127.0.0.1"):
            pytest.fail("Refusing database tests because the server identity does not match")
        if row[2] != 5433 or not str(row[3]).startswith("16") or row[5] != "a7c8d9e0f1a2":
            pytest.fail("Refusing database tests because the server or revision does not match")
        if os.path.normcase(os.path.normpath(row[4])) != os.path.normcase(os.path.normpath(r"D:\PostgreSQLData\16")):
            pytest.fail("Refusing database tests because the data directory does not match")
        with engine.connect() as connection:
            transaction = connection.begin()
            connection.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
            session = Session(bind=connection, autoflush=False, join_transaction_mode="create_savepoint")
            try:
                _scenario(
                    session,
                    text,
                    approve_budget,
                    approve_daywork,
                    create_application,
                    create_budget,
                    create_certificate,
                    create_commitment,
                    create_cost_code,
                    create_counterparty,
                    create_funding,
                    create_opening_balance,
                    create_project,
                    create_receipt,
                    create_retention_release,
                    draw_commitment,
                    project_cvr,
                    review_opening_balance,
                    save_daywork,
                    save_variation,
                    supplier_position,
                    transition_variation,
                    CostAllocationInput,
                    CostDraftInput,
                    CostLineInput,
                    create_cost_draft,
                    post_cost_document,
                    create_customer_invoice,
                    AllocationBatchInput,
                    SupplierPaymentDraftInput,
                    allocate_supplier_payment,
                    create_supplier_payment_draft,
                    post_supplier_payment,
                    supplier_document_outstanding,
                )
            finally:
                session.close()
                transaction.rollback()
    finally:
        engine.dispose()


def _scenario(session, text, approve_budget, approve_daywork, create_application, create_budget, create_certificate, create_commitment, create_cost_code, create_counterparty, create_funding, create_opening_balance, create_project, create_receipt, create_retention_release, draw_commitment, project_cvr, review_opening_balance, save_daywork, save_variation, supplier_position, transition_variation, allocation_input, draft_input, line_input, create_cost_draft, post_cost_document, create_customer_invoice, payment_batch, payment_input, allocate_supplier_payment, create_supplier_payment_draft, post_supplier_payment, supplier_document_outstanding) -> None:
    company_id = uuid.uuid4()
    actor_id = uuid.uuid4()
    session.execute(
        text("INSERT INTO companies (id, name, is_active, created_at, updated_at) VALUES (:id, :name, true, now(), now())"),
        {"id": company_id, "name": f"Harbour Build {company_id.hex[:8]}"},
    )
    payroll_before = session.execute(text("SELECT count(*) FROM payroll_items")).scalar_one()
    project_id = create_project(
        session, company_id=company_id, actor_user_id=actor_id, name="Harbour Wall", reference_code="HW", contract_value_net=Decimal("100000.0000")
    )
    code_id = create_cost_code(session, company_id=company_id, code="10", name="Groundworks")
    supplier_id = create_counterparty(session, company_id=company_id, counterparty_type="supplier", name="Fictional Aggregates")
    customer_id = create_counterparty(session, company_id=company_id, counterparty_type="customer", name="Fictional Client")
    version_id = create_budget(
        session,
        company_id=company_id,
        project_id=project_id,
        note="QS draft",
        lines=[{"cost_code_id": code_id, "amount_net": Decimal("80000.0000"), "description": "Groundworks", "item_reference": "1"}],
    )
    approve_budget(session, company_id=company_id, actor_user_id=actor_id, version_id=version_id)
    document = create_cost_draft(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        payload=draft_input(
            document_type="supplier_invoice",
            counterparty_id=supplier_id,
            external_reference="AGG-1",
            service_date=date(2026, 10, 10),
            document_date=date(2026, 10, 10),
            tax_point_date=date(2026, 10, 10),
            due_date=date(2026, 11, 10),
            lines=[
                line_input(
                    line_number=1,
                    description="Stone",
                    net_amount=Decimal("1000.0000"),
                    tax_treatment="standard",
                    tax_amount=Decimal("200.0000"),
                    recoverable_amount=Decimal("200.0000"),
                    allocations=[
                        allocation_input(
                            allocation_number=1,
                            project_id=project_id,
                            cost_code_id=code_id,
                            amount_net=Decimal("1000.0000"),
                            amount_non_recoverable=Decimal("0.0000"),
                        )
                    ],
                )
            ],
        ),
    )
    post_cost_document(session, company_id=company_id, actor_user_id=actor_id, document_id=document.id)
    payment = create_supplier_payment_draft(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        payload=payment_input(
            counterparty_id=supplier_id,
            payment_date=date(2026, 10, 11),
            payment_method="bank_transfer",
            external_reference="BANK-500",
            amount=Decimal("500.0000"),
        ),
    )
    post_supplier_payment(session, company_id=company_id, actor_user_id=actor_id, payment_id=payment.id)
    allocate_supplier_payment(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        payment_id=payment.id,
        payload=payment_batch(allocations=[{"cost_document_id": document.id, "amount": Decimal("500.0000")}]),
    )
    assert supplier_document_outstanding(session, company_id=company_id, document_id=document.id) == Decimal("700.0000")
    variation_id = save_variation(
        session, company_id=company_id, project_id=project_id, reference_code="V1", description="Extra wall",
        requested_value=Decimal("5000.0000"), submitted_value=Decimal("5000.0000"), counterparty_id=customer_id,
    )
    transition_variation(session, company_id=company_id, variation_id=variation_id, approval_status="submitted", approved_value=None)
    transition_variation(session, company_id=company_id, variation_id=variation_id, approval_status="approved", approved_value=Decimal("5000.0000"))
    daywork_id = save_daywork(
        session, company_id=company_id, project_id=project_id, reference_code="DW1", work_date=date(2026, 10, 8),
        description="Pumping", labour_amount=Decimal("400.0000"), material_amount=Decimal("500.0000"), plant_amount=Decimal("100.0000"),
    )
    approve_daywork(session, company_id=company_id, daywork_id=daywork_id, counts_in_contract_value=True)
    commitment_id = create_commitment(
        session, company_id=company_id, actor_user_id=actor_id, project_id=project_id, cost_code_id=code_id,
        counterparty_id=supplier_id, reference_code="PO-1", committed_amount=Decimal("4000.0000"),
    )
    draw_commitment(session, company_id=company_id, actor_user_id=actor_id, commitment_id=commitment_id, cost_document_id=document.id, amount=Decimal("1000.0000"))
    cvr = project_cvr(session, company_id=company_id, project_id=project_id)
    assert Decimal(cvr["approved_contract_value"]) == Decimal("106000.0000")
    assert Decimal(cvr["approved_budget"]) == Decimal("80000.0000")
    assert Decimal(cvr["actual_eligible_cost"]) == Decimal("1000.0000")
    assert Decimal(cvr["open_commitment"]) == Decimal("3000.0000")
    assert cvr["cost_to_complete"] == "missing"
    assert cvr["forecast_final_cost"] == "missing"
    assert cvr["forecast_margin"] == "missing"
    from app.modules.finance.commercial_service import record_cost_to_complete

    record_cost_to_complete(
        session, company_id=company_id, actor_user_id=actor_id, project_id=project_id,
        amount=Decimal("500.0000"), explanation="Remaining groundworks not yet ordered",
    )
    cvr = project_cvr(session, company_id=company_id, project_id=project_id)
    assert Decimal(cvr["cost_to_complete"]) == Decimal("500.0000")
    assert Decimal(cvr["forecast_final_cost"]) == Decimal("4500.0000")
    assert Decimal(cvr["forecast_margin"]) == Decimal("101500.0000")
    parts = session.execute(
        text("SELECT labour_amount, material_amount, plant_amount, submitted_value FROM finance_dayworks WHERE id = :id"),
        {"id": daywork_id},
    ).one()
    assert Decimal(str(parts.labour_amount)) + Decimal(str(parts.material_amount)) + Decimal(str(parts.plant_amount)) == Decimal(str(parts.submitted_value))
    application_id = create_application(
        session, company_id=company_id, actor_user_id=actor_id, project_id=project_id, counterparty_id=customer_id,
        period_start=date(2026, 10, 1), period_end=date(2026, 10, 31), applied_net=Decimal("12000.0000"), notes=None,
    )
    certificate_id = create_certificate(
        session, company_id=company_id, actor_user_id=actor_id, application_id=application_id, certificate_reference="C1",
        certified_net=Decimal("10000.0000"), retention_rate=Decimal("5.0000"), invoice_id=None,
    )
    withheld = session.execute(text("SELECT retention_withheld FROM finance_payment_certificates WHERE id = :id"), {"id": certificate_id}).scalar_one()
    assert Decimal(str(withheld)) == Decimal("500.0000")
    create_retention_release(session, company_id=company_id, actor_user_id=actor_id, certificate_id=certificate_id, amount=Decimal("200.0000"), release_date=date(2026, 10, 20), notes=None)
    released = session.execute(
        text("SELECT COALESCE(SUM(amount), 0) FROM finance_retention_releases WHERE certificate_id = :id AND status = 'posted'"),
        {"id": certificate_id},
    ).scalar_one()
    assert Decimal(str(withheld)) - Decimal(str(released)) == Decimal("300.0000")
    invoice_id = create_customer_invoice(
        session, company_id=company_id, actor_user_id=actor_id, counterparty_id=customer_id, project_id=project_id,
        document_kind="invoice", external_reference="INV-1", document_date=date(2026, 10, 12), due_date=date(2026, 11, 12),
        lines=[{"description": "Certified", "taxable": True, "net_amount": Decimal("100.0000"), "tax_amount": Decimal("20.0000")}],
    )
    receipt_id = create_receipt(
        session, company_id=company_id, actor_user_id=actor_id, counterparty_id=customer_id, receipt_date=date(2026, 10, 13),
        amount=Decimal("50.0000"), external_reference="RCPT-50", notes=None,
    )
    from app.modules.finance.commercial_service import allocate_receipt

    allocate_receipt(session, company_id=company_id, actor_user_id=actor_id, receipt_id=receipt_id, allocations=[{"invoice_id": invoice_id, "amount": Decimal("50.0000")}])
    outstanding = session.execute(text("SELECT finance_customer_invoice_outstanding(:id)"), {"id": invoice_id}).scalar_one()
    assert Decimal(str(outstanding)) == Decimal("70.0000")
    create_funding(session, company_id=company_id, actor_user_id=actor_id, entry_kind="loan_draw", entry_date=date(2026, 10, 1), amount=Decimal("2000.0000"), counterparty_id=None, source_user_id=None, external_reference="DL-1", notes="Director loan")
    create_funding(session, company_id=company_id, actor_user_id=actor_id, entry_kind="loan_repayment", entry_date=date(2026, 10, 15), amount=Decimal("500.0000"), counterparty_id=None, source_user_id=None, external_reference="DL-REP", notes="Principal repayment")
    principal = session.execute(
        text(
            "SELECT COALESCE(SUM(CASE WHEN entry_kind = 'loan_draw' THEN amount WHEN entry_kind = 'loan_repayment' THEN -amount ELSE 0 END), 0) "
            "FROM finance_funding_entries WHERE company_id = :company_id AND status = 'posted'"
        ),
        {"company_id": company_id},
    ).scalar_one()
    assert Decimal(str(principal)) == Decimal("1500.0000")
    opening_id = create_opening_balance(
        session, company_id=company_id, balance_kind="supplier_payable", effective_date=date(2026, 4, 1), amount=Decimal("250.0000"),
        source_reference="OPEN-SUP", explanation="Synthetic historical supplier balance", counterparty_id=supplier_id, project_id=project_id, source_user_id=None,
    )
    review_opening_balance(session, company_id=company_id, opening_id=opening_id)
    from app.modules.finance.commercial_service import settle_opening_balance

    settle_opening_balance(
        session, company_id=company_id, actor_user_id=actor_id, opening_id=opening_id,
        amount=Decimal("100.0000"), settlement_date=date(2026, 10, 16), external_reference="OPEN-PAY",
    )
    position = supplier_position(session, company_id=company_id)
    assert Decimal(position["invoice_outstanding"]) == Decimal("700.0000")
    assert Decimal(position["opening_supplier_payable"]) == Decimal("250.0000")
    assert Decimal(position["opening_settled"]) == Decimal("100.0000")
    assert Decimal(position["combined_supplier_position"]) == Decimal("850.0000")
    assert session.execute(text("SELECT count(*) FROM payroll_items")).scalar_one() == payroll_before
    cost_count = session.execute(text("SELECT count(*) FROM finance_cost_documents WHERE company_id = :company_id"), {"company_id": company_id}).scalar_one()
    assert int(cost_count) == 1
