import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class OnboardingDocumentPublic(BaseModel):
    id: uuid.UUID
    doc_type: str
    original_filename: str
    content_type: str
    file_size_bytes: int
    created_at: datetime

    model_config = {"from_attributes": True}


class OnboardingSubmissionDetailResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    company_id: uuid.UUID | None
    status: str
    form_payload: dict[str, Any]
    signature_mode: str | None
    signature_typed_text: str | None
    has_drawn_signature: bool
    documents: list[OnboardingDocumentPublic]
    submitted_at: datetime | None
    reviewed_at: datetime | None
    review_note: str | None
    has_profile_photo: bool
    profile_photo_updated_at: datetime | None
    created_at: datetime
    updated_at: datetime


class OnboardingReviewListItemResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_email: str
    employee_name: str | None
    company_id: uuid.UUID | None
    company_name: str | None
    status: str
    submitted_at: datetime | None
    updated_at: datetime


class OnboardingReviewListResponse(BaseModel):
    items: list[OnboardingReviewListItemResponse]
    total: int


class OnboardingDraftPatchRequest(BaseModel):
    form_payload: dict[str, Any] = Field(default_factory=dict)


class OnboardingReviewReasonBody(BaseModel):
    reason: str = Field(..., min_length=3, max_length=2000)


class OnboardingTypedSignatureBody(BaseModel):
    text: str = Field(..., min_length=2, max_length=200)
