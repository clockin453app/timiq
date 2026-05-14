from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

PROVIDER_KEYS = frozenset(
    {
        "none",
        "quickbooks_desktop",
        "xero",
        "sage",
        "csv_export_only",
        "other",
    },
)

EXPORT_CSV_PROVIDERS = frozenset({"xero", "quickbooks", "sage", "generic_csv"})

PayrollExportType = Literal["payroll_summary", "payroll_items"]


class AccountingSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    company_id: uuid.UUID
    provider_key: str
    notes: str | None
    updated_by_user_id: uuid.UUID | None
    updated_at: datetime | None


class AccountingSettingsUpsertRequest(BaseModel):
    company_id: uuid.UUID | None = None
    provider_key: str = Field(..., max_length=64)
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("provider_key")
    @classmethod
    def _provider(cls, v: str) -> str:
        s = v.strip().lower()
        if s not in PROVIDER_KEYS:
            raise ValueError("Invalid provider.")
        return s


class AccountingPayrollExportRequest(BaseModel):
    provider: str
    company_id: uuid.UUID | None = Field(
        default=None,
        description="Required for global administrators.",
    )
    date_from: date
    date_to: date
    export_type: PayrollExportType = "payroll_items"
    include_approved: bool = True
    include_paid: bool = True
    include_pending: bool = False
    include_email: bool = True

    @field_validator("provider", mode="before")
    @classmethod
    def _export_provider(cls, v: str) -> str:
        s = str(v).strip().lower()
        if s not in EXPORT_CSV_PROVIDERS:
            raise ValueError("Invalid export provider.")
        return s


class AccountingBudgetExportRequest(BaseModel):
    provider: str

    @field_validator("provider", mode="before")
    @classmethod
    def _export_provider(cls, v: str) -> str:
        s = str(v).strip().lower()
        if s not in EXPORT_CSV_PROVIDERS:
            raise ValueError("Invalid export provider.")
        return s


class AccountingExportRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    provider: str
    export_type: str
    date_from: date
    date_to: date
    status: str
    created_by_user_id: uuid.UUID | None
    created_at: datetime
    row_count: int
    total_amount: Decimal | None
    file_name: str
    notes: str | None


class AccountingExportRunListResponse(BaseModel):
    items: list[AccountingExportRunResponse]


class AccountingProviderExportType(BaseModel):
    id: str
    label: str


class AccountingProviderManifest(BaseModel):
    id: str
    label: str
    export_types: list[AccountingProviderExportType]


class AccountingProvidersResponse(BaseModel):
    providers: list[AccountingProviderManifest]
    disclaimer: str = (
        "Export-ready CSV only. This is not a certified Xero, QuickBooks, or Sage integration. "
        "Direct OAuth sync is not implemented in this version."
    )


class AccountingExportMappingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    company_id: uuid.UUID
    provider: str
    nominal_code_wages: str | None
    nominal_code_cis: str | None
    nominal_code_materials: str | None
    nominal_code_tools: str | None
    nominal_code_equipment: str | None
    nominal_code_subcontractor: str | None
    tax_code: str | None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AccountingExportMappingPatchRequest(BaseModel):
    company_id: uuid.UUID | None = Field(default=None, description="Required for global administrators.")
    provider: str
    nominal_code_wages: str | None = Field(default=None, max_length=64)
    nominal_code_cis: str | None = Field(default=None, max_length=64)
    nominal_code_materials: str | None = Field(default=None, max_length=64)
    nominal_code_tools: str | None = Field(default=None, max_length=64)
    nominal_code_equipment: str | None = Field(default=None, max_length=64)
    nominal_code_subcontractor: str | None = Field(default=None, max_length=64)
    tax_code: str | None = Field(default=None, max_length=64)

    @field_validator("provider", mode="before")
    @classmethod
    def _export_provider(cls, v: str) -> str:
        s = str(v).strip().lower()
        if s not in EXPORT_CSV_PROVIDERS:
            raise ValueError("Invalid export provider.")
        return s

    @staticmethod
    def _trim(v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        return s or None

    @field_validator(
        "nominal_code_wages",
        "nominal_code_cis",
        "nominal_code_materials",
        "nominal_code_tools",
        "nominal_code_equipment",
        "nominal_code_subcontractor",
        "tax_code",
        mode="before",
    )
    @classmethod
    def _trim_nominals(cls, v: str | None) -> str | None:
        return AccountingExportMappingPatchRequest._trim(v)
