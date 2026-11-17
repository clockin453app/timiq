"""Input and output models for the cost register. Company id is not accepted from the client."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.finance.cost_register_errors import CostRegisterError
from app.modules.finance.cost_register_rules import (
    TAX_TREATMENTS,
    VAT_RECOVERABILITY_STATUSES,
    require_money,
)

DocumentType = Literal[
    "supplier_invoice",
    "expense_receipt",
    "supplier_credit",
    "reversal",
    "direct_cash",
    "accrual",
]
TaxTreatment = Literal["standard", "reduced", "zero", "exempt", "outside_scope"]


def _money(value: object) -> Decimal:
    if isinstance(value, float):
        raise ValueError("Money values must be decimal amounts, not binary floats.")
    try:
        decimal_value = value if isinstance(value, Decimal) else Decimal(str(value))
        return require_money(decimal_value)
    except CostRegisterError as exc:
        raise ValueError(exc.message) from exc


class CostAllocationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    allocation_number: int = Field(ge=1)
    project_id: uuid.UUID | None = None
    cost_code_id: uuid.UUID | None = None
    is_overhead: bool = False
    amount_net: Decimal = Decimal("0")
    amount_non_recoverable: Decimal = Decimal("0")

    @field_validator("amount_net", "amount_non_recoverable", mode="before")
    @classmethod
    def parse_money(cls, value: object) -> Decimal:
        return _money(value)


class CostLineInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    line_number: int = Field(ge=1)
    description: str | None = Field(default=None, max_length=500)
    net_amount: Decimal = Decimal("0")
    tax_treatment: TaxTreatment | None = None
    tax_amount: Decimal = Decimal("0")
    recoverable_amount: Decimal = Decimal("0")
    vat_recoverability_status: str | None = None
    allocations: list[CostAllocationInput] = Field(default_factory=list)

    @field_validator("net_amount", "tax_amount", "recoverable_amount", mode="before")
    @classmethod
    def parse_money(cls, value: object) -> Decimal:
        return _money(value)

    @field_validator("tax_treatment")
    @classmethod
    def known_treatment(cls, value: str | None) -> str | None:
        if value is not None and value not in TAX_TREATMENTS:
            raise ValueError("Tax treatment is not supported.")
        return value

    @field_validator("vat_recoverability_status")
    @classmethod
    def known_recoverability(cls, value: str | None) -> str | None:
        if value is not None and value not in VAT_RECOVERABILITY_STATUSES:
            raise ValueError("VAT recoverability status is not supported.")
        return value


class CostDraftInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_type: DocumentType
    counterparty_id: uuid.UUID | None = None
    external_reference: str | None = Field(default=None, max_length=120)
    service_date: date | None = None
    document_date: date | None = None
    tax_point_date: date | None = None
    due_date: date | None = None
    notes: str | None = None
    credited_document_id: uuid.UUID | None = None
    reverses_document_id: uuid.UUID | None = None
    lines: list[CostLineInput] = Field(default_factory=list)


class PostingBlockerView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str


class ValidationView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ready_to_post: bool
    blockers: list[PostingBlockerView]
    cash_settlement: Literal["unavailable"] = "unavailable"


class CostAllocationView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    allocation_number: int
    project_id: uuid.UUID | None
    cost_code_id: uuid.UUID | None
    is_overhead: bool
    amount_net: Decimal
    amount_non_recoverable: Decimal
    amount_eligible: Decimal


class CostLineView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    line_number: int
    description: str | None
    net_amount: Decimal
    tax_treatment: str | None
    tax_amount: Decimal
    recoverable_amount: Decimal
    non_recoverable_amount: Decimal
    eligible_amount: Decimal
    vat_recoverability_status: str | None = None
    allocations: list[CostAllocationView]


class CostDocumentView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    company_id: uuid.UUID
    document_type: str
    status: str
    counterparty_id: uuid.UUID | None
    external_reference: str | None
    normalized_reference: str | None
    service_date: date | None
    document_date: date | None
    tax_point_date: date | None
    due_date: date | None
    currency_code: str
    net_amount: Decimal
    tax_amount: Decimal
    recoverable_amount: Decimal
    non_recoverable_amount: Decimal
    eligible_amount: Decimal
    gross_amount: Decimal
    vat_recoverability_status: str | None = None
    credited_document_id: uuid.UUID | None
    reverses_document_id: uuid.UUID | None
    notes: str | None
    posted_at: datetime | None
    lines: list[CostLineView]
    cash_settlement: Literal["unavailable"] = "unavailable"


class PostingResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document: CostDocumentView
    audit_event_id: uuid.UUID
