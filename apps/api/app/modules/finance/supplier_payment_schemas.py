"""Input and output models for supplier payments. Company id is not accepted from the client."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.finance.supplier_payment_errors import SupplierPaymentError
from app.modules.finance.supplier_payment_rules import (
    PAYMENT_METHODS,
    require_payment_method,
    require_positive_money,
)


def _positive_money(value: object) -> Decimal:
    if isinstance(value, float):
        raise ValueError("Money values must be decimal amounts, not binary floats.")
    try:
        decimal_value = value if isinstance(value, Decimal) else Decimal(str(value))
        return require_positive_money(decimal_value)
    except SupplierPaymentError as exc:
        raise ValueError(exc.message) from exc


class SupplierPaymentDraftInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    counterparty_id: uuid.UUID | None = None
    payment_date: date | None = None
    payment_method: str | None = None
    external_reference: str | None = Field(default=None, max_length=120)
    amount: Decimal
    notes: str | None = None

    @field_validator("amount", mode="before")
    @classmethod
    def parse_amount(cls, value: object) -> Decimal:
        return _positive_money(value)

    @field_validator("payment_method")
    @classmethod
    def known_method(cls, value: str | None) -> str | None:
        if value is not None and value not in PAYMENT_METHODS:
            raise ValueError("Payment method is not supported.")
        try:
            return require_payment_method(value)
        except SupplierPaymentError as exc:
            raise ValueError(exc.message) from exc


class AllocationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cost_document_id: uuid.UUID
    amount: Decimal

    @field_validator("amount", mode="before")
    @classmethod
    def parse_amount(cls, value: object) -> Decimal:
        return _positive_money(value)


class AllocationBatchInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    allocations: list[AllocationInput] = Field(min_length=1)


class ReversalInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str | None = None


class PostingBlockerView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str


class SupplierPaymentValidationView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ready_to_post: bool
    blockers: list[PostingBlockerView]


class AllocationView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    payment_id: uuid.UUID
    cost_document_id: uuid.UUID
    allocation_number: int
    status: str
    amount: Decimal
    reversed: bool
    document_outstanding_amount: Decimal


class SupplierPaymentReversalView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    payment_id: uuid.UUID
    status: str
    amount: Decimal
    reason: str | None


class SupplierPaymentView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    company_id: uuid.UUID
    counterparty_id: uuid.UUID | None
    status: str
    payment_date: date | None
    payment_method: str | None
    external_reference: str | None
    normalized_reference: str | None
    currency_code: str
    amount: Decimal
    allocated_amount: Decimal
    available_amount: Decimal
    notes: str | None
    posted_at: datetime | None
    allocations: list[AllocationView]
    reversal: SupplierPaymentReversalView | None
