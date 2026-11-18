"""Authenticated routes for the remaining Finance workflows."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.company_scope import CompanyScopeError, resolve_operational_company_id
from app.db.session import get_db_session
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.finance.access import (
    PREVIEW_READONLY,
    assert_finance_access,
    assert_finance_company_access,
    assert_finance_write,
    finance_preview_readonly,
)
from app.modules.finance.commercial_service import (
    allocate_receipt,
    approve_budget,
    approve_daywork,
    create_application,
    create_budget,
    create_certificate,
    create_cis_split,
    create_commitment,
    create_cost_code,
    create_counterparty,
    create_funding,
    create_hmrc_payment,
    create_opening_balance,
    create_project,
    create_receipt,
    create_retention_release,
    draw_commitment,
    list_budgets,
    list_cis_sources,
    list_paye_sources,
    list_snapshot_history,
    record_cost_to_complete,
    settle_opening_balance,
    list_cost_codes,
    list_counterparties,
    list_projects,
    list_table,
    project_cvr,
    project_cvr_as_of,
    report_csv,
    reverse_receipt,
    reverse_receipt_allocation,
    reverse_worker_allocation,
    reverse_worker_payment,
    review_opening_balance,
    save_daywork,
    save_variation,
    set_contract_value,
    supplier_position,
    transition_variation,
    vat_cis_report,
)
from app.modules.finance.cvr_source_breakdown import build_cvr_source_breakdown
from app.modules.finance.workplace_link import (
    dry_run_workplace_initialize,
    initialize_finance_project_from_workplace,
    list_project_links,
)
from app.modules.finance.ledger_service import FinanceLedgerError, paye_obligation
from app.modules.finance.supplier_payment_errors import SupplierPaymentError
from app.modules.finance.supplier_payment_schemas import ReversalInput
from app.modules.finance.supplier_payment_service import reverse_supplier_payment, reverse_supplier_payment_allocation

# Paths that may continue under FINANCE_PREVIEW_MODE=readonly only after
# assert_finance_write succeeds inside the endpoint.
_SCOPED_WRITE_PATH_PREFIXES = (
    "/api/finance/contract-value",
    "/api/finance/budgets",
    "/api/finance/cost-to-complete",
    "/api/finance/variations",
    "/api/finance/dayworks",
    "/api/finance/commitments",
    "/api/finance/applications",
    "/api/finance/certificates",
    "/api/finance/retention-releases",
    "/api/finance/customer-receipts",
    "/api/finance/customer-receipt-allocations",
    "/api/finance/counterparties",
    "/api/finance/cost-codes",
    "/api/finance/funding",
    "/api/finance/opening-balances",
    "/api/finance/cis-splits",
    "/api/finance/hmrc-payments",
    "/api/finance/worker-allocations",
    "/api/finance/worker-payments",
    "/api/finance/supplier-payment-allocations",
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


class ProjectBody(BaseModel):
    name: str
    reference_code: str | None = None
    contract_value_net: Decimal = Decimal("0")


class WorkplaceInitBody(BaseModel):
    workplace_id: uuid.UUID


class NamedBody(BaseModel):
    code: str
    name: str


class PartyBody(BaseModel):
    counterparty_type: str
    name: str


class BudgetLineBody(BaseModel):
    cost_code_id: uuid.UUID
    amount_net: Decimal
    description: str | None = None
    item_reference: str | None = None


class BudgetBody(BaseModel):
    project_id: uuid.UUID
    note: str | None = None
    lines: list[BudgetLineBody] = Field(min_length=1)


class ContractBody(BaseModel):
    project_id: uuid.UUID
    amount: Decimal
    effective_date: date


class ReceiptBody(BaseModel):
    counterparty_id: uuid.UUID
    receipt_date: date
    amount: Decimal
    external_reference: str | None = None
    notes: str | None = None


class ReceiptAllocationBody(BaseModel):
    invoice_id: uuid.UUID
    amount: Decimal


class ReceiptAllocationBatch(BaseModel):
    allocations: list[ReceiptAllocationBody] = Field(min_length=1)


class ReasonBody(BaseModel):
    reason: str | None = None


class ApplicationBody(BaseModel):
    project_id: uuid.UUID
    counterparty_id: uuid.UUID
    period_start: date
    period_end: date
    applied_net: Decimal
    notes: str | None = None


class CertificateBody(BaseModel):
    application_id: uuid.UUID
    certificate_reference: str
    certified_net: Decimal
    retention_rate: Decimal
    invoice_id: uuid.UUID | None = None


class RetentionBody(BaseModel):
    certificate_id: uuid.UUID
    amount: Decimal
    release_date: date
    notes: str | None = None


class VariationBody(BaseModel):
    project_id: uuid.UUID
    reference_code: str
    description: str
    requested_value: Decimal
    submitted_value: Decimal
    counterparty_id: uuid.UUID | None = None


class VariationStatusBody(BaseModel):
    approval_status: str
    approved_value: Decimal | None = None


class DayworkBody(BaseModel):
    project_id: uuid.UUID
    reference_code: str
    work_date: date
    description: str
    labour_amount: Decimal
    material_amount: Decimal
    plant_amount: Decimal


class DayworkApprovalBody(BaseModel):
    counts_in_contract_value: bool = True


class CommitmentBody(BaseModel):
    project_id: uuid.UUID
    counterparty_id: uuid.UUID
    reference_code: str
    committed_amount: Decimal
    cost_code_id: uuid.UUID | None = None


class DrawBody(BaseModel):
    cost_document_id: uuid.UUID
    amount: Decimal


class SplitBody(BaseModel):
    snapshot_id: uuid.UUID
    project_id: uuid.UUID
    gross_amount: Decimal
    review_note: str | None = None


class FundingBody(BaseModel):
    entry_kind: str
    entry_date: date
    amount: Decimal
    counterparty_id: uuid.UUID | None = None
    source_user_id: uuid.UUID | None = None
    external_reference: str | None = None
    notes: str | None = None


class OpeningBody(BaseModel):
    balance_kind: str
    effective_date: date
    amount: Decimal
    source_reference: str
    explanation: str
    counterparty_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    source_user_id: uuid.UUID | None = None


class HmrcBody(BaseModel):
    payment_kind: str
    payment_date: date
    amount: Decimal
    external_reference: str | None = None
    notes: str | None = None


def _company(db_session: Session, actor: User, company_id: uuid.UUID | None) -> uuid.UUID:
    assert_finance_access(actor)
    try:
        scoped = resolve_operational_company_id(db_session, actor, company_id)
    except CompanyScopeError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    assert_finance_company_access(scoped)
    return scoped


def _company_for_write(
    db_session: Session,
    actor: User,
    company_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
    *,
    operation: str,
) -> uuid.UUID:
    scoped = _company(db_session, actor, company_id)
    assert_finance_write(
        db_session,
        actor=actor,
        company_id=scoped,
        project_id=project_id,
        operation=operation,
    )
    return scoped


def _project_id_or_404(db_session: Session, *, company_id: uuid.UUID, sql: str, params: dict) -> uuid.UUID:
    project_id = db_session.execute(text(sql), params).scalar_one_or_none()
    if project_id is None:
        raise HTTPException(status_code=404, detail="Finance record was not found for this company.")
    return project_id


def _run(db_session: Session, action):
    try:
        result = action()
        db_session.commit()
        return result
    except FinanceLedgerError as exc:
        db_session.rollback()
        raise HTTPException(status_code=400, detail={"code": exc.code, "message": exc.message}) from exc
    except SupplierPaymentError as exc:
        db_session.rollback()
        raise HTTPException(status_code=400, detail={"code": exc.code, "message": exc.message}) from exc
    except Exception:
        db_session.rollback()
        raise


class ForecastBody(BaseModel):
    project_id: uuid.UUID
    amount: Decimal
    explanation: str


class SettlementBody(BaseModel):
    amount: Decimal
    settlement_date: date
    external_reference: str | None = None


@router.post("/cost-to-complete")
def finance_forecast(body: ForecastBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, body.project_id, operation="cost_to_complete")
    return _run(db_session, lambda: {"id": str(record_cost_to_complete(db_session, company_id=scoped, actor_user_id=actor.id, project_id=body.project_id, amount=body.amount, explanation=body.explanation))})


@router.post("/opening-balances/{opening_id}/settlements")
def finance_opening_settle(opening_id: uuid.UUID, body: SettlementBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company(db_session, actor, company_id)
    project_id = db_session.execute(
        text("SELECT project_id FROM finance_opening_balances WHERE id = :opening_id AND company_id = :company_id"),
        {"opening_id": opening_id, "company_id": scoped},
    ).scalar_one_or_none()
    assert_finance_write(db_session, actor=actor, company_id=scoped, project_id=project_id, operation="opening_balance_settle")
    return _run(db_session, lambda: {"id": str(settle_opening_balance(db_session, company_id=scoped, actor_user_id=actor.id, opening_id=opening_id, amount=body.amount, settlement_date=body.settlement_date, external_reference=body.external_reference))})


@router.get("/cis-sources")
def finance_cis_sources(company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    return list_cis_sources(db_session, company_id=_company(db_session, actor, company_id))


@router.get("/paye-sources")
def finance_paye_sources(company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    return list_paye_sources(db_session, company_id=_company(db_session, actor, company_id))


@router.get("/cis/{source_item_id}/history")
def finance_cis_history(source_item_id: uuid.UUID, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    return list_snapshot_history(db_session, company_id=_company(db_session, actor, company_id), kind="cis", source_id=source_item_id)


@router.get("/paye/{source_item_id}/history")
def finance_paye_history(source_item_id: uuid.UUID, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    return list_snapshot_history(db_session, company_id=_company(db_session, actor, company_id), kind="paye", source_id=source_item_id)



@router.get("/project-links")
def finance_project_links(company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    """READ-ONLY workplace <-> Finance project association status for the scoped company."""
    return list_project_links(db_session, company_id=_company(db_session, actor, company_id))


@router.get("/project-links/dry-run")
def finance_project_links_dry_run(
    company_id: uuid.UUID | None = None,
    workplace_id: list[uuid.UUID] | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
):
    """DRY-RUN only. Reports what initialize would create; never writes."""
    return dry_run_workplace_initialize(
        db_session,
        company_id=_company(db_session, actor, company_id),
        workplace_ids=workplace_id,
    )


@router.post("/project-links/initialize")
def finance_project_links_initialize(
    body: WorkplaceInitBody,
    company_id: uuid.UUID | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
):
    """Create or return the Finance project for one workplace. Blocked in preview readonly."""
    scoped = _company(db_session, actor, company_id)

    def action():
        return initialize_finance_project_from_workplace(
            db_session,
            company_id=scoped,
            actor_user_id=actor.id,
            workplace_id=body.workplace_id,
        )

    try:
        result = action()
        db_session.commit()
        return result
    except FinanceLedgerError as exc:
        db_session.rollback()
        status = 404 if exc.code == "NOT_FOUND" else 400
        raise HTTPException(status_code=status, detail={"code": exc.code, "message": exc.message}) from exc


@router.get("/projects")
def finance_projects(company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    return list_projects(db_session, company_id=_company(db_session, actor, company_id))


@router.post("/projects")
def finance_project_create(body: ProjectBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company(db_session, actor, company_id)
    return _run(db_session, lambda: {"id": str(create_project(db_session, company_id=scoped, actor_user_id=actor.id, name=body.name, reference_code=body.reference_code, contract_value_net=body.contract_value_net))})


@router.get("/cost-codes")
def finance_cost_codes(company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    return list_cost_codes(db_session, company_id=_company(db_session, actor, company_id))


@router.post("/cost-codes")
def finance_cost_code_create(body: NamedBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, None, operation="cost_code_create")
    return _run(db_session, lambda: {"id": str(create_cost_code(db_session, company_id=scoped, actor_user_id=actor.id, code=body.code, name=body.name))})


@router.get("/counterparties")
def finance_parties(counterparty_type: str | None = None, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    return list_counterparties(db_session, company_id=_company(db_session, actor, company_id), counterparty_type=counterparty_type)


@router.post("/counterparties")
def finance_party_create(body: PartyBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, None, operation="counterparty_create")
    return _run(db_session, lambda: {"id": str(create_counterparty(db_session, company_id=scoped, actor_user_id=actor.id, counterparty_type=body.counterparty_type, name=body.name))})


@router.get("/budgets")
def finance_budgets(project_id: uuid.UUID | None = None, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    return list_budgets(db_session, company_id=_company(db_session, actor, company_id), project_id=project_id)


@router.post("/budgets")
def finance_budget_create(body: BudgetBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, body.project_id, operation="budget_create")
    return _run(db_session, lambda: {"id": str(create_budget(db_session, company_id=scoped, actor_user_id=actor.id, project_id=body.project_id, note=body.note, lines=[line.model_dump() for line in body.lines]))})


@router.post("/budgets/{version_id}/approve")
def finance_budget_approve(version_id: uuid.UUID, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company(db_session, actor, company_id)
    project_id = _project_id_or_404(
        db_session,
        company_id=scoped,
        sql="SELECT project_id FROM finance_budget_versions WHERE id = :version_id AND company_id = :company_id",
        params={"version_id": version_id, "company_id": scoped},
    )
    assert_finance_write(db_session, actor=actor, company_id=scoped, project_id=project_id, operation="budget_approve")
    return _run(db_session, lambda: approve_budget(db_session, company_id=scoped, actor_user_id=actor.id, version_id=version_id) or {"status": "approved"})


@router.post("/contract-value")
def finance_contract(body: ContractBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, body.project_id, operation="contract_value")
    return _run(db_session, lambda: {"id": str(set_contract_value(db_session, company_id=scoped, actor_user_id=actor.id, project_id=body.project_id, amount=body.amount, effective_date=body.effective_date))})


@router.post("/customer-receipts")
def finance_receipt(body: ReceiptBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, None, operation="customer_receipt_create")
    return _run(db_session, lambda: {"id": str(create_receipt(db_session, company_id=scoped, actor_user_id=actor.id, counterparty_id=body.counterparty_id, receipt_date=body.receipt_date, amount=body.amount, external_reference=body.external_reference, notes=body.notes))})


@router.post("/customer-receipts/{receipt_id}/allocations")
def finance_receipt_allocate(receipt_id: uuid.UUID, body: ReceiptAllocationBatch, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, None, operation="customer_receipt_allocate")
    return _run(db_session, lambda: allocate_receipt(db_session, company_id=scoped, actor_user_id=actor.id, receipt_id=receipt_id, allocations=[item.model_dump() for item in body.allocations]) or {"status": "posted"})


@router.post("/customer-receipt-allocations/{allocation_id}/reverse")
def finance_receipt_allocation_reverse(allocation_id: uuid.UUID, body: ReasonBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, None, operation="customer_receipt_allocation_reverse")
    return _run(db_session, lambda: {"id": str(reverse_receipt_allocation(db_session, company_id=scoped, actor_user_id=actor.id, allocation_id=allocation_id, reason=body.reason))})


@router.post("/customer-receipts/{receipt_id}/reverse")
def finance_receipt_reverse(receipt_id: uuid.UUID, body: ReasonBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, None, operation="customer_receipt_reverse")
    return _run(db_session, lambda: {"id": str(reverse_receipt(db_session, company_id=scoped, actor_user_id=actor.id, receipt_id=receipt_id, reason=body.reason))})


@router.post("/applications")
def finance_application(body: ApplicationBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, body.project_id, operation="application_create")
    return _run(db_session, lambda: {"id": str(create_application(db_session, company_id=scoped, actor_user_id=actor.id, project_id=body.project_id, counterparty_id=body.counterparty_id, period_start=body.period_start, period_end=body.period_end, applied_net=body.applied_net, notes=body.notes))})


@router.post("/certificates")
def finance_certificate(body: CertificateBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company(db_session, actor, company_id)
    project_id = _project_id_or_404(
        db_session,
        company_id=scoped,
        sql=(
            "SELECT application.project_id FROM finance_payment_applications application "
            "WHERE application.id = :application_id AND application.company_id = :company_id"
        ),
        params={"application_id": body.application_id, "company_id": scoped},
    )
    assert_finance_write(db_session, actor=actor, company_id=scoped, project_id=project_id, operation="certificate_create")
    return _run(db_session, lambda: {"id": str(create_certificate(db_session, company_id=scoped, actor_user_id=actor.id, application_id=body.application_id, certificate_reference=body.certificate_reference, certified_net=body.certified_net, retention_rate=body.retention_rate, invoice_id=body.invoice_id))})


@router.post("/retention-releases")
def finance_retention(body: RetentionBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company(db_session, actor, company_id)
    project_id = _project_id_or_404(
        db_session,
        company_id=scoped,
        sql=(
            "SELECT application.project_id "
            "FROM finance_payment_certificates certificate "
            "JOIN finance_payment_applications application "
            "  ON application.id = certificate.application_id AND application.company_id = certificate.company_id "
            "WHERE certificate.id = :certificate_id AND certificate.company_id = :company_id"
        ),
        params={"certificate_id": body.certificate_id, "company_id": scoped},
    )
    assert_finance_write(db_session, actor=actor, company_id=scoped, project_id=project_id, operation="retention_release")
    return _run(db_session, lambda: {"id": str(create_retention_release(db_session, company_id=scoped, actor_user_id=actor.id, certificate_id=body.certificate_id, amount=body.amount, release_date=body.release_date, notes=body.notes))})


@router.post("/variations")
def finance_variation(body: VariationBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, body.project_id, operation="variation_save")
    return _run(db_session, lambda: {"id": str(save_variation(db_session, company_id=scoped, actor_user_id=actor.id, project_id=body.project_id, reference_code=body.reference_code, description=body.description, requested_value=body.requested_value, submitted_value=body.submitted_value, counterparty_id=body.counterparty_id))})


@router.post("/variations/{variation_id}/status")
def finance_variation_status(variation_id: uuid.UUID, body: VariationStatusBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company(db_session, actor, company_id)
    project_id = _project_id_or_404(
        db_session,
        company_id=scoped,
        sql="SELECT project_id FROM finance_variations WHERE id = :variation_id AND company_id = :company_id",
        params={"variation_id": variation_id, "company_id": scoped},
    )
    assert_finance_write(db_session, actor=actor, company_id=scoped, project_id=project_id, operation="variation_status")
    return _run(db_session, lambda: transition_variation(db_session, company_id=scoped, actor_user_id=actor.id, variation_id=variation_id, approval_status=body.approval_status, approved_value=body.approved_value) or {"status": body.approval_status})


@router.post("/dayworks")
def finance_daywork(body: DayworkBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, body.project_id, operation="daywork_save")
    return _run(db_session, lambda: {"id": str(save_daywork(db_session, company_id=scoped, actor_user_id=actor.id, project_id=body.project_id, reference_code=body.reference_code, work_date=body.work_date, description=body.description, labour_amount=body.labour_amount, material_amount=body.material_amount, plant_amount=body.plant_amount))})


@router.post("/dayworks/{daywork_id}/approve")
def finance_daywork_approve(daywork_id: uuid.UUID, body: DayworkApprovalBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company(db_session, actor, company_id)
    project_id = _project_id_or_404(
        db_session,
        company_id=scoped,
        sql="SELECT project_id FROM finance_dayworks WHERE id = :daywork_id AND company_id = :company_id",
        params={"daywork_id": daywork_id, "company_id": scoped},
    )
    assert_finance_write(db_session, actor=actor, company_id=scoped, project_id=project_id, operation="daywork_approve")
    return _run(db_session, lambda: approve_daywork(db_session, company_id=scoped, actor_user_id=actor.id, daywork_id=daywork_id, counts_in_contract_value=body.counts_in_contract_value) or {"status": "approved"})


@router.post("/commitments")
def finance_commitment(body: CommitmentBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, body.project_id, operation="commitment_create")
    return _run(db_session, lambda: {"id": str(create_commitment(db_session, company_id=scoped, actor_user_id=actor.id, project_id=body.project_id, cost_code_id=body.cost_code_id, counterparty_id=body.counterparty_id, reference_code=body.reference_code, committed_amount=body.committed_amount))})


@router.post("/commitments/{commitment_id}/draws")
def finance_draw(commitment_id: uuid.UUID, body: DrawBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company(db_session, actor, company_id)
    project_id = _project_id_or_404(
        db_session,
        company_id=scoped,
        sql="SELECT project_id FROM finance_commitments WHERE id = :commitment_id AND company_id = :company_id",
        params={"commitment_id": commitment_id, "company_id": scoped},
    )
    assert_finance_write(db_session, actor=actor, company_id=scoped, project_id=project_id, operation="commitment_draw")
    return _run(db_session, lambda: {"id": str(draw_commitment(db_session, company_id=scoped, actor_user_id=actor.id, commitment_id=commitment_id, cost_document_id=body.cost_document_id, amount=body.amount))})


@router.get("/cvr")
def finance_cvr(project_id: uuid.UUID, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company(db_session, actor, company_id)
    try:
        return project_cvr(db_session, company_id=scoped, project_id=project_id)
    except FinanceLedgerError as exc:
        status = 404 if exc.code == "NOT_FOUND" else 400
        raise HTTPException(status_code=status, detail={"code": exc.code, "message": exc.message}) from exc


@router.get("/cvr/as-of")
def finance_cvr_as_of(
    project_id: uuid.UUID,
    cut_off: date,
    company_id: uuid.UUID | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
):
    """Historical CVR position for one authorised company project and cut-off date."""
    scoped = _company(db_session, actor, company_id)
    try:
        return project_cvr_as_of(
            db_session,
            company_id=scoped,
            project_id=project_id,
            cut_off=cut_off,
        )
    except FinanceLedgerError as exc:
        status = 404 if exc.code == "NOT_FOUND" else 400
        raise HTTPException(status_code=status, detail={"code": exc.code, "message": exc.message}) from exc


@router.get("/cvr.csv")
def finance_cvr_csv(project_id: uuid.UUID, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company(db_session, actor, company_id)
    try:
        report = project_cvr(db_session, company_id=scoped, project_id=project_id)
    except FinanceLedgerError as exc:
        status = 404 if exc.code == "NOT_FOUND" else 400
        raise HTTPException(status_code=status, detail={"code": exc.code, "message": exc.message}) from exc
    return PlainTextResponse(report_csv(report), media_type="text/csv")


@router.get("/cvr/source-breakdown")
def finance_cvr_source_breakdown(
    project_id: uuid.UUID,
    metric: str,
    company_id: uuid.UUID | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
):
    """READ-ONLY CVR source rows for Finance Data Grid / source drawer."""
    scoped = _company(db_session, actor, company_id)
    try:
        return build_cvr_source_breakdown(
            db_session,
            company_id=scoped,
            project_id=project_id,
            metric=metric,
        )
    except FinanceLedgerError as exc:
        status = 404 if exc.code == "NOT_FOUND" else 400
        raise HTTPException(status_code=status, detail={"code": exc.code, "message": exc.message}) from exc


@router.post("/cis-splits")
def finance_split(body: SplitBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, body.project_id, operation="cis_split")
    return _run(db_session, lambda: {"id": str(create_cis_split(db_session, company_id=scoped, actor_user_id=actor.id, snapshot_id=body.snapshot_id, project_id=body.project_id, gross_amount=body.gross_amount, review_note=body.review_note))})


@router.post("/funding")
def finance_funding(body: FundingBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, None, operation="funding_create")
    return _run(db_session, lambda: {"id": str(create_funding(db_session, company_id=scoped, actor_user_id=actor.id, entry_kind=body.entry_kind, entry_date=body.entry_date, amount=body.amount, counterparty_id=body.counterparty_id, source_user_id=body.source_user_id, external_reference=body.external_reference, notes=body.notes))})


@router.post("/opening-balances")
def finance_opening(body: OpeningBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, body.project_id, operation="opening_balance_create")
    return _run(db_session, lambda: {"id": str(create_opening_balance(db_session, company_id=scoped, actor_user_id=actor.id, balance_kind=body.balance_kind, effective_date=body.effective_date, amount=body.amount, source_reference=body.source_reference, explanation=body.explanation, counterparty_id=body.counterparty_id, project_id=body.project_id, source_user_id=body.source_user_id))})


@router.post("/opening-balances/{opening_id}/review")
def finance_opening_review(opening_id: uuid.UUID, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company(db_session, actor, company_id)
    project_id = db_session.execute(
        text("SELECT project_id FROM finance_opening_balances WHERE id = :opening_id AND company_id = :company_id"),
        {"opening_id": opening_id, "company_id": scoped},
    ).scalar_one_or_none()
    assert_finance_write(db_session, actor=actor, company_id=scoped, project_id=project_id, operation="opening_balance_review")
    return _run(db_session, lambda: review_opening_balance(db_session, company_id=scoped, actor_user_id=actor.id, opening_id=opening_id) or {"status": "reviewed"})


@router.post("/hmrc-payments")
def finance_hmrc(body: HmrcBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, None, operation="hmrc_payment_create")
    return _run(db_session, lambda: {"id": str(create_hmrc_payment(db_session, company_id=scoped, actor_user_id=actor.id, payment_kind=body.payment_kind, payment_date=body.payment_date, amount=body.amount, external_reference=body.external_reference, notes=body.notes))})


@router.get("/supplier-position")
def finance_supplier_position(company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    return supplier_position(db_session, company_id=_company(db_session, actor, company_id))


@router.get("/tax-report")
def finance_tax(company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    return vat_cis_report(db_session, company_id=_company(db_session, actor, company_id))


@router.get("/tax-report.csv")
def finance_tax_csv(company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    report = vat_cis_report(db_session, company_id=_company(db_session, actor, company_id))
    return PlainTextResponse(report_csv(report), media_type="text/csv")


@router.get("/paye/{source_item_id}")
def finance_paye_one(source_item_id: uuid.UUID, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company(db_session, actor, company_id)
    try:
        row = paye_obligation(db_session, company_id=scoped, source_item_id=source_item_id)
    except FinanceLedgerError as exc:
        raise HTTPException(status_code=404, detail={"code": exc.code, "message": exc.message}) from exc
    return {key: str(value) if value is not None else None for key, value in row.items()}


@router.post("/worker-allocations/{allocation_id}/reverse")
def finance_worker_allocation_reverse(allocation_id: uuid.UUID, body: ReasonBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, None, operation="worker_allocation_reverse")
    return _run(db_session, lambda: {"id": str(reverse_worker_allocation(db_session, company_id=scoped, actor_user_id=actor.id, allocation_id=allocation_id, reason=body.reason))})


@router.post("/worker-payments/{payment_id}/reverse")
def finance_worker_payment_reverse(payment_id: uuid.UUID, body: ReasonBody, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, None, operation="worker_payment_reverse")
    return _run(db_session, lambda: {"id": str(reverse_worker_payment(db_session, company_id=scoped, actor_user_id=actor.id, payment_id=payment_id, reason=body.reason))})


@router.post("/supplier-payment-allocations/{allocation_id}/reverse")
def finance_supplier_allocation_reverse(allocation_id: uuid.UUID, body: ReversalInput, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, None, operation="supplier_payment_allocation_reverse")
    return _run(db_session, lambda: reverse_supplier_payment_allocation(db_session, company_id=scoped, actor_user_id=actor.id, allocation_id=allocation_id, payload=body))


@router.post("/supplier-payments/{payment_id}/reverse")
def finance_supplier_payment_reverse(payment_id: uuid.UUID, body: ReversalInput, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company_for_write(db_session, actor, company_id, None, operation="supplier_payment_reverse")
    return _run(db_session, lambda: reverse_supplier_payment(db_session, company_id=scoped, actor_user_id=actor.id, payment_id=payment_id, payload=body))


@router.get("/cost-categories")
def finance_cost_categories(company_id: uuid.UUID | None = None, project_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company(db_session, actor, company_id)
    if project_id is not None:
        owned = db_session.execute(
            text("SELECT 1 FROM finance_projects WHERE id = :project_id AND company_id = :company_id"),
            {"project_id": project_id, "company_id": scoped},
        ).first()
        if owned is None:
            raise HTTPException(status_code=404, detail="Project is not in this company.")
    project_filter = ""
    params: dict[str, object] = {"company_id": scoped}
    if project_id is not None:
        project_filter = "AND allocation.project_id = :project_id "
        params["project_id"] = project_id
    rows = db_session.execute(
        text(
            "SELECT code.name AS category, COALESCE(SUM(allocation.amount_eligible), 0) AS eligible "
            "FROM finance_cost_allocations allocation "
            "JOIN finance_cost_lines line ON line.id = allocation.line_id AND line.company_id = allocation.company_id "
            "JOIN finance_cost_documents document ON document.id = line.document_id AND document.company_id = line.company_id "
            "JOIN finance_cost_codes code ON code.id = allocation.cost_code_id AND code.company_id = allocation.company_id "
            "WHERE document.company_id = :company_id AND allocation.company_id = :company_id AND document.status = 'posted' "
            f"{project_filter}"
            "GROUP BY code.name ORDER BY code.name"
        ),
        params,
    ).mappings()
    return [{"category": row["category"], "eligible": str(row["eligible"])} for row in rows]


FINANCE_REGISTER_STATEMENTS = {
        "invoices": "SELECT id, counterparty_id, project_id, document_kind, external_reference, document_date, due_date, net_amount, tax_amount, gross_amount, finance_customer_invoice_outstanding(id) AS outstanding, (SELECT COALESCE(SUM(allocation.amount), 0) FROM finance_customer_receipt_allocations allocation JOIN finance_customer_receipts receipt ON receipt.id = allocation.receipt_id AND receipt.company_id = allocation.company_id WHERE allocation.invoice_id = finance_customer_invoices.id AND allocation.status = 'posted' AND receipt.status = 'posted' AND NOT EXISTS (SELECT 1 FROM finance_customer_receipt_allocation_reversals reversal_row WHERE reversal_row.allocation_id = allocation.id AND reversal_row.status = 'posted') AND NOT EXISTS (SELECT 1 FROM finance_customer_receipt_reversals receipt_reversal WHERE receipt_reversal.receipt_id = receipt.id AND receipt_reversal.status = 'posted')) AS cash_allocated, (SELECT COALESCE(SUM(credit.gross_amount), 0) FROM finance_customer_invoices credit WHERE credit.credits_invoice_id = finance_customer_invoices.id AND credit.company_id = finance_customer_invoices.company_id AND credit.document_kind = 'credit' AND credit.status = 'posted') AS credit_applied, (SELECT string_agg(receipt.external_reference, ', ' ORDER BY receipt.receipt_date) FROM finance_customer_receipt_allocations allocation JOIN finance_customer_receipts receipt ON receipt.id = allocation.receipt_id AND receipt.company_id = allocation.company_id WHERE allocation.invoice_id = finance_customer_invoices.id AND allocation.status = 'posted' AND receipt.status = 'posted' AND NOT EXISTS (SELECT 1 FROM finance_customer_receipt_allocation_reversals reversal_row WHERE reversal_row.allocation_id = allocation.id AND reversal_row.status = 'posted') AND NOT EXISTS (SELECT 1 FROM finance_customer_receipt_reversals receipt_reversal WHERE receipt_reversal.receipt_id = receipt.id AND receipt_reversal.status = 'posted')) AS receipt_references, status FROM finance_customer_invoices WHERE company_id = :company_id ORDER BY created_at DESC",
        "receipts": "SELECT id, counterparty_id, receipt_date, external_reference, amount, status, EXISTS (SELECT 1 FROM finance_customer_receipt_reversals receipt_reversal WHERE receipt_reversal.receipt_id = finance_customer_receipts.id AND receipt_reversal.company_id = finance_customer_receipts.company_id AND receipt_reversal.status = 'posted') AS receipt_reversed, (SELECT COALESCE(SUM(allocation.amount), 0) FROM finance_customer_receipt_allocations allocation WHERE allocation.receipt_id = finance_customer_receipts.id AND allocation.company_id = finance_customer_receipts.company_id AND allocation.status = 'posted' AND NOT EXISTS (SELECT 1 FROM finance_customer_receipt_allocation_reversals reversal_row WHERE reversal_row.allocation_id = allocation.id AND reversal_row.status = 'posted') AND NOT EXISTS (SELECT 1 FROM finance_customer_receipt_reversals receipt_reversal WHERE receipt_reversal.receipt_id = finance_customer_receipts.id AND receipt_reversal.status = 'posted')) AS allocated_amount FROM finance_customer_receipts WHERE company_id = :company_id ORDER BY created_at DESC",
        "applications": "SELECT id, project_id, counterparty_id, application_number, period_start, period_end, applied_net, status FROM finance_payment_applications WHERE company_id = :company_id ORDER BY application_number",
        "certificates": "SELECT id, application_id, certificate_reference, certified_net, retention_rate, retention_withheld, invoice_id, status FROM finance_payment_certificates WHERE company_id = :company_id ORDER BY created_at DESC",
        "retention": "SELECT id, certificate_id, amount, release_date, status FROM finance_retention_releases WHERE company_id = :company_id ORDER BY created_at DESC",
        "variations": "SELECT id, project_id, reference_code, description, requested_value, submitted_value, approved_value, approval_status FROM finance_variations WHERE company_id = :company_id ORDER BY reference_code",
        "dayworks": "SELECT id, project_id, reference_code, work_date, description, labour_amount, material_amount, plant_amount, submitted_value, approved_value, approval_status, counts_in_contract_value FROM finance_dayworks WHERE company_id = :company_id ORDER BY work_date",
        "commitments": "SELECT id, project_id, counterparty_id, reference_code, committed_amount, commitment_status, status FROM finance_commitments WHERE company_id = :company_id ORDER BY reference_code",
        "funding": "SELECT id, entry_kind, entry_date, amount, external_reference, review_required, status FROM finance_funding_entries WHERE company_id = :company_id ORDER BY entry_date",
        "openings": "SELECT id, balance_kind, effective_date, amount, source_reference, explanation, review_status FROM finance_opening_balances WHERE company_id = :company_id ORDER BY effective_date",
        "hmrc": "SELECT id, payment_kind, payment_date, amount, external_reference, status FROM finance_hmrc_payments WHERE company_id = :company_id ORDER BY payment_date",
        # cash_paid = bank allocations only. credit_applied = invoice gross minus current liability
        # (credits reduce liability; they are not bank payments). Do not label gross-outstanding as "Paid".
        "supplier-invoices": "SELECT id, counterparty_id, document_type, external_reference, document_date, due_date, net_amount, tax_amount, gross_amount, (finance_supplier_gross_liability(id) - finance_supplier_allocated_to_document(id)) AS outstanding, CASE WHEN document_type IN ('supplier_invoice', 'expense_receipt') THEN finance_supplier_allocated_to_document(id) ELSE NULL END AS cash_paid, CASE WHEN document_type IN ('supplier_invoice', 'expense_receipt') THEN (gross_amount - finance_supplier_gross_liability(id)) ELSE NULL END AS credit_applied, (SELECT string_agg(payment.external_reference, ', ' ORDER BY payment.payment_date) FROM finance_supplier_payment_allocations allocation JOIN finance_supplier_payments payment ON payment.id = allocation.payment_id AND payment.company_id = allocation.company_id WHERE allocation.cost_document_id = finance_cost_documents.id AND allocation.status = 'posted' AND payment.status = 'posted' AND NOT EXISTS (SELECT 1 FROM finance_supplier_payment_allocation_reversals allocation_reversal WHERE allocation_reversal.allocation_id = allocation.id AND allocation_reversal.status = 'posted') AND NOT EXISTS (SELECT 1 FROM finance_supplier_payment_reversals payment_reversal WHERE payment_reversal.payment_id = payment.id AND payment_reversal.status = 'posted')) AS payment_references, (SELECT string_agg(DISTINCT project.name, ', ' ORDER BY project.name) FROM finance_cost_lines line JOIN finance_cost_allocations allocation ON allocation.line_id = line.id AND allocation.company_id = line.company_id JOIN finance_projects project ON project.id = allocation.project_id AND project.company_id = allocation.company_id WHERE line.document_id = finance_cost_documents.id AND line.company_id = finance_cost_documents.company_id) AS project_names, status FROM finance_cost_documents WHERE company_id = :company_id ORDER BY created_at DESC",
        "supplier-payments": "SELECT id, payment_date, external_reference, amount, status, EXISTS (SELECT 1 FROM finance_supplier_payment_reversals payment_reversal WHERE payment_reversal.payment_id = finance_supplier_payments.id AND payment_reversal.company_id = finance_supplier_payments.company_id AND payment_reversal.status = 'posted') AS payment_reversed FROM finance_supplier_payments WHERE company_id = :company_id ORDER BY created_at DESC",
        "worker-payments": "SELECT id, payment_date, external_reference, amount, status FROM finance_worker_payments WHERE company_id = :company_id ORDER BY created_at DESC",
        "audit": "SELECT id, entity_type, action, reason, created_at FROM finance_audit_events WHERE company_id = :company_id ORDER BY created_at DESC",
}


@router.get("/registers/{register}")
def finance_register(register: str, company_id: uuid.UUID | None = None, db_session: Session = Depends(get_db_session), actor: User = Depends(get_current_user)):
    scoped = _company(db_session, actor, company_id)
    statement = FINANCE_REGISTER_STATEMENTS.get(register)
    if statement is None:
        raise HTTPException(status_code=404, detail="Unknown finance register.")
    return list_table(db_session, company_id=scoped, statement=statement)


def _query_filters(
    q: str = "",
    date_field: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    party_id: str | None = None,
    project_id: str | None = None,
    status: str | None = "all",
    sort: str | None = None,
    descending: bool = True,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, object]:
    return {
        "query": q,
        "date_field": date_field,
        "date_from": date_from,
        "date_to": date_to,
        "party_id": party_id or None,
        "project_id": project_id or None,
        "status": status,
        "sort": sort,
        "descending": descending,
        "limit": limit,
        "offset": offset,
    }


@router.get("/query/{register}")
def finance_query_register(
    register: str,
    company_id: uuid.UUID | None = None,
    q: str = "",
    date_field: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    party_id: str | None = None,
    project_id: str | None = None,
    status: str | None = "all",
    sort: str | None = None,
    descending: bool = True,
    limit: int = 50,
    offset: int = 0,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
):
    from app.modules.finance.register_query import REGISTER_FIELDS
    from app.modules.finance.register_service import query_register

    if register not in REGISTER_FIELDS:
        raise HTTPException(status_code=404, detail="Unknown finance register.")
    scoped = _company(db_session, actor, company_id)
    try:
        return query_register(db_session, scoped, register, **_query_filters(q, date_field, date_from, date_to, party_id, project_id, status, sort, descending, limit, offset))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="The date filter is not a calendar date.") from exc


@router.get("/audit-trail")
def finance_audit_trail(
    company_id: uuid.UUID | None = None,
    category: str | None = None,
    q: str = "",
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
):
    from app.modules.finance.register_query import filter_rows, page_rows
    from app.modules.finance.register_service import load_register_rows

    scoped = _company(db_session, actor, company_id)
    try:
        rows = load_register_rows(db_session, scoped, "audit")
        if category and category != "All operations":
            rows = [row for row in rows if row.get("category") == category]
        filtered, unsupported = filter_rows("audit", rows, query=q, date_field="recorded", date_from=date_from, date_to=date_to)
        result = page_rows(filtered, limit=limit, offset=offset)
        from app.modules.finance.audit_presentation import enrich_audit_rows

        result["rows"] = enrich_audit_rows(db_session, scoped, list(result["rows"]))
        result["unsupported_filters"] = unsupported
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="The date filter is not a calendar date.") from exc
    result["date_field"] = "Audit event timestamp, Europe/London, including the whole final day."
    result["actor_note"] = "Actor is the account email when a user id was stored. A personal name is not recorded on the audit row."
    result["ledger_note"] = "An audit event is not an additional payment. Several events can describe one transfer."
    return result


@router.get("/exports/{register}")
def finance_export_register(
    register: str,
    company_id: uuid.UUID | None = None,
    q: str = "",
    date_field: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    party_id: str | None = None,
    project_id: str | None = None,
    status: str | None = "all",
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
):
    from app.modules.finance.register_query import REGISTER_FIELDS
    from app.modules.finance.register_service import ExportTooLarge, export_csv

    if register not in REGISTER_FIELDS:
        raise HTTPException(status_code=404, detail="Unknown finance register.")
    scoped = _company(db_session, actor, company_id)
    try:
        body = export_csv(db_session, scoped, register, **_query_filters(q, date_field, date_from, date_to, party_id, project_id, status))
    except ExportTooLarge as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="The date filter is not a calendar date.") from exc
    return Response(
        content=body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{register}.csv"'},
    )


@router.get("/projects/{project_id}/report.xlsx")
def finance_project_report(
    project_id: uuid.UUID,
    company_id: uuid.UUID | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    db_session: Session = Depends(get_db_session),
    actor: User = Depends(get_current_user),
):
    from app.modules.finance.register_service import project_report_xlsx

    scoped = _company(db_session, actor, company_id)
    owned = db_session.execute(
        text("SELECT 1 FROM finance_projects WHERE id = :project_id AND company_id = :company_id"),
        {"project_id": project_id, "company_id": scoped},
    ).first()
    if owned is None:
        raise HTTPException(status_code=404, detail="Project is not in this company.")
    try:
        payload = project_report_xlsx(db_session, company_id=scoped, project_id=project_id, date_from=date_from, date_to=date_to)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="The date filter is not a calendar date.") from exc
    return Response(
        content=payload,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="project-finance-report.xlsx"'},
    )
