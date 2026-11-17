"""D3 cost-register rules and, when explicitly enabled, disposable database tests.

Database tests run only when FINANCE_D3_DATABASE_TESTS=yes and the connection is
the approved loopback database. They roll back their transaction.
"""

from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.modules.finance.cost_register_errors import (
    ALLOCATION_MISMATCH,
    INVALID_AMOUNT,
    REQUIRED_FIELD,
    UNPOSTABLE_DOCUMENT_TYPE,
    CostRegisterError,
)
from app.modules.finance.cost_register_rules import (
    AllocationDraft,
    DocumentDraft,
    LineDraft,
    allocation_eligible,
    line_amounts,
    normalize_reference,
    posting_blockers,
    require_money,
)
from app.modules.finance.cost_register_schemas import CostDocumentView, CostDraftInput, CostLineInput

TODAY = date(2026, 10, 8)


def _line(
    net: str,
    tax: str = "0",
    recoverable: str = "0",
    treatment: str | None = "standard",
    allocations: tuple[AllocationDraft, ...] = (),
    line_number: int = 1,
) -> LineDraft:
    return LineDraft(
        line_number,
        "Materials",
        Decimal(net),
        treatment,
        Decimal(tax),
        Decimal(recoverable),
        allocations,
    )


def _allocation(
    net: str,
    non_recoverable: str = "0",
    project_id: uuid.UUID | None = None,
    cost_code_id: uuid.UUID | None = None,
    overhead: bool = False,
    number: int = 1,
) -> AllocationDraft:
    return AllocationDraft(
        number,
        project_id,
        cost_code_id if cost_code_id is not None else uuid.uuid4(),
        overhead,
        Decimal(net),
        Decimal(non_recoverable),
    )


def _document(document_type: str = "supplier_invoice", lines: tuple[LineDraft, ...] = (), **kwargs) -> DocumentDraft:
    values = {
        "document_type": document_type,
        "counterparty_id": uuid.uuid4(),
        "normalized_reference": "FA-1" if document_type in {"supplier_invoice", "supplier_credit"} else None,
        "service_date": TODAY,
        "document_date": TODAY,
        "tax_point_date": TODAY,
        "credited_document_id": uuid.uuid4() if document_type == "supplier_credit" else None,
        "reverses_document_id": uuid.uuid4() if document_type == "reversal" else None,
        "lines": lines,
    }
    values.update(kwargs)
    return DocumentDraft(**values)


def test_line_amounts_use_decimal_storage_scale() -> None:
    amounts = line_amounts(Decimal("100.0000"), Decimal("20.0000"), Decimal("15.0000"))
    assert amounts.non_recoverable_amount == Decimal("5.0000")
    assert amounts.eligible_amount == Decimal("105.0000")
    assert amounts.gross_amount == Decimal("120.0000")
    assert allocation_eligible(Decimal("60.0000"), Decimal("3.0000")) == Decimal("63.0000")
    assert require_money(Decimal("-40.2500")) == Decimal("-40.2500")
    with pytest.raises(CostRegisterError) as exc:
        require_money(Decimal("1.00001"))
    assert exc.value.code == INVALID_AMOUNT


def test_schema_rejects_binary_floats_and_client_company_id() -> None:
    with pytest.raises(ValidationError):
        CostLineInput(line_number=1, net_amount=10.1)
    with pytest.raises(ValidationError):
        CostDraftInput(document_type="supplier_invoice", company_id=uuid.uuid4())
    assert "outstanding" not in CostDocumentView.model_fields
    assert "paid" not in CostDocumentView.model_fields
    assert CostDocumentView.model_fields["cash_settlement"].default == "unavailable"


def test_incomplete_draft_and_missing_dates_are_not_postable() -> None:
    blockers = posting_blockers(
        _document(
            counterparty_id=None,
            normalized_reference=None,
            service_date=None,
            document_date=None,
            tax_point_date=None,
        )
    )
    assert REQUIRED_FIELD in {item.code for item in blockers}
    assert any("tax point" in item.message for item in blockers)


def test_direct_cash_and_accrual_cannot_be_posted() -> None:
    for document_type in ("direct_cash", "accrual"):
        blockers = posting_blockers(_document(document_type, normalized_reference=None))
        assert blockers[0].code == UNPOSTABLE_DOCUMENT_TYPE


def test_repeated_cost_codes_on_one_project_reconcile() -> None:
    project_id = uuid.uuid4()
    line = _line(
        "100",
        "20",
        "20",
        allocations=(
            _allocation("60", "0", project_id, uuid.uuid4(), number=1),
            _allocation("40", "0", project_id, uuid.uuid4(), number=2),
        ),
    )
    assert posting_blockers(_document(lines=(line,))) == []


def test_allocation_shortfall_is_rejected_without_an_automatic_remainder() -> None:
    line = _line("100", allocations=(_allocation("90", project_id=uuid.uuid4()),))
    blockers = posting_blockers(_document(lines=(line,)))
    assert blockers[-1].code == ALLOCATION_MISMATCH
    assert "automatically" in blockers[-1].message


def test_recoverable_vat_must_stay_inside_the_line_tax() -> None:
    line = _line("100", "20", "25", allocations=(_allocation("100", "-5", uuid.uuid4()),))
    blockers = posting_blockers(_document(lines=(line,)))
    assert INVALID_AMOUNT in {item.code for item in blockers}


def test_supplier_credit_lines_must_be_negative() -> None:
    line = _line("100", allocations=(_allocation("100", project_id=uuid.uuid4()),))
    blockers = posting_blockers(_document("supplier_credit", lines=(line,)))
    assert any("positive" in item.message for item in blockers)


def test_reference_is_normalized_without_changing_decimal_amounts() -> None:
    assert normalize_reference("  fa-1001  ") == "FA-1001"
    assert normalize_reference("   ") is None


def _database_tests_enabled() -> bool:
    return os.environ.get("FINANCE_D3_DATABASE_TESTS", "").strip().lower() in {"1", "yes", "true"}


@pytest.mark.skipif(not _database_tests_enabled(), reason="FINANCE_D3_DATABASE_TESTS is not set")
def test_database_cost_register_round_trip() -> None:
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session

    from app.modules.finance.cost_register_schemas import CostAllocationInput
    from app.modules.finance.cost_register_service import (
        create_cost_draft,
        create_reversal_draft,
        delete_cost_draft,
        get_cost_document,
        post_cost_document,
        update_cost_draft,
        validate_cost_draft,
    )
    from app.testing.database_safety import validate_test_database_url

    # Canonical registry: companies and Finance models share Base.metadata.
    import app.db.models  # noqa: F401

    if os.environ.get("TIMIQ_ENV", "").strip().lower() != "test":
        pytest.fail("FINANCE_D3_DATABASE_TESTS requires TIMIQ_ENV=test")
    url = validate_test_database_url(os.environ["TEST_DATABASE_URL"], timiq_env="test")
    engine = create_engine(url)
    try:
        with engine.connect() as probe:
            row = probe.execute(
                text(
                    "SELECT current_database(), inet_server_port(), current_setting('server_version'), "
                    "current_setting('data_directory')"
                )
            ).one()
        if row[0] != "timiq_test_finance_d2" or row[1] != 5433 or not str(row[2]).startswith("16"):
            pytest.fail("Refusing database tests because the server identity does not match")
        if os.path.normcase(os.path.normpath(row[3])) != os.path.normcase(os.path.normpath(r"D:\PostgreSQLData\16")):
            pytest.fail("Refusing database tests because the data directory does not match")

        with engine.connect() as connection:
            transaction = connection.begin()
            session = Session(bind=connection, autoflush=False, join_transaction_mode="create_savepoint")
            try:
                _run_database_scenario(
                    session,
                    text,
                    CostAllocationInput,
                    create_cost_draft,
                    create_reversal_draft,
                    delete_cost_draft,
                    get_cost_document,
                    post_cost_document,
                    update_cost_draft,
                    validate_cost_draft,
                )
            finally:
                session.close()
                transaction.rollback()
    finally:
        engine.dispose()


def _run_database_scenario(session, text, allocation_input, create_cost_draft, create_reversal_draft, delete_cost_draft, get_cost_document, post_cost_document, update_cost_draft, validate_cost_draft) -> None:
    company_id = uuid.uuid4()
    other_company_id = uuid.uuid4()
    actor_id = uuid.uuid4()
    supplier_id = uuid.uuid4()
    other_supplier_id = uuid.uuid4()
    project_a = uuid.uuid4()
    project_b = uuid.uuid4()
    code_a = uuid.uuid4()
    code_b = uuid.uuid4()
    session.execute(
        text(
            "INSERT INTO companies (id, name, is_active, created_at, updated_at) "
            "VALUES (:id, :name, true, now(), now()), (:other, :other_name, true, now(), now())"
        ),
        {
            "id": company_id,
            "name": f"Finance D3 {company_id.hex[:8]}",
            "other": other_company_id,
            "other_name": f"Finance D3 Other {other_company_id.hex[:8]}",
        },
    )
    session.execute(
        text(
            "INSERT INTO finance_counterparties "
            "(id, company_id, counterparty_type, name, normalized_name, is_active, created_at, updated_at) "
            "VALUES (:id, :company_id, 'supplier', 'Fictional Aggregates Ltd', "
            "'FICTIONAL AGGREGATES LTD', true, now(), now()), "
            "(:other_id, :other_company, 'supplier', 'Other Supplier', 'OTHER SUPPLIER', true, now(), now())"
        ),
        {
            "id": supplier_id,
            "company_id": company_id,
            "other_id": other_supplier_id,
            "other_company": other_company_id,
        },
    )
    session.execute(
        text(
            "INSERT INTO finance_projects (id, company_id, name, status, created_at, updated_at) "
            "VALUES (:a, :company_id, 'Harbour Walk', 'active', now(), now()), "
            "(:b, :company_id, 'Mill Lane', 'active', now(), now())"
        ),
        {"a": project_a, "b": project_b, "company_id": company_id},
    )
    session.execute(
        text(
            "INSERT INTO finance_cost_codes (id, company_id, code, name, is_active, created_at, updated_at) "
            "VALUES (:a, :company_id, 'MAT', 'Materials', true, now(), now()), "
            "(:b, :company_id, 'LAB', 'Labour', true, now(), now())"
        ),
        {"a": code_a, "b": code_b, "company_id": company_id},
    )
    payroll_before = session.execute(text("SELECT count(*) FROM payroll_items")).scalar_one()
    shifts_before = session.execute(text("SELECT count(*) FROM time_shifts")).scalar_one()

    incomplete = create_cost_draft(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        payload=CostDraftInput(document_type="supplier_invoice", notes="Incomplete"),
    )
    assert incomplete.status == "draft"
    assert validate_cost_draft(session, company_id=company_id, document_id=incomplete.id).ready_to_post is False
    with pytest.raises(CostRegisterError):
        post_cost_document(session, company_id=company_id, actor_user_id=actor_id, document_id=incomplete.id)
    delete_cost_draft(session, company_id=company_id, actor_user_id=actor_id, document_id=incomplete.id)
    with pytest.raises(CostRegisterError):
        get_cost_document(session, company_id=company_id, document_id=incomplete.id)

    draft_input = _invoice_input(supplier_id, project_a, project_b, code_a, code_b, allocation_input, "FA-D3-100")
    created = create_cost_draft(session, company_id=company_id, actor_user_id=actor_id, payload=draft_input)
    edited = update_cost_draft(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        document_id=created.id,
        payload=draft_input,
    )
    assert edited.normalized_reference == "FA-D3-100"
    assert edited.eligible_amount == Decimal("105.0000")
    assert edited.gross_amount == Decimal("120.0000")
    assert edited.non_recoverable_amount == Decimal("5.0000")
    assert edited.cash_settlement == "unavailable"
    with pytest.raises(CostRegisterError):
        create_cost_draft(
            session,
            company_id=company_id,
            actor_user_id=actor_id,
            payload=draft_input.model_copy(update={"counterparty_id": other_supplier_id}),
        )
    posted = post_cost_document(session, company_id=company_id, actor_user_id=actor_id, document_id=created.id)
    assert posted.document.status == "posted"
    with pytest.raises(CostRegisterError):
        update_cost_draft(
            session,
            company_id=company_id,
            actor_user_id=actor_id,
            document_id=created.id,
            payload=draft_input,
        )
    with pytest.raises(CostRegisterError):
        get_cost_document(session, company_id=other_company_id, document_id=created.id)
    duplicate = create_cost_draft(session, company_id=company_id, actor_user_id=actor_id, payload=draft_input)
    with pytest.raises(CostRegisterError) as duplicate_error:
        post_cost_document(session, company_id=company_id, actor_user_id=actor_id, document_id=duplicate.id)
    assert duplicate_error.value.code == "DUPLICATE_REFERENCE"
    assert get_cost_document(session, company_id=company_id, document_id=duplicate.id).status == "draft"

    partial = create_cost_draft(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        payload=_credit_input(supplier_id, created.id, project_a, code_a, allocation_input, "-40", "-8", "-6", "-2"),
    )
    partial_posted = post_cost_document(
        session, company_id=company_id, actor_user_id=actor_id, document_id=partial.id
    )
    assert partial_posted.document.eligible_amount == Decimal("-42.0000")
    too_large = create_cost_draft(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        payload=_credit_input(supplier_id, created.id, project_a, code_a, allocation_input, "-90", "-18", "-12", "-6"),
    )
    with pytest.raises(CostRegisterError) as credit_error:
        post_cost_document(session, company_id=company_id, actor_user_id=actor_id, document_id=too_large.id)
    assert credit_error.value.code == "CREDIT_REJECTED"

    credit_reversal = create_reversal_draft(
        session, company_id=company_id, actor_user_id=actor_id, source_document_id=partial.id
    )
    post_cost_document(session, company_id=company_id, actor_user_id=actor_id, document_id=credit_reversal.id)
    invoice_reversal = create_reversal_draft(
        session, company_id=company_id, actor_user_id=actor_id, source_document_id=created.id
    )
    post_cost_document(session, company_id=company_id, actor_user_id=actor_id, document_id=invoice_reversal.id)
    with pytest.raises(CostRegisterError):
        create_reversal_draft(
            session, company_id=company_id, actor_user_id=actor_id, source_document_id=invoice_reversal.id
        )
    second = create_reversal_draft(
        session, company_id=company_id, actor_user_id=actor_id, source_document_id=created.id
    )
    with pytest.raises(CostRegisterError) as second_error:
        post_cost_document(session, company_id=company_id, actor_user_id=actor_id, document_id=second.id)
    assert second_error.value.code == "DUPLICATE_REVERSAL"

    for document_type in ("direct_cash", "accrual"):
        blocked = create_cost_draft(
            session,
            company_id=company_id,
            actor_user_id=actor_id,
            payload=CostDraftInput(document_type=document_type, counterparty_id=supplier_id),
        )
        with pytest.raises(CostRegisterError) as blocked_error:
            post_cost_document(session, company_id=company_id, actor_user_id=actor_id, document_id=blocked.id)
        assert blocked_error.value.code == "UNPOSTABLE_DOCUMENT_TYPE"

    assert session.execute(text("SELECT count(*) FROM payroll_items")).scalar_one() == payroll_before
    assert session.execute(text("SELECT count(*) FROM time_shifts")).scalar_one() == shifts_before


def _invoice_input(supplier_id, project_a, project_b, code_a, code_b, allocation_input, reference: str) -> CostDraftInput:
    return CostDraftInput(
        document_type="supplier_invoice",
        counterparty_id=supplier_id,
        external_reference=reference,
        service_date=TODAY,
        document_date=TODAY,
        tax_point_date=TODAY,
        due_date=TODAY,
        lines=[
            CostLineInput(
                line_number=1,
                description="Aggregates",
                net_amount=Decimal("100.0000"),
                tax_treatment="standard",
                tax_amount=Decimal("20.0000"),
                recoverable_amount=Decimal("15.0000"),
                allocations=[
                    allocation_input(
                        allocation_number=1,
                        project_id=project_a,
                        cost_code_id=code_a,
                        amount_net=Decimal("60.0000"),
                        amount_non_recoverable=Decimal("3.0000"),
                    ),
                    allocation_input(
                        allocation_number=2,
                        project_id=project_b,
                        cost_code_id=code_b,
                        amount_net=Decimal("40.0000"),
                        amount_non_recoverable=Decimal("2.0000"),
                    ),
                ],
            )
        ],
    )


def _credit_input(supplier_id, invoice_id, project_id, code_id, allocation_input, net, tax, recoverable, non_recoverable) -> CostDraftInput:
    return CostDraftInput(
        document_type="supplier_credit",
        counterparty_id=supplier_id,
        external_reference=f"CR-{net}",
        service_date=TODAY,
        document_date=TODAY,
        tax_point_date=TODAY,
        credited_document_id=invoice_id,
        lines=[
            CostLineInput(
                line_number=1,
                description="Credit",
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
                        amount_non_recoverable=Decimal(non_recoverable),
                    )
                ],
            )
        ],
    )
