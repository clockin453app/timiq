from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class SmartFormTemplateCreateRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    company_id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    category: str = Field(min_length=1, max_length=64)
    status: str = Field(default="draft", max_length=32)
    schema_json: dict[str, Any]
    requires_location: bool = False
    requires_signature: bool = False
    allow_photos: bool = False


class SmartFormTemplatePatchRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    category: str | None = Field(default=None, min_length=1, max_length=64)
    status: str | None = Field(default=None, max_length=32)
    schema_json: dict[str, Any] | None = None
    requires_location: bool | None = None
    requires_signature: bool | None = None
    allow_photos: bool | None = None


class SmartFormTemplateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: uuid.UUID
    company_id: uuid.UUID | None
    name: str
    description: str | None
    category: str
    status: str
    version: int
    schema_json: dict[str, Any]
    requires_location: bool
    requires_signature: bool
    allow_photos: bool
    created_by_user_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


class SmartFormSubmissionCreateRequest(BaseModel):
    location_id: uuid.UUID | None = None


class SmartFormSubmissionPatchRequest(BaseModel):
    answers_json: dict[str, Any] | None = None
    location_id: uuid.UUID | None = None
    signature_name: str | None = Field(default=None, max_length=200)


class SmartFormSubmissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    template_id: uuid.UUID
    company_id: uuid.UUID
    submitted_by_user_id: uuid.UUID
    location_id: uuid.UUID | None
    status: str
    answers_json: dict[str, Any]
    submitted_at: datetime | None
    reviewed_by_user_id: uuid.UUID | None
    reviewed_at: datetime | None
    review_notes: str | None
    signature_name: str | None
    created_at: datetime
    updated_at: datetime


class SmartFormSubmissionWithTemplateResponse(SmartFormSubmissionResponse):
    template_name: str
    template_category: str


class SmartFormReviewRequest(BaseModel):
    decision: Literal["reviewed", "rejected"]
    review_notes: str | None = Field(default=None, max_length=2000)


class SmartFormReviewQueueItem(BaseModel):
    id: uuid.UUID
    template_id: uuid.UUID
    template_name: str
    template_category: str
    company_id: uuid.UUID
    submitted_by_user_id: uuid.UUID
    submitter_email: str
    submitter_display: str | None
    location_id: uuid.UUID | None
    location_name: str | None
    status: str
    submitted_at: datetime | None
    updated_at: datetime


class SmartFormReviewQueueResponse(BaseModel):
    items: list[SmartFormReviewQueueItem]
