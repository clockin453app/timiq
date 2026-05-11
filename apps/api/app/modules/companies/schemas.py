import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CompanyCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.strip().split())

        if not normalized:
            raise ValueError("Company name is required.")

        return normalized


class CompanyUpdateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.strip().split())

        if not normalized:
            raise ValueError("Company name is required.")

        return normalized


class CompanyStatusUpdateRequest(BaseModel):
    is_active: bool


class CompanyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    is_active: bool
    default_tax_rate: Decimal | None = None
    created_at: datetime
    updated_at: datetime


class CompanyPayrollTaxPatchRequest(BaseModel):
    default_tax_rate: Decimal | None = Field(default=None, ge=0, le=100)


class CompanyTimePolicyResponse(BaseModel):
    company_id: uuid.UUID
    standard_start_time: str
    overtime_after_hours: float
    overtime_multiplier: float
    rounding_increment_minutes: int
    rounding_mode: str
    break_deduction_minutes: int
    break_deduction_after_minutes: int | None = None
    rule_effective_from: datetime
    rule_note: str
    timezone: str
    created_at: datetime
    updated_at: datetime


class CompanyTimePolicyPatchRequest(BaseModel):
    standard_start_time: str | None = Field(default=None, max_length=5)
    overtime_after_hours: float | None = Field(default=None, ge=0, le=24)
    overtime_multiplier: float | None = Field(default=None, ge=0, le=10)
    rounding_increment_minutes: int | None = Field(default=None, ge=0, le=480)
    rounding_mode: str | None = Field(default=None, max_length=16)
    break_deduction_minutes: int | None = Field(default=None, ge=0, le=480)
    break_deduction_after_minutes: int | None = Field(
        default=None,
        ge=0,
        le=10080,
        description="Apply automatic break deduction floor only after this many payable minutes (default 360).",
    )
    rule_effective_from: datetime | None = None
    rule_note: str | None = Field(default=None, max_length=4000)
    timezone: str | None = Field(default=None, max_length=64)

    @field_validator("standard_start_time")
    @classmethod
    def validate_standard_start(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        parts = cleaned.split(":")
        if len(parts) != 2:
            raise ValueError("standard_start_time must be HH:MM.")
        hour, minute = int(parts[0]), int(parts[1])
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError("standard_start_time must be HH:MM.")
        return f"{hour:02d}:{minute:02d}"

    @field_validator("rounding_mode")
    @classmethod
    def validate_rounding_mode(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        allowed = frozenset({"nearest", "up", "down", "none"})
        if normalized not in allowed:
            raise ValueError(f"rounding_mode must be one of {sorted(allowed)}.")
        return normalized