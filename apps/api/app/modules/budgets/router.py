import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.core.export_csv import safe_export_filename
from app.core.storage.file_response import content_disposition_attachment, protected_file_response
from app.db.session import get_db_session
from app.modules.auth.dependencies import require_admin_or_administrator
from app.modules.auth.models import User
from app.modules.budgets.billing import (
    create_invoice,
    delete_invoice,
    get_billing_summary,
    get_invoice,
    issue_invoice,
    list_invoices,
    patch_invoice,
    update_contract_value,
    void_invoice,
)
from app.modules.budgets.invoice_documents import download_invoice_document, upload_invoice_document
from app.modules.budgets.payments import create_payment, list_payments, reverse_payment
from app.modules.budgets.schemas import (
    BillingSummaryResponse,
    BudgetExpenseCreateRequest,
    BudgetExpensePatchRequest,
    BudgetExpenseResponse,
    BudgetProjectCreateRequest,
    BudgetProjectDetailResponse,
    BudgetProjectPatchRequest,
    BudgetProjectSummary,
    ContractValueUpdateRequest,
    InvoiceCreateRequest,
    InvoicePatchRequest,
    InvoiceResponse,
    InvoiceVoidRequest,
    LabourCostResponse,
    PaymentCreateRequest,
    PaymentResponse,
    PaymentReverseRequest,
)
from app.modules.budgets.saved_budgets import (
    archive_budget,
    create_budget,
    create_expense,
    export_budget_csv,
    export_budget_print_html,
    get_budget_detail,
    list_expenses_api,
    list_saved_budgets,
    patch_budget,
    patch_expense,
    remove_expense,
)
from app.modules.budgets.service import labour_cost_budget

router = APIRouter(prefix="/api/budgets", tags=["budgets"])


def _opt_date(raw: str | None) -> date | None:
    if raw is None or str(raw).strip() == "":
        return None
    try:
        return date.fromisoformat(raw.strip())
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid date (use YYYY-MM-DD).",
        ) from exc


def _opt_planned_budget(raw: str | None) -> Decimal | None:
    if raw is None or str(raw).strip() == "":
        return None
    try:
        return Decimal(str(raw).strip())
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="planned_budget_amount must be a decimal number.",
        ) from exc


def _require_iso_date(label: str, raw: str) -> date:
    if not raw or not str(raw).strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{label} is required.",
        )
    try:
        return date.fromisoformat(str(raw).strip())
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{label} must be YYYY-MM-DD.",
        ) from exc


@router.get("/labour-cost", response_model=LabourCostResponse)
def get_labour_cost_budget(
    date_from: str = Query(..., description="Inclusive local start date (YYYY-MM-DD) in company policy timezone."),
    date_to: str = Query(..., description="Inclusive local end date (YYYY-MM-DD) in company policy timezone."),
    company_id: uuid.UUID | None = Query(
        default=None,
        description="Required for administrators; ignored for company admins (own company enforced).",
    ),
    location_id: uuid.UUID | None = Query(default=None),
    user_id: uuid.UUID | None = Query(default=None),
    workplace_id: uuid.UUID | None = Query(default=None),
    planned_budget_amount: str | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> LabourCostResponse:
    return labour_cost_budget(
        db_session,
        current_user,
        company_id=company_id,
        date_from=_require_iso_date("date_from", date_from),
        date_to=_require_iso_date("date_to", date_to),
        location_id=location_id,
        user_id=user_id,
        workplace_id=workplace_id,
        planned_budget_amount=_opt_planned_budget(planned_budget_amount),
    )


@router.get("", response_model=list[BudgetProjectSummary])
def list_budgets(
    company_id: uuid.UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    location_id: uuid.UUID | None = Query(default=None),
    workplace_id: uuid.UUID | None = Query(default=None),
    search: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[BudgetProjectSummary]:
    return list_saved_budgets(
        db_session,
        current_user,
        company_id=company_id,
        status=status,
        location_id=location_id,
        workplace_id=workplace_id,
        search=search,
        date_from=_opt_date(date_from),
        date_to=_opt_date(date_to),
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=BudgetProjectDetailResponse)
def create_budget_route(
    body: BudgetProjectCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> BudgetProjectDetailResponse:
    return create_budget(db_session, current_user, body)


@router.get("/{budget_id}/report.csv")
def download_budget_report_csv(
    budget_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
):
    body, _fname = export_budget_csv(db_session, current_user, budget_id)
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": content_disposition_attachment(safe_export_filename("budget-report", str(budget_id)) + ".csv")},
    )


@router.get("/{budget_id}/report.print")
def print_budget_report(
    budget_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    html_body = export_budget_print_html(db_session, current_user, budget_id)
    return Response(
        content=html_body,
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": 'inline; filename="budget-report.html"'},
    )


@router.get("/{budget_id}/expenses", response_model=list[BudgetExpenseResponse])
def read_budget_expenses(
    budget_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[BudgetExpenseResponse]:
    return list_expenses_api(db_session, current_user, budget_id)


@router.post("/{budget_id}/expenses", response_model=BudgetExpenseResponse)
def add_budget_expense(
    budget_id: uuid.UUID,
    body: BudgetExpenseCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> BudgetExpenseResponse:
    return create_expense(db_session, current_user, budget_id, body)


@router.patch("/{budget_id}/expenses/{expense_id}", response_model=BudgetExpenseResponse)
def update_budget_expense(
    budget_id: uuid.UUID,
    expense_id: uuid.UUID,
    body: BudgetExpensePatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> BudgetExpenseResponse:
    return patch_expense(db_session, current_user, budget_id, expense_id, body)


@router.delete("/{budget_id}/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_budget_expense_route(
    budget_id: uuid.UUID,
    expense_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> None:
    remove_expense(db_session, current_user, budget_id, expense_id)


@router.patch("/{budget_id}/contract-value", response_model=BillingSummaryResponse)
def patch_budget_contract_value(
    budget_id: uuid.UUID,
    body: ContractValueUpdateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> BillingSummaryResponse:
    return update_contract_value(db_session, current_user, budget_id, body)


@router.get("/{budget_id}/billing-summary", response_model=BillingSummaryResponse)
def read_billing_summary(
    budget_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> BillingSummaryResponse:
    return get_billing_summary(db_session, current_user, budget_id)


@router.get("/{budget_id}/invoices", response_model=list[InvoiceResponse])
def read_budget_invoices(
    budget_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[InvoiceResponse]:
    return list_invoices(db_session, current_user, budget_id)


@router.post("/{budget_id}/invoices", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED)
def add_budget_invoice(
    budget_id: uuid.UUID,
    body: InvoiceCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> InvoiceResponse:
    return create_invoice(db_session, current_user, budget_id, body)


@router.get("/{budget_id}/invoices/{invoice_id}", response_model=InvoiceResponse)
def read_budget_invoice(
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> InvoiceResponse:
    return get_invoice(db_session, current_user, budget_id, invoice_id)


@router.patch("/{budget_id}/invoices/{invoice_id}", response_model=InvoiceResponse)
def update_budget_invoice(
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
    body: InvoicePatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> InvoiceResponse:
    return patch_invoice(db_session, current_user, budget_id, invoice_id, body)


@router.delete("/{budget_id}/invoices/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_budget_invoice_route(
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> None:
    delete_invoice(db_session, current_user, budget_id, invoice_id)


@router.post("/{budget_id}/invoices/{invoice_id}/issue", response_model=InvoiceResponse)
def issue_budget_invoice(
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> InvoiceResponse:
    return issue_invoice(db_session, current_user, budget_id, invoice_id)


@router.post("/{budget_id}/invoices/{invoice_id}/void", response_model=InvoiceResponse)
def void_budget_invoice(
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
    body: InvoiceVoidRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> InvoiceResponse:
    return void_invoice(db_session, current_user, budget_id, invoice_id, body)


@router.get("/{budget_id}/invoices/{invoice_id}/payments", response_model=list[PaymentResponse])
def read_invoice_payments(
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[PaymentResponse]:
    return list_payments(db_session, current_user, budget_id, invoice_id)


@router.post(
    "/{budget_id}/invoices/{invoice_id}/payments",
    response_model=PaymentResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_invoice_payment(
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
    body: PaymentCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> PaymentResponse:
    return create_payment(db_session, current_user, budget_id, invoice_id, body)


@router.post(
    "/{budget_id}/invoices/{invoice_id}/payments/{payment_id}/reverse",
    response_model=PaymentResponse,
)
def reverse_invoice_payment(
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
    payment_id: uuid.UUID,
    body: PaymentReverseRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> PaymentResponse:
    return reverse_payment(db_session, current_user, budget_id, invoice_id, payment_id, body)


@router.post("/{budget_id}/invoices/{invoice_id}/document", response_model=InvoiceResponse)
async def upload_budget_invoice_document(
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
    file: UploadFile = File(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> InvoiceResponse:
    raw = await file.read()
    return upload_invoice_document(
        db_session,
        current_user,
        budget_id,
        invoice_id,
        file_bytes=raw,
        filename=file.filename,
        content_type=file.content_type,
    )


@router.get("/{budget_id}/invoices/{invoice_id}/document")
def download_budget_invoice_document(
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    body, filename, media_type = download_invoice_document(
        db_session,
        current_user,
        budget_id,
        invoice_id,
    )
    return protected_file_response(body=body, download_filename=filename, media_type=media_type)


@router.post("/{budget_id}/archive", response_model=BudgetProjectDetailResponse)
def archive_budget_route(
    budget_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> BudgetProjectDetailResponse:
    return archive_budget(db_session, current_user, budget_id)


@router.get("/{budget_id}", response_model=BudgetProjectDetailResponse)
def read_budget(
    budget_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> BudgetProjectDetailResponse:
    return get_budget_detail(db_session, current_user, budget_id)


@router.patch("/{budget_id}", response_model=BudgetProjectDetailResponse)
def update_budget(
    budget_id: uuid.UUID,
    body: BudgetProjectPatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> BudgetProjectDetailResponse:
    return patch_budget(db_session, current_user, budget_id, body)
