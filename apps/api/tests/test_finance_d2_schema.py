"""Finance D2 schema tests.

Static tests inspect models and the migration file and do not connect.

The truncate path is permanently disabled. Setting FINANCE_D2_DESTRUCTIVE_TESTS
does not connect to timiq_test_finance_d2 or timiq_test_finance_gate.
"""

from __future__ import annotations

import importlib.util
import inspect
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from app.modules.finance.models import (
    MONEY,
    FinanceAuditEvent,
    FinanceBudgetLine,
    FinanceCostAllocation,
    FinanceCostDocument,
    FinanceCostLine,
    FinanceProject,
)

MIGRATION_NAME = "f2a3b4c5d6e7_finance_d2_cost_register.py"
FINANCE_TEST_DB_NAME = "timiq_test_finance_d2"
PROTECTED_SQL = (
    "ALTER TABLE companies",
    "ALTER TABLE payroll_items",
    "ALTER TABLE monthly_paye_items",
    "ALTER TABLE budget_projects",
    "ALTER TABLE time_shifts",
    "DROP TABLE companies",
    "DROP TABLE payroll_items",
)


def _expect_database_rejection(
    connection, statement: str, params: dict, message: str | None = None
) -> None:
    """Roll back only the rejected statement so the surrounding test transaction can continue."""
    nested = connection.begin_nested()
    try:
        connection.execute(text(statement), params)
    except DBAPIError as exc:
        nested.rollback()
        if message is not None:
            detail = f"{exc} {getattr(exc, 'orig', '')}"
            if message not in detail:
                pytest.fail(f"expected {message!r} in database error, got {detail}")
        return
    nested.rollback()
    pytest.fail("expected the database to reject the write")


def _migration_path() -> Path:
    return Path(__file__).resolve().parents[1] / "migrations" / "versions" / MIGRATION_NAME


def _load_migration():
    path = _migration_path()
    spec = importlib.util.spec_from_file_location("finance_d2_cost_register", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _constraint_names(table) -> set[str]:
    names = set()
    for constraint in table.constraints:
        if constraint.name:
            names.add(constraint.name)
    return names


def _index_names(table) -> set[str]:
    return {index.name for index in table.indexes if index.name}


def test_finance_models_use_decimal_money_and_gbp() -> None:
    assert str(MONEY) == "NUMERIC(18, 4)"
    document = FinanceCostDocument.__table__
    for column_name in (
        "net_amount",
        "tax_amount",
        "recoverable_amount",
        "non_recoverable_amount",
        "eligible_amount",
        "gross_amount",
    ):
        column = document.c[column_name]
        assert isinstance(column.type, type(MONEY))
        assert column.type.precision == 18
        assert column.type.scale == 4
    assert "ck_finance_cost_documents_gbp" in _constraint_names(document)
    assert "ck_finance_cost_documents_eligible" in _constraint_names(document)
    assert "ck_finance_cost_lines_eligible" in _constraint_names(FinanceCostLine.__table__)
    assert "domestic_reverse_charge" not in str(
        next(
            constraint.sqltext
            for constraint in FinanceCostLine.__table__.constraints
            if constraint.name == "ck_finance_cost_lines_tax_treatment"
        )
    )


def test_budget_lines_allow_repeated_cost_codes() -> None:
    table = FinanceBudgetLine.__table__
    unique_sets = [
        tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if constraint.__class__.__name__ == "UniqueConstraint"
    ]
    assert ("version_id", "line_number") in unique_sets
    assert ("version_id", "cost_code_id") not in unique_sets
    assert "ix_finance_budget_lines_version_cost_code" in _index_names(table)
    assert table.c.item_reference.nullable is True
    assert table.c.description.nullable is True
    assert table.c.amount_net.nullable is False


def test_draft_document_fields_are_nullable_until_posting() -> None:
    document = FinanceCostDocument.__table__
    for column_name in ("counterparty_id", "service_date", "document_date", "tax_point_date", "normalized_reference"):
        assert document.c[column_name].nullable is True
    assert "ck_finance_cost_documents_posted_required" in _constraint_names(document)
    line = FinanceCostLine.__table__
    assert line.c.tax_treatment.nullable is True
    assert line.c.description.nullable is True


def test_company_foreign_keys_are_restrict_and_composite() -> None:
    document = FinanceCostDocument.__table__
    company_fk = next(fk for fk in document.foreign_keys if fk.parent.name == "company_id")
    assert company_fk.ondelete == "RESTRICT"
    assert "fk_finance_cost_documents_counterparty" in _constraint_names(document)
    allocation = FinanceCostAllocation.__table__
    assert "fk_finance_cost_allocations_project" in _constraint_names(allocation)
    assert "uq_finance_cost_allocations_line_number" in _constraint_names(allocation)


def test_audit_actor_has_no_user_foreign_key() -> None:
    table = FinanceAuditEvent.__table__
    assert table.c.actor_user_id.foreign_keys == set()
    assert "updated_at" not in table.c


def test_supplier_reference_indexes_are_separate_for_invoices_and_credits() -> None:
    names = _index_names(FinanceCostDocument.__table__)
    assert "uq_finance_posted_supplier_invoice_ref" in names
    assert "uq_finance_posted_supplier_credit_ref" in names
    assert "uq_finance_posted_reversal_source" in names


def test_migration_is_additive_and_parented_on_current_head() -> None:
    migration = _load_migration()
    source = _migration_path().read_text(encoding="utf-8")
    assert migration.revision == "f2a3b4c5d6e7"
    assert migration.down_revision == "f8a9b0c1d2e3"
    for name in (
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
    ):
        assert name in source
    assert "DEFERRABLE INITIALLY DEFERRED" in source
    assert "posted finance document children are immutable" in source
    assert "reversal does not negate its source document" in source
    assert "a reversal cannot be reversed" in source
    assert "approved budget lines are immutable" in source
    assert "budget versions must be inserted as drafts" in source
    assert "posted positive cost document cannot contain negative lines or allocations" in source
    assert "supplier credits exceed the source eligible amount" in source
    assert "supplier credit allocations exceed the source project amounts" in source
    assert "cannot credit a reversed document" in source
    assert "cannot reverse a document that has posted credits" in source
    assert "credit_is_historical" in source
    assert "ck_finance_cost_documents_posted_links" in source
    assert "ck_finance_cost_documents_posted_links" in _constraint_names(FinanceCostDocument.__table__)
    assert "finance_reject_posted_cost_documents" in source
    assert "finance history rows are append-only" in source
    assert "allocation_number" in source
    for forbidden in PROTECTED_SQL:
        assert forbidden not in source
    upgrade_source = source.split("def upgrade", 1)[1].split("def downgrade", 1)[0]
    assert "op.drop_table" not in upgrade_source
    assert "op.alter_table" not in upgrade_source


def test_model_indexes_are_named_in_the_migration() -> None:
    source = _migration_path().read_text(encoding="utf-8")
    workplace_link = (
        Path(__file__).resolve().parents[1]
        / "migrations"
        / "versions"
        / "b8c9d0e1f2a3_finance_project_workplace_link.py"
    ).read_text(encoding="utf-8")
    named = source + "\n" + workplace_link
    for table in FinanceProject.metadata.tables.values():
        if not str(table.name).startswith("finance_"):
            continue
        for index in table.indexes:
            assert index.name in named


def test_destructive_fixture_cannot_reach_the_trial_database(monkeypatch: pytest.MonkeyPatch) -> None:
    guard_source = inspect.getsource(_finance_test_url)
    truncate_sql = inspect.getsource(_engine).split("TRUNCATE TABLE", 1)[1].split(")", 1)[0]
    assert "permanently disabled" in guard_source
    assert "FINANCE_D2_DESTRUCTIVE_TESTS" in guard_source
    assert FINANCE_TEST_DB_NAME in guard_source
    assert "timiq_test_finance_gate" in guard_source
    assert "CASCADE" not in truncate_sql
    monkeypatch.setenv("FINANCE_D2_DESTRUCTIVE_TESTS", "yes")
    monkeypatch.setenv("TIMIQ_ENV", "test")
    monkeypatch.setenv(
        "TEST_DATABASE_URL",
        "postgresql+psycopg://postgres@127.0.0.1:5433/timiq_test_finance_d2",
    )
    with pytest.raises(pytest.skip.Exception) as skipped:
        _finance_test_url()
    assert "timiq_test_finance_d2" in str(skipped.value)


def _finance_test_url() -> str:
    pytest.skip(
        "Destructive Finance schema tests are permanently disabled. "
        "They must not truncate timiq_test_finance_d2 or timiq_test_finance_gate, "
        "even when FINANCE_D2_DESTRUCTIVE_TESTS is set. "
        "A disposable database requires separate owner approval."
    )


def _engine():
    url = _finance_test_url()
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            ready = connection.execute(text("SELECT to_regclass('public.finance_cost_documents')")).scalar()
    except Exception as exc:  # noqa: BLE001
        engine.dispose()
        pytest.fail(f"disposable finance test database connection failed: {exc}")
    if ready is None:
        engine.dispose()
        pytest.fail("Finance D2 migration is not applied on timiq_test_finance_d2")
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "TRUNCATE TABLE "
                    "finance_duplicate_exceptions, finance_audit_events, finance_cost_allocations, "
                    "finance_cost_lines, finance_cost_documents, finance_budget_lines, "
                    "finance_budget_versions, finance_counterparties, finance_cost_codes, "
                    "finance_projects RESTART IDENTITY"
                )
            )
    except Exception as exc:  # noqa: BLE001
        engine.dispose()
        pytest.fail(f"disposable finance test database cleanup failed: {exc}")
    return engine


def _new_company(connection) -> uuid.UUID:
    company_id = uuid.uuid4()
    connection.execute(
        text(
            "INSERT INTO companies (id, name, is_active, created_at, updated_at) "
            "VALUES (:id, :name, true, now(), now())"
        ),
        {"id": company_id, "name": f"Finance Test {company_id.hex[:8]}"},
    )
    return company_id


def _insert_finance_parties(connection, company_id, project_id, code_id, supplier_id) -> None:
    connection.execute(
        text(
            "INSERT INTO finance_projects (id, company_id, name, status, created_at, updated_at) "
            "VALUES (:id, :company_id, 'Harbour Walk', 'active', now(), now())"
        ),
        {"id": project_id, "company_id": company_id},
    )
    connection.execute(
        text(
            "INSERT INTO finance_cost_codes "
            "(id, company_id, code, name, is_active, created_at, updated_at) "
            "VALUES (:id, :company_id, 'MAT', 'Materials', true, now(), now())"
        ),
        {"id": code_id, "company_id": company_id},
    )
    connection.execute(
        text(
            "INSERT INTO finance_counterparties "
            "(id, company_id, counterparty_type, name, normalized_name, is_active, created_at, updated_at) "
            "VALUES (:id, :company_id, 'supplier', 'Fictional Aggregates Ltd', "
            "'FICTIONAL AGGREGATES LTD', true, now(), now())"
        ),
        {"id": supplier_id, "company_id": company_id},
    )


def _post_signed_document(
    connection,
    *,
    company_id,
    supplier_id,
    project_id,
    code_id,
    document_id,
    document_type: str,
    reference: str | None,
    net: Decimal,
    link: str | None,
    link_value,
) -> None:
    tax = (net * Decimal("0.2")).quantize(Decimal("0.0001"))
    gross = net + tax
    connection.execute(
        text(
            "INSERT INTO finance_cost_documents ("
            "id, company_id, counterparty_id, document_type, status, normalized_reference, "
            "service_date, document_date, tax_point_date, currency_code, net_amount, tax_amount, "
            "recoverable_amount, non_recoverable_amount, eligible_amount, gross_amount, "
            "tax_notional_amount, credited_document_id, reverses_document_id, created_at, updated_at"
            ") VALUES ("
            ":id, :company_id, :counterparty_id, :document_type, 'draft', :reference, "
            ":today, :today, :today, 'GBP', :net, :tax, :tax, 0, :net, :gross, 0, "
            ":credited, :reverses, now(), now())"
        ),
        {
            "id": document_id,
            "company_id": company_id,
            "counterparty_id": supplier_id,
            "document_type": document_type,
            "reference": reference,
            "today": date(2026, 10, 8),
            "net": net,
            "tax": tax,
            "gross": gross,
            "credited": link_value if link == "credited" else None,
            "reverses": link_value if link == "reverses" else None,
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
            ":id, :company_id, :document_id, 1, :net, 'standard', :tax, :tax, 0, :net, 0, now(), now())"
        ),
        {
            "id": line_id,
            "company_id": company_id,
            "document_id": document_id,
            "net": net,
            "tax": tax,
        },
    )
    connection.execute(
        text(
            "INSERT INTO finance_cost_allocations ("
            "id, company_id, line_id, allocation_number, project_id, cost_code_id, is_overhead, "
            "amount_net, amount_non_recoverable, amount_eligible, created_at, updated_at"
            ") VALUES (:id, :company_id, :line_id, 1, :project_id, :code_id, false, "
            ":net, 0, :net, now(), now())"
        ),
        {
            "id": uuid.uuid4(),
            "company_id": company_id,
            "line_id": line_id,
            "project_id": project_id,
            "code_id": code_id,
            "net": net,
        },
    )
    connection.execute(
        text("UPDATE finance_cost_documents SET status = 'posted', posted_at = now() WHERE id = :id"),
        {"id": document_id},
    )


def _assert_zero_posted_position(connection, company_id, project_id, code_id) -> None:
    totals = connection.execute(
        text(
            "SELECT COALESCE(SUM(net_amount), 0), COALESCE(SUM(tax_amount), 0), "
            "COALESCE(SUM(recoverable_amount), 0), COALESCE(SUM(non_recoverable_amount), 0), "
            "COALESCE(SUM(eligible_amount), 0), COALESCE(SUM(gross_amount), 0), COUNT(*) "
            "FROM finance_cost_documents WHERE company_id = :company_id AND status = 'posted'"
        ),
        {"company_id": company_id},
    ).one()
    assert [Decimal(value) for value in totals[:6]] == [Decimal("0.0000")] * 6
    assert totals[6] == 4
    allocations = connection.execute(
        text(
            "SELECT COALESCE(SUM(allocation.amount_net), 0), "
            "COALESCE(SUM(allocation.amount_non_recoverable), 0), "
            "COALESCE(SUM(allocation.amount_eligible), 0), "
            "COUNT(*) FILTER ("
            "WHERE allocation.company_id IS DISTINCT FROM document.company_id "
            "OR allocation.project_id IS DISTINCT FROM :project_id "
            "OR allocation.cost_code_id IS DISTINCT FROM :code_id"
            ") "
            "FROM finance_cost_allocations allocation "
            "JOIN finance_cost_lines line ON line.id = allocation.line_id "
            "JOIN finance_cost_documents document ON document.id = line.document_id "
            "WHERE document.company_id = :company_id"
        ),
        {"company_id": company_id, "project_id": project_id, "code_id": code_id},
    ).one()
    assert [Decimal(value) for value in allocations[:3]] == [Decimal("0.0000")] * 3
    assert allocations[3] == 0


def test_cross_company_project_allocation_is_rejected() -> None:
    engine = _engine()
    try:
        with engine.begin() as connection:
            company_a = _new_company(connection)
            company_b = _new_company(connection)
            project_b = uuid.uuid4()
            connection.execute(
                text(
                    "INSERT INTO finance_projects (id, company_id, name, status, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'Other project', 'active', now(), now())"
                ),
                {"id": project_b, "company_id": company_b},
            )
            _expect_database_rejection(
                connection,
                "INSERT INTO finance_budget_versions "
                "(id, company_id, project_id, version_number, status, created_at, updated_at) "
                "VALUES (:id, :company_id, :project_id, 1, 'draft', now(), now())",
                {"id": uuid.uuid4(), "company_id": company_a, "project_id": project_b},
            )
    finally:
        engine.dispose()


def test_repeated_cost_code_lines_and_approved_immutability() -> None:
    engine = _engine()
    try:
        with engine.begin() as connection:
            company_id = _new_company(connection)
            project_id = uuid.uuid4()
            code_id = uuid.uuid4()
            version_id = uuid.uuid4()
            connection.execute(
                text(
                    "INSERT INTO finance_projects (id, company_id, name, status, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'Harbour Walk', 'active', now(), now())"
                ),
                {"id": project_id, "company_id": company_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_codes "
                    "(id, company_id, code, name, is_active, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'CON', 'Concrete', true, now(), now())"
                ),
                {"id": code_id, "company_id": company_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_budget_versions "
                    "(id, company_id, project_id, version_number, status, created_at, updated_at) "
                    "VALUES (:id, :company_id, :project_id, 1, 'draft', now(), now())"
                ),
                {"id": version_id, "company_id": company_id, "project_id": project_id},
            )
            for number, amount in ((1, Decimal("600.0000")), (2, Decimal("400.0000"))):
                connection.execute(
                    text(
                        "INSERT INTO finance_budget_lines "
                        "(id, company_id, version_id, line_number, item_reference, description, "
                        "cost_code_id, amount_net, created_at, updated_at) "
                        "VALUES (:id, :company_id, :version_id, :line_number, :item_reference, "
                        ":description, :cost_code_id, :amount_net, now(), now())"
                    ),
                    {
                        "id": uuid.uuid4(),
                        "company_id": company_id,
                        "version_id": version_id,
                        "line_number": number,
                        "item_reference": f"BW-{number}",
                        "description": None,
                        "cost_code_id": code_id,
                        "amount_net": amount,
                    },
                )
            total = connection.execute(
                text(
                    "SELECT SUM(amount_net) FROM finance_budget_lines "
                    "WHERE version_id = :version_id AND cost_code_id = :cost_code_id"
                ),
                {"version_id": version_id, "cost_code_id": code_id},
            ).scalar_one()
            assert Decimal(total) == Decimal("1000.0000")
            connection.execute(
                text("UPDATE finance_budget_versions SET status = 'approved', approved_at = now() WHERE id = :id"),
                {"id": version_id},
            )
            _expect_database_rejection(
                connection,
                "UPDATE finance_budget_lines SET amount_net = 1 WHERE version_id = :version_id",
                {"version_id": version_id},
            )
    finally:
        engine.dispose()


def test_incomplete_draft_posts_only_when_balanced() -> None:
    engine = _engine()
    try:
        with pytest.raises(DBAPIError):
            with engine.begin() as connection:
                company_id = _new_company(connection)
                document_id = uuid.uuid4()
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_documents "
                        "(id, company_id, document_type, status, currency_code, created_at, updated_at) "
                        "VALUES (:id, :company_id, 'supplier_invoice', 'draft', 'GBP', now(), now())"
                    ),
                    {"id": document_id, "company_id": company_id},
                )
                stored = connection.execute(
                    text("SELECT counterparty_id, net_amount FROM finance_cost_documents WHERE id = :id"),
                    {"id": document_id},
                ).one()
                assert stored.counterparty_id is None
                assert Decimal(stored.net_amount) == Decimal("0.0000")
                connection.execute(
                    text("UPDATE finance_cost_documents SET status = 'posted' WHERE id = :id"),
                    {"id": document_id},
                )
    finally:
        engine.dispose()


def test_posted_multi_project_vat_allocation_and_child_lock() -> None:
    engine = _engine()
    try:
        with engine.begin() as connection:
            company_id = _new_company(connection)
            project_a = uuid.uuid4()
            project_b = uuid.uuid4()
            code_id = uuid.uuid4()
            supplier_id = uuid.uuid4()
            document_id = uuid.uuid4()
            line_id = uuid.uuid4()
            for project_id, name in ((project_a, "Harbour Walk"), (project_b, "Mill Lane")):
                connection.execute(
                    text(
                        "INSERT INTO finance_projects (id, company_id, name, status, created_at, updated_at) "
                        "VALUES (:id, :company_id, :name, 'active', now(), now())"
                    ),
                    {"id": project_id, "company_id": company_id, "name": name},
                )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_codes "
                    "(id, company_id, code, name, is_active, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'MAT', 'Materials', true, now(), now())"
                ),
                {"id": code_id, "company_id": company_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_counterparties "
                    "(id, company_id, counterparty_type, name, normalized_name, is_active, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'supplier', 'Fictional Aggregates Ltd', "
                    "'FICTIONAL AGGREGATES LTD', true, now(), now())"
                ),
                {"id": supplier_id, "company_id": company_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_documents ("
                    "id, company_id, counterparty_id, document_type, status, external_reference, "
                    "normalized_reference, service_date, document_date, tax_point_date, currency_code, "
                    "net_amount, tax_amount, recoverable_amount, non_recoverable_amount, eligible_amount, "
                    "gross_amount, tax_notional_amount, created_at, updated_at"
                    ") VALUES ("
                    ":id, :company_id, :counterparty_id, 'supplier_invoice', 'draft', 'FA-1001', 'FA-1001', "
                    ":today, :today, :today, 'GBP', 1000, 200, 150, 50, 1050, 1200, 0, now(), now())"
                ),
                {
                    "id": document_id,
                    "company_id": company_id,
                    "counterparty_id": supplier_id,
                    "today": date(2026, 10, 8),
                },
            )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_lines ("
                    "id, company_id, document_id, line_number, description, net_amount, tax_treatment, "
                    "tax_amount, recoverable_amount, non_recoverable_amount, eligible_amount, "
                    "tax_notional_amount, created_at, updated_at"
                    ") VALUES ("
                    ":id, :company_id, :document_id, 1, 'Aggregates', 1000, 'standard', "
                    "200, 150, 50, 1050, 0, now(), now())"
                ),
                {"id": line_id, "company_id": company_id, "document_id": document_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_allocations ("
                    "id, company_id, line_id, allocation_number, project_id, cost_code_id, is_overhead, "
                    "amount_net, amount_non_recoverable, amount_eligible, created_at, updated_at"
                    ") VALUES "
                    "(:a, :company_id, :line_id, 1, :project_a, :code_id, false, 600, 30, 630, now(), now()), "
                    "(:b, :company_id, :line_id, 2, :project_b, :code_id, false, 400, 20, 420, now(), now())"
                ),
                {
                    "a": uuid.uuid4(),
                    "b": uuid.uuid4(),
                    "company_id": company_id,
                    "line_id": line_id,
                    "project_a": project_a,
                    "project_b": project_b,
                    "code_id": code_id,
                },
            )
            connection.execute(
                text("UPDATE finance_cost_documents SET status = 'posted', posted_at = now() WHERE id = :id"),
                {"id": document_id},
            )
            _expect_database_rejection(
                connection,
                "INSERT INTO finance_cost_lines ("
                "id, company_id, document_id, line_number, net_amount, tax_amount, "
                "recoverable_amount, non_recoverable_amount, eligible_amount, tax_notional_amount, "
                "created_at, updated_at"
                ") VALUES (:id, :company_id, :document_id, 2, 0, 0, 0, 0, 0, 0, now(), now())",
                {"id": uuid.uuid4(), "company_id": company_id, "document_id": document_id},
            )
    finally:
        engine.dispose()


def test_duplicate_posted_invoice_reference_and_signed_reversals() -> None:
    engine = _engine()
    try:
        with engine.begin() as connection:
            company_id = _new_company(connection)
            project_id = uuid.uuid4()
            code_id = uuid.uuid4()
            supplier_id = uuid.uuid4()
            connection.execute(
                text(
                    "INSERT INTO finance_projects (id, company_id, name, status, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'Harbour Walk', 'active', now(), now())"
                ),
                {"id": project_id, "company_id": company_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_codes "
                    "(id, company_id, code, name, is_active, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'MAT', 'Materials', true, now(), now())"
                ),
                {"id": code_id, "company_id": company_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_counterparties "
                    "(id, company_id, counterparty_type, name, normalized_name, is_active, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'supplier', 'Fictional Aggregates Ltd', "
                    "'FICTIONAL AGGREGATES LTD', true, now(), now())"
                ),
                {"id": supplier_id, "company_id": company_id},
            )

            def post_simple(connection, document_id: uuid.UUID, document_type: str, reference: str | None, net: Decimal, link: str | None, link_value):
                tax = (net * Decimal("0.2")).quantize(Decimal("0.0001"))
                recoverable = tax
                gross = net + tax
                eligible = net
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_documents ("
                        "id, company_id, counterparty_id, document_type, status, normalized_reference, "
                        "service_date, document_date, tax_point_date, currency_code, net_amount, tax_amount, "
                        "recoverable_amount, non_recoverable_amount, eligible_amount, gross_amount, "
                        "tax_notional_amount, credited_document_id, reverses_document_id, created_at, updated_at"
                        ") VALUES ("
                        ":id, :company_id, :counterparty_id, :document_type, 'draft', :reference, "
                        ":today, :today, :today, 'GBP', :net, :tax, :recoverable, 0, :eligible, :gross, 0, "
                        ":credited, :reverses, now(), now())"
                    ),
                    {
                        "id": document_id,
                        "company_id": company_id,
                        "counterparty_id": supplier_id,
                        "document_type": document_type,
                        "reference": reference,
                        "today": date(2026, 10, 8),
                        "net": net,
                        "tax": tax,
                        "recoverable": recoverable,
                        "eligible": eligible,
                        "gross": gross,
                        "credited": link_value if link == "credited" else None,
                        "reverses": link_value if link == "reverses" else None,
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
                        ":id, :company_id, :document_id, 1, :net, 'standard', :tax, :recoverable, 0, :eligible, "
                        "0, now(), now())"
                    ),
                    {
                        "id": line_id,
                        "company_id": company_id,
                        "document_id": document_id,
                        "net": net,
                        "tax": tax,
                        "recoverable": recoverable,
                        "eligible": eligible,
                    },
                )
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_allocations ("
                        "id, company_id, line_id, allocation_number, project_id, cost_code_id, is_overhead, "
                        "amount_net, amount_non_recoverable, amount_eligible, created_at, updated_at"
                        ") VALUES (:id, :company_id, :line_id, 1, :project_id, :code_id, false, "
                        ":net, 0, :eligible, now(), now())"
                    ),
                    {
                        "id": uuid.uuid4(),
                        "company_id": company_id,
                        "line_id": line_id,
                        "project_id": project_id,
                        "code_id": code_id,
                        "net": net,
                        "eligible": eligible,
                    },
                )
                connection.execute(
                    text("UPDATE finance_cost_documents SET status = 'posted', posted_at = now() WHERE id = :id"),
                    {"id": document_id},
                )

            invoice_id = uuid.uuid4()
            post_simple(connection, invoice_id, "supplier_invoice", "FA-1001", Decimal("100.0000"), None, None)
        with pytest.raises(DBAPIError, match="uq_finance_posted_supplier_invoice_ref"):
            with engine.begin() as connection:
                post_simple(connection, uuid.uuid4(), "supplier_invoice", "FA-1001", Decimal("100.0000"), None, None)
        with engine.begin() as connection:
            credit_id = uuid.uuid4()
            credit_reversal_id = uuid.uuid4()
            invoice_reversal_id = uuid.uuid4()
            post_simple(
                connection, credit_id, "supplier_credit", "FA-1001", Decimal("-100.0000"), "credited", invoice_id
            )
            post_simple(
                connection, credit_reversal_id, "reversal", None, Decimal("100.0000"), "reverses", credit_id
            )
            post_simple(
                connection, invoice_reversal_id, "reversal", None, Decimal("-100.0000"), "reverses", invoice_id
            )
        with engine.begin() as connection:
            _assert_zero_posted_position(connection, company_id, project_id, code_id)
            stored_invoice = connection.execute(
                text(
                    "SELECT status, net_amount, tax_amount, gross_amount FROM finance_cost_documents WHERE id = :id"
                ),
                {"id": invoice_id},
            ).one()
            assert stored_invoice.status == "posted"
            assert Decimal(stored_invoice.net_amount) == Decimal("100.0000")
            assert Decimal(stored_invoice.tax_amount) == Decimal("20.0000")
            assert Decimal(stored_invoice.gross_amount) == Decimal("120.0000")
        with pytest.raises(DBAPIError, match="a reversal cannot be reversed"):
            with engine.begin() as connection:
                post_simple(
                    connection, uuid.uuid4(), "reversal", None, Decimal("100.0000"), "reverses", credit_reversal_id
                )
        with pytest.raises(DBAPIError, match="uq_finance_posted_reversal_source"):
            with engine.begin() as connection:
                post_simple(connection, uuid.uuid4(), "reversal", None, Decimal("-100.0000"), "reverses", invoice_id)
    finally:
        engine.dispose()


def test_credit_and_invoice_reversal_across_transactions() -> None:
    engine = _engine()
    try:
        with engine.begin() as connection:
            company_id = _new_company(connection)
            project_id = uuid.uuid4()
            code_id = uuid.uuid4()
            supplier_id = uuid.uuid4()
            _insert_finance_parties(connection, company_id, project_id, code_id, supplier_id)

            def post_simple(connection, document_id: uuid.UUID, document_type: str, reference: str | None, net: Decimal, link: str | None, link_value):
                _post_signed_document(
                    connection,
                    company_id=company_id,
                    supplier_id=supplier_id,
                    project_id=project_id,
                    code_id=code_id,
                    document_id=document_id,
                    document_type=document_type,
                    reference=reference,
                    net=net,
                    link=link,
                    link_value=link_value,
                )

            invoice_id = uuid.uuid4()
            post_simple(connection, invoice_id, "supplier_invoice", "FA-SEP-100", Decimal("100.0000"), None, None)
        with engine.begin() as connection:
            credit_id = uuid.uuid4()
            post_simple(
                connection, credit_id, "supplier_credit", "FA-SEP-100", Decimal("-100.0000"), "credited", invoice_id
            )
        with engine.begin() as connection:
            post_simple(connection, uuid.uuid4(), "reversal", None, Decimal("100.0000"), "reverses", credit_id)
        with engine.begin() as connection:
            post_simple(connection, uuid.uuid4(), "reversal", None, Decimal("-100.0000"), "reverses", invoice_id)
        with engine.begin() as connection:
            _assert_zero_posted_position(connection, company_id, project_id, code_id)
        with pytest.raises(DBAPIError, match="cannot credit a reversed document"):
            with engine.begin() as connection:
                post_simple(
                    connection,
                    uuid.uuid4(),
                    "supplier_credit",
                    "FA-SEP-AFTER",
                    Decimal("-100.0000"),
                    "credited",
                    invoice_id,
                )
        with engine.begin() as connection:
            blocked_company_id = _new_company(connection)
            blocked_project_id = uuid.uuid4()
            blocked_code_id = uuid.uuid4()
            blocked_supplier_id = uuid.uuid4()
            _insert_finance_parties(
                connection, blocked_company_id, blocked_project_id, blocked_code_id, blocked_supplier_id
            )
            blocked_invoice_id = uuid.uuid4()
            blocked_credit_id = uuid.uuid4()
            _post_signed_document(
                connection,
                company_id=blocked_company_id,
                supplier_id=blocked_supplier_id,
                project_id=blocked_project_id,
                code_id=blocked_code_id,
                document_id=blocked_invoice_id,
                document_type="supplier_invoice",
                reference="FA-OPEN-CREDIT",
                net=Decimal("100.0000"),
                link=None,
                link_value=None,
            )
            _post_signed_document(
                connection,
                company_id=blocked_company_id,
                supplier_id=blocked_supplier_id,
                project_id=blocked_project_id,
                code_id=blocked_code_id,
                document_id=blocked_credit_id,
                document_type="supplier_credit",
                reference="FA-OPEN-CREDIT",
                net=Decimal("-100.0000"),
                link="credited",
                link_value=blocked_invoice_id,
            )
        with pytest.raises(DBAPIError, match="cannot reverse a document that has posted credits"):
            with engine.begin() as connection:
                _post_signed_document(
                    connection,
                    company_id=blocked_company_id,
                    supplier_id=blocked_supplier_id,
                    project_id=blocked_project_id,
                    code_id=blocked_code_id,
                    document_id=uuid.uuid4(),
                    document_type="reversal",
                    reference=None,
                    net=Decimal("-100.0000"),
                    link="reverses",
                    link_value=blocked_invoice_id,
                )
        with engine.begin() as connection:
            remaining = connection.execute(
                text(
                    "SELECT id, status, net_amount FROM finance_cost_documents "
                    "WHERE id IN (:invoice_id, :credit_id) ORDER BY net_amount"
                ),
                {"invoice_id": blocked_invoice_id, "credit_id": blocked_credit_id},
            ).all()
            assert [Decimal(row.net_amount) for row in remaining] == [Decimal("-100.0000"), Decimal("100.0000")]
            assert {row.status for row in remaining} == {"posted"}
    finally:
        engine.dispose()


def test_concurrent_duplicate_invoice_reference_allows_one_row() -> None:
    engine = _engine()
    barrier_url = _finance_test_url()
    try:
        with engine.begin() as connection:
            company_id = _new_company(connection)
            project_id = uuid.uuid4()
            code_id = uuid.uuid4()
            supplier_id = uuid.uuid4()
            connection.execute(
                text(
                    "INSERT INTO finance_projects (id, company_id, name, status, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'Harbour Walk', 'active', now(), now())"
                ),
                {"id": project_id, "company_id": company_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_codes "
                    "(id, company_id, code, name, is_active, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'MAT', 'Materials', true, now(), now())"
                ),
                {"id": code_id, "company_id": company_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_counterparties "
                    "(id, company_id, counterparty_type, name, normalized_name, is_active, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'supplier', 'Fictional Aggregates Ltd', "
                    "'FICTIONAL AGGREGATES LTD', true, now(), now())"
                ),
                {"id": supplier_id, "company_id": company_id},
            )
            ids = [uuid.uuid4(), uuid.uuid4()]
            for document_id in ids:
                line_id = uuid.uuid4()
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_documents ("
                        "id, company_id, counterparty_id, document_type, status, normalized_reference, "
                        "service_date, document_date, tax_point_date, currency_code, net_amount, tax_amount, "
                        "recoverable_amount, non_recoverable_amount, eligible_amount, gross_amount, "
                        "tax_notional_amount, created_at, updated_at"
                        ") VALUES ("
                        ":id, :company_id, :supplier_id, 'supplier_invoice', 'draft', 'FA-RACE', "
                        ":today, :today, :today, 'GBP', 10, 2, 2, 0, 10, 12, 0, now(), now())"
                    ),
                    {
                        "id": document_id,
                        "company_id": company_id,
                        "supplier_id": supplier_id,
                        "today": date(2026, 10, 8),
                    },
                )
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_lines ("
                        "id, company_id, document_id, line_number, net_amount, tax_treatment, tax_amount, "
                        "recoverable_amount, non_recoverable_amount, eligible_amount, tax_notional_amount, "
                        "created_at, updated_at"
                        ") VALUES (:id, :company_id, :document_id, 1, 10, 'standard', 2, 2, 0, 10, 0, now(), now())"
                    ),
                    {"id": line_id, "company_id": company_id, "document_id": document_id},
                )
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_allocations ("
                        "id, company_id, line_id, allocation_number, project_id, cost_code_id, is_overhead, "
                        "amount_net, amount_non_recoverable, amount_eligible, created_at, updated_at"
                        ") VALUES (:id, :company_id, :line_id, 1, :project_id, :code_id, false, 10, 0, 10, now(), now())"
                    ),
                    {
                        "id": uuid.uuid4(),
                        "company_id": company_id,
                        "line_id": line_id,
                        "project_id": project_id,
                        "code_id": code_id,
                    },
                )
        errors = []

        def _post(document_id: uuid.UUID) -> None:
            local = create_engine(barrier_url)
            try:
                with local.begin() as connection:
                    connection.execute(
                        text(
                            "UPDATE finance_cost_documents SET status = 'posted', posted_at = now() WHERE id = :id"
                        ),
                        {"id": document_id},
                    )
            except DBAPIError:
                errors.append(document_id)
            finally:
                local.dispose()

        import threading

        threads = [threading.Thread(target=_post, args=(document_id,)) for document_id in ids]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        assert len(errors) == 1
        with engine.connect() as connection:
            posted = connection.execute(
                text(
                    "SELECT COUNT(*) FROM finance_cost_documents "
                    "WHERE normalized_reference = 'FA-RACE' AND status = 'posted'"
                )
            ).scalar_one()
        assert posted == 1
    finally:
        engine.dispose()


def test_migration_registers_finance_tables_when_inspected() -> None:
    """Confirms the revision graph entry is the only Finance head parent link."""
    source = _migration_path().read_text(encoding="utf-8")
    assert 'down_revision: Union[str, Sequence[str], None] = "f8a9b0c1d2e3"' in source
    inspector_tables = {
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
    assert inspector_tables <= set(FinanceProject.metadata.tables)
    assert "finance_budget_versions" in FinanceProject.metadata.tables


def test_posted_lines_and_allocations_cannot_move_between_documents() -> None:
    engine = _engine()
    try:
        with engine.begin() as connection:
            company_id = _new_company(connection)
            project_id = uuid.uuid4()
            code_id = uuid.uuid4()
            supplier_id = uuid.uuid4()
            posted_id = uuid.uuid4()
            draft_id = uuid.uuid4()
            posted_line_id = uuid.uuid4()
            draft_line_id = uuid.uuid4()
            posted_allocation_id = uuid.uuid4()
            draft_allocation_id = uuid.uuid4()
            connection.execute(
                text(
                    "INSERT INTO finance_projects (id, company_id, name, status, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'Harbour Walk', 'active', now(), now())"
                ),
                {"id": project_id, "company_id": company_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_codes "
                    "(id, company_id, code, name, is_active, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'MAT', 'Materials', true, now(), now())"
                ),
                {"id": code_id, "company_id": company_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_counterparties "
                    "(id, company_id, counterparty_type, name, normalized_name, is_active, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'supplier', 'Fictional Aggregates Ltd', "
                    "'FICTIONAL AGGREGATES LTD', true, now(), now())"
                ),
                {"id": supplier_id, "company_id": company_id},
            )
            for document_id, status in ((posted_id, "draft"), (draft_id, "draft")):
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_documents ("
                        "id, company_id, counterparty_id, document_type, status, normalized_reference, "
                        "service_date, document_date, tax_point_date, currency_code, net_amount, tax_amount, "
                        "recoverable_amount, non_recoverable_amount, eligible_amount, gross_amount, "
                        "tax_notional_amount, created_at, updated_at"
                        ") VALUES ("
                        ":id, :company_id, :supplier_id, 'supplier_invoice', 'draft', :reference, "
                        ":today, :today, :today, 'GBP', 100, 0, 0, 0, 100, 100, 0, now(), now())"
                    ),
                    {
                        "id": document_id,
                        "company_id": company_id,
                        "supplier_id": supplier_id,
                        "reference": "FA-POSTED" if document_id == posted_id else "FA-DRAFT",
                        "today": date(2026, 10, 8),
                    },
                )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_lines ("
                    "id, company_id, document_id, line_number, net_amount, tax_treatment, tax_amount, "
                    "recoverable_amount, non_recoverable_amount, eligible_amount, tax_notional_amount, "
                    "created_at, updated_at) VALUES "
                    "(:posted_line, :company_id, :posted_id, 1, 100, 'zero', 0, 0, 0, 100, 0, now(), now()), "
                    "(:draft_line, :company_id, :draft_id, 2, 100, 'zero', 0, 0, 0, 100, 0, now(), now())"
                ),
                {
                    "posted_line": posted_line_id,
                    "draft_line": draft_line_id,
                    "company_id": company_id,
                    "posted_id": posted_id,
                    "draft_id": draft_id,
                },
            )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_allocations ("
                    "id, company_id, line_id, allocation_number, project_id, cost_code_id, is_overhead, "
                    "amount_net, amount_non_recoverable, amount_eligible, created_at, updated_at) VALUES "
                    "(:posted_allocation, :company_id, :posted_line, 1, :project_id, :code_id, false, "
                    "100, 0, 100, now(), now()), "
                    "(:draft_allocation, :company_id, :draft_line, 2, :project_id, :code_id, false, "
                    "100, 0, 100, now(), now())"
                ),
                {
                    "posted_allocation": posted_allocation_id,
                    "draft_allocation": draft_allocation_id,
                    "company_id": company_id,
                    "posted_line": posted_line_id,
                    "draft_line": draft_line_id,
                    "project_id": project_id,
                    "code_id": code_id,
                },
            )
            connection.execute(
                text("UPDATE finance_cost_lines SET document_id = :draft_id WHERE id = :posted_line"),
                {"draft_id": draft_id, "posted_line": posted_line_id},
            )
            moved_line = connection.execute(
                text("SELECT document_id FROM finance_cost_lines WHERE id = :id"),
                {"id": posted_line_id},
            ).scalar_one()
            assert moved_line == draft_id
            connection.execute(
                text("UPDATE finance_cost_lines SET document_id = :posted_id WHERE id = :posted_line"),
                {"posted_id": posted_id, "posted_line": posted_line_id},
            )
            connection.execute(
                text("UPDATE finance_cost_allocations SET line_id = :draft_line WHERE id = :posted_allocation"),
                {"draft_line": draft_line_id, "posted_allocation": posted_allocation_id},
            )
            moved_allocation = connection.execute(
                text("SELECT line_id FROM finance_cost_allocations WHERE id = :id"),
                {"id": posted_allocation_id},
            ).scalar_one()
            assert moved_allocation == draft_line_id
            connection.execute(
                text("UPDATE finance_cost_allocations SET line_id = :posted_line WHERE id = :posted_allocation"),
                {"posted_line": posted_line_id, "posted_allocation": posted_allocation_id},
            )
            connection.execute(
                text("UPDATE finance_cost_documents SET status = 'posted', posted_at = now() WHERE id = :id"),
                {"id": posted_id},
            )
            _expect_database_rejection(
                connection,
                "UPDATE finance_cost_lines SET document_id = :draft_id WHERE id = :posted_line",
                {"draft_id": draft_id, "posted_line": posted_line_id},
                "posted finance document children are immutable",
            )
            _expect_database_rejection(
                connection,
                "UPDATE finance_cost_lines SET document_id = :posted_id WHERE id = :draft_line",
                {"posted_id": posted_id, "draft_line": draft_line_id},
                "posted finance document children are immutable",
            )
            _expect_database_rejection(
                connection,
                "UPDATE finance_cost_allocations SET line_id = :draft_line WHERE id = :posted_allocation",
                {"draft_line": draft_line_id, "posted_allocation": posted_allocation_id},
                "posted finance document children are immutable",
            )
            _expect_database_rejection(
                connection,
                "UPDATE finance_cost_allocations SET line_id = :posted_line WHERE id = :draft_allocation",
                {"posted_line": posted_line_id, "draft_allocation": draft_allocation_id},
                "posted finance document children are immutable",
            )
    finally:
        engine.dispose()


def test_approved_budget_lines_cannot_be_reassigned() -> None:
    engine = _engine()
    try:
        with engine.begin() as connection:
            company_id = _new_company(connection)
            project_id = uuid.uuid4()
            code_id = uuid.uuid4()
            approved_id = uuid.uuid4()
            draft_id = uuid.uuid4()
            empty_id = uuid.uuid4()
            approved_line_id = uuid.uuid4()
            draft_line_id = uuid.uuid4()
            connection.execute(
                text(
                    "INSERT INTO finance_projects (id, company_id, name, status, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'Harbour Walk', 'active', now(), now())"
                ),
                {"id": project_id, "company_id": company_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_codes "
                    "(id, company_id, code, name, is_active, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'CON', 'Concrete', true, now(), now())"
                ),
                {"id": code_id, "company_id": company_id},
            )
            _expect_database_rejection(
                connection,
                "INSERT INTO finance_budget_versions "
                "(id, company_id, project_id, version_number, status, created_at, updated_at) "
                "VALUES (:id, :company_id, :project_id, 9, 'approved', now(), now())",
                {"id": uuid.uuid4(), "company_id": company_id, "project_id": project_id},
            )
            for version_id, number in ((approved_id, 1), (draft_id, 2), (empty_id, 3)):
                connection.execute(
                    text(
                        "INSERT INTO finance_budget_versions "
                        "(id, company_id, project_id, version_number, status, created_at, updated_at) "
                        "VALUES (:id, :company_id, :project_id, :number, 'draft', now(), now())"
                    ),
                    {
                        "id": version_id,
                        "company_id": company_id,
                        "project_id": project_id,
                        "number": number,
                    },
                )
            connection.execute(
                text(
                    "INSERT INTO finance_budget_lines "
                    "(id, company_id, version_id, line_number, cost_code_id, amount_net, created_at, updated_at) "
                    "VALUES (:approved_line, :company_id, :approved_id, 1, :code_id, 100, now(), now()), "
                    "(:draft_line, :company_id, :draft_id, 2, :code_id, 50, now(), now())"
                ),
                {
                    "approved_line": approved_line_id,
                    "draft_line": draft_line_id,
                    "company_id": company_id,
                    "approved_id": approved_id,
                    "draft_id": draft_id,
                    "code_id": code_id,
                },
            )
            connection.execute(
                text("UPDATE finance_budget_lines SET version_id = :draft_id WHERE id = :approved_line"),
                {"draft_id": draft_id, "approved_line": approved_line_id},
            )
            moved_budget_line = connection.execute(
                text("SELECT version_id FROM finance_budget_lines WHERE id = :id"),
                {"id": approved_line_id},
            ).scalar_one()
            assert moved_budget_line == draft_id
            connection.execute(
                text("UPDATE finance_budget_lines SET version_id = :approved_id WHERE id = :approved_line"),
                {"approved_id": approved_id, "approved_line": approved_line_id},
            )
            connection.execute(
                text("UPDATE finance_budget_versions SET status = 'approved', approved_at = now() WHERE id = :id"),
                {"id": approved_id},
            )
            _expect_database_rejection(
                connection,
                "UPDATE finance_budget_versions SET status = 'approved', approved_at = now() WHERE id = :id",
                {"id": empty_id},
                "approved budget requires a line",
            )
            _expect_database_rejection(
                connection,
                "UPDATE finance_budget_lines SET version_id = :draft_id WHERE id = :approved_line",
                {"draft_id": draft_id, "approved_line": approved_line_id},
                "approved budget lines are immutable",
            )
            _expect_database_rejection(
                connection,
                "UPDATE finance_budget_lines SET version_id = :approved_id WHERE id = :draft_line",
                {"approved_id": approved_id, "draft_line": draft_line_id},
                "approved budget lines are immutable",
            )
            _expect_database_rejection(
                connection,
                "INSERT INTO finance_budget_lines "
                "(id, company_id, version_id, line_number, cost_code_id, amount_net, created_at, updated_at) "
                "VALUES (:id, :company_id, :approved_id, 2, :code_id, 25, now(), now())",
                {"id": uuid.uuid4(), "company_id": company_id, "approved_id": approved_id, "code_id": code_id},
                "approved budget lines are immutable",
            )
    finally:
        engine.dispose()


def test_offsetting_allocations_fail_and_negative_credits_post() -> None:
    engine = _engine()
    try:
        with pytest.raises(DBAPIError):
            with engine.begin() as connection:
                company_id = _new_company(connection)
                project_id = uuid.uuid4()
                code_id = uuid.uuid4()
                supplier_id = uuid.uuid4()
                document_id = uuid.uuid4()
                line_id = uuid.uuid4()
                connection.execute(
                    text(
                        "INSERT INTO finance_projects (id, company_id, name, status, created_at, updated_at) "
                        "VALUES (:id, :company_id, 'Harbour Walk', 'active', now(), now())"
                    ),
                    {"id": project_id, "company_id": company_id},
                )
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_codes "
                        "(id, company_id, code, name, is_active, created_at, updated_at) "
                        "VALUES (:id, :company_id, 'MAT', 'Materials', true, now(), now())"
                    ),
                    {"id": code_id, "company_id": company_id},
                )
                connection.execute(
                    text(
                        "INSERT INTO finance_counterparties "
                        "(id, company_id, counterparty_type, name, normalized_name, is_active, "
                        "created_at, updated_at) VALUES (:id, :company_id, 'supplier', "
                        "'Fictional Aggregates Ltd', 'FICTIONAL AGGREGATES LTD', true, now(), now())"
                    ),
                    {"id": supplier_id, "company_id": company_id},
                )
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_documents ("
                        "id, company_id, counterparty_id, document_type, status, normalized_reference, "
                        "service_date, document_date, tax_point_date, currency_code, net_amount, tax_amount, "
                        "recoverable_amount, non_recoverable_amount, eligible_amount, gross_amount, "
                        "tax_notional_amount, created_at, updated_at) VALUES ("
                        ":id, :company_id, :supplier_id, 'supplier_invoice', 'draft', 'FA-OFFSET', "
                        ":today, :today, :today, 'GBP', 100, 0, 0, 0, 100, 100, 0, now(), now())"
                    ),
                    {
                        "id": document_id,
                        "company_id": company_id,
                        "supplier_id": supplier_id,
                        "today": date(2026, 10, 8),
                    },
                )
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_lines ("
                        "id, company_id, document_id, line_number, net_amount, tax_treatment, tax_amount, "
                        "recoverable_amount, non_recoverable_amount, eligible_amount, tax_notional_amount, "
                        "created_at, updated_at) VALUES ("
                        ":id, :company_id, :document_id, 1, 100, 'zero', 0, 0, 0, 100, 0, now(), now())"
                    ),
                    {"id": line_id, "company_id": company_id, "document_id": document_id},
                )
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_allocations ("
                        "id, company_id, line_id, allocation_number, project_id, cost_code_id, is_overhead, "
                        "amount_net, amount_non_recoverable, amount_eligible, created_at, updated_at) VALUES "
                        "(:positive, :company_id, :line_id, 1, :project_id, :code_id, false, 1000, 0, 1000, now(), now()), "
                        "(:negative, :company_id, :line_id, 2, :project_id, :code_id, false, -900, 0, -900, now(), now())"
                    ),
                    {
                        "positive": uuid.uuid4(),
                        "negative": uuid.uuid4(),
                        "company_id": company_id,
                        "line_id": line_id,
                        "project_id": project_id,
                        "code_id": code_id,
                    },
                )
                connection.execute(
                    text("UPDATE finance_cost_documents SET status = 'posted', posted_at = now() WHERE id = :id"),
                    {"id": document_id},
                )
        with engine.begin() as connection:
            company_id = _new_company(connection)
            project_id = uuid.uuid4()
            code_id = uuid.uuid4()
            supplier_id = uuid.uuid4()
            invoice_id = uuid.uuid4()
            credit_id = uuid.uuid4()
            connection.execute(
                text(
                    "INSERT INTO finance_projects (id, company_id, name, status, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'Harbour Walk', 'active', now(), now())"
                ),
                {"id": project_id, "company_id": company_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_codes "
                    "(id, company_id, code, name, is_active, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'MAT', 'Materials', true, now(), now())"
                ),
                {"id": code_id, "company_id": company_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_counterparties "
                    "(id, company_id, counterparty_type, name, normalized_name, is_active, "
                    "created_at, updated_at) VALUES (:id, :company_id, 'supplier', "
                    "'Fictional Aggregates Ltd', 'FICTIONAL AGGREGATES LTD', true, now(), now())"
                ),
                {"id": supplier_id, "company_id": company_id},
            )

            def post_document(document_id: uuid.UUID, document_type: str, reference: str, net: Decimal, source_id):
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_documents ("
                        "id, company_id, counterparty_id, document_type, status, normalized_reference, "
                        "service_date, document_date, tax_point_date, currency_code, net_amount, tax_amount, "
                        "recoverable_amount, non_recoverable_amount, eligible_amount, gross_amount, "
                        "tax_notional_amount, credited_document_id, created_at, updated_at) VALUES ("
                        ":id, :company_id, :supplier_id, :document_type, 'draft', :reference, "
                        ":today, :today, :today, 'GBP', :net, 0, 0, 0, :net, :net, 0, :source_id, now(), now())"
                    ),
                    {
                        "id": document_id,
                        "company_id": company_id,
                        "supplier_id": supplier_id,
                        "document_type": document_type,
                        "reference": reference,
                        "today": date(2026, 10, 8),
                        "net": net,
                        "source_id": source_id,
                    },
                )
                line_id = uuid.uuid4()
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_lines ("
                        "id, company_id, document_id, line_number, net_amount, tax_treatment, tax_amount, "
                        "recoverable_amount, non_recoverable_amount, eligible_amount, tax_notional_amount, "
                        "created_at, updated_at) VALUES ("
                        ":id, :company_id, :document_id, 1, :net, 'zero', 0, 0, 0, :net, 0, now(), now())"
                    ),
                    {"id": line_id, "company_id": company_id, "document_id": document_id, "net": net},
                )
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_allocations ("
                        "id, company_id, line_id, allocation_number, project_id, cost_code_id, is_overhead, "
                        "amount_net, amount_non_recoverable, amount_eligible, created_at, updated_at) VALUES ("
                        ":id, :company_id, :line_id, 1, :project_id, :code_id, false, :net, 0, :net, now(), now())"
                    ),
                    {
                        "id": uuid.uuid4(),
                        "company_id": company_id,
                        "line_id": line_id,
                        "project_id": project_id,
                        "code_id": code_id,
                        "net": net,
                    },
                )
                connection.execute(
                    text("UPDATE finance_cost_documents SET status = 'posted', posted_at = now() WHERE id = :id"),
                    {"id": document_id},
                )

            post_document(invoice_id, "supplier_invoice", "FA-CREDIT", Decimal("1000.0000"), None)
            post_document(credit_id, "supplier_credit", "FA-CREDIT-1", Decimal("-400.0000"), invoice_id)
            stored = connection.execute(
                text("SELECT status, eligible_amount FROM finance_cost_documents WHERE id = :id"),
                {"id": credit_id},
            ).one()
            assert stored.status == "posted"
            assert Decimal(stored.eligible_amount) == Decimal("-400.0000")
        with pytest.raises(DBAPIError):
            with engine.begin() as connection:
                company_id = connection.execute(
                    text("SELECT company_id FROM finance_cost_documents WHERE normalized_reference = 'FA-CREDIT'")
                ).scalar_one()
                invoice_id = connection.execute(
                    text("SELECT id FROM finance_cost_documents WHERE normalized_reference = 'FA-CREDIT'")
                ).scalar_one()
                supplier_id = connection.execute(
                    text("SELECT counterparty_id FROM finance_cost_documents WHERE id = :id"),
                    {"id": invoice_id},
                ).scalar_one()
                project_id = connection.execute(text("SELECT id FROM finance_projects LIMIT 1")).scalar_one()
                code_id = connection.execute(text("SELECT id FROM finance_cost_codes LIMIT 1")).scalar_one()
                too_large = uuid.uuid4()
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_documents ("
                        "id, company_id, counterparty_id, document_type, status, normalized_reference, "
                        "service_date, document_date, tax_point_date, currency_code, net_amount, tax_amount, "
                        "recoverable_amount, non_recoverable_amount, eligible_amount, gross_amount, "
                        "tax_notional_amount, credited_document_id, created_at, updated_at) VALUES ("
                        ":id, :company_id, :supplier_id, 'supplier_credit', 'draft', 'FA-CREDIT-TOO-MUCH', "
                        ":today, :today, :today, 'GBP', -700, 0, 0, 0, -700, -700, 0, :invoice_id, now(), now())"
                    ),
                    {
                        "id": too_large,
                        "company_id": company_id,
                        "supplier_id": supplier_id,
                        "today": date(2026, 10, 8),
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
                        ":id, :company_id, :document_id, 1, -700, 'zero', 0, 0, 0, -700, 0, now(), now())"
                    ),
                    {"id": line_id, "company_id": company_id, "document_id": too_large},
                )
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_allocations ("
                        "id, company_id, line_id, allocation_number, project_id, cost_code_id, is_overhead, "
                        "amount_net, amount_non_recoverable, amount_eligible, created_at, updated_at) VALUES ("
                        ":id, :company_id, :line_id, 1, :project_id, :code_id, false, -700, 0, -700, now(), now())"
                    ),
                    {
                        "id": uuid.uuid4(),
                        "company_id": company_id,
                        "line_id": line_id,
                        "project_id": project_id,
                        "code_id": code_id,
                    },
                )
                connection.execute(
                    text("UPDATE finance_cost_documents SET status = 'posted', posted_at = now() WHERE id = :id"),
                    {"id": too_large},
                )
    finally:
        engine.dispose()


def test_posted_document_links_match_document_type() -> None:
    engine = _engine()
    try:
        with engine.begin() as connection:
            company_id = _new_company(connection)
            supplier_id = uuid.uuid4()
            source_id = uuid.uuid4()
            draft_id = uuid.uuid4()
            connection.execute(
                text(
                    "INSERT INTO finance_counterparties "
                    "(id, company_id, counterparty_type, name, normalized_name, is_active, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'supplier', 'Fictional Aggregates Ltd', "
                    "'FICTIONAL AGGREGATES LTD', true, now(), now())"
                ),
                {"id": supplier_id, "company_id": company_id},
            )
            for document_id, reference in ((source_id, "FA-LINK-SRC"), (draft_id, "FA-LINK-DRAFT")):
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_documents ("
                        "id, company_id, counterparty_id, document_type, status, normalized_reference, "
                        "service_date, document_date, tax_point_date, currency_code, net_amount, tax_amount, "
                        "recoverable_amount, non_recoverable_amount, eligible_amount, gross_amount, "
                        "tax_notional_amount, created_at, updated_at) VALUES ("
                        ":id, :company_id, :supplier_id, 'supplier_invoice', 'draft', :reference, "
                        ":today, :today, :today, 'GBP', 100, 0, 0, 0, 100, 100, 0, now(), now())"
                    ),
                    {
                        "id": document_id,
                        "company_id": company_id,
                        "supplier_id": supplier_id,
                        "reference": reference,
                        "today": date(2026, 10, 8),
                    },
                )
            connection.execute(
                text(
                    "UPDATE finance_cost_documents SET credited_document_id = :source_id, "
                    "reverses_document_id = :source_id WHERE id = :draft_id"
                ),
                {"source_id": source_id, "draft_id": draft_id},
            )
            stored = connection.execute(
                text(
                    "SELECT status, credited_document_id, reverses_document_id "
                    "FROM finance_cost_documents WHERE id = :id"
                ),
                {"id": draft_id},
            ).one()
            assert stored.status == "draft"
            assert stored.credited_document_id == source_id
            assert stored.reverses_document_id == source_id
            _expect_database_rejection(
                connection,
                "UPDATE finance_cost_documents SET status = 'posted', posted_at = now() WHERE id = :id",
                {"id": draft_id},
                "ck_finance_cost_documents_posted_links",
            )
            _expect_database_rejection(
                connection,
                "UPDATE finance_cost_documents SET credited_document_id = :source_id, "
                "reverses_document_id = NULL, status = 'posted', posted_at = now() WHERE id = :id",
                {"id": draft_id, "source_id": source_id},
                "ck_finance_cost_documents_posted_links",
            )
            _expect_database_rejection(
                connection,
                "UPDATE finance_cost_documents SET document_type = 'supplier_credit', "
                "net_amount = -100, eligible_amount = -100, gross_amount = -100, "
                "credited_document_id = :source_id, reverses_document_id = :source_id, "
                "status = 'posted', posted_at = now() WHERE id = :id",
                {"id": draft_id, "source_id": source_id},
                "ck_finance_cost_documents_posted_links",
            )
            _expect_database_rejection(
                connection,
                "UPDATE finance_cost_documents SET document_type = 'reversal', "
                "credited_document_id = :source_id, reverses_document_id = :source_id, "
                "status = 'posted', posted_at = now() WHERE id = :id",
                {"id": draft_id, "source_id": source_id},
                "ck_finance_cost_documents_posted_links",
            )
            connection.execute(
                text(
                    "UPDATE finance_cost_documents SET document_type = 'supplier_invoice', "
                    "credited_document_id = NULL, reverses_document_id = NULL, notes = 'still draft' "
                    "WHERE id = :id"
                ),
                {"id": draft_id},
            )
            revised = connection.execute(
                text(
                    "SELECT status, document_type, credited_document_id, reverses_document_id, notes "
                    "FROM finance_cost_documents WHERE id = :id"
                ),
                {"id": draft_id},
            ).one()
            assert revised.status == "draft"
            assert revised.document_type == "supplier_invoice"
            assert revised.credited_document_id is None
            assert revised.reverses_document_id is None
            assert revised.notes == "still draft"
    finally:
        engine.dispose()


def test_supplier_credit_cannot_use_another_projects_allocation() -> None:
    engine = _engine()
    try:
        with engine.begin() as connection:
            company_id = _new_company(connection)
            project_a = uuid.uuid4()
            project_b = uuid.uuid4()
            project_c = uuid.uuid4()
            code_id = uuid.uuid4()
            supplier_id = uuid.uuid4()
            invoice_id = uuid.uuid4()
            line_id = uuid.uuid4()
            for project_id, name in (
                (project_a, "Harbour Walk"),
                (project_b, "Mill Lane"),
                (project_c, "Other Site"),
            ):
                connection.execute(
                    text(
                        "INSERT INTO finance_projects (id, company_id, name, status, created_at, updated_at) "
                        "VALUES (:id, :company_id, :name, 'active', now(), now())"
                    ),
                    {"id": project_id, "company_id": company_id, "name": name},
                )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_codes "
                    "(id, company_id, code, name, is_active, created_at, updated_at) "
                    "VALUES (:id, :company_id, 'MAT', 'Materials', true, now(), now())"
                ),
                {"id": code_id, "company_id": company_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_counterparties "
                    "(id, company_id, counterparty_type, name, normalized_name, is_active, "
                    "created_at, updated_at) VALUES (:id, :company_id, 'supplier', "
                    "'Fictional Aggregates Ltd', 'FICTIONAL AGGREGATES LTD', true, now(), now())"
                ),
                {"id": supplier_id, "company_id": company_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_documents ("
                    "id, company_id, counterparty_id, document_type, status, normalized_reference, "
                    "service_date, document_date, tax_point_date, currency_code, net_amount, tax_amount, "
                    "recoverable_amount, non_recoverable_amount, eligible_amount, gross_amount, "
                    "tax_notional_amount, created_at, updated_at) VALUES ("
                    ":id, :company_id, :supplier_id, 'supplier_invoice', 'draft', 'FA-SPLIT', "
                    ":today, :today, :today, 'GBP', 1000, 0, 0, 0, 1000, 1000, 0, now(), now())"
                ),
                {
                    "id": invoice_id,
                    "company_id": company_id,
                    "supplier_id": supplier_id,
                    "today": date(2026, 10, 8),
                },
            )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_lines ("
                    "id, company_id, document_id, line_number, net_amount, tax_treatment, tax_amount, "
                    "recoverable_amount, non_recoverable_amount, eligible_amount, tax_notional_amount, "
                    "created_at, updated_at) VALUES ("
                    ":id, :company_id, :document_id, 1, 1000, 'zero', 0, 0, 0, 1000, 0, now(), now())"
                ),
                {"id": line_id, "company_id": company_id, "document_id": invoice_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_allocations ("
                    "id, company_id, line_id, allocation_number, project_id, cost_code_id, is_overhead, "
                    "amount_net, amount_non_recoverable, amount_eligible, created_at, updated_at) VALUES "
                    "(:a, :company_id, :line_id, 1, :project_a, :code_id, false, 600, 0, 600, now(), now()), "
                    "(:b, :company_id, :line_id, 2, :project_b, :code_id, false, 400, 0, 400, now(), now())"
                ),
                {
                    "a": uuid.uuid4(),
                    "b": uuid.uuid4(),
                    "company_id": company_id,
                    "line_id": line_id,
                    "project_a": project_a,
                    "project_b": project_b,
                    "code_id": code_id,
                },
            )
            connection.execute(
                text("UPDATE finance_cost_documents SET status = 'posted', posted_at = now() WHERE id = :id"),
                {"id": invoice_id},
            )
            credit_id = uuid.uuid4()
            credit_line_id = uuid.uuid4()
            connection.execute(
                text(
                    "INSERT INTO finance_cost_documents ("
                    "id, company_id, counterparty_id, document_type, status, normalized_reference, "
                    "service_date, document_date, tax_point_date, currency_code, net_amount, tax_amount, "
                    "recoverable_amount, non_recoverable_amount, eligible_amount, gross_amount, "
                    "tax_notional_amount, credited_document_id, created_at, updated_at) VALUES ("
                    ":id, :company_id, :supplier_id, 'supplier_credit', 'draft', 'FA-SPLIT-CREDIT', "
                    ":today, :today, :today, 'GBP', -300, 0, 0, 0, -300, -300, 0, :invoice_id, now(), now())"
                ),
                {
                    "id": credit_id,
                    "company_id": company_id,
                    "supplier_id": supplier_id,
                    "today": date(2026, 10, 8),
                    "invoice_id": invoice_id,
                },
            )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_lines ("
                    "id, company_id, document_id, line_number, net_amount, tax_treatment, tax_amount, "
                    "recoverable_amount, non_recoverable_amount, eligible_amount, tax_notional_amount, "
                    "created_at, updated_at) VALUES ("
                    ":id, :company_id, :document_id, 1, -300, 'zero', 0, 0, 0, -300, 0, now(), now())"
                ),
                {"id": credit_line_id, "company_id": company_id, "document_id": credit_id},
            )
            connection.execute(
                text(
                    "INSERT INTO finance_cost_allocations ("
                    "id, company_id, line_id, allocation_number, project_id, cost_code_id, is_overhead, "
                    "amount_net, amount_non_recoverable, amount_eligible, created_at, updated_at) VALUES ("
                    ":id, :company_id, :line_id, 1, :project_b, :code_id, false, -300, 0, -300, now(), now())"
                ),
                {
                    "id": uuid.uuid4(),
                    "company_id": company_id,
                    "line_id": credit_line_id,
                    "project_b": project_b,
                    "code_id": code_id,
                },
            )
            connection.execute(
                text("UPDATE finance_cost_documents SET status = 'posted', posted_at = now() WHERE id = :id"),
                {"id": credit_id},
            )
        with pytest.raises(DBAPIError, match="supplier credit allocations exceed the source project amounts"):
            with engine.begin() as connection:
                company_id = connection.execute(
                    text("SELECT company_id FROM finance_cost_documents WHERE id = :id"),
                    {"id": invoice_id},
                ).scalar_one()
                supplier_id = connection.execute(
                    text("SELECT counterparty_id FROM finance_cost_documents WHERE id = :id"),
                    {"id": invoice_id},
                ).scalar_one()
                project_c = connection.execute(
                    text("SELECT id FROM finance_projects WHERE name = 'Other Site'")
                ).scalar_one()
                code_id = connection.execute(text("SELECT id FROM finance_cost_codes LIMIT 1")).scalar_one()
                foreign_credit = uuid.uuid4()
                foreign_line = uuid.uuid4()
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_documents ("
                        "id, company_id, counterparty_id, document_type, status, normalized_reference, "
                        "service_date, document_date, tax_point_date, currency_code, net_amount, tax_amount, "
                        "recoverable_amount, non_recoverable_amount, eligible_amount, gross_amount, "
                        "tax_notional_amount, credited_document_id, created_at, updated_at) VALUES ("
                        ":id, :company_id, :supplier_id, 'supplier_credit', 'draft', 'FA-SPLIT-FOREIGN', "
                        ":today, :today, :today, 'GBP', -100, 0, 0, 0, -100, -100, 0, :invoice_id, now(), now())"
                    ),
                    {
                        "id": foreign_credit,
                        "company_id": company_id,
                        "supplier_id": supplier_id,
                        "today": date(2026, 10, 8),
                        "invoice_id": invoice_id,
                    },
                )
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_lines ("
                        "id, company_id, document_id, line_number, net_amount, tax_treatment, tax_amount, "
                        "recoverable_amount, non_recoverable_amount, eligible_amount, tax_notional_amount, "
                        "created_at, updated_at) VALUES ("
                        ":id, :company_id, :document_id, 1, -100, 'zero', 0, 0, 0, -100, 0, now(), now())"
                    ),
                    {"id": foreign_line, "company_id": company_id, "document_id": foreign_credit},
                )
                connection.execute(
                    text(
                        "INSERT INTO finance_cost_allocations ("
                        "id, company_id, line_id, allocation_number, project_id, cost_code_id, is_overhead, "
                        "amount_net, amount_non_recoverable, amount_eligible, created_at, updated_at) VALUES ("
                        ":id, :company_id, :line_id, 1, :project_c, :code_id, false, -100, 0, -100, now(), now())"
                    ),
                    {
                        "id": uuid.uuid4(),
                        "company_id": company_id,
                        "line_id": foreign_line,
                        "project_c": project_c,
                        "code_id": code_id,
                    },
                )
                connection.execute(
                    text("UPDATE finance_cost_documents SET status = 'posted', posted_at = now() WHERE id = :id"),
                    {"id": foreign_credit},
                )
    finally:
        engine.dispose()
