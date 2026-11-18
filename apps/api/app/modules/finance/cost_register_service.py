"""Draft and post operations for the D2 cost register.

The caller supplies the trusted company id. This service does not commit.
Posting runs the deferred database checks inside a savepoint and leaves the
caller's transaction to commit or roll back. Cash settlement is not calculated.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.modules.finance.cost_register_errors import (
    CREDIT_REJECTED,
    DATABASE_REJECTED,
    INVALID_AMOUNT,
    DOCUMENT_NOT_FOUND,
    DUPLICATE_REFERENCE,
    REQUIRED_FIELD,
    DUPLICATE_REVERSAL,
    IMMUTABLE_DOCUMENT,
    REFERENCE_NOT_IN_COMPANY,
    REVERSAL_REJECTED,
    UNPOSTABLE_DOCUMENT_TYPE,
    CostRegisterError,
)
from app.modules.finance.cost_register_rules import (
    CONFIRMED_VAT,
    UNCLASSIFIED_VAT,
    UNPOSTABLE_TYPES,
    AllocationDraft,
    DocumentDraft,
    LineDraft,
    allocation_eligible,
    cost_audit_snapshot,
    line_amounts,
    normalize_reference,
    posting_blockers,
    require_money,
)
from app.modules.finance.cost_register_schemas import (
    CostAllocationInput,
    CostAllocationView,
    CostDocumentView,
    CostDraftInput,
    CostLineInput,
    CostLineView,
    PostingBlockerView,
    PostingResult,
    ValidationView,
)
from app.modules.finance.models import (
    FinanceAuditEvent,
    FinanceCostAllocation,
    FinanceCostCode,
    FinanceCostDocument,
    FinanceCostLine,
    FinanceCounterparty,
    FinanceProject,
)

_SAFE_DATABASE_MESSAGES = {
    "cannot credit a reversed document": (CREDIT_REJECTED, "A credit cannot be posted against a reversed document."),
    "supplier credits exceed the source eligible amount": (
        CREDIT_REJECTED,
        "The credit is larger than the remaining source amount.",
    ),
    "supplier credit allocations exceed the source project amounts": (
        CREDIT_REJECTED,
        "The credit allocations are larger than the remaining project amounts.",
    ),
    "supplier credit source must be a posted document": (
        CREDIT_REJECTED,
        "A supplier credit must name a posted source document.",
    ),
    "supplier credit source must be a posted cost document": (
        CREDIT_REJECTED,
        "A supplier credit must name a posted cost document.",
    ),
    "supplier credit must keep the source company and counterparty": (
        CREDIT_REJECTED,
        "A supplier credit must keep the source company and counterparty.",
    ),
    "a reversal cannot be reversed": (REVERSAL_REJECTED, "A reversal cannot be reversed."),
    "new posted supplier document cannot mix overhead and a project": (
        REQUIRED_FIELD,
        "A new supplier invoice cannot mix a project with company overhead.",
    ),
    "new posted supplier document can belong to one project only": (
        REQUIRED_FIELD,
        "A new supplier invoice can belong to one project only.",
    ),
    "new posted supplier document requires one project or company overhead": (
        REQUIRED_FIELD,
        "Choose at least one Finance project, or mark the document as company overhead.",
    ),
    "cannot reverse a document that has posted credits": (
        REVERSAL_REJECTED,
        "Reverse the effective credits before reversing this document.",
    ),
    "reversal does not negate its source document": (
        REVERSAL_REJECTED,
        "A reversal must negate its source document exactly.",
    ),
    "reversal lines do not negate source lines": (
        REVERSAL_REJECTED,
        "Reversal lines must negate the source lines exactly.",
    ),
    "reversal allocations do not negate source allocations": (
        REVERSAL_REJECTED,
        "Reversal allocations must negate the source allocations exactly.",
    ),
    "reversal source must be a posted document": (
        REVERSAL_REJECTED,
        "A reversal must name a posted source document.",
    ),
    "posted finance document is immutable": (IMMUTABLE_DOCUMENT, "A posted finance document cannot be changed."),
    "posted finance document children are immutable": (
        IMMUTABLE_DOCUMENT,
        "Lines and allocations on a posted document cannot be changed.",
    ),
    "posted finance document cannot be deleted": (IMMUTABLE_DOCUMENT, "A posted finance document cannot be deleted."),
    "unclassified VAT cannot be posted": (
        REQUIRED_FIELD,
        "VAT recoverability must be confirmed before posting. Unknown VAT is not treated as non-recoverable.",
    ),
}


def create_cost_draft(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    payload: CostDraftInput,
) -> CostDocumentView:
    _reject_foreign_references(db_session, company_id, payload)
    document = FinanceCostDocument(
        id=uuid.uuid4(),
        company_id=company_id,
        document_type=payload.document_type,
        status="draft",
        currency_code="GBP",
        tax_notional_amount=Decimal("0"),
        created_by_user_id=actor_user_id,
    )
    db_session.add(document)
    _apply_payload(db_session, document, payload)
    _audit(db_session, document, actor_user_id, "cost_document_draft_saved", "Draft saved.")
    db_session.flush()
    return _view(db_session, document)


def update_cost_draft(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    document_id: uuid.UUID,
    payload: CostDraftInput,
) -> CostDocumentView:
    document = _load_draft(db_session, company_id, document_id)
    _reject_foreign_references(db_session, company_id, payload)
    _apply_payload(db_session, document, payload)
    _audit(db_session, document, actor_user_id, "cost_document_draft_saved", "Draft updated.")
    db_session.flush()
    return _view(db_session, document)


def delete_cost_draft(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    document_id: uuid.UUID,
) -> None:
    document = _load_draft(db_session, company_id, document_id)
    _audit(db_session, document, actor_user_id, "cost_document_draft_deleted", "Draft deleted.")
    for line in _lines_for(db_session, document.id):
        for allocation in _allocations_for(db_session, line.id):
            db_session.delete(allocation)
        db_session.delete(line)
    db_session.delete(document)
    db_session.flush()


def get_cost_document(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    document_id: uuid.UUID,
) -> CostDocumentView:
    document = _load_visible(db_session, company_id, document_id)
    return _view(db_session, document)


def validate_cost_draft(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    document_id: uuid.UUID,
) -> ValidationView:
    document = _load_visible(db_session, company_id, document_id)
    if document.status == "posted":
        return ValidationView(
            ready_to_post=False,
            blockers=[
                PostingBlockerView(
                    code=IMMUTABLE_DOCUMENT,
                    message="A posted finance document cannot be changed.",
                )
            ],
        )
    blockers = _blockers_for(db_session, company_id, document)
    return ValidationView(
        ready_to_post=not blockers,
        blockers=[PostingBlockerView(code=item.code, message=item.message) for item in blockers],
    )


def post_cost_document(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    document_id: uuid.UUID,
) -> PostingResult:
    document = _load_draft(db_session, company_id, document_id)
    if document.document_type in UNPOSTABLE_TYPES:
        raise CostRegisterError(
            UNPOSTABLE_DOCUMENT_TYPE,
            "Direct cash and accrual documents cannot be posted until settlement exists.",
        )
    blockers = _blockers_for(db_session, company_id, document)
    if blockers:
        raise CostRegisterError(blockers[0].code, blockers[0].message)
    _reject_model_references(db_session, company_id, document)
    # Keep status mutation, audit, and constraint flush inside one savepoint so
    # PostgreSQL credit/overcredit/duplicate-reference rejections map to HTTP 400
    # instead of escaping as unhandled IntegrityError during audit autoflush.
    savepoint = db_session.begin_nested()
    try:
        document.status = "posted"
        document.posted_at = datetime.now(timezone.utc)
        document.posted_by_user_id = actor_user_id
        audit = _audit(db_session, document, actor_user_id, "cost_document_posted", "Document posted.")
        db_session.flush()
        db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
        savepoint.commit()
    except DBAPIError as exc:
        savepoint.rollback()
        raise _from_database(exc) from None
    db_session.refresh(document)
    return PostingResult(document=_view(db_session, document), audit_event_id=audit.id)


def create_reversal_draft(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    source_document_id: uuid.UUID,
) -> CostDocumentView:
    source = _load_visible(db_session, company_id, source_document_id)
    if source.status != "posted":
        raise CostRegisterError(REVERSAL_REJECTED, "Only a posted document can be reversed.")
    if source.document_type == "reversal" or source.reverses_document_id is not None:
        raise CostRegisterError(REVERSAL_REJECTED, "A reversal cannot be reversed.")
    payload = CostDraftInput(
        document_type="reversal",
        counterparty_id=source.counterparty_id,
        service_date=source.service_date,
        document_date=source.document_date,
        tax_point_date=source.tax_point_date,
        due_date=source.due_date,
        reverses_document_id=source.id,
        lines=[
            _negated_line(db_session, line)
            for line in _lines_for(db_session, source.id)
        ],
    )
    return create_cost_draft(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        payload=payload,
    )


def _apply_payload(db_session: Session, document: FinanceCostDocument, payload: CostDraftInput) -> None:
    document.document_type = payload.document_type
    document.counterparty_id = payload.counterparty_id
    document.external_reference = _clean_text(payload.external_reference)
    document.normalized_reference = normalize_reference(payload.external_reference)
    document.service_date = payload.service_date
    document.document_date = payload.document_date
    document.tax_point_date = payload.tax_point_date
    document.due_date = payload.due_date
    document.notes = payload.notes
    document.credited_document_id = payload.credited_document_id
    document.reverses_document_id = payload.reverses_document_id
    document.currency_code = "GBP"
    document.tax_notional_amount = Decimal("0")
    _reject_inconsistent_vat_status(payload.lines)
    requested = payload.lines[0].vat_recoverability_status if payload.lines else None
    if requested is not None and not _vat_column_ready(db_session):
        raise CostRegisterError(
            REQUIRED_FIELD,
            "This database cannot store an explicit VAT recoverability status. "
            "The draft was not saved, and unknown VAT was not stored as non-recoverable.",
        )
    _replace_lines(db_session, document, payload.lines)
    _persist_vat_status(db_session, document, payload.lines)


def _reject_inconsistent_vat_status(lines: list[CostLineInput]) -> None:
    statuses = {line.vat_recoverability_status for line in lines}
    if len(statuses) > 1:
        raise CostRegisterError(REQUIRED_FIELD, "Every line on a document must use the same VAT recoverability status.")
    for line in lines:
        status = line.vat_recoverability_status
        if status == "confirmed_non_recoverable" and line.recoverable_amount != 0:
            raise CostRegisterError(
                INVALID_AMOUNT,
                "Confirmed non-recoverable VAT must record recoverable VAT as zero.",
            )
        if status == "confirmed_recoverable" and line.tax_amount != 0 and line.recoverable_amount == 0:
            raise CostRegisterError(
                INVALID_AMOUNT,
                "Confirmed recoverable VAT cannot be zero while VAT is recorded. "
                "Use confirmed non-recoverable, or leave recoverability not determined.",
            )
        if status is not None and status not in CONFIRMED_VAT and status not in UNCLASSIFIED_VAT:
            raise CostRegisterError(REQUIRED_FIELD, "VAT recoverability status is not supported.")


def _vat_column_ready(db_session: Session) -> bool:
    cached = db_session.info.get("finance_vat_status_column")
    if cached is not None:
        return bool(cached)
    ready = bool(
        db_session.scalar(
            text(
                "SELECT EXISTS ("
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = 'finance_cost_lines' "
                "AND column_name = 'vat_recoverability_status'"
                ")"
            )
        )
    )
    db_session.info["finance_vat_status_column"] = ready
    return ready


def _persist_vat_status(db_session: Session, document: FinanceCostDocument, lines: list[CostLineInput]) -> None:
    status = lines[0].vat_recoverability_status if lines else None
    if not _vat_column_ready(db_session) or status is None:
        return
    db_session.flush()
    if status in UNCLASSIFIED_VAT:
        # Status is metadata only. Never rewrite net/tax/recoverable/non-recoverable/
        # eligible amounts here — that would invent recoverability and can violate
        # non_recoverable = tax - recoverable when VAT is present but unclassified.
        # Posting rules still block unclassified VAT.
        db_session.execute(
            text(
                "UPDATE finance_cost_lines SET vat_recoverability_status = :status "
                "WHERE document_id = :document_id"
            ),
            {"status": status, "document_id": document.id},
        )
        db_session.execute(
            text(
                "UPDATE finance_cost_documents SET vat_recoverability_status = :status "
                "WHERE id = :document_id"
            ),
            {"status": status, "document_id": document.id},
        )
    else:
        basis_ready = bool(
            db_session.scalar(
                text(
                    "SELECT EXISTS ("
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = 'finance_cost_lines' "
                    "AND column_name = 'vat_classification_basis'"
                    ")"
                )
            )
        )
        if basis_ready and status in {"confirmed_recoverable", "confirmed_non_recoverable"}:
            db_session.execute(
                text(
                    "UPDATE finance_cost_lines SET vat_recoverability_status = :status, "
                    "vat_classification_basis = 'posting_selection' WHERE document_id = :document_id"
                ),
                {"status": status, "document_id": document.id},
            )
            db_session.execute(
                text(
                    "UPDATE finance_cost_documents SET vat_recoverability_status = :status, "
                    "vat_classification_basis = 'posting_selection' WHERE id = :document_id"
                ),
                {"status": status, "document_id": document.id},
            )
        else:
            db_session.execute(
                text(
                    "UPDATE finance_cost_lines SET vat_recoverability_status = :status "
                    "WHERE document_id = :document_id"
                ),
                {"status": status, "document_id": document.id},
            )
            db_session.execute(
                text(
                    "UPDATE finance_cost_documents SET vat_recoverability_status = :status WHERE id = :document_id"
                ),
                {"status": status, "document_id": document.id},
            )
    db_session.expire_all()


def _line_vat_statuses(db_session: Session, document_id: uuid.UUID) -> dict[uuid.UUID, str | None]:
    if not _vat_column_ready(db_session):
        return {}
    rows = db_session.execute(
        text(
            "SELECT id, vat_recoverability_status FROM finance_cost_lines WHERE document_id = :document_id"
        ),
        {"document_id": document_id},
    )
    return {row.id: row.vat_recoverability_status for row in rows}


def _replace_lines(db_session: Session, document: FinanceCostDocument, lines: list[CostLineInput]) -> None:
    for line in _lines_for(db_session, document.id):
        for allocation in _allocations_for(db_session, line.id):
            db_session.delete(allocation)
        db_session.delete(line)
    db_session.flush()
    totals = {
        "net_amount": Decimal("0"),
        "tax_amount": Decimal("0"),
        "recoverable_amount": Decimal("0"),
        "non_recoverable_amount": Decimal("0"),
        "eligible_amount": Decimal("0"),
        "gross_amount": Decimal("0"),
    }
    seen_lines: set[int] = set()
    for line_input in lines:
        if line_input.line_number in seen_lines:
            raise CostRegisterError(REQUIRED_FIELD, "Line numbers must be unique on a document.")
        seen_lines.add(line_input.line_number)
        amounts = line_amounts(line_input.net_amount, line_input.tax_amount, line_input.recoverable_amount)
        line = FinanceCostLine(
            id=uuid.uuid4(),
            company_id=document.company_id,
            document_id=document.id,
            line_number=line_input.line_number,
            description=_clean_text(line_input.description),
            net_amount=amounts.net_amount,
            tax_treatment=line_input.tax_treatment,
            tax_amount=amounts.tax_amount,
            recoverable_amount=amounts.recoverable_amount,
            non_recoverable_amount=amounts.non_recoverable_amount,
            eligible_amount=amounts.eligible_amount,
            tax_notional_amount=Decimal("0"),
        )
        db_session.add(line)
        # The allocation BEFORE INSERT trigger reads finance_cost_lines. The line
        # must already be visible; one combined flush can insert allocations first.
        db_session.flush()
        _replace_allocations(db_session, line, line_input)
        db_session.flush()
        for key in totals:
            totals[key] += getattr(amounts, key)
    for key, value in totals.items():
        setattr(document, key, require_money(value))


def _replace_allocations(db_session: Session, line: FinanceCostLine, line_input: CostLineInput) -> None:
    seen: set[int] = set()
    for allocation_input in line_input.allocations:
        if allocation_input.allocation_number in seen:
            raise CostRegisterError(REQUIRED_FIELD, "Allocation numbers must be unique on a line.")
        seen.add(allocation_input.allocation_number)
        amount_net = require_money(allocation_input.amount_net)
        amount_non_recoverable = require_money(allocation_input.amount_non_recoverable)
        db_session.add(
            FinanceCostAllocation(
                id=uuid.uuid4(),
                company_id=line.company_id,
                line_id=line.id,
                allocation_number=allocation_input.allocation_number,
                project_id=allocation_input.project_id,
                cost_code_id=allocation_input.cost_code_id,
                is_overhead=allocation_input.is_overhead,
                amount_net=amount_net,
                amount_non_recoverable=amount_non_recoverable,
                amount_eligible=allocation_eligible(amount_net, amount_non_recoverable),
            )
        )


def _reject_foreign_references(db_session: Session, company_id: uuid.UUID, payload: CostDraftInput) -> None:
    if payload.counterparty_id is not None:
        _require_company_row(db_session, FinanceCounterparty, company_id, payload.counterparty_id, "Counterparty")
    if payload.credited_document_id is not None:
        _require_company_row(db_session, FinanceCostDocument, company_id, payload.credited_document_id, "Credited document")
    if payload.reverses_document_id is not None:
        _require_company_row(db_session, FinanceCostDocument, company_id, payload.reverses_document_id, "Reversed document")
    for line in payload.lines:
        for allocation in line.allocations:
            if allocation.project_id is not None:
                _require_company_row(db_session, FinanceProject, company_id, allocation.project_id, "Project")
            if allocation.cost_code_id is not None:
                _require_company_row(db_session, FinanceCostCode, company_id, allocation.cost_code_id, "Cost code")


def _reject_model_references(db_session: Session, company_id: uuid.UUID, document: FinanceCostDocument) -> None:
    payload = CostDraftInput(
        document_type=document.document_type,  # type: ignore[arg-type]
        counterparty_id=document.counterparty_id,
        external_reference=document.external_reference,
        service_date=document.service_date,
        document_date=document.document_date,
        tax_point_date=document.tax_point_date,
        due_date=document.due_date,
        notes=document.notes,
        credited_document_id=document.credited_document_id,
        reverses_document_id=document.reverses_document_id,
        lines=[],
    )
    _reject_foreign_references(db_session, company_id, payload)
    for line in _lines_for(db_session, document.id):
        for allocation in _allocations_for(db_session, line.id):
            if allocation.project_id is not None:
                _require_company_row(db_session, FinanceProject, company_id, allocation.project_id, "Project")
            if allocation.cost_code_id is not None:
                _require_company_row(db_session, FinanceCostCode, company_id, allocation.cost_code_id, "Cost code")


def _require_company_row(db_session: Session, model: type, company_id: uuid.UUID, row_id: uuid.UUID, label: str) -> None:
    found = db_session.scalar(select(model.id).where(model.company_id == company_id, model.id == row_id))
    if found is None:
        raise CostRegisterError(REFERENCE_NOT_IN_COMPANY, f"{label} was not found in this company.")


def _load_visible(db_session: Session, company_id: uuid.UUID, document_id: uuid.UUID) -> FinanceCostDocument:
    document = db_session.scalar(
        select(FinanceCostDocument).where(
            FinanceCostDocument.company_id == company_id,
            FinanceCostDocument.id == document_id,
        )
    )
    if document is None:
        raise CostRegisterError(DOCUMENT_NOT_FOUND, "Finance document was not found.")
    return document


def _load_draft(db_session: Session, company_id: uuid.UUID, document_id: uuid.UUID) -> FinanceCostDocument:
    document = _load_visible(db_session, company_id, document_id)
    if document.status != "draft":
        raise CostRegisterError(IMMUTABLE_DOCUMENT, "A posted finance document cannot be changed.")
    return document


def _lines_for(db_session: Session, document_id: uuid.UUID) -> list[FinanceCostLine]:
    rows = db_session.scalars(select(FinanceCostLine).where(FinanceCostLine.document_id == document_id)).all()
    return sorted(rows, key=lambda line: line.line_number)


def _allocations_for(db_session: Session, line_id: uuid.UUID) -> list[FinanceCostAllocation]:
    rows = db_session.scalars(
        select(FinanceCostAllocation).where(FinanceCostAllocation.line_id == line_id)
    ).all()
    return sorted(rows, key=lambda allocation: allocation.allocation_number)


def _blockers_for(db_session: Session, company_id: uuid.UUID, document: FinanceCostDocument) -> list:
    source_projects = None
    source_overhead_only = False
    if document.document_type == "supplier_credit" and document.credited_document_id is not None:
        source = _load_visible(db_session, company_id, document.credited_document_id)
        source_allocations = [
            allocation
            for line in _lines_for(db_session, source.id)
            for allocation in _allocations_for(db_session, line.id)
        ]
        source_projects = frozenset(
            allocation.project_id for allocation in source_allocations if allocation.project_id is not None
        )
        source_overhead_only = bool(source_allocations) and all(allocation.is_overhead for allocation in source_allocations)
    return posting_blockers(
        _draft_from_model(db_session, document),
        source_projects=source_projects,
        source_overhead_only=source_overhead_only,
    )


def _draft_from_model(db_session: Session, document: FinanceCostDocument) -> DocumentDraft:
    return DocumentDraft(
        document_type=document.document_type,
        counterparty_id=document.counterparty_id,
        normalized_reference=document.normalized_reference,
        service_date=document.service_date,
        document_date=document.document_date,
        tax_point_date=document.tax_point_date,
        credited_document_id=document.credited_document_id,
        reverses_document_id=document.reverses_document_id,
        vat_status_enforced=_vat_column_ready(db_session),
        lines=tuple(
            LineDraft(
                line_number=line.line_number,
                description=line.description,
                net_amount=Decimal(line.net_amount),
                tax_treatment=line.tax_treatment,
                tax_amount=Decimal(line.tax_amount),
                recoverable_amount=Decimal(line.recoverable_amount),
                vat_recoverability_status=_line_vat_statuses(db_session, document.id).get(line.id),
                allocations=tuple(
                    AllocationDraft(
                        allocation_number=allocation.allocation_number,
                        project_id=allocation.project_id,
                        cost_code_id=allocation.cost_code_id,
                        is_overhead=allocation.is_overhead,
                        amount_net=Decimal(allocation.amount_net),
                        amount_non_recoverable=Decimal(allocation.amount_non_recoverable),
                    )
                    for allocation in _allocations_for(db_session, line.id)
                ),
            )
            for line in _lines_for(db_session, document.id)
        ),
    )


def _negated_line(db_session: Session, line: FinanceCostLine) -> CostLineInput:
    return CostLineInput(
        line_number=line.line_number,
        description=line.description,
        net_amount=-Decimal(line.net_amount),
        tax_treatment=line.tax_treatment,  # type: ignore[arg-type]
        tax_amount=-Decimal(line.tax_amount),
        recoverable_amount=-Decimal(line.recoverable_amount),
        allocations=[
            CostAllocationInput(
                allocation_number=allocation.allocation_number,
                project_id=allocation.project_id,
                cost_code_id=allocation.cost_code_id,
                is_overhead=allocation.is_overhead,
                amount_net=-Decimal(allocation.amount_net),
                amount_non_recoverable=-Decimal(allocation.amount_non_recoverable),
            )
            for allocation in _allocations_for(db_session, line.id)
        ],
    )


def _audit(
    db_session: Session,
    document: FinanceCostDocument,
    actor_user_id: uuid.UUID | None,
    action: str,
    reason: str,
) -> FinanceAuditEvent:
    event = FinanceAuditEvent(
        id=uuid.uuid4(),
        company_id=document.company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_cost_document",
        entity_id=document.id,
        action=action,
        reason=reason,
        after_json=cost_audit_snapshot(
            document_type=document.document_type,
            status=document.status,
            external_reference=document.external_reference,
            currency_code=document.currency_code,
            net_amount=Decimal(document.net_amount),
            tax_amount=Decimal(document.tax_amount),
            recoverable_amount=Decimal(document.recoverable_amount),
            non_recoverable_amount=Decimal(document.non_recoverable_amount),
            eligible_amount=Decimal(document.eligible_amount),
            gross_amount=Decimal(document.gross_amount),
            project_ids=sorted(
                {
                    str(allocation.project_id)
                    for line in _lines_for(db_session, document.id)
                    for allocation in _allocations_for(db_session, line.id)
                    if allocation.project_id is not None
                }
            ),
        ),
    )
    db_session.add(event)
    return event


def _view(db_session: Session, document: FinanceCostDocument) -> CostDocumentView:
    statuses = _line_vat_statuses(db_session, document.id)
    document_status = None
    if statuses:
        document_status = next(iter(statuses.values()))
    lines = []
    for line in _lines_for(db_session, document.id):
        allocations = [
            CostAllocationView(
                id=allocation.id,
                allocation_number=allocation.allocation_number,
                project_id=allocation.project_id,
                cost_code_id=allocation.cost_code_id,
                is_overhead=allocation.is_overhead,
                amount_net=Decimal(allocation.amount_net),
                amount_non_recoverable=Decimal(allocation.amount_non_recoverable),
                amount_eligible=Decimal(allocation.amount_eligible),
            )
            for allocation in _allocations_for(db_session, line.id)
        ]
        lines.append(
            CostLineView(
                id=line.id,
                line_number=line.line_number,
                description=line.description,
                net_amount=Decimal(line.net_amount),
                tax_treatment=line.tax_treatment,
                tax_amount=Decimal(line.tax_amount),
                recoverable_amount=Decimal(line.recoverable_amount),
                non_recoverable_amount=Decimal(line.non_recoverable_amount),
                eligible_amount=Decimal(line.eligible_amount),
                vat_recoverability_status=statuses.get(line.id),
                allocations=allocations,
            )
        )
    return CostDocumentView(
        id=document.id,
        company_id=document.company_id,
        document_type=document.document_type,
        status=document.status,
        counterparty_id=document.counterparty_id,
        external_reference=document.external_reference,
        normalized_reference=document.normalized_reference,
        service_date=document.service_date,
        document_date=document.document_date,
        tax_point_date=document.tax_point_date,
        due_date=document.due_date,
        currency_code=document.currency_code,
        net_amount=Decimal(document.net_amount),
        tax_amount=Decimal(document.tax_amount),
        recoverable_amount=Decimal(document.recoverable_amount),
        non_recoverable_amount=Decimal(document.non_recoverable_amount),
        eligible_amount=Decimal(document.eligible_amount),
        gross_amount=Decimal(document.gross_amount),
        vat_recoverability_status=document_status,
        credited_document_id=document.credited_document_id,
        reverses_document_id=document.reverses_document_id,
        notes=document.notes,
        posted_at=document.posted_at,
        lines=lines,
    )


def _from_database(exc: DBAPIError) -> CostRegisterError:
    primary = ""
    constraint = ""
    diagnostic = getattr(getattr(exc, "orig", None), "diag", None)
    if diagnostic is not None:
        primary = str(getattr(diagnostic, "message_primary", "") or "")
        constraint = str(getattr(diagnostic, "constraint_name", "") or "")
    if constraint in {"uq_finance_posted_supplier_invoice_ref", "uq_finance_posted_supplier_credit_ref"}:
        return CostRegisterError(DUPLICATE_REFERENCE, "That posted supplier reference already exists.")
    if constraint == "uq_finance_posted_reversal_source":
        return CostRegisterError(DUPLICATE_REVERSAL, "This document already has a posted reversal.")
    mapped = _SAFE_DATABASE_MESSAGES.get(primary)
    if mapped is not None:
        return CostRegisterError(mapped[0], mapped[1])
    return CostRegisterError(DATABASE_REJECTED, "The finance document was rejected by the cost register rules.")


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.strip().split())
    return cleaned or None
