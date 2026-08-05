"""Customer invoice billing for saved budgets (separate from labour/expense cost maths)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.budgets.models import BudgetCustomerInvoice, BudgetProject
from app.modules.budgets.repository import (
    delete_customer_invoice,
    get_budget_project,
    get_current_invoice_document,
    get_customer_invoice,
    get_customer_invoice_by_client_action_id,
    get_customer_invoice_by_number,
    list_customer_invoices_for_budget,
    list_invoice_documents,
    save_budget_project,
    save_customer_invoice,
    sum_issued_invoice_amounts,
)
from app.modules.budgets.schemas import (
    BillingSummaryResponse,
    ContractValueUpdateRequest,
    InvoiceCreateRequest,
    InvoicePatchRequest,
    InvoiceResponse,
    InvoiceVoidRequest,
)
from app.modules.companies.service import ensure_company_time_policy

MONEY_QUANT = Decimal("0.01")
DEFAULT_CURRENCY = "GBP"


def _assert_can_access_budget(actor: User, project: BudgetProject) -> None:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission.")
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id != project.company_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot access this budget.")
    elif actor.system_role != SystemRole.ADMINISTRATOR:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission.")


def _load_budget(db_session: Session, actor: User, budget_id: uuid.UUID) -> BudgetProject:
    project = get_budget_project(db_session, budget_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found.")
    _assert_can_access_budget(actor, project)
    return project


def _load_invoice(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
) -> tuple[BudgetProject, BudgetCustomerInvoice]:
    project = _load_budget(db_session, actor, budget_id)
    invoice = get_customer_invoice(db_session, invoice_id)
    if invoice is None or invoice.budget_id != budget_id or invoice.company_id != project.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found.")
    return project, invoice


def _money(value: Decimal | float | int | str) -> Decimal:
    return Decimal(str(value)).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)


def _validate_totals(net: Decimal, vat: Decimal, gross: Decimal) -> tuple[Decimal, Decimal, Decimal]:
    n = _money(net)
    v = _money(vat)
    g = _money(gross)
    if n < 0 or v < 0 or g < 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invoice amounts cannot be negative.",
        )
    expected = (n + v).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    if g != expected:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="gross_amount must equal net_amount + vat_amount.",
        )
    return n, v, g


def _company_local_today(db_session: Session, company_id: uuid.UUID) -> date:
    policy = ensure_company_time_policy(db_session, company_id)
    try:
        tz = ZoneInfo(policy.timezone_name)
    except Exception:
        tz = ZoneInfo("UTC")
    return datetime.now(timezone.utc).astimezone(tz).date()


def _display_status(
    invoice: BudgetCustomerInvoice,
    today_local: date,
    payments_received: Decimal,
) -> str:
    # Lazy import avoids circular dependency with payments.py (which imports helpers here).
    from app.modules.budgets.payments import derive_display_status

    return derive_display_status(invoice, today_local, payments_received)


def _invoice_response(
    db_session: Session,
    invoice: BudgetCustomerInvoice,
    *,
    today_local: date | None = None,
    payments_received: Decimal | None = None,
) -> InvoiceResponse:
    from app.modules.budgets.payments import active_payments_total

    if today_local is None:
        today_local = _company_local_today(db_session, invoice.company_id)
    if payments_received is None:
        payments_received = active_payments_total(db_session, invoice.id)
    else:
        payments_received = _money(payments_received)

    gross = _money(invoice.gross_amount)
    outstanding = max(gross - payments_received, Decimal("0.00")).quantize(
        MONEY_QUANT,
        rounding=ROUND_HALF_UP,
    )
    doc = get_current_invoice_document(db_session, invoice.id)
    return InvoiceResponse(
        id=invoice.id,
        company_id=invoice.company_id,
        budget_id=invoice.budget_id,
        client_action_id=invoice.client_action_id,
        customer_name=invoice.customer_name,
        invoice_number=invoice.invoice_number,
        invoice_date=invoice.invoice_date,
        due_date=invoice.due_date,
        status=invoice.status,
        display_status=_display_status(invoice, today_local, payments_received),
        currency=invoice.currency,
        net_amount=_money(invoice.net_amount),
        vat_amount=_money(invoice.vat_amount),
        gross_amount=gross,
        payments_received_gross=payments_received,
        outstanding_gross=outstanding,
        description=invoice.description,
        reference=invoice.reference,
        payment_terms=invoice.payment_terms,
        issued_at=invoice.issued_at,
        voided_at=invoice.voided_at,
        void_reason=invoice.void_reason,
        created_at=invoice.created_at,
        updated_at=invoice.updated_at,
        has_document=doc is not None,
        document_filename=doc.original_filename if doc else None,
        document_content_type=doc.content_type if doc else None,
        document_version=doc.version if doc else None,
    )


def get_billing_summary(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
) -> BillingSummaryResponse:
    from app.modules.budgets.payments import active_payments_total, derive_display_status
    from app.modules.budgets.repository import sum_active_payments_for_budget

    project = _load_budget(db_session, actor, budget_id)
    today_local = _company_local_today(db_session, project.company_id)
    invoices = list_customer_invoices_for_budget(db_session, budget_id=budget_id, limit=5000)

    draft_count = 0
    issued_count = 0
    overdue_count = 0
    void_count = 0
    part_paid_count = 0
    paid_count = 0
    outstanding_gross = Decimal("0.00")
    overdue_outstanding_gross = Decimal("0.00")

    for inv in invoices:
        if inv.status == "draft":
            draft_count += 1
            continue
        if inv.status == "void":
            void_count += 1
            continue
        if inv.status == "issued":
            issued_count += 1
            received = active_payments_total(db_session, inv.id)
            gross = _money(inv.gross_amount)
            outstanding = max(gross - received, Decimal("0.00")).quantize(
                MONEY_QUANT,
                rounding=ROUND_HALF_UP,
            )
            outstanding_gross = (outstanding_gross + outstanding).quantize(
                MONEY_QUANT,
                rounding=ROUND_HALF_UP,
            )
            display = derive_display_status(inv, today_local, received)
            if display == "paid":
                paid_count += 1
            elif display == "part_paid":
                part_paid_count += 1
            elif display == "overdue":
                overdue_count += 1
                overdue_outstanding_gross = (overdue_outstanding_gross + outstanding).quantize(
                    MONEY_QUANT,
                    rounding=ROUND_HALF_UP,
                )

    net_f, vat_f, gross_f = sum_issued_invoice_amounts(db_session, budget_id)
    active_net = _money(net_f)
    vat_invoiced = _money(vat_f)
    gross_invoiced = _money(gross_f)
    payments_received_gross = _money(sum_active_payments_for_budget(db_session, budget_id))

    contract: Decimal | None = None
    if project.contract_value_net is not None:
        contract = _money(project.contract_value_net)

    remaining: Decimal | None = None
    over: Decimal | None = None
    if contract is not None:
        remaining = max(contract - active_net, Decimal("0.00")).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
        over = max(active_net - contract, Decimal("0.00")).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)

    return BillingSummaryResponse(
        budget_id=project.id,
        company_id=project.company_id,
        contract_value_net=contract,
        billing_currency=project.billing_currency,
        active_invoiced_net=active_net,
        vat_invoiced=vat_invoiced,
        gross_invoiced=gross_invoiced,
        payments_received_gross=payments_received_gross,
        outstanding_gross=outstanding_gross,
        overdue_outstanding_gross=overdue_outstanding_gross,
        remaining_to_invoice=remaining,
        over_invoiced=over,
        draft_count=draft_count,
        issued_count=issued_count,
        part_paid_count=part_paid_count,
        paid_count=paid_count,
        overdue_count=overdue_count,
        void_count=void_count,
        active_count=issued_count,
    )


def update_contract_value(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    body: ContractValueUpdateRequest,
) -> BillingSummaryResponse:
    project = _load_budget(db_session, actor, budget_id)
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No contract value fields to update.",
        )

    old_net = (
        _money(project.contract_value_net) if project.contract_value_net is not None else None
    )
    old_currency = project.billing_currency

    if "contract_value_net" in data:
        raw = body.contract_value_net
        if raw is None:
            project.contract_value_net = None
        else:
            value = _money(raw)
            if value < 0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="contract_value_net cannot be negative.",
                )
            net_f, _, _ = sum_issued_invoice_amounts(db_session, budget_id)
            active_net = _money(net_f)
            if value < active_net:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Contract value cannot be lower than the active invoiced amount.",
                )
            project.contract_value_net = float(value)

    if "billing_currency" in data:
        project.billing_currency = body.billing_currency

    if project.billing_currency is None and project.contract_value_net is not None:
        project.billing_currency = DEFAULT_CURRENCY

    save_budget_project(db_session, project)
    new_net = (
        _money(project.contract_value_net) if project.contract_value_net is not None else None
    )
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.contract_value_updated",
        entity_type="budget",
        entity_id=str(project.id),
        company_id=project.company_id,
        details={
            "budget_id": str(project.id),
            "old_contract_value_net": str(old_net) if old_net is not None else None,
            "new_contract_value_net": str(new_net) if new_net is not None else None,
            "old_billing_currency": old_currency,
            "new_billing_currency": project.billing_currency,
        },
    )
    return get_billing_summary(db_session, actor, budget_id)


def list_invoices(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
) -> list[InvoiceResponse]:
    project = _load_budget(db_session, actor, budget_id)
    today_local = _company_local_today(db_session, project.company_id)
    rows = list_customer_invoices_for_budget(db_session, budget_id=budget_id)
    return [_invoice_response(db_session, row, today_local=today_local) for row in rows]


def get_invoice(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
) -> InvoiceResponse:
    _project, invoice = _load_invoice(db_session, actor, budget_id, invoice_id)
    return _invoice_response(db_session, invoice)


def create_invoice(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    body: InvoiceCreateRequest,
) -> InvoiceResponse:
    project = _load_budget(db_session, actor, budget_id)

    existing = get_customer_invoice_by_client_action_id(
        db_session,
        company_id=project.company_id,
        client_action_id=body.client_action_id,
    )
    if existing is not None:
        if existing.budget_id != budget_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="client_action_id already used for another invoice.",
            )
        return _invoice_response(db_session, existing)

    net, vat, gross = _validate_totals(body.net_amount, body.vat_amount, body.gross_amount)
    currency = (body.currency or DEFAULT_CURRENCY).strip().upper() or DEFAULT_CURRENCY

    if body.invoice_number:
        clash = get_customer_invoice_by_number(
            db_session,
            company_id=project.company_id,
            invoice_number=body.invoice_number.strip(),
        )
        if clash is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Invoice number already exists for this company.",
            )

    row = BudgetCustomerInvoice(
        company_id=project.company_id,
        budget_id=project.id,
        client_action_id=body.client_action_id,
        customer_name=body.customer_name.strip(),
        invoice_number=body.invoice_number.strip() if body.invoice_number else None,
        invoice_date=body.invoice_date,
        due_date=body.due_date,
        status="draft",
        currency=currency,
        net_amount=float(net),
        vat_amount=float(vat),
        gross_amount=float(gross),
        description=body.description,
        reference=body.reference,
        payment_terms=body.payment_terms,
        created_by_user_id=actor.id,
        updated_by_user_id=actor.id,
    )
    save_customer_invoice(db_session, row)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.invoice_created",
        entity_type="budget_invoice",
        entity_id=str(row.id),
        company_id=project.company_id,
        details={
            "budget_id": str(project.id),
            "invoice_id": str(row.id),
            "client_action_id": str(body.client_action_id),
            "net_amount": str(net),
            "vat_amount": str(vat),
            "gross_amount": str(gross),
            "currency": currency,
        },
    )
    return _invoice_response(db_session, row)


def patch_invoice(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
    body: InvoicePatchRequest,
) -> InvoiceResponse:
    project, invoice = _load_invoice(db_session, actor, budget_id, invoice_id)
    if invoice.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only draft invoices can be edited.",
        )

    data = body.model_dump(exclude_unset=True)
    changed: list[str] = []

    if "customer_name" in data and body.customer_name is not None:
        invoice.customer_name = body.customer_name
        changed.append("customer_name")
    if "invoice_number" in data:
        new_number = body.invoice_number.strip() if body.invoice_number else None
        if new_number:
            clash = get_customer_invoice_by_number(
                db_session,
                company_id=project.company_id,
                invoice_number=new_number,
            )
            if clash is not None and clash.id != invoice.id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Invoice number already exists for this company.",
                )
        invoice.invoice_number = new_number
        changed.append("invoice_number")
    if "invoice_date" in data:
        invoice.invoice_date = body.invoice_date
        changed.append("invoice_date")
    if "due_date" in data:
        invoice.due_date = body.due_date
        changed.append("due_date")
    if "currency" in data and body.currency is not None:
        invoice.currency = body.currency
        changed.append("currency")
    if "description" in data:
        invoice.description = body.description
        changed.append("description")
    if "reference" in data:
        invoice.reference = body.reference
        changed.append("reference")
    if "payment_terms" in data:
        invoice.payment_terms = body.payment_terms
        changed.append("payment_terms")

    amount_touched = any(k in data for k in ("net_amount", "vat_amount", "gross_amount"))
    if amount_touched:
        net = body.net_amount if "net_amount" in data and body.net_amount is not None else Decimal(str(invoice.net_amount))
        vat = body.vat_amount if "vat_amount" in data and body.vat_amount is not None else Decimal(str(invoice.vat_amount))
        gross = (
            body.gross_amount
            if "gross_amount" in data and body.gross_amount is not None
            else Decimal(str(invoice.gross_amount))
        )
        net, vat, gross = _validate_totals(net, vat, gross)
        invoice.net_amount = float(net)
        invoice.vat_amount = float(vat)
        invoice.gross_amount = float(gross)
        changed.extend([k for k in ("net_amount", "vat_amount", "gross_amount") if k in data])

    invoice.updated_by_user_id = actor.id
    save_customer_invoice(db_session, invoice)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.invoice_updated",
        entity_type="budget_invoice",
        entity_id=str(invoice.id),
        company_id=project.company_id,
        details={
            "budget_id": str(project.id),
            "invoice_id": str(invoice.id),
            "changed_fields": changed,
        },
    )
    return _invoice_response(db_session, invoice)


def issue_invoice(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
) -> InvoiceResponse:
    project, invoice = _load_invoice(db_session, actor, budget_id, invoice_id)
    if invoice.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only draft invoices can be issued.",
        )

    missing: list[str] = []
    if not (invoice.invoice_number or "").strip():
        missing.append("invoice_number")
    if invoice.invoice_date is None:
        missing.append("invoice_date")
    if invoice.due_date is None:
        missing.append("due_date")
    if not (invoice.customer_name or "").strip():
        missing.append("customer_name")
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Cannot issue invoice; missing: {', '.join(missing)}.",
        )

    _validate_totals(
        Decimal(str(invoice.net_amount)),
        Decimal(str(invoice.vat_amount)),
        Decimal(str(invoice.gross_amount)),
    )

    doc = get_current_invoice_document(db_session, invoice.id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A current invoice document is required before issuing.",
        )

    clash = get_customer_invoice_by_number(
        db_session,
        company_id=project.company_id,
        invoice_number=invoice.invoice_number.strip(),  # type: ignore[union-attr]
    )
    if clash is not None and clash.id != invoice.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Invoice number already exists for this company.",
        )

    now = datetime.now(timezone.utc)
    invoice.status = "issued"
    invoice.issued_at = now
    invoice.updated_by_user_id = actor.id
    save_customer_invoice(db_session, invoice)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.invoice_issued",
        entity_type="budget_invoice",
        entity_id=str(invoice.id),
        company_id=project.company_id,
        details={
            "budget_id": str(project.id),
            "invoice_id": str(invoice.id),
            "invoice_number": invoice.invoice_number,
            "net_amount": str(_money(invoice.net_amount)),
            "vat_amount": str(_money(invoice.vat_amount)),
            "gross_amount": str(_money(invoice.gross_amount)),
            "document_version": doc.version,
        },
    )
    return _invoice_response(db_session, invoice)


def void_invoice(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
    body: InvoiceVoidRequest,
) -> InvoiceResponse:
    from app.modules.budgets.payments import active_payments_total

    project, invoice = _load_invoice(db_session, actor, budget_id, invoice_id)
    if invoice.status != "issued":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only issued invoices can be voided.",
        )
    if not body.confirm:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="confirm must be true to void an invoice.",
        )

    if active_payments_total(db_session, invoice.id) > Decimal("0.00"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="An invoice with active payments cannot be voided until those payments are reversed.",
        )

    now = datetime.now(timezone.utc)
    invoice.status = "void"
    invoice.voided_at = now
    invoice.void_reason = body.reason
    invoice.updated_by_user_id = actor.id
    save_customer_invoice(db_session, invoice)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.invoice_voided",
        entity_type="budget_invoice",
        entity_id=str(invoice.id),
        company_id=project.company_id,
        details={
            "budget_id": str(project.id),
            "invoice_id": str(invoice.id),
            "invoice_number": invoice.invoice_number,
            "reason": body.reason,
        },
    )
    return _invoice_response(db_session, invoice)


def delete_invoice(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
) -> None:
    from app.core.storage.factory import get_storage_backend

    project, invoice = _load_invoice(db_session, actor, budget_id, invoice_id)
    if invoice.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only draft invoices can be deleted.",
        )

    docs = list_invoice_documents(db_session, invoice.id)
    paths = [d.storage_path for d in docs if d.storage_path]
    delete_customer_invoice(db_session, invoice.id)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.invoice_deleted",
        entity_type="budget_invoice",
        entity_id=str(invoice_id),
        company_id=project.company_id,
        details={
            "budget_id": str(project.id),
            "invoice_id": str(invoice_id),
            "document_count": len(docs),
        },
    )
    storage = get_storage_backend()
    for path in paths:
        try:
            storage.delete_file(path)
        except OSError:
            pass
