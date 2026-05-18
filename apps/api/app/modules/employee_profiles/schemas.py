import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class EmployeeProfileUpdateRequest(BaseModel):
    first_name: str | None = Field(default=None, max_length=120)
    last_name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    job_title: str | None = Field(default=None, max_length=120)
    national_insurance_number: str | None = Field(default=None, max_length=32)
    utr_number: str | None = Field(default=None, max_length=32)
    start_date: date | None = None
    emergency_contact_name: str | None = Field(default=None, max_length=120)
    emergency_contact_phone: str | None = Field(default=None, max_length=30)
    is_onboarded: bool | None = None
    early_access_enabled: bool | None = None
    hourly_rate: Decimal | None = Field(default=None, ge=0)
    tax_rate: Decimal | None = Field(default=None, ge=0, le=100)
    payment_mode: Literal["net_payment", "gross_payment"] | None = None


class FaceReferenceStatusResponse(BaseModel):
    face_check_consent_at: datetime | None = None
    face_reference_enrolled_at: datetime | None = None
    face_reference_updated_at: datetime | None = None
    face_reference_configured: bool = False


class EmployeeProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    company_id: uuid.UUID | None
    company_name: str | None = None
    first_name: str | None
    last_name: str | None
    phone: str | None
    job_title: str | None
    national_insurance_number: str | None = None
    utr_number: str | None = None
    start_date: date | None
    emergency_contact_name: str | None
    emergency_contact_phone: str | None
    is_onboarded: bool
    early_access_enabled: bool
    hourly_rate: Decimal | None = None
    tax_rate: Decimal | None = None
    payment_mode: str | None = None
    face_check_consent_at: datetime | None = None
    face_reference_enrolled_at: datetime | None = None
    face_reference_updated_at: datetime | None = None
    face_reference_configured: bool = False
    created_at: datetime
    updated_at: datetime
