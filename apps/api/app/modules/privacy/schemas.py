from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

REQUEST_TYPES = frozenset(
    {
        "data_access",
        "correction",
        "deletion",
        "gps_tracking_info",
        "document_copy",
        "other",
    },
)
REQUEST_STATUSES = frozenset({"submitted", "in_review", "completed", "rejected", "cancelled"})


class PrivacyInventorySection(BaseModel):
    title: str
    items: list[str]


class PrivacyInventoryResponse(BaseModel):
    version: str
    intro: str
    sections: list[PrivacyInventorySection]


class PrivacyAckRequest(BaseModel):
    policy_version: str = Field(..., min_length=1, max_length=64)


class PrivacyAckResponse(BaseModel):
    policy_version: str
    acknowledged_at: datetime


# --- Me summary (no sensitive values) ---


class PrivacyAccountSummary(BaseModel):
    email: str
    role: str
    company_name: str | None


class PrivacyProfileDataCategories(BaseModel):
    name_contact_stored: bool
    job_title_stored: bool
    emergency_contact_stored: bool
    national_insurance_number_stored: bool
    utr_stored: bool


class PrivacyTrackingCategories(BaseModel):
    clock_shift_records_count: int
    gps_may_be_recorded_at_clock_events: bool
    clock_selfie_records_count: int
    break_records_count: int


class PrivacyDocumentsCategories(BaseModel):
    onboarding_document_count: int
    work_progress_attachment_count: int


class PrivacyPayrollCategories(BaseModel):
    payroll_history_item_count: int
    paid_payroll_records_count: int


class PrivacyAuditCategories(BaseModel):
    description: str


class PrivacyMeSummaryResponse(BaseModel):
    account: PrivacyAccountSummary
    profile_data_categories: PrivacyProfileDataCategories
    tracking_categories: PrivacyTrackingCategories
    documents_categories: PrivacyDocumentsCategories
    payroll_categories: PrivacyPayrollCategories
    audit_categories: PrivacyAuditCategories
    retention_notice: str


# --- Privacy requests ---


class PrivacyMeRequestCreateRequest(BaseModel):
    request_type: str
    subject: str | None = Field(default=None, max_length=300)
    message: str = Field(..., min_length=1, max_length=8000)

    @field_validator("request_type")
    @classmethod
    def _rt(cls, v: str) -> str:
        s = v.strip().lower()
        if s not in REQUEST_TYPES:
            raise ValueError("Invalid request_type.")
        return s


class PrivacyMeRequestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID | None
    user_id: uuid.UUID
    request_type: str
    status: str
    subject: str | None
    message: str
    admin_response: str | None
    submitted_at: datetime
    updated_at: datetime
    completed_at: datetime | None


class PrivacyMeRequestCancelRequest(BaseModel):
    status: str = "cancelled"

    @field_validator("status")
    @classmethod
    def _st(cls, v: str) -> str:
        if v != "cancelled":
            raise ValueError("Only cancellation is allowed.")
        return v


class PrivacyAdminRequestListItem(BaseModel):
    id: uuid.UUID
    company_id: uuid.UUID | None
    user_id: uuid.UUID
    user_email: str
    requester_display: str
    request_type: str
    status: str
    subject: str | None
    submitted_at: datetime
    updated_at: datetime


class PrivacyAdminRequestDetailResponse(PrivacyMeRequestResponse):
    user_email: str
    requester_display: str


class PrivacyAdminRequestPatchRequest(BaseModel):
    status: str | None = None
    admin_response: str | None = Field(default=None, max_length=8000)

    @field_validator("status")
    @classmethod
    def _st(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip().lower()
        if s not in REQUEST_STATUSES:
            raise ValueError("Invalid status.")
        if s == "cancelled":
            raise ValueError("Admins cannot set cancelled status.")
        return s

    @field_validator("admin_response")
    @classmethod
    def _ar(cls, v: str | None) -> str | None:
        if v is None:
            return None
        t = v.strip()
        return t if t else None

    @model_validator(mode="after")
    def _need_update(self) -> PrivacyAdminRequestPatchRequest:
        if self.status is None and self.admin_response is None:
            raise ValueError("Provide status and/or admin_response.")
        return self
