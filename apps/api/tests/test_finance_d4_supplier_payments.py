"""D4 supplier payment schema tests.

Static tests do not connect. PostgreSQL tests run only when
FINANCE_D4_DATABASE_TESTS is set and the connection is the approved local
timiq_test_finance_d2 database. Those tests roll back their transaction.
"""

from __future__ import annotations

import importlib.util
import os
import uuid

import pytest
from datetime import date
from decimal import Decimal
from pathlib import Path

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Numeric, UniqueConstraint

from app.modules.finance.models import FinanceCostDocument
from app.modules.finance.supplier_payment_models import (
    FinanceSupplierPayment,
    FinanceSupplierPaymentAllocation,
    FinanceSupplierPaymentAllocationReversal,
    FinanceSupplierPaymentReversal,
)

MIGRATION_NAME = "f4b5c6d7e8f9_finance_d4_supplier_payments.py"
D2_MIGRATION_NAME = "f2a3b4c5d6e7_finance_d2_cost_register.py"
PAYMENT_TABLES = (
    FinanceSupplierPayment,
    FinanceSupplierPaymentAllocation,
    FinanceSupplierPaymentReversal,
    FinanceSupplierPaymentAllocationReversal,
)
FORBIDDEN_COLUMNS = (
    "project_id",
    "cost_code_id",
    "eligible_amount",
    "net_amount",
    "tax_amount",
    "recoverable_amount",
    "non_recoverable_amount",
    "gross_amount",
    "opening_balance_id",
)
PROTECTED_SQL = (
    "ALTER TABLE companies",
    "ALTER TABLE payroll_items",
    "ALTER TABLE monthly_paye_items",
    "ALTER TABLE budget_projects",
    "ALTER TABLE time_shifts",
    "DROP TABLE companies",
    "DROP TABLE payroll_items",
    "DROP TABLE finance_cost_documents",
)


def _migration_path(name: str) -> Path:
    return Path(__file__).resolve().parents[1] / "migrations" / "versions" / name


def _load_migration():
    path = _migration_path(MIGRATION_NAME)
    spec = importlib.util.spec_from_file_location("finance_d4_supplier_payments", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _constraint_names(table) -> set[str]:
    return {constraint.name for constraint in table.constraints if constraint.name}


def test_payment_models_share_finance_metadata() -> None:
    import app.db.models
    from app.db.base import Base

    assert FinanceSupplierPayment.__table__.metadata is FinanceCostDocument.__table__.metadata
    assert FinanceSupplierPayment.__table__.metadata is Base.metadata
    for model in PAYMENT_TABLES:
        assert model.__tablename__ in Base.metadata.tables
        assert model.__table__ is Base.metadata.tables[model.__tablename__]
    assert "companies" in Base.metadata.tables
    assert "finance_cost_documents" in Base.metadata.tables
    assert app.db.models.FinanceSupplierPayment is FinanceSupplierPayment


def test_d4_identifiers_fit_postgresql_limit() -> None:
    import re

    source = _migration_path(MIGRATION_NAME).read_text(encoding="utf-8")
    assert 'down_revision: Union[str, Sequence[str], None] = "f2a3b4c5d6e7"' in source
    assert "ck_fin_sup_pay_alloc_rev_posted_req" in source
    assert "ck_finance_supplier_payment_allocation_reversals_posted_required" not in source
    assert 'status <> \'posted\' OR posted_at IS NOT NULL' in source
    names = set(re.findall(r'name="([^"]+)"', source))
    names.update(re.findall(r'op\.create_index\(\s*"([^"]+)"', source))
    names.update(re.findall(r"CREATE (?:CONSTRAINT )?TRIGGER (\S+)", source))
    names.update(re.findall(r"CREATE FUNCTION (\w+)", source))
    too_long = sorted(name for name in names if len(name.encode("utf-8")) > 63)
    assert too_long == []


def test_migration_descends_from_d2_and_is_additive() -> None:
    migration = _load_migration()
    source = _migration_path(MIGRATION_NAME).read_text(encoding="utf-8")
    d2_source = _migration_path(D2_MIGRATION_NAME).read_text(encoding="utf-8")
    assert migration.revision == "f4b5c6d7e8f9"
    assert migration.down_revision == "f2a3b4c5d6e7"
    assert "finance_supplier_payments" not in d2_source
    for name in (
        "finance_supplier_payments",
        "finance_supplier_payment_allocations",
        "finance_supplier_payment_reversals",
        "finance_supplier_payment_allocation_reversals",
    ):
        assert name in source
    assert "opening_balance_id" not in source
    assert "finance_supplier_opening_balances" in source
    for forbidden in PROTECTED_SQL:
        assert forbidden not in source
    upgrade_source = source.split("def upgrade", 1)[1].split("def downgrade", 1)[0]
    assert "op.drop_table" not in upgrade_source
    assert "op.alter_column" not in upgrade_source
    assert "DROP FUNCTION IF EXISTS finance_cost_document" not in source
    assert "CREATE OR REPLACE FUNCTION finance_cost_document" not in source


def test_money_is_gbp_numeric_and_positive() -> None:
    source = _migration_path(MIGRATION_NAME).read_text(encoding="utf-8")
    for model in PAYMENT_TABLES:
        amount = model.__table__.c.amount
        assert isinstance(amount.type, Numeric)
        assert amount.type.precision == 18
        assert amount.type.scale == 4
        assert amount.nullable is False
    assert "ck_finance_supplier_payments_gbp" in _constraint_names(FinanceSupplierPayment.__table__)
    assert "ck_finance_supplier_payments_positive" in source
    assert "ck_finance_supplier_payment_allocations_positive" in source
    assert FinanceSupplierPayment.__table__.c.currency_code.nullable is False
    assert "currency_code" not in FinanceSupplierPaymentAllocation.__table__.c


def test_company_foreign_keys_are_restrict_and_composite() -> None:
    source = _migration_path(MIGRATION_NAME).read_text(encoding="utf-8")
    expected = {
        "fk_finance_supplier_payments_counterparty": ("company_id", "counterparty_id"),
        "fk_finance_supplier_payment_allocations_payment": ("company_id", "payment_id"),
        "fk_finance_supplier_payment_allocations_document": ("company_id", "cost_document_id"),
        "fk_finance_supplier_payment_reversals_payment": ("company_id", "payment_id"),
        "fk_finance_supplier_payment_allocation_reversals_allocation": ("company_id", "allocation_id"),
    }
    found: dict[str, tuple[str, ...]] = {}
    for model in PAYMENT_TABLES:
        for constraint in model.__table__.constraints:
            if isinstance(constraint, ForeignKeyConstraint) and constraint.name in expected:
                found[constraint.name] = tuple(element.name for element in constraint.columns)
                assert all(foreign_key.ondelete == "RESTRICT" for foreign_key in constraint.elements)
        company = model.__table__.c.company_id
        assert any(foreign_key.ondelete == "RESTRICT" for foreign_key in company.foreign_keys)
    assert found == expected
    for name in expected:
        assert name in source


def test_allocations_do_not_carry_cost_or_opening_balance_columns() -> None:
    for model in PAYMENT_TABLES:
        for column_name in FORBIDDEN_COLUMNS:
            assert column_name not in model.__table__.c
    allocation = FinanceSupplierPaymentAllocation.__table__.c.cost_document_id
    assert allocation.nullable is False
    assert "supplier payments allocate only to posted supplier invoices and expense receipts" in (
        _migration_path(MIGRATION_NAME).read_text(encoding="utf-8")
    )


def test_reversals_are_exact_and_unique() -> None:
    source = _migration_path(MIGRATION_NAME).read_text(encoding="utf-8")
    reversal_names = _constraint_names(FinanceSupplierPaymentReversal.__table__)
    allocation_reversal_names = _constraint_names(FinanceSupplierPaymentAllocationReversal.__table__)
    assert "uq_finance_supplier_payment_reversals_payment" in reversal_names
    assert "uq_finance_supplier_payment_allocation_reversals_allocation" in allocation_reversal_names
    assert "supplier payment reversal must match the payment amount" in source
    assert "supplier payment allocation reversal must match the allocation amount" in source
    assert "reverse supplier payment allocations before reversing the payment" in source
    assert "posted supplier payment reversal is immutable" in source
    assert "posted supplier payment allocation reversal is immutable" in source
    assert "uq_finance_supplier_payments_posted_reference" in source


def test_reversed_payment_available_balance_is_zero() -> None:
    source = _migration_path(MIGRATION_NAME).read_text(encoding="utf-8")
    function = source.split("CREATE FUNCTION finance_supplier_payment_available", 1)[1]
    function = function.split("CREATE FUNCTION finance_supplier_payment_before_write", 1)[0]
    assert "RETURN 0" in function
    assert "finance_supplier_payment_reversals" in function
    assert "payment_reversal.status = 'posted'" in function
    assert "RETURN payment.amount - allocated" in function
    posted_return, reversed_return = function.split("payment_reversal.status = 'posted'", 1)
    assert "RETURN 0" in posted_return
    assert "RETURN 0" in reversed_return.split("allocated :=", 1)[0]
    allocation_trigger = source.split(
        "CREATE FUNCTION finance_supplier_payment_allocation_before_write", 1
    )[1].split("CREATE FUNCTION finance_supplier_payment_reversal_before_write", 1)[0]
    assert "NEW.amount > finance_supplier_payment_available(payment.id)" in allocation_trigger
    assert "payment_used + NEW.amount > payment.amount" not in allocation_trigger
    assert "cannot allocate a reversed supplier payment" in allocation_trigger
    assert "uq_finance_supplier_payment_reversals_payment" in source
    assert "uq_finance_supplier_payment_allocations_number" in source
    assert "finance_supplier_allocated_from_payment(payment.id)" in source


def test_supplier_registry_matches_d2_index_contract() -> None:
    import app.db.models
    from app.db.base import Base

    d2_source = _migration_path(D2_MIGRATION_NAME).read_text(encoding="utf-8")
    d2_tables = {
        "finance_projects",
        "finance_cost_codes",
        "finance_counterparties",
        "finance_budget_versions",
        "finance_budget_lines",
        "finance_cost_documents",
        "finance_cost_lines",
        "finance_cost_allocations",
        "finance_audit_events",
        "finance_duplicate_exceptions",
    }
    registered = {
        "FinanceProject",
        "FinanceCostCode",
        "FinanceCounterparty",
        "FinanceBudgetVersion",
        "FinanceBudgetLine",
        "FinanceCostDocument",
        "FinanceCostLine",
        "FinanceCostAllocation",
        "FinanceAuditEvent",
        "FinanceDuplicateException",
        "FinanceSupplierPayment",
        "FinanceSupplierPaymentAllocation",
        "FinanceSupplierPaymentReversal",
        "FinanceSupplierPaymentAllocationReversal",
    }
    assert registered <= set(app.db.models.__all__)
    for table in Base.metadata.tables.values():
        if not str(table.name).startswith("finance_"):
            continue
        if table.name in d2_tables:
            for index in table.indexes:
                assert index.name in d2_source
        else:
            assert table.name.startswith("finance_supplier_payment")
            assert list(table.indexes) == []
    assert FinanceCostDocument.__table__.metadata is FinanceSupplierPayment.__table__.metadata


def test_outstanding_and_concurrency_rules_are_in_the_migration() -> None:
    source = _migration_path(MIGRATION_NAME).read_text(encoding="utf-8")
    for message in (
        "payment allocation exceeds the unallocated payment amount",
        "payment allocation exceeds the supplier outstanding balance",
        "supplier payment allocation must use the same supplier",
        "supplier payment allocation must stay in its company",
        "cannot allocate a reversed supplier payment",
        "supplier credit exceeds the unpaid supplier balance",
        "cannot reverse a supplier document that still has payment allocations",
        "supplier payment requires a supplier counterparty",
        "finance_supplier_gross_liability",
        "finance_supplier_allocated_to_document",
        "finance_supplier_allocated_from_payment",
        "trg_finance_cost_documents_supplier_payable",
        "DEFERRABLE INITIALLY DEFERRED",
        "FOR UPDATE",
    ):
        assert message in source
    assert "CREATE OR REPLACE FUNCTION finance_cost_document_posted_balance" not in source


def test_posted_rows_are_drafts_first_and_then_immutable() -> None:
    source = _migration_path(MIGRATION_NAME).read_text(encoding="utf-8")
    for message in (
        "supplier payments must be inserted as drafts",
        "supplier payment allocations must be inserted as drafts",
        "posted supplier payment is immutable",
        "posted supplier payment allocation is immutable",
    ):
        assert message in source
    for model in PAYMENT_TABLES:
        status = model.__table__.c.status
        assert status.nullable is False
        names = _constraint_names(model.__table__)
        assert any(name.endswith("_status") for name in names)
        assert isinstance(
            next(item for item in model.__table__.constraints if isinstance(item, CheckConstraint)),
            CheckConstraint,
        )


def test_d2_and_d3_modules_do_not_define_supplier_payments() -> None:
    finance_dir = Path(__file__).resolve().parents[1] / "app" / "modules" / "finance"
    d2_models = (finance_dir / "models.py").read_text(encoding="utf-8")
    d3_service = (finance_dir / "cost_register_service.py").read_text(encoding="utf-8")
    d3_rules = (finance_dir / "cost_register_rules.py").read_text(encoding="utf-8")
    assert "FinanceSupplierPayment" not in d2_models
    assert "finance_supplier_payments" not in d2_models
    assert "supplier_payment" not in d3_service
    assert "supplier_payment" not in d3_rules
    assert "uq_finance_supplier_payments_company_id" in _constraint_names(FinanceSupplierPayment.__table__)
    assert any(
        isinstance(constraint, UniqueConstraint) and constraint.name == "uq_finance_supplier_payment_allocations_number"
        for constraint in FinanceSupplierPaymentAllocation.__table__.constraints
    )


def _database_tests_enabled() -> bool:
    return os.environ.get("FINANCE_D4_DATABASE_TESTS", "").strip().lower() in {"1", "yes", "true"}


def _expect_rejection(connection, statement: str, params: dict, message: str) -> None:
    from sqlalchemy.exc import DBAPIError

    nested = connection.begin_nested()
    try:
        connection.execute(__import__("sqlalchemy").text(statement), params)
    except DBAPIError as exc:
        nested.rollback()
        detail = f"{exc} {getattr(exc, 'orig', '')}"
        assert message in detail, detail
        return
    nested.rollback()
    raise AssertionError(f"expected database rejection containing {message}")


def _open_finance_connection():
    import pytest
    from sqlalchemy import create_engine, text

    from app.testing.database_safety import validate_test_database_url

    if os.environ.get("TIMIQ_ENV", "").strip().lower() != "test":
        pytest.fail("FINANCE_D4_DATABASE_TESTS requires TIMIQ_ENV=test")
    url = validate_test_database_url(os.environ["TEST_DATABASE_URL"], timiq_env="test")
    engine = create_engine(url)
    probe = engine.connect()
    try:
        row = probe.execute(
            text(
                "SELECT current_database(), inet_server_addr(), inet_server_port(), "
                "current_setting('server_version'), current_setting('data_directory'), "
                "(SELECT version_num FROM alembic_version)"
            )
        ).one()
    finally:
        probe.close()
    address = str(row[1] or "")
    if row[0] != "timiq_test_finance_d2" or not address.startswith("127.0.0.1"):
        engine.dispose()
        pytest.fail("Refusing database tests because the server identity does not match")
    if row[2] != 5433 or not str(row[3]).startswith("16"):
        engine.dispose()
        pytest.fail("Refusing database tests because the server version or port does not match")
    if os.path.normcase(os.path.normpath(row[4])) != os.path.normcase(os.path.normpath(r"D:\PostgreSQLData\16")):
        engine.dispose()
        pytest.fail("Refusing database tests because the data directory does not match")
    if row[5] != "a7c8d9e0f1a2":
        engine.dispose()
        pytest.fail("Refusing database tests because the Alembic revision is not a7c8d9e0f1a2")
    connection = engine.connect()
    transaction = connection.begin()
    connection.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    return engine, connection, transaction


def _money(value: str) -> Decimal:
    return Decimal(value)


def _insert_company(connection, text, name: str) -> uuid.UUID:
    company_id = uuid.uuid4()
    connection.execute(
        text(
            "INSERT INTO companies (id, name, is_active, created_at, updated_at) "
            "VALUES (:id, :name, true, now(), now())"
        ),
        {"id": company_id, "name": name},
    )
    return company_id


def _insert_supplier(connection, text, company_id, name: str, kind: str = "supplier") -> uuid.UUID:
    supplier_id = uuid.uuid4()
    connection.execute(
        text(
            "INSERT INTO finance_counterparties "
            "(id, company_id, counterparty_type, name, normalized_name, is_active, created_at, updated_at) "
            "VALUES (:id, :company_id, :kind, :name, :normalized, true, now(), now())"
        ),
        {
            "id": supplier_id,
            "company_id": company_id,
            "kind": kind,
            "name": name,
            "normalized": name.upper(),
        },
    )
    return supplier_id


def _insert_project_and_code(connection, text, company_id) -> tuple[uuid.UUID, uuid.UUID]:
    project_id = uuid.uuid4()
    code_id = uuid.uuid4()
    connection.execute(
        text(
            "INSERT INTO finance_projects (id, company_id, name, status, created_at, updated_at) "
            "VALUES (:id, :company_id, 'Harbour Walk', 'active', now(), now())"
        ),
        {"id": project_id, "company_id": company_id},
    )
    connection.execute(
        text(
            "INSERT INTO finance_cost_codes (id, company_id, code, name, is_active, created_at, updated_at) "
            "VALUES (:id, :company_id, :code, 'Materials', true, now(), now())"
        ),
        {"id": code_id, "company_id": company_id, "code": f"M{code_id.hex[:8].upper()}"},
    )
    return project_id, code_id


def _post_cost(
    connection,
    text,
    *,
    company_id,
    supplier_id,
    project_id,
    code_id,
    document_type: str,
    reference: str | None,
    net: str,
    tax: str,
    recoverable: str,
    link: str | None = None,
    link_id=None,
) -> uuid.UUID:
    document_id = uuid.uuid4()
    net_amount = _money(net)
    tax_amount = _money(tax)
    recoverable_amount = _money(recoverable)
    non_recoverable = tax_amount - recoverable_amount
    eligible = net_amount + non_recoverable
    gross = net_amount + tax_amount
    connection.execute(
        text(
            "INSERT INTO finance_cost_documents ("
            "id, company_id, counterparty_id, document_type, status, normalized_reference, "
            "service_date, document_date, tax_point_date, currency_code, net_amount, tax_amount, "
            "recoverable_amount, non_recoverable_amount, eligible_amount, gross_amount, "
            "tax_notional_amount, credited_document_id, reverses_document_id, created_at, updated_at"
            ") VALUES ("
            ":id, :company_id, :supplier_id, :document_type, 'draft', :reference, "
            ":today, :today, :today, 'GBP', :net, :tax, :recoverable, :non_recoverable, :eligible, "
            ":gross, 0, :credited, :reverses, now(), now())"
        ),
        {
            "id": document_id,
            "company_id": company_id,
            "supplier_id": supplier_id,
            "document_type": document_type,
            "reference": reference,
            "today": date(2026, 10, 10),
            "net": net_amount,
            "tax": tax_amount,
            "recoverable": recoverable_amount,
            "non_recoverable": non_recoverable,
            "eligible": eligible,
            "gross": gross,
            "credited": link_id if link == "credited" else None,
            "reverses": link_id if link == "reverses" else None,
        },
    )
    line_id = uuid.uuid4()
    connection.execute(
        text(
            "INSERT INTO finance_cost_lines ("
            "id, company_id, document_id, line_number, net_amount, tax_treatment, tax_amount, "
            "recoverable_amount, non_recoverable_amount, eligible_amount, tax_notional_amount, "
            "created_at, updated_at"
            ") VALUES ("
            ":id, :company_id, :document_id, 1, :net, 'standard', :tax, :recoverable, :non_recoverable, "
            ":eligible, 0, now(), now())"
        ),
        {
            "id": line_id,
            "company_id": company_id,
            "document_id": document_id,
            "net": net_amount,
            "tax": tax_amount,
            "recoverable": recoverable_amount,
            "non_recoverable": non_recoverable,
            "eligible": eligible,
        },
    )
    connection.execute(
        text(
            "INSERT INTO finance_cost_allocations ("
            "id, company_id, line_id, allocation_number, project_id, cost_code_id, is_overhead, "
            "amount_net, amount_non_recoverable, amount_eligible, created_at, updated_at"
            ") VALUES ("
            ":id, :company_id, :line_id, 1, :project_id, :code_id, false, :net, :non_recoverable, "
            ":eligible, now(), now())"
        ),
        {
            "id": uuid.uuid4(),
            "company_id": company_id,
            "line_id": line_id,
            "project_id": project_id,
            "code_id": code_id,
            "net": net_amount,
            "non_recoverable": non_recoverable,
            "eligible": eligible,
        },
    )
    connection.execute(
        text("UPDATE finance_cost_documents SET status = 'posted', posted_at = now() WHERE id = :id"),
        {"id": document_id},
    )
    return document_id


def _post_payment(connection, text, company_id, supplier_id, amount: str, reference: str) -> uuid.UUID:
    payment_id = uuid.uuid4()
    connection.execute(
        text(
            "INSERT INTO finance_supplier_payments ("
            "id, company_id, counterparty_id, status, payment_date, external_reference, "
            "normalized_reference, currency_code, amount, created_at, updated_at"
            ") VALUES ("
            ":id, :company_id, :supplier_id, 'draft', :today, :reference, :reference, 'GBP', "
            ":amount, now(), now())"
        ),
        {
            "id": payment_id,
            "company_id": company_id,
            "supplier_id": supplier_id,
            "today": date(2026, 10, 10),
            "reference": reference,
            "amount": _money(amount),
        },
    )
    connection.execute(
        text(
            "UPDATE finance_supplier_payments SET status = 'posted', posted_at = now() WHERE id = :id"
        ),
        {"id": payment_id},
    )
    return payment_id


def _post_allocation(connection, text, company_id, payment_id, document_id, number: int, amount: str) -> uuid.UUID:
    allocation_id = uuid.uuid4()
    connection.execute(
        text(
            "INSERT INTO finance_supplier_payment_allocations ("
            "id, company_id, payment_id, cost_document_id, allocation_number, status, amount, "
            "created_at, updated_at"
            ") VALUES ("
            ":id, :company_id, :payment_id, :document_id, :number, 'draft', :amount, now(), now())"
        ),
        {
            "id": allocation_id,
            "company_id": company_id,
            "payment_id": payment_id,
            "document_id": document_id,
            "number": number,
            "amount": _money(amount),
        },
    )
    connection.execute(
        text(
            "UPDATE finance_supplier_payment_allocations "
            "SET status = 'posted', posted_at = now() WHERE id = :id"
        ),
        {"id": allocation_id},
    )
    return allocation_id


def _post_allocation_reversal(connection, text, company_id, allocation_id, amount: str) -> None:
    reversal_id = uuid.uuid4()
    connection.execute(
        text(
            "INSERT INTO finance_supplier_payment_allocation_reversals ("
            "id, company_id, allocation_id, status, amount, created_at, updated_at"
            ") VALUES (:id, :company_id, :allocation_id, 'draft', :amount, now(), now())"
        ),
        {
            "id": reversal_id,
            "company_id": company_id,
            "allocation_id": allocation_id,
            "amount": _money(amount),
        },
    )
    connection.execute(
        text(
            "UPDATE finance_supplier_payment_allocation_reversals "
            "SET status = 'posted', posted_at = now() WHERE id = :id"
        ),
        {"id": reversal_id},
    )


def _post_payment_reversal(connection, text, company_id, payment_id, amount: str) -> None:
    reversal_id = uuid.uuid4()
    connection.execute(
        text(
            "INSERT INTO finance_supplier_payment_reversals ("
            "id, company_id, payment_id, status, amount, created_at, updated_at"
            ") VALUES (:id, :company_id, :payment_id, 'draft', :amount, now(), now())"
        ),
        {
            "id": reversal_id,
            "company_id": company_id,
            "payment_id": payment_id,
            "amount": _money(amount),
        },
    )
    connection.execute(
        text(
            "UPDATE finance_supplier_payment_reversals SET status = 'posted', posted_at = now() WHERE id = :id"
        ),
        {"id": reversal_id},
    )


def _outstanding(connection, text, document_id) -> Decimal:
    value = connection.execute(
        text(
            "SELECT finance_supplier_gross_liability(:id) - finance_supplier_allocated_to_document(:id)"
        ),
        {"id": document_id},
    ).scalar_one()
    return Decimal(value)


def _available(connection, text, payment_id) -> Decimal:
    value = connection.execute(
        text("SELECT finance_supplier_payment_available(:id)"),
        {"id": payment_id},
    ).scalar_one()
    return Decimal(value)


def _cost_snapshot(connection, text, document_id):
    return connection.execute(
        text(
            "SELECT net_amount, tax_amount, recoverable_amount, non_recoverable_amount, "
            "eligible_amount, gross_amount FROM finance_cost_documents WHERE id = :id"
        ),
        {"id": document_id},
    ).one()


@pytest.mark.skipif(not _database_tests_enabled(), reason="FINANCE_D4_DATABASE_TESTS is not set")
def test_database_supplier_payment_scenarios() -> None:
    import pytest
    from sqlalchemy import text

    engine, connection, transaction = _open_finance_connection()
    try:
        payroll_before = connection.execute(text("SELECT count(*) FROM payroll_items")).scalar_one()
        shifts_before = connection.execute(text("SELECT count(*) FROM time_shifts")).scalar_one()
        company_id = _insert_company(connection, text, f"Finance D4 {uuid.uuid4().hex[:8]}")
        supplier_id = _insert_supplier(connection, text, company_id, "Fictional Aggregates Ltd")
        project_id, code_id = _insert_project_and_code(connection, text, company_id)

        invoice_id = _post_cost(
            connection, text,
            company_id=company_id, supplier_id=supplier_id, project_id=project_id, code_id=code_id,
            document_type="supplier_invoice", reference="D4B-1200",
            net="1000.0000", tax="200.0000", recoverable="200.0000",
        )
        cost_before = _cost_snapshot(connection, text, invoice_id)
        payment_a = _post_payment(connection, text, company_id, supplier_id, "500.0000", "PAY-500")
        _post_allocation(connection, text, company_id, payment_a, invoice_id, 1, "500.0000")
        assert _outstanding(connection, text, invoice_id) == _money("700.0000")
        payment_b = _post_payment(connection, text, company_id, supplier_id, "700.0000", "PAY-700")
        _post_allocation(connection, text, company_id, payment_b, invoice_id, 1, "700.0000")
        assert _outstanding(connection, text, invoice_id) == _money("0.0000")
        assert _cost_snapshot(connection, text, invoice_id) == cost_before

        first_id = _post_cost(
            connection, text,
            company_id=company_id, supplier_id=supplier_id, project_id=project_id, code_id=code_id,
            document_type="supplier_invoice", reference="D4B-INV-1",
            net="500.0000", tax="100.0000", recoverable="100.0000",
        )
        second_id = _post_cost(
            connection, text,
            company_id=company_id, supplier_id=supplier_id, project_id=project_id, code_id=code_id,
            document_type="supplier_invoice", reference="D4B-INV-2",
            net="400.0000", tax="80.0000", recoverable="80.0000",
        )
        shared = _post_payment(connection, text, company_id, supplier_id, "800.0000", "PAY-SHARED")
        _post_allocation(connection, text, company_id, shared, first_id, 1, "600.0000")
        _post_allocation(connection, text, company_id, shared, second_id, 2, "100.0000")
        assert _outstanding(connection, text, first_id) == _money("0.0000")
        assert _outstanding(connection, text, second_id) == _money("380.0000")
        assert _available(connection, text, shared) == _money("100.0000")
        allocated_total = connection.execute(
            text(
                "SELECT COALESCE(SUM(amount), 0) FROM finance_supplier_payment_allocations "
                "WHERE payment_id = :id AND status = 'posted'"
            ),
            {"id": shared},
        ).scalar_one()
        assert Decimal(allocated_total) == _money("700.0000")

        settled_id = _post_cost(
            connection, text,
            company_id=company_id, supplier_id=supplier_id, project_id=project_id, code_id=code_id,
            document_type="supplier_invoice", reference="D4B-REV",
            net="400.0000", tax="0.0000", recoverable="0.0000",
        )
        reversible = _post_payment(connection, text, company_id, supplier_id, "400.0000", "PAY-REV")
        settled_allocation = _post_allocation(
            connection, text, company_id, reversible, settled_id, 1, "400.0000"
        )
        assert _outstanding(connection, text, settled_id) == _money("0.0000")
        _post_allocation_reversal(connection, text, company_id, settled_allocation, "400.0000")
        assert _outstanding(connection, text, settled_id) == _money("400.0000")
        assert _available(connection, text, reversible) == _money("400.0000")
        original_amount = connection.execute(
            text("SELECT amount, status FROM finance_supplier_payment_allocations WHERE id = :id"),
            {"id": settled_allocation},
        ).one()
        assert Decimal(original_amount[0]) == _money("400.0000")
        assert original_amount[1] == "posted"
        _expect_rejection(
            connection,
            "INSERT INTO finance_supplier_payment_allocation_reversals "
            "(id, company_id, allocation_id, status, amount, created_at, updated_at) "
            "VALUES (:id, :company_id, :allocation_id, 'draft', 400, now(), now())",
            {
                "id": uuid.uuid4(),
                "company_id": company_id,
                "allocation_id": settled_allocation,
            },
            "uq_finance_supplier_payment_allocation_reversals_allocation",
        )
        _post_payment_reversal(connection, text, company_id, reversible, "400.0000")
        assert _available(connection, text, reversible) == _money("0.0000")
        assert _outstanding(connection, text, settled_id) == _money("400.0000")
        reused = _insert_allocation_draft(connection, text, company_id, reversible, settled_id, 2, "1.0000")
        _expect_rejection(
            connection,
            "UPDATE finance_supplier_payment_allocations SET status = 'posted', posted_at = now() "
            "WHERE id = :id",
            {"id": reused},
            "cannot allocate a reversed supplier payment",
        )
        _expect_rejection(
            connection,
            "INSERT INTO finance_supplier_payment_reversals "
            "(id, company_id, payment_id, status, amount, created_at, updated_at) "
            "VALUES (:id, :company_id, :payment_id, 'draft', 400, now(), now())",
            {"id": uuid.uuid4(), "company_id": company_id, "payment_id": reversible},
            "uq_finance_supplier_payment_reversals_payment",
        )

        credited_id = _post_cost(
            connection, text,
            company_id=company_id, supplier_id=supplier_id, project_id=project_id, code_id=code_id,
            document_type="supplier_invoice", reference="D4B-CREDIT",
            net="1000.0000", tax="200.0000", recoverable="200.0000",
        )
        credit_payment = _post_payment(connection, text, company_id, supplier_id, "500.0000", "PAY-CREDIT")
        credit_allocation = _post_allocation(
            connection, text, company_id, credit_payment, credited_id, 1, "500.0000"
        )
        _expect_rejection(
            connection,
            "UPDATE finance_cost_documents SET status = 'posted', posted_at = now() WHERE id = :id",
            {
                "id": _post_cost_draft_credit(
                    connection, text, company_id, supplier_id, project_id, code_id, credited_id
                )
            },
            "supplier credit exceeds the unpaid supplier balance",
        )
        assert _outstanding(connection, text, credited_id) == _money("700.0000")
        _post_allocation_reversal(connection, text, company_id, credit_allocation, "500.0000")
        credit_id = _post_cost(
            connection, text,
            company_id=company_id, supplier_id=supplier_id, project_id=project_id, code_id=code_id,
            document_type="supplier_credit", reference="D4B-CN",
            net="-600.0000", tax="-120.0000", recoverable="-120.0000",
            link="credited", link_id=credited_id,
        )
        assert _outstanding(connection, text, credited_id) == _money("480.0000")
        assert _cost_snapshot(connection, text, credited_id)[4] == _money("1000.0000")
        assert connection.execute(
            text("SELECT eligible_amount FROM finance_cost_documents WHERE id = :id"),
            {"id": credit_id},
        ).scalar_one() == _money("-600.0000")

        blocked_id = _post_cost(
            connection, text,
            company_id=company_id, supplier_id=supplier_id, project_id=project_id, code_id=code_id,
            document_type="supplier_invoice", reference="D4B-BLOCK",
            net="250.0000", tax="0.0000", recoverable="0.0000",
        )
        blocking_payment = _post_payment(connection, text, company_id, supplier_id, "250.0000", "PAY-BLOCK")
        blocking_allocation = _post_allocation(
            connection, text, company_id, blocking_payment, blocked_id, 1, "250.0000"
        )
        reversal_draft_id = _insert_reversal_draft(
            connection, text, company_id, supplier_id, project_id, code_id, blocked_id,
            "-250.0000", "0.0000", "0.0000",
        )
        _expect_rejection(
            connection,
            "UPDATE finance_cost_documents SET status = 'posted', posted_at = now() WHERE id = :id",
            {"id": reversal_draft_id},
            "cannot reverse a supplier document that still has payment allocations",
        )
        blocked_invoice = connection.execute(
            text(
                "SELECT status, net_amount, tax_amount, recoverable_amount, eligible_amount, gross_amount "
                "FROM finance_cost_documents WHERE id = :id"
            ),
            {"id": blocked_id},
        ).one()
        assert blocked_invoice[0] == "posted"
        assert [Decimal(value) for value in blocked_invoice[1:]] == [
            _money("250.0000"),
            _money("0.0000"),
            _money("0.0000"),
            _money("250.0000"),
            _money("250.0000"),
        ]
        blocking_row = connection.execute(
            text("SELECT status, amount FROM finance_supplier_payment_allocations WHERE id = :id"),
            {"id": blocking_allocation},
        ).one()
        assert blocking_row[0] == "posted"
        assert Decimal(blocking_row[1]) == _money("250.0000")
        assert connection.execute(
            text("SELECT status FROM finance_cost_documents WHERE id = :id"),
            {"id": reversal_draft_id},
        ).scalar_one() == "draft"
        _post_allocation_reversal(connection, text, company_id, blocking_allocation, "250.0000")
        _post_payment_reversal(connection, text, company_id, blocking_payment, "250.0000")
        reversal_id = _post_cost(
            connection, text,
            company_id=company_id, supplier_id=supplier_id, project_id=project_id, code_id=code_id,
            document_type="reversal", reference=None,
            net="-250.0000", tax="0.0000", recoverable="0.0000",
            link="reverses", link_id=blocked_id,
        )
        assert _outstanding(connection, text, blocked_id) == _money("0.0000")
        assert reversal_id is not None

        other_company = _insert_company(connection, text, f"Finance D4 Other {uuid.uuid4().hex[:8]}")
        other_supplier = _insert_supplier(connection, text, other_company, "Other Supplier")
        other_project, other_code = _insert_project_and_code(connection, text, other_company)
        other_invoice = _post_cost(
            connection, text,
            company_id=other_company, supplier_id=other_supplier, project_id=other_project,
            code_id=other_code, document_type="supplier_invoice", reference="D4B-OTHER",
            net="100.0000", tax="0.0000", recoverable="0.0000",
        )
        wrong_supplier = _insert_supplier(connection, text, company_id, "Wrong Supplier")
        wrong_payment = _post_payment(connection, text, company_id, wrong_supplier, "50.0000", "PAY-WRONG")
        _expect_rejection(
            connection,
            "UPDATE finance_supplier_payment_allocations SET status = 'posted', posted_at = now() "
            "WHERE id = :id",
            {
                "id": _insert_allocation_draft(
                    connection, text, company_id, wrong_payment, invoice_id, 9, "50.0000"
                )
            },
            "supplier payment allocation must use the same supplier",
        )
        cross_payment = _post_payment(connection, text, company_id, supplier_id, "10.0000", "PAY-CROSS")
        _expect_rejection(
            connection,
            "INSERT INTO finance_supplier_payment_allocations "
            "(id, company_id, payment_id, cost_document_id, allocation_number, status, amount, "
            "created_at, updated_at) VALUES "
            "(:id, :company_id, :payment_id, :document_id, 1, 'draft', 10, now(), now())",
            {
                "id": uuid.uuid4(),
                "company_id": company_id,
                "payment_id": cross_payment,
                "document_id": other_invoice,
            },
            "fk_finance_supplier_payment_allocations_document",
        )
        draft_id = uuid.uuid4()
        connection.execute(
            text(
                "INSERT INTO finance_cost_documents ("
                "id, company_id, counterparty_id, document_type, status, currency_code, "
                "net_amount, tax_amount, recoverable_amount, non_recoverable_amount, eligible_amount, "
                "gross_amount, tax_notional_amount, created_at, updated_at"
                ") VALUES ("
                ":id, :company_id, :supplier_id, 'supplier_invoice', 'draft', 'GBP', "
                "10, 0, 0, 0, 10, 10, 0, now(), now())"
            ),
            {"id": draft_id, "company_id": company_id, "supplier_id": supplier_id},
        )
        _expect_rejection(
            connection,
            "UPDATE finance_supplier_payment_allocations SET status = 'posted', posted_at = now() "
            "WHERE id = :id",
            {"id": _insert_allocation_draft(connection, text, company_id, shared, draft_id, 3, "10.0000")},
            "supplier payments allocate only to posted supplier invoices and expense receipts",
        )
        _expect_rejection(
            connection,
            "UPDATE finance_supplier_payment_allocations SET status = 'posted', posted_at = now() "
            "WHERE id = :id",
            {
                "id": _insert_allocation_draft(
                    connection, text, company_id, shared, credit_id, 4, "10.0000"
                )
            },
            "supplier payments allocate only to posted supplier invoices and expense receipts",
        )
        _expect_rejection(
            connection,
            "UPDATE finance_supplier_payment_allocations SET status = 'posted', posted_at = now() "
            "WHERE id = :id",
            {"id": _insert_allocation_draft(connection, text, company_id, shared, second_id, 5, "400.0000")},
            "payment allocation exceeds the unallocated payment amount",
        )
        room = _post_payment(connection, text, company_id, supplier_id, "500.0000", "PAY-ROOM")
        _expect_rejection(
            connection,
            "UPDATE finance_supplier_payment_allocations SET status = 'posted', posted_at = now() "
            "WHERE id = :id",
            {"id": _insert_allocation_draft(connection, text, company_id, room, second_id, 1, "381.0000")},
            "payment allocation exceeds the supplier outstanding balance",
        )
        _expect_rejection(
            connection,
            "UPDATE finance_supplier_payments SET amount = 1 WHERE id = :id",
            {"id": shared},
            "posted supplier payment is immutable",
        )

        sequence_invoice = _post_cost(
            connection, text,
            company_id=company_id, supplier_id=supplier_id, project_id=project_id, code_id=code_id,
            document_type="supplier_invoice", reference="D4B-D2",
            net="100.0000", tax="20.0000", recoverable="20.0000",
        )
        sequence_credit = _post_cost(
            connection, text,
            company_id=company_id, supplier_id=supplier_id, project_id=project_id, code_id=code_id,
            document_type="supplier_credit", reference="D4B-D2-CN",
            net="-100.0000", tax="-20.0000", recoverable="-20.0000",
            link="credited", link_id=sequence_invoice,
        )
        _post_cost(
            connection, text,
            company_id=company_id, supplier_id=supplier_id, project_id=project_id, code_id=code_id,
            document_type="reversal", reference=None,
            net="100.0000", tax="20.0000", recoverable="20.0000",
            link="reverses", link_id=sequence_credit,
        )
        _post_cost(
            connection, text,
            company_id=company_id, supplier_id=supplier_id, project_id=project_id, code_id=code_id,
            document_type="reversal", reference=None,
            net="-100.0000", tax="-20.0000", recoverable="-20.0000",
            link="reverses", link_id=sequence_invoice,
        )
        assert _outstanding(connection, text, sequence_invoice) == _money("0.0000")
        assert connection.execute(
            text("SELECT count(*) FROM finance_supplier_payment_allocations WHERE cost_document_id = :id"),
            {"id": sequence_invoice},
        ).scalar_one() == 0
        assert connection.execute(text("SELECT count(*) FROM payroll_items")).scalar_one() == payroll_before
        assert connection.execute(text("SELECT count(*) FROM time_shifts")).scalar_one() == shifts_before
    finally:
        transaction.rollback()
        connection.close()
        engine.dispose()


def _insert_allocation_draft(connection, text, company_id, payment_id, document_id, number: int, amount: str):
    allocation_id = uuid.uuid4()
    connection.execute(
        text(
            "INSERT INTO finance_supplier_payment_allocations ("
            "id, company_id, payment_id, cost_document_id, allocation_number, status, amount, "
            "created_at, updated_at) VALUES ("
            ":id, :company_id, :payment_id, :document_id, :number, 'draft', :amount, now(), now())"
        ),
        {
            "id": allocation_id,
            "company_id": company_id,
            "payment_id": payment_id,
            "document_id": document_id,
            "number": number,
            "amount": _money(amount),
        },
    )
    return allocation_id


def _post_cost_draft_credit(connection, text, company_id, supplier_id, project_id, code_id, invoice_id):
    document_id = uuid.uuid4()
    net_amount = _money("-600.0000")
    tax_amount = _money("-120.0000")
    recoverable_amount = _money("-120.0000")
    connection.execute(
        text(
            "INSERT INTO finance_cost_documents ("
            "id, company_id, counterparty_id, document_type, status, normalized_reference, "
            "service_date, document_date, tax_point_date, currency_code, net_amount, tax_amount, "
            "recoverable_amount, non_recoverable_amount, eligible_amount, gross_amount, "
            "tax_notional_amount, credited_document_id, created_at, updated_at"
            ") VALUES ("
            ":id, :company_id, :supplier_id, 'supplier_credit', 'draft', 'D4B-CN-TOO-BIG', "
            ":today, :today, :today, 'GBP', :net, :tax, :tax, 0, :net, :gross, 0, :invoice_id, now(), now())"
        ),
        {
            "id": document_id,
            "company_id": company_id,
            "supplier_id": supplier_id,
            "today": date(2026, 10, 10),
            "net": net_amount,
            "tax": tax_amount,
            "gross": net_amount + tax_amount,
            "invoice_id": invoice_id,
        },
    )
    line_id = uuid.uuid4()
    connection.execute(
        text(
            "INSERT INTO finance_cost_lines ("
            "id, company_id, document_id, line_number, net_amount, tax_treatment, tax_amount, "
            "recoverable_amount, non_recoverable_amount, eligible_amount, tax_notional_amount, "
            "created_at, updated_at) VALUES ("
            ":id, :company_id, :document_id, 1, :net, 'standard', :tax, :tax, 0, :net, 0, now(), now())"
        ),
        {
            "id": line_id,
            "company_id": company_id,
            "document_id": document_id,
            "net": net_amount,
            "tax": tax_amount,
        },
    )
    connection.execute(
        text(
            "INSERT INTO finance_cost_allocations ("
            "id, company_id, line_id, allocation_number, project_id, cost_code_id, is_overhead, "
            "amount_net, amount_non_recoverable, amount_eligible, created_at, updated_at) "
            "VALUES (:id, :company_id, :line_id, 1, :project_id, :code_id, false, :net, 0, :net, now(), now())"
        ),
        {
            "id": uuid.uuid4(),
            "company_id": company_id,
            "line_id": line_id,
            "project_id": project_id,
            "code_id": code_id,
            "net": net_amount,
        },
    )
    return document_id


def _insert_reversal_draft(
    connection, text, company_id, supplier_id, project_id, code_id, source_id, net, tax, recoverable
):
    return _insert_unposted_cost(
        connection, text,
        company_id=company_id, supplier_id=supplier_id, project_id=project_id, code_id=code_id,
        document_type="reversal", reference=None, net=net, tax=tax, recoverable=recoverable,
        link="reverses", link_id=source_id,
    )


def _insert_unposted_cost(
    connection, text, *, company_id, supplier_id, project_id, code_id, document_type, reference, net, tax,
    recoverable, link=None, link_id=None,
):
    document_id = uuid.uuid4()
    net_amount = _money(net)
    tax_amount = _money(tax)
    recoverable_amount = _money(recoverable)
    non_recoverable = tax_amount - recoverable_amount
    eligible = net_amount + non_recoverable
    gross = net_amount + tax_amount
    connection.execute(
        text(
            "INSERT INTO finance_cost_documents ("
            "id, company_id, counterparty_id, document_type, status, normalized_reference, "
            "service_date, document_date, tax_point_date, currency_code, net_amount, tax_amount, "
            "recoverable_amount, non_recoverable_amount, eligible_amount, gross_amount, "
            "tax_notional_amount, credited_document_id, reverses_document_id, created_at, updated_at"
            ") VALUES ("
            ":id, :company_id, :supplier_id, :document_type, 'draft', :reference, "
            ":today, :today, :today, 'GBP', :net, :tax, :recoverable, :non_recoverable, :eligible, "
            ":gross, 0, :credited, :reverses, now(), now())"
        ),
        {
            "id": document_id,
            "company_id": company_id,
            "supplier_id": supplier_id,
            "document_type": document_type,
            "reference": reference,
            "today": date(2026, 10, 10),
            "net": net_amount,
            "tax": tax_amount,
            "recoverable": recoverable_amount,
            "non_recoverable": non_recoverable,
            "eligible": eligible,
            "gross": gross,
            "credited": link_id if link == "credited" else None,
            "reverses": link_id if link == "reverses" else None,
        },
    )
    line_id = uuid.uuid4()
    connection.execute(
        text(
            "INSERT INTO finance_cost_lines ("
            "id, company_id, document_id, line_number, net_amount, tax_treatment, tax_amount, "
            "recoverable_amount, non_recoverable_amount, eligible_amount, tax_notional_amount, "
            "created_at, updated_at) VALUES ("
            ":id, :company_id, :document_id, 1, :net, 'standard', :tax, :recoverable, :non_recoverable, "
            ":eligible, 0, now(), now())"
        ),
        {
            "id": line_id,
            "company_id": company_id,
            "document_id": document_id,
            "net": net_amount,
            "tax": tax_amount,
            "recoverable": recoverable_amount,
            "non_recoverable": non_recoverable,
            "eligible": eligible,
        },
    )
    connection.execute(
        text(
            "INSERT INTO finance_cost_allocations ("
            "id, company_id, line_id, allocation_number, project_id, cost_code_id, is_overhead, "
            "amount_net, amount_non_recoverable, amount_eligible, created_at, updated_at) "
            "VALUES (:id, :company_id, :line_id, 1, :project_id, :code_id, false, :net, "
            ":non_recoverable, :eligible, now(), now())"
        ),
        {
            "id": uuid.uuid4(),
            "company_id": company_id,
            "line_id": line_id,
            "project_id": project_id,
            "code_id": code_id,
            "net": net_amount,
            "non_recoverable": non_recoverable,
            "eligible": eligible,
        },
    )
    return document_id


@pytest.mark.skip(
    reason="Superseded by test_finance_gate_concurrency.py, which commits only on timiq_test_finance_gate. This rollback suite must not commit."
)
def test_database_simultaneous_allocations_are_not_run() -> None:
    raise AssertionError("simultaneous allocation test was not authorised to commit on the persistent database")
