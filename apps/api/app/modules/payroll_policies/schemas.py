from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

ROUNDING_INCREMENTS = frozenset({1, 5, 10, 15, 30, 60})
ROUNDING_MODES = frozenset({"nearest", "up", "down"})


def _trim_opt_str(v: str | None) -> str | None:
    if v is None:
        return None
    s = v.strip()
    return s or None


class SitePayrollPolicyUpsertRequest(BaseModel):
    is_enabled: bool = True
    standard_start_time: str | None = None
    allow_early_clock_in: bool | None = None
    break_deduction_after_minutes: int | None = Field(default=None, ge=0)
    break_deduction_minutes: int | None = Field(default=None, ge=0)
    rounding_increment_minutes: int | None = None
    rounding_mode: str | None = None
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("standard_start_time", mode="before")
    @classmethod
    def _std(cls, v: str | None) -> str | None:
        s = _trim_opt_str(v)
        if s is None:
            return None
        parts = s.split(":")
        if len(parts) != 2:
            raise ValueError("standard_start_time must be HH:MM.")
        h, m = int(parts[0]), int(parts[1])
        if not (0 <= h <= 23 and 0 <= m <= 59):
            raise ValueError("standard_start_time must be HH:MM.")
        return f"{h:02d}:{m:02d}"

    @field_validator("rounding_increment_minutes")
    @classmethod
    def _rinc(cls, v: int | None) -> int | None:
        if v is None:
            return None
        if v not in ROUNDING_INCREMENTS:
            raise ValueError(f"rounding_increment_minutes must be one of {sorted(ROUNDING_INCREMENTS)}.")
        return v

    @field_validator("rounding_mode", mode="before")
    @classmethod
    def _rmode(cls, v: str | None) -> str | None:
        s = _trim_opt_str(v)
        if s is None:
            return None
        sl = s.lower()
        if sl not in ROUNDING_MODES:
            raise ValueError("rounding_mode must be nearest, up, or down.")
        return sl


class CompanyTimePolicyFields(BaseModel):
    """Subset of company time policy for UI fallback display."""

    standard_start_time: str
    break_deduction_after_minutes: int | None
    break_deduction_minutes: int
    rounding_increment_minutes: int
    rounding_mode: str


class SitePayrollPolicyRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    location_id: uuid.UUID
    is_enabled: bool
    standard_start_time: str | None
    allow_early_clock_in: bool | None
    break_deduction_after_minutes: int | None
    break_deduction_minutes: int | None
    rounding_increment_minutes: int | None
    rounding_mode: str | None
    notes: str | None
    created_by_user_id: uuid.UUID | None
    updated_by_user_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class SitePayrollPolicyListItem(BaseModel):
    location_id: uuid.UUID
    location_name: str
    is_active: bool
    has_policy_row: bool
    is_enabled: bool


class SitePayrollPolicyListResponse(BaseModel):
    company_id: uuid.UUID
    items: list[SitePayrollPolicyListItem]


class SitePayrollPolicyEffectiveResponse(BaseModel):
    location_id: uuid.UUID
    location_name: str
    company_id: uuid.UUID
    company_fallback: CompanyTimePolicyFields
    override: SitePayrollPolicyRow | None
    merged_effective: CompanyTimePolicyFields
    policy_source: str  # "company" | "site"
