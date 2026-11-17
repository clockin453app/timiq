"""Pure cost-register calculations. No database and no cash settlement."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from app.modules.finance.cost_register_errors import (
    ALLOCATION_MISMATCH,
    INVALID_AMOUNT,
    REQUIRED_FIELD,
    UNPOSTABLE_DOCUMENT_TYPE,
    CostRegisterError,
)

MONEY_QUANTUM = Decimal("0.0001")
MONEY_MAX = Decimal("99999999999999.9999")
TAX_TREATMENTS = frozenset({"standard", "reduced", "zero", "exempt", "outside_scope"})
VAT_RECOVERABILITY_STATUSES = frozenset(
    {
        "not_determined",
        "confirmed_non_recoverable",
        "confirmed_recoverable",
        "accountant_review",
    }
)
UNCLASSIFIED_VAT = frozenset({"not_determined", "accountant_review"})
CONFIRMED_VAT = frozenset({"confirmed_non_recoverable", "confirmed_recoverable"})
POSTABLE_TYPES = frozenset(
    {"supplier_invoice", "expense_receipt", "supplier_credit", "reversal"}
)
UNPOSTABLE_TYPES = frozenset({"direct_cash", "accrual"})
POSITIVE_TYPES = frozenset(
    {"supplier_invoice", "expense_receipt", "direct_cash", "accrual"}
)
REFERENCE_REQUIRED_TYPES = frozenset({"supplier_invoice", "supplier_credit"})
# Supplier invoices and expense receipts may allocate across multiple Finance
# projects in the same company. Company overhead stays is_overhead with no project.
# Mixing overhead with project allocations on one document remains forbidden.
MULTI_PROJECT_DOCUMENT_TYPES = frozenset({"supplier_invoice", "expense_receipt"})
# Back-compat alias used by older call sites/tests.
SINGLE_PROJECT_DOCUMENT_TYPES = MULTI_PROJECT_DOCUMENT_TYPES


@dataclass(frozen=True)
class MoneyBreakdown:
    net_amount: Decimal
    tax_amount: Decimal
    recoverable_amount: Decimal
    non_recoverable_amount: Decimal
    eligible_amount: Decimal
    gross_amount: Decimal


@dataclass(frozen=True)
class AllocationDraft:
    allocation_number: int
    project_id: object | None
    cost_code_id: object | None
    is_overhead: bool
    amount_net: Decimal
    amount_non_recoverable: Decimal


@dataclass(frozen=True)
class LineDraft:
    line_number: int
    description: str | None
    net_amount: Decimal
    tax_treatment: str | None
    tax_amount: Decimal
    recoverable_amount: Decimal
    allocations: tuple[AllocationDraft, ...]
    vat_recoverability_status: str | None = None


@dataclass(frozen=True)
class DocumentDraft:
    document_type: str
    counterparty_id: object | None
    normalized_reference: str | None
    service_date: date | None
    document_date: date | None
    tax_point_date: date | None
    credited_document_id: object | None
    reverses_document_id: object | None
    lines: tuple[LineDraft, ...]
    vat_status_enforced: bool = False


@dataclass(frozen=True)
class PostingBlocker:
    code: str
    message: str


def require_money(value: Decimal) -> Decimal:
    """Accept a Decimal that already fits NUMERIC(18,4). Reject floats elsewhere."""
    if not isinstance(value, Decimal):
        raise CostRegisterError(INVALID_AMOUNT, "Money values must be decimal amounts.")
    if value != value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP) or abs(value) > MONEY_MAX:
        raise CostRegisterError(
            INVALID_AMOUNT,
            "Money values must fit NUMERIC(18,4) without rounding away a remainder.",
        )
    return value


def unclassified_amounts(net_amount: Decimal, tax_amount: Decimal) -> MoneyBreakdown:
    """Record the supplier VAT figure without classifying it or adding it to project cost."""
    net = require_money(net_amount)
    tax = require_money(tax_amount)
    zero = Decimal("0.0000")
    return MoneyBreakdown(net, tax, zero, zero, net, require_money(net + tax))


def line_amounts(net_amount: Decimal, tax_amount: Decimal, recoverable_amount: Decimal) -> MoneyBreakdown:
    net = require_money(net_amount)
    tax = require_money(tax_amount)
    recoverable = require_money(recoverable_amount)
    non_recoverable = require_money(tax - recoverable)
    eligible = require_money(net + non_recoverable)
    gross = require_money(net + tax)
    return MoneyBreakdown(net, tax, recoverable, non_recoverable, eligible, gross)


def allocation_eligible(amount_net: Decimal, amount_non_recoverable: Decimal) -> Decimal:
    return require_money(require_money(amount_net) + require_money(amount_non_recoverable))


def normalize_reference(value: str | None) -> str | None:
    if value is None:
        return None
    collapsed = " ".join(value.strip().split()).upper()
    return collapsed or None


def posting_blockers(
    document: DocumentDraft,
    *,
    source_projects: frozenset[object] | None = None,
    source_overhead_only: bool = False,
) -> list[PostingBlocker]:
    """Return why a draft cannot be posted. An empty list means the shape is complete."""
    blockers: list[PostingBlocker] = []
    if document.document_type in UNPOSTABLE_TYPES:
        blockers.append(
            PostingBlocker(
                UNPOSTABLE_DOCUMENT_TYPE,
                "Direct cash and accrual documents cannot be posted until settlement exists.",
            )
        )
        return blockers
    if document.document_type not in POSTABLE_TYPES:
        blockers.append(PostingBlocker(REQUIRED_FIELD, "Document type is not supported."))
        return blockers
    if document.counterparty_id is None:
        blockers.append(PostingBlocker(REQUIRED_FIELD, "A counterparty is required before posting."))
    if document.service_date is None or document.document_date is None or document.tax_point_date is None:
        blockers.append(
            PostingBlocker(
                REQUIRED_FIELD,
                "Service date, document date, and tax point date are required before posting.",
            )
        )
    if document.document_type in REFERENCE_REQUIRED_TYPES and not document.normalized_reference:
        blockers.append(PostingBlocker(REQUIRED_FIELD, "A supplier reference is required before posting."))
    if document.document_type == "supplier_credit" and document.credited_document_id is None:
        blockers.append(PostingBlocker(REQUIRED_FIELD, "A supplier credit must name its source document."))
    if document.document_type == "reversal" and document.reverses_document_id is None:
        blockers.append(PostingBlocker(REQUIRED_FIELD, "A reversal must name its source document."))
    if document.document_type != "supplier_credit" and document.credited_document_id is not None:
        blockers.append(PostingBlocker(REQUIRED_FIELD, "Only a supplier credit can name a credited document."))
    if document.document_type != "reversal" and document.reverses_document_id is not None:
        blockers.append(PostingBlocker(REQUIRED_FIELD, "Only a reversal can name a reversed document."))
    if not document.lines:
        blockers.append(PostingBlocker(REQUIRED_FIELD, "A posted document needs at least one line."))
    if document.vat_status_enforced:
        for line in document.lines:
            if line.vat_recoverability_status not in CONFIRMED_VAT:
                blockers.append(
                    PostingBlocker(
                        REQUIRED_FIELD,
                        "VAT recoverability must be confirmed before posting. "
                        "Unknown VAT is not treated as non-recoverable.",
                    )
                )
                break

    sign = _sign(document.document_type)
    for line in document.lines:
        blockers.extend(_line_blockers(line, sign))
    blockers.extend(
        _project_scope_blockers(
            document,
            source_projects=source_projects,
            source_overhead_only=source_overhead_only,
        )
    )
    return blockers


def _allocations(document: DocumentDraft) -> list[AllocationDraft]:
    return [allocation for line in document.lines for allocation in line.allocations]


def _project_scope_blockers(
    document: DocumentDraft,
    *,
    source_projects: frozenset[object] | None,
    source_overhead_only: bool,
) -> list[PostingBlocker]:
    allocations = _allocations(document)
    if document.document_type in MULTI_PROJECT_DOCUMENT_TYPES:
        overhead = [item for item in allocations if item.is_overhead]
        project_rows = [item for item in allocations if not item.is_overhead]
        projects = {item.project_id for item in project_rows if item.project_id is not None}
        if overhead and project_rows:
            return [
                PostingBlocker(
                    REQUIRED_FIELD,
                    "A new supplier document cannot mix company overhead with a project. "
                    "Record the overhead on its own document.",
                )
            ]
        if overhead:
            return []
        if not projects:
            return [
                PostingBlocker(
                    REQUIRED_FIELD,
                    "A supplier invoice needs at least one Finance project, "
                    "or must be marked as company overhead.",
                )
            ]
        # Multiple projects in the same company are allowed. Cross-company
        # project ownership is enforced in the cost-register service.
        return []
    if document.document_type != "supplier_credit" or source_projects is None:
        return []
    credit_projects = {item.project_id for item in allocations if not item.is_overhead and item.project_id is not None}
    credit_has_project = any(not item.is_overhead for item in allocations)
    credit_has_overhead = any(item.is_overhead for item in allocations)
    if source_overhead_only and credit_has_project:
        return [
            PostingBlocker(
                REQUIRED_FIELD,
                "A credit against a company-overhead document must stay company overhead.",
            )
        ]
    if credit_projects - set(source_projects):
        return [
            PostingBlocker(
                REQUIRED_FIELD,
                "A supplier credit can use only projects stored on its source invoice.",
            )
        ]
    if len(source_projects) == 1 and credit_has_project and credit_projects != set(source_projects):
        return [
            PostingBlocker(
                REQUIRED_FIELD,
                "A credit against a one-project invoice must use that same project.",
            )
        ]
    if credit_has_overhead and credit_has_project:
        return [
            PostingBlocker(
                REQUIRED_FIELD,
                "A supplier credit cannot mix company overhead with a project.",
            )
        ]
    return []


def cost_audit_snapshot(
    *,
    document_type: str,
    status: str,
    external_reference: str | None,
    currency_code: str,
    net_amount: Decimal,
    tax_amount: Decimal,
    recoverable_amount: Decimal,
    non_recoverable_amount: Decimal,
    eligible_amount: Decimal,
    gross_amount: Decimal,
    project_ids: list[str],
) -> dict[str, object]:
    """Facts stored with the cost-document audit event. This is not a payment."""
    return {
        "document_type": document_type,
        "status": status,
        "external_reference": external_reference,
        "currency_code": currency_code,
        "net_amount": str(net_amount),
        "tax_amount": str(tax_amount),
        "recoverable_amount": str(recoverable_amount),
        "non_recoverable_amount": str(non_recoverable_amount),
        "eligible_amount": str(eligible_amount),
        "gross_amount": str(gross_amount),
        "project_ids": project_ids,
    }


def _sign(document_type: str) -> int:
    if document_type == "supplier_credit":
        return -1
    if document_type in POSITIVE_TYPES:
        return 1
    return 0


def _line_blockers(line: LineDraft, sign: int) -> list[PostingBlocker]:
    blockers: list[PostingBlocker] = []
    if line.vat_recoverability_status in UNCLASSIFIED_VAT:
        blockers.append(
            PostingBlocker(
                REQUIRED_FIELD,
                "VAT recoverability is not determined. Posting stays blocked.",
            )
        )
        return blockers
    if line.vat_recoverability_status == "confirmed_non_recoverable" and line.recoverable_amount != 0:
        blockers.append(
            PostingBlocker(
                INVALID_AMOUNT,
                "Confirmed non-recoverable VAT must record recoverable VAT as zero.",
            )
        )
    amounts = line_amounts(line.net_amount, line.tax_amount, line.recoverable_amount)
    if line.tax_treatment not in TAX_TREATMENTS:
        blockers.append(PostingBlocker(REQUIRED_FIELD, "Each posted line needs an allowed tax treatment."))
    if sign > 0 and (
        amounts.net_amount < 0
        or amounts.tax_amount < 0
        or amounts.recoverable_amount < 0
        or amounts.non_recoverable_amount < 0
        or amounts.eligible_amount < 0
    ):
        blockers.append(PostingBlocker(INVALID_AMOUNT, "A positive cost document cannot contain negative lines."))
    if sign < 0 and (
        amounts.net_amount > 0
        or amounts.tax_amount > 0
        or amounts.recoverable_amount > 0
        or amounts.non_recoverable_amount > 0
        or amounts.eligible_amount > 0
    ):
        blockers.append(PostingBlocker(INVALID_AMOUNT, "A supplier credit cannot contain positive lines."))
    if amounts.tax_amount >= 0:
        if amounts.recoverable_amount < 0 or amounts.recoverable_amount > amounts.tax_amount:
            blockers.append(
                PostingBlocker(INVALID_AMOUNT, "Recoverable VAT must sit between zero and the line VAT.")
            )
    elif amounts.recoverable_amount > 0 or amounts.recoverable_amount < amounts.tax_amount:
        blockers.append(
            PostingBlocker(INVALID_AMOUNT, "Recoverable VAT on a credit must sit between the line VAT and zero.")
        )
    if not line.allocations:
        blockers.append(PostingBlocker(ALLOCATION_MISMATCH, "Each posted line needs an allocation."))
        return blockers
    net_sum = Decimal("0")
    non_recoverable_sum = Decimal("0")
    for allocation in line.allocations:
        blockers.extend(_allocation_blockers(allocation, sign))
        net_sum += allocation.amount_net
        non_recoverable_sum += allocation.amount_non_recoverable
    if net_sum != amounts.net_amount or non_recoverable_sum != amounts.non_recoverable_amount:
        blockers.append(
            PostingBlocker(
                ALLOCATION_MISMATCH,
                "Allocation totals must equal the line net and non-recoverable VAT. "
                "Nothing is assigned to a project automatically.",
            )
        )
    return blockers


def _allocation_blockers(allocation: AllocationDraft, sign: int) -> list[PostingBlocker]:
    blockers: list[PostingBlocker] = []
    if allocation.is_overhead and allocation.project_id is not None:
        blockers.append(PostingBlocker(REQUIRED_FIELD, "An overhead allocation cannot also name a project."))
    if not allocation.is_overhead and allocation.project_id is None:
        blockers.append(PostingBlocker(REQUIRED_FIELD, "A project allocation must name a Finance project."))
    if allocation.cost_code_id is None:
        blockers.append(PostingBlocker(REQUIRED_FIELD, "Each posted allocation must name a cost code."))
    if sign > 0 and (allocation.amount_net < 0 or allocation.amount_non_recoverable < 0):
        blockers.append(PostingBlocker(INVALID_AMOUNT, "A positive cost document cannot contain negative allocations."))
    if sign < 0 and (allocation.amount_net > 0 or allocation.amount_non_recoverable > 0):
        blockers.append(PostingBlocker(INVALID_AMOUNT, "A supplier credit cannot contain positive allocations."))
    return blockers
