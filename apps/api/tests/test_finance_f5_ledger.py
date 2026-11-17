"""PostgreSQL checks for the installed f5 Finance ledger.

Runs only when FINANCE_F5_DATABASE_TESTS is set. The transaction rolls back.
"""

from __future__ import annotations

import os
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy.exc import DBAPIError


def _enabled() -> bool:
    return os.environ.get("FINANCE_F5_DATABASE_TESTS", "").strip().lower() in {"1", "yes", "true"}


@pytest.mark.skipif(not _enabled(), reason="FINANCE_F5_DATABASE_TESTS is not set")
def test_database_f5_cis_paye_and_customer_invoice() -> None:
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session

    from app.modules.finance.ledger_service import (
        FinanceLedgerError,
        allocate_worker_payment,
        create_customer_invoice,
        create_worker_payment,
        import_cis_snapshot,
        import_paye_snapshot,
        paye_obligation,
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
        if row[2] != 5433 or not str(row[3]).startswith("16"):
            pytest.fail("Refusing database tests because the server version or port does not match")
        if os.path.normcase(os.path.normpath(row[4])) != os.path.normcase(os.path.normpath(r"D:\PostgreSQLData\16")):
            pytest.fail("Refusing database tests because the data directory does not match")
        if row[5] != "a7c8d9e0f1a2":
            pytest.fail("Refusing database tests because the Alembic revision is not a7c8d9e0f1a2")
        with engine.connect() as connection:
            transaction = connection.begin()
            connection.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
            session = Session(bind=connection, autoflush=False, join_transaction_mode="create_savepoint")
            try:
                _scenario(session, text, DBAPIError, FinanceLedgerError, allocate_worker_payment, create_customer_invoice, create_worker_payment, import_cis_snapshot, import_paye_snapshot, paye_obligation)
            finally:
                session.close()
                transaction.rollback()
    finally:
        engine.dispose()


def _scenario(session, text, dbapi_error, ledger_error, allocate_worker_payment, create_customer_invoice, create_worker_payment, import_cis_snapshot, import_paye_snapshot, paye_obligation) -> None:
    company_id = uuid.uuid4()
    other_company = uuid.uuid4()
    user_id = uuid.uuid4()
    other_user = uuid.uuid4()
    actor_id = uuid.uuid4()
    period_id = uuid.uuid4()
    item_id = uuid.uuid4()
    paye_period_id = uuid.uuid4()
    paye_item_id = uuid.uuid4()
    customer_id = uuid.uuid4()
    project_id = uuid.uuid4()
    session.execute(
        text("INSERT INTO companies (id, name, is_active, created_at, updated_at) VALUES (:id, :name, true, now(), now()), (:other, :other_name, true, now(), now())"),
        {"id": company_id, "name": f"Finance F5 {company_id.hex[:8]}", "other": other_company, "other_name": f"Finance F5 Other {other_company.hex[:8]}"},
    )
    session.execute(
        text(
            "INSERT INTO users (id, company_id, email, password_hash, system_role, is_active, created_at, updated_at) "
            "VALUES (:id, :company_id, :email, 'not-a-real-secret', 'employee', true, now(), now()), "
            "(:other_id, :other_company, :other_email, 'not-a-real-secret', 'employee', true, now(), now())"
        ),
        {
            "id": user_id,
            "company_id": company_id,
            "email": f"f5-{user_id.hex[:8]}@example.test",
            "other_id": other_user,
            "other_company": other_company,
            "other_email": f"f5-other-{other_user.hex[:8]}@example.test",
        },
    )
    session.execute(
        text(
            "INSERT INTO payroll_periods (id, company_id, week_start, timezone_name, created_at, updated_at) "
            "VALUES (:id, :company_id, :week_start, 'Europe/London', now(), now())"
        ),
        {"id": period_id, "company_id": company_id, "week_start": date(2026, 10, 5)},
    )
    now = datetime(2026, 10, 6, tzinfo=timezone.utc)
    session.execute(
        text(
            "INSERT INTO payroll_items ("
            "id, period_id, user_id, company_id, regular_seconds, overtime_seconds, rounded_total_seconds, "
            "gross_amount, tax_amount, net_amount, other_deductions_amount, display_tax_amount, display_net_amount, "
            "payment_mode, policy_snapshot, status, approved_at, rate_missing, created_at, updated_at"
            ") VALUES ("
            ":id, :period_id, :user_id, :company_id, 36000, 0, 36000, 1000, 200, 800, 0, 200, 800, "
            "'net_payment', '{}'::jsonb, 'approved', :approved_at, false, :now, :now)"
        ),
        {"id": item_id, "period_id": period_id, "user_id": user_id, "company_id": company_id, "approved_at": now, "now": now},
    )
    payroll_status = session.execute(text("SELECT status, paid_at FROM payroll_items WHERE id = :id"), {"id": item_id}).one()
    obligation = import_cis_snapshot(session, company_id=company_id, actor_user_id=actor_id, payroll_item_id=item_id)
    assert Decimal(str(obligation["effective_cis_deduction"])) == Decimal("200.0000")
    assert Decimal(str(obligation["effective_payable_amount"])) == Decimal("800.0000")
    assert Decimal(str(obligation["still_owed"])) == Decimal("800.0000")
    again = import_cis_snapshot(session, company_id=company_id, actor_user_id=actor_id, payroll_item_id=item_id)
    assert again["id"] == obligation["id"]
    with pytest.raises(ledger_error) as foreign:
        import_cis_snapshot(session, company_id=other_company, actor_user_id=actor_id, payroll_item_id=item_id)
    assert foreign.value.code == "SOURCE_NOT_FOUND"

    payment_id = create_worker_payment(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        source_user_id=user_id,
        amount=Decimal("500.0000"),
        payment_date=date(2026, 10, 10),
        payment_method="bank_transfer",
        external_reference="F5-BANK",
        notes=None,
    )
    allocate_worker_payment(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        payment_id=payment_id,
        allocations=[{"cis_snapshot_id": obligation["id"], "paye_snapshot_id": None, "amount": Decimal("500.0000")}],
    )
    after_pay = import_cis_snapshot(session, company_id=company_id, actor_user_id=actor_id, payroll_item_id=item_id)
    assert Decimal(str(after_pay["still_owed"])) == Decimal("300.0000")
    assert Decimal(str(after_pay["bank_allocated"])) == Decimal("500.0000")
    with pytest.raises(ledger_error) as over:
        allocate_worker_payment(
            session,
            company_id=company_id,
            actor_user_id=actor_id,
            payment_id=create_worker_payment(
                session, company_id=company_id, actor_user_id=actor_id, source_user_id=user_id,
                amount=Decimal("400.0000"), payment_date=date(2026, 10, 11), payment_method="bank_transfer",
                external_reference="F5-OVER", notes=None,
            ),
            allocations=[{"cis_snapshot_id": obligation["id"], "paye_snapshot_id": None, "amount": Decimal("301.0000")}],
        )
    assert over.value.code == "ALLOCATION_REJECTED"
    with pytest.raises(ledger_error):
        allocate_worker_payment(
            session,
            company_id=company_id,
            actor_user_id=actor_id,
            payment_id=create_worker_payment(
                session, company_id=other_company, actor_user_id=actor_id, source_user_id=other_user,
                amount=Decimal("10.0000"), payment_date=date(2026, 10, 11), payment_method=None,
                external_reference="F5-OTHER", notes=None,
            ),
            allocations=[{"cis_snapshot_id": obligation["id"], "paye_snapshot_id": None, "amount": Decimal("10.0000")}],
        )

    session.execute(
        text(
            "UPDATE payroll_items SET gross_amount = 1100, net_amount = 900, display_net_amount = 900, "
            "updated_at = :updated WHERE id = :id"
        ),
        {"id": item_id, "updated": datetime(2026, 10, 12, tzinfo=timezone.utc)},
    )
    session.expire_all()
    with pytest.raises(ledger_error) as changed:
        import_cis_snapshot(session, company_id=company_id, actor_user_id=actor_id, payroll_item_id=item_id)
    assert changed.value.code == "SOURCE_CHANGED"
    corrected = import_cis_snapshot(session, company_id=company_id, actor_user_id=actor_id, payroll_item_id=item_id, correct=True)
    assert corrected["id"] != obligation["id"]
    assert int(corrected["revision_number"]) == 2
    assert Decimal(str(corrected["effective_payable_amount"])) == Decimal("900.0000")
    assert Decimal(str(corrected["bank_allocated"])) == Decimal("500.0000")
    assert Decimal(str(corrected["still_owed"])) == Decimal("400.0000")
    session.execute(
        text(
            "UPDATE payroll_items SET gross_amount = 900, net_amount = 700, display_net_amount = 700, updated_at = :updated WHERE id = :id"
        ),
        {"id": item_id, "updated": datetime(2026, 10, 13, tzinfo=timezone.utc)},
    )
    session.expire_all()
    reduced = import_cis_snapshot(session, company_id=company_id, actor_user_id=actor_id, payroll_item_id=item_id, correct=True)
    assert Decimal(str(reduced["effective_payable_amount"])) == Decimal("700.0000")
    assert Decimal(str(reduced["bank_allocated"])) == Decimal("500.0000")
    assert Decimal(str(reduced["still_owed"])) == Decimal("200.0000")
    assert session.execute(text("SELECT status, paid_at FROM payroll_items WHERE id = :id"), {"id": item_id}).one() == payroll_status

    nested = session.begin_nested()
    try:
        session.execute(text("UPDATE finance_cis_payroll_snapshots SET gross_amount = 1 WHERE id = :id"), {"id": obligation["id"]})
        session.flush()
    except dbapi_error as exc:
        nested.rollback()
        assert "immutable" in str(exc).lower() or "immutable" in str(getattr(exc, "orig", "")).lower()
    else:
        nested.rollback()
        raise AssertionError("posted CIS snapshot accepted an amount edit")

    session.execute(
        text(
            "INSERT INTO monthly_paye_periods ("
            "id, company_id, tax_year, tax_month, period_start, period_end, pay_date, status, created_at, updated_at"
            ") VALUES (:id, :company_id, '2026-27', 7, '2026-10-01', '2026-10-31', '2026-10-31', 'approved', now(), now())"
        ),
        {"id": paye_period_id, "company_id": company_id},
    )
    session.execute(
        text(
            "INSERT INTO monthly_paye_items ("
            "id, period_id, company_id, user_id, payroll_type, pay_frequency, salary_type, tax_basis, "
            "student_loan_plan, postgraduate_loan, pension_enrolment_status, pension_scheme_basis, pension_relief_method, "
            "gross_pay, paye_tax, employee_ni, employer_ni, employee_pension, employer_pension, student_loan, "
            "postgraduate_loan_deduction, other_deductions, additions, net_pay, status, approved_at, "
            "component_snapshot, calculation_snapshot, created_at, updated_at"
            ") VALUES ("
            ":id, :period_id, :company_id, :user_id, 'paye', 'monthly', 'salary', 'cumulative', "
            "'none', false, 'not_eligible', 'qualifying_earnings', 'relief_at_source', "
            "2000, 200, 100, 150, 40, 60, 0, 0, 0, 0, 1660, 'approved', now(), '[]'::jsonb, '{}'::jsonb, now(), :now)"
        ),
        {"id": paye_item_id, "period_id": paye_period_id, "company_id": company_id, "user_id": user_id, "now": now},
    )
    paye_id = import_paye_snapshot(session, company_id=company_id, actor_user_id=actor_id, paye_item_id=paye_item_id)
    assert import_paye_snapshot(session, company_id=company_id, actor_user_id=actor_id, paye_item_id=paye_item_id) == paye_id
    view = paye_obligation(session, company_id=company_id, source_item_id=paye_item_id)
    assert Decimal(str(view["net_pay"])) == Decimal("1660.0000")
    assert Decimal(str(view["employer_cost"])) == Decimal("210.0000")
    assert Decimal(str(view["still_owed"])) == Decimal("1660.0000")
    session.execute(text("UPDATE monthly_paye_items SET net_pay = 1600, updated_at = :now WHERE id = :id"), {"id": paye_item_id, "now": datetime(2026, 10, 20, tzinfo=timezone.utc)})
    session.expire_all()
    with pytest.raises(ledger_error) as paye_changed:
        import_paye_snapshot(session, company_id=company_id, actor_user_id=actor_id, paye_item_id=paye_item_id)
    assert paye_changed.value.code == "SOURCE_CHANGED"
    corrected_paye = import_paye_snapshot(session, company_id=company_id, actor_user_id=actor_id, paye_item_id=paye_item_id, correct=True)
    assert corrected_paye != paye_id
    assert Decimal(str(paye_obligation(session, company_id=company_id, source_item_id=paye_item_id)["net_pay"])) == Decimal("1600.0000")

    gross_period = uuid.uuid4()
    gross_item = uuid.uuid4()
    session.execute(
        text(
            "INSERT INTO payroll_periods (id, company_id, week_start, timezone_name, created_at, updated_at) "
            "VALUES (:id, :company_id, :week_start, 'Europe/London', now(), now())"
        ),
        {"id": gross_period, "company_id": company_id, "week_start": date(2026, 10, 12)},
    )
    session.execute(
        text(
            "INSERT INTO payroll_items ("
            "id, period_id, user_id, company_id, regular_seconds, overtime_seconds, rounded_total_seconds, "
            "gross_amount, tax_amount, net_amount, other_deductions_amount, display_tax_amount, display_net_amount, "
            "payment_mode, policy_snapshot, status, approved_at, rate_missing, created_at, updated_at"
            ") VALUES ("
            ":id, :period_id, :user_id, :company_id, 36000, 0, 36000, 1000, 200, 800, 0, 200, 1000, "
            "'gross_payment', '{}'::jsonb, 'approved', :approved_at, false, :now, :now)"
        ),
        {"id": gross_item, "period_id": gross_period, "user_id": user_id, "company_id": company_id, "approved_at": now, "now": now},
    )
    gross_view = import_cis_snapshot(session, company_id=company_id, actor_user_id=actor_id, payroll_item_id=gross_item)
    assert Decimal(str(gross_view["effective_cis_deduction"])) == Decimal("0.0000")
    assert Decimal(str(gross_view["effective_payable_amount"])) == Decimal("1000.0000")

    session.execute(
        text(
            "INSERT INTO finance_projects (id, company_id, name, status, created_at, updated_at) "
            "VALUES (:id, :company_id, 'F5 Harbour', 'active', now(), now())"
        ),
        {"id": project_id, "company_id": company_id},
    )
    session.execute(
        text(
            "INSERT INTO finance_counterparties (id, company_id, counterparty_type, name, normalized_name, is_active, created_at, updated_at) "
            "VALUES (:id, :company_id, 'customer', 'Fictional Client Ltd', 'FICTIONAL CLIENT LTD', true, now(), now())"
        ),
        {"id": customer_id, "company_id": company_id},
    )
    invoice_id = create_customer_invoice(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        counterparty_id=customer_id,
        project_id=project_id,
        document_kind="invoice",
        external_reference="F5-INV-1",
        document_date=date(2026, 10, 10),
        due_date=date(2026, 11, 10),
        lines=[
            {"description": "Taxable", "taxable": True, "net_amount": Decimal("100.0000"), "tax_amount": Decimal("20.0000")},
            {"description": "Outside", "taxable": False, "net_amount": Decimal("50.0000"), "tax_amount": Decimal("0.0000")},
        ],
    )
    stored = session.execute(
        text("SELECT net_amount, tax_amount, gross_amount, status FROM finance_customer_invoices WHERE id = :id"),
        {"id": invoice_id},
    ).one()
    assert Decimal(str(stored.net_amount)) == Decimal("150.0000")
    assert Decimal(str(stored.tax_amount)) == Decimal("20.0000")
    assert Decimal(str(stored.gross_amount)) == Decimal("170.0000")
    assert stored.status == "posted"
    outstanding = session.execute(text("SELECT finance_customer_invoice_outstanding(:id)"), {"id": invoice_id}).scalar_one()
    assert Decimal(str(outstanding)) == Decimal("170.0000")
    assert session.execute(text("SELECT status FROM payroll_items WHERE id = :id"), {"id": item_id}).scalar_one() == "approved"
    assert session.execute(text("SELECT status FROM monthly_paye_items WHERE id = :id"), {"id": paye_item_id}).scalar_one() == "approved"
    from app.modules.finance.commercial_service import list_snapshot_history, vat_cis_report

    history = list_snapshot_history(session, company_id=company_id, kind="cis", source_id=item_id)
    assert [int(Decimal(str(row["revision_number"]))) for row in history] == [1, 2, 3]
    report = vat_cis_report(session, company_id=company_id)
    assert Decimal(report["output_vat"]) == Decimal("20.0000")
    assert Decimal(report["input_vat"]) == Decimal("0")
    assert Decimal(report["cis_deduction_control"]) == Decimal("200.0000")
    assert Decimal(report["employer_ni_and_pension"]) == Decimal("210.0000")
    assert Decimal(report["paye_deduction_control"]) == Decimal("300.0000")
