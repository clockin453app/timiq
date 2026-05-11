import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field


class WorkProgressLocationOption(BaseModel):
    id: uuid.UUID
    name: str
    address: str | None = None


class WorkProgressMeOptionsResponse(BaseModel):
    locations: list[WorkProgressLocationOption]
    max_attachments_per_entry: int
    max_original_image_bytes: int


class WorkProgressAttachmentPublic(BaseModel):
    id: uuid.UUID
    original_filename: str
    content_type: str
    file_size_bytes: int
    original_size_bytes: int | None = None
    stored_size_bytes: int | None = None
    stored_content_type: str | None = None
    image_width: int | None = None
    image_height: int | None = None
    processing_version: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class WorkProgressEntryListItem(BaseModel):
    id: uuid.UUID
    work_date: date
    title: str
    progress_status: str
    percent_complete: int | None
    status: str
    location_name: str
    workplace_name: str | None
    created_at: datetime
    updated_at: datetime
    attachments: list[WorkProgressAttachmentPublic] = Field(default_factory=list)


class WorkProgressEntryDetailResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    company_id: uuid.UUID
    workplace_id: uuid.UUID | None
    workplace_name: str | None
    location_id: uuid.UUID
    location_name: str
    work_date: date
    title: str
    progress_status: str
    notes: str | None
    percent_complete: int | None
    status: str
    reviewed_at: datetime | None
    review_note: str | None
    attachments: list[WorkProgressAttachmentPublic]
    created_at: datetime
    updated_at: datetime


class WorkProgressMeListResponse(BaseModel):
    items: list[WorkProgressEntryListItem]
    total: int


class WorkProgressCreateRequest(BaseModel):
    work_date: date
    location_id: uuid.UUID
    workplace_id: uuid.UUID | None = None
    title: str = Field(..., min_length=1, max_length=300)
    progress_status: str = Field(..., min_length=1, max_length=32)
    notes: str | None = Field(default=None, max_length=8000)
    percent_complete: int | None = Field(default=None, ge=0, le=100)


class WorkProgressReviewListItem(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_email: str
    employee_name: str | None
    company_id: uuid.UUID
    company_name: str | None
    location_id: uuid.UUID
    location_name: str
    work_date: date
    title: str
    progress_status: str
    status: str
    created_at: datetime


class WorkProgressReviewListResponse(BaseModel):
    items: list[WorkProgressReviewListItem]
    total: int


class WorkProgressAcknowledgeBody(BaseModel):
    note: str | None = Field(default=None, max_length=4000)


class WorkProgressCommentBody(BaseModel):
    comment: str = Field(..., min_length=1, max_length=4000)


class WorkProgressReviewDetailResponse(WorkProgressEntryDetailResponse):
    user_email: str
    employee_name: str | None = None


class WorkProgressBulkFileIdsBody(BaseModel):
    file_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=200)


class WorkProgressReviewAttachmentGalleryItem(BaseModel):
    attachment: WorkProgressAttachmentPublic
    entry_id: uuid.UUID
    work_date: date
    title: str
    location_id: uuid.UUID
    location_name: str
    user_id: uuid.UUID
    user_email: str
    employee_name: str | None = None


class WorkProgressReviewAttachmentGalleryResponse(BaseModel):
    items: list[WorkProgressReviewAttachmentGalleryItem]
    total: int
