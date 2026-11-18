"""Authenticated Finance API. Company scope is resolved on the server."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.company_scope import CompanyScopeError, resolve_operational_company_id
from app.db.session import get_db_session
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import SystemRole, User
from app.modules.finance.access import (
    PREVIEW_READONLY,
    SCOPED_WRITE_OPERATIONS,
    assert_finance_access,
    assert_finance_company_access,
    assert_finance_write,
    assert_projects_write_allowed,
    effective_finance_readonly,
    finance_module_enabled,
    finance_preview_readonly,
    finance_user_authorized,
    finance_write_allowed,
)
from app.modules.finance.cost_register_schemas import CostDraftInput
from app.modules.finance.cost_register_service import (
    create_cost_draft,
    get_cost_document,
    post_cost_document,
)
from app.modules.finance.cost_register_errors import CostRegisterError
from app.modules.finance.ledger_service import (
    FinanceLedgerError,
    allocate_worker_payment,
    create_customer_invoice,
    create_worker_payment,
    dashboard_totals,
    import_cis_snapshot,
    import_paye_snapshot,
    list_cis_obligations,
)
from app.modules.finance.supplier_payment_errors import SupplierPaymentError
from app.modules.finance.supplier_payment_schemas import AllocationBatchInput, SupplierPaymentDraftInput
from app.modules.finance.supplier_payment_service import (
    allocate_supplier_payment,
    create_supplier_payment_draft,
    get_supplier_payment,
    post_supplier_payment,
)

# Soft-path prefixes: may continue under FINANCE_PREVIEW_MODE=readonly only after
# assert_finance_write / assert_projects_write_allowed succeeds in the endpoint.
_SCOPED_WRITE_PATH_PREFIXES = (
    "/api/finance/cis/import",
    "/api/finance/paye/import",
    "/api/finance/worker-payments",
    "/api/finance/customer-invoices",
    "/api/finance/cost-documents",
    "/api/finance/supplier-payments",
)


def reject_preview_mutation(request: Request) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    if not finance_preview_readonly():
        return
    path = request.url.path.rstrip("/") or "/"
    if any(path == prefix or path.startswith(f"{prefix}/") for prefix in _SCOPED_WRITE_PATH_PREFIXES):
        return
    raise HTTPException(status_code=403, detail=PREVIEW_READONLY)


router = APIRouter(prefix="/api/finance", tags=["finance"], dependencies=[Depends(reject_preview_mutation)])


class WorkerPaymentBody(BaseModel):
    source_user_id: uuid.UUID
    amount: Decimal
    payment_date: date
    payment_method: str | None = None
    external_reference: str | None = None
    notes: str | None = None


class WorkerAllocationBody(BaseModel):
    cis_snapshot_id: uuid.UUID | None = None
    paye_snapshot_id: uuid.UUID | None = None
    amount: Decimal


class WorkerAllocationBatchBody(BaseModel):
    allocations: list[WorkerAllocationBody] = Field(min_length=1)


class CustomerLineBody(BaseModel):
    description: str | None = None
    taxable: bool = True
    net_amount: Decimal
    tax_amount: Decimal


class CustomerInvoiceBody(BaseModel):
    counterparty_id: uuid.UUID
    project_id: uuid.UUID | None = None
    document_kind: str = "invoice"
    external_reference: str | None = None
    document_date: date | None = None
    due_date: date | None = None
    lines: list[CustomerLineBody] = Field(min_length=1)
    credits_invoice_id: uuid.UUID | None = None
    reverses_invoice_id: uuid.UUID | None = None


def _company(db_session: Session, actor: User, company_id: uuid.UUID | None) -> uuid.UUID:
    assert_finance_access(actor)
    try:
        scoped = resolve_operational_company_id(db_session, actor, company_id)
    except CompanyScopeError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    assert_finance_company_access(scoped)
    return scoped


def _ledger(exc: FinanceLedgerError) -> HTTPException:
    return HTTPException(status_code=400, detail={"code": exc.code, "message": exc.message})


@router.get("/module-status")
def finance_module_status(actor: User = Depends(get_current_user)) -> dict[str, bool]:
    """Always available when authenticated. Does not enable Finance operations.

    ``enabled`` is true only when the module flag is on AND this actor is
    authorized for Finance (pilot allowlist in live-like environments).
    """
    enabled = finance_module_enabled() and finance_user_authorized(actor)
    return {
        "enabled": enabled,
        "readonly": finance_preview_readonly() if enabled else True,
    }


@router.get("/preview-mode")
def finance_preview_mode(
    company_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
) -> dict[str, object]:
    """Effective Finance lock for the current actor and optional company/project.

    ``preview_mode_readonly`` mirrors the global env switch.
    ``write_allowed`` is true only for fail-closed scoped commercial write.
    ``readonly`` is the UI/effective lock for the supplied selection.
    """
    assert_finance_access(actor)
    preview = finance_preview_readonly()
    scoped_company: uuid.UUID | None = None
    if company_id is not None or actor.system_role == SystemRole.ADMIN:
        try:
            scoped_company = resolve_operational_company_id(db_session, actor, company_id)
            assert_finance_company_access(scoped_company)
        except (CompanyScopeError, HTTPException):
            scoped_company = None
    write_allowed = False
    if scoped_company is not None and project_id is not None:
        write_allowed = finance_write_allowed(
            db_session,
            actor=actor,
            company_id=scoped_company,
            project_id=project_id,
            operation="contract_value",
        )
    readonly = effective_finance_readonly(
        db_session if scoped_company is not None else None,
        actor=actor,
        company_id=scoped_company,
        project_id=project_id,
    )
    return {
        "readonly": readonly,
        "preview_mode_readonly": preview,
        "write_allowed": write_allowed,
        "scoped_operations": sorted(SCOPED_WRITE_OPERATIONS) if write_allowed else [],
    }


@router.get("/dashboard")
def finance_dashboard(
    company_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
) -> dict[str, str]:
    scoped = _company(db_session, actor, company_id)
    return dashboard_totals(db_session, company_id=scoped, project_id=project_id)


@router.get("/cis")
def finance_cis_list(
    company_id: uuid.UUID | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
) -> list[dict[str, object]]:
    scoped = _company(db_session, actor, company_id)
    rows = list_cis_obligations(db_session, company_id=scoped)
    return [{key: str(value) if value is not None else None for key, value in row.items()} for row in rows]


@router.post("/cis/import")
def finance_cis_import(
    payroll_item_id: uuid.UUID = Query(...),
    correct: bool = Query(False),
    company_id: uuid.UUID | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
) -> dict[str, object]:
    scoped = _company(db_session, actor, company_id)
    assert_finance_write(
        db_session,
        actor=actor,
        company_id=scoped,
        project_id=None,
        operation="cis_import",
    )
    try:
        result = import_cis_snapshot(
            db_session,
            company_id=scoped,
            actor_user_id=actor.id,
            payroll_item_id=payroll_item_id,
            correct=correct,
        )
        db_session.commit()
        return {key: str(value) if value is not None else None for key, value in result.items()}
    except FinanceLedgerError as exc:
        db_session.rollback()
        raise _ledger(exc) from exc


@router.post("/paye/import")
def finance_paye_import(
    paye_item_id: uuid.UUID = Query(...),
    correct: bool = Query(False),
    company_id: uuid.UUID | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
) -> dict[str, str]:
    scoped = _company(db_session, actor, company_id)
    assert_finance_write(
        db_session,
        actor=actor,
        company_id=scoped,
        project_id=None,
        operation="paye_import",
    )
    try:
        snapshot_id = import_paye_snapshot(
            db_session,
            company_id=scoped,
            actor_user_id=actor.id,
            paye_item_id=paye_item_id,
            correct=correct,
        )
        db_session.commit()
        return {"id": str(snapshot_id)}
    except FinanceLedgerError as exc:
        db_session.rollback()
        raise _ledger(exc) from exc


@router.post("/worker-payments")
def finance_worker_payment(
    body: WorkerPaymentBody,
    company_id: uuid.UUID | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
) -> dict[str, str]:
    scoped = _company(db_session, actor, company_id)
    assert_finance_write(
        db_session,
        actor=actor,
        company_id=scoped,
        project_id=None,
        operation="worker_payment_create",
    )
    try:
        payment_id = create_worker_payment(
            db_session,
            company_id=scoped,
            actor_user_id=actor.id,
            source_user_id=body.source_user_id,
            amount=body.amount,
            payment_date=body.payment_date,
            payment_method=body.payment_method,
            external_reference=body.external_reference,
            notes=body.notes,
        )
        db_session.commit()
        return {"id": str(payment_id)}
    except FinanceLedgerError as exc:
        db_session.rollback()
        raise _ledger(exc) from exc


@router.post("/worker-payments/{payment_id}/allocations")
def finance_worker_allocations(
    payment_id: uuid.UUID,
    body: WorkerAllocationBatchBody,
    company_id: uuid.UUID | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
) -> dict[str, str]:
    scoped = _company(db_session, actor, company_id)
    assert_finance_write(
        db_session,
        actor=actor,
        company_id=scoped,
        project_id=None,
        operation="worker_payment_allocate",
    )
    try:
        allocate_worker_payment(
            db_session,
            company_id=scoped,
            actor_user_id=actor.id,
            payment_id=payment_id,
            allocations=[item.model_dump() for item in body.allocations],
        )
        db_session.commit()
        return {"status": "posted"}
    except FinanceLedgerError as exc:
        db_session.rollback()
        raise _ledger(exc) from exc


@router.post("/customer-invoices")
def finance_customer_invoice(
    body: CustomerInvoiceBody,
    company_id: uuid.UUID | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
) -> dict[str, str]:
    scoped = _company(db_session, actor, company_id)
    assert_finance_write(
        db_session,
        actor=actor,
        company_id=scoped,
        project_id=body.project_id,
        operation="customer_invoice_create",
    )
    try:
        invoice_id = create_customer_invoice(
            db_session,
            company_id=scoped,
            actor_user_id=actor.id,
            counterparty_id=body.counterparty_id,
            project_id=body.project_id,
            document_kind=body.document_kind,
            external_reference=body.external_reference,
            document_date=body.document_date,
            due_date=body.due_date,
            lines=[line.model_dump() for line in body.lines],
            credits_invoice_id=body.credits_invoice_id,
            reverses_invoice_id=body.reverses_invoice_id,
        )
        db_session.commit()
        return {"id": str(invoice_id)}
    except FinanceLedgerError as exc:
        db_session.rollback()
        raise _ledger(exc) from exc


@router.post("/cost-documents")
def finance_cost_draft(
    body: CostDraftInput,
    company_id: uuid.UUID | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
):
    scoped = _company(db_session, actor, company_id)
    project_ids = {
        allocation.project_id
        for line in body.lines
        for allocation in line.allocations
        if allocation.project_id is not None
    }
    assert_projects_write_allowed(
        db_session,
        actor=actor,
        company_id=scoped,
        project_ids=project_ids,
        operation="cost_document_draft",
    )
    try:
        view = create_cost_draft(db_session, company_id=scoped, actor_user_id=actor.id, payload=body)
        db_session.commit()
        return view
    except CostRegisterError as exc:
        db_session.rollback()
        raise HTTPException(status_code=400, detail={"code": exc.code, "message": exc.message}) from exc


@router.post("/cost-documents/{document_id}/post")
def finance_cost_post(
    document_id: uuid.UUID,
    company_id: uuid.UUID | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
):
    scoped = _company(db_session, actor, company_id)
    project_ids = {
        uuid.UUID(str(row[0]))
        for row in db_session.execute(
            text(
                "SELECT DISTINCT allocation.project_id "
                "FROM finance_cost_allocations AS allocation "
                "JOIN finance_cost_lines AS line "
                "  ON line.id = allocation.line_id AND line.company_id = allocation.company_id "
                "WHERE line.document_id = :document_id "
                "  AND allocation.company_id = :company_id "
                "  AND allocation.project_id IS NOT NULL"
            ),
            {"document_id": document_id, "company_id": scoped},
        ).all()
    }
    assert_projects_write_allowed(
        db_session,
        actor=actor,
        company_id=scoped,
        project_ids=project_ids,
        operation="cost_document_post",
    )
    try:
        result = post_cost_document(db_session, company_id=scoped, actor_user_id=actor.id, document_id=document_id)
        db_session.commit()
        return result
    except CostRegisterError as exc:
        db_session.rollback()
        raise HTTPException(status_code=400, detail={"code": exc.code, "message": exc.message}) from exc


@router.get("/cost-documents/{document_id}")
def finance_cost_get(
    document_id: uuid.UUID,
    company_id: uuid.UUID | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
):
    scoped = _company(db_session, actor, company_id)
    try:
        return get_cost_document(db_session, company_id=scoped, document_id=document_id)
    except CostRegisterError as exc:
        raise HTTPException(status_code=404, detail={"code": exc.code, "message": exc.message}) from exc


@router.post("/supplier-payments")
def finance_supplier_payment(
    body: SupplierPaymentDraftInput,
    company_id: uuid.UUID | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
):
    scoped = _company(db_session, actor, company_id)
    assert_finance_write(
        db_session,
        actor=actor,
        company_id=scoped,
        project_id=None,
        operation="supplier_payment_create",
    )
    try:
        draft = create_supplier_payment_draft(db_session, company_id=scoped, actor_user_id=actor.id, payload=body)
        posted = post_supplier_payment(db_session, company_id=scoped, actor_user_id=actor.id, payment_id=draft.id)
        db_session.commit()
        return posted
    except SupplierPaymentError as exc:
        db_session.rollback()
        raise HTTPException(status_code=400, detail={"code": exc.code, "message": exc.message}) from exc


@router.post("/supplier-payments/{payment_id}/allocations")
def finance_supplier_allocations(
    payment_id: uuid.UUID,
    body: AllocationBatchInput,
    company_id: uuid.UUID | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
):
    scoped = _company(db_session, actor, company_id)
    assert_finance_write(
        db_session,
        actor=actor,
        company_id=scoped,
        project_id=None,
        operation="supplier_payment_allocate",
    )
    try:
        view = allocate_supplier_payment(
            db_session,
            company_id=scoped,
            actor_user_id=actor.id,
            payment_id=payment_id,
            payload=body,
        )
        db_session.commit()
        return view
    except SupplierPaymentError as exc:
        db_session.rollback()
        raise HTTPException(status_code=400, detail={"code": exc.code, "message": exc.message}) from exc


@router.get("/supplier-payments/{payment_id}")
def finance_supplier_get(
    payment_id: uuid.UUID,
    company_id: uuid.UUID | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
):
    scoped = _company(db_session, actor, company_id)
    try:
        return get_supplier_payment(db_session, company_id=scoped, payment_id=payment_id)
    except SupplierPaymentError as exc:
        raise HTTPException(status_code=404, detail={"code": exc.code, "message": exc.message}) from exc
