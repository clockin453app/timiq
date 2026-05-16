from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class ToolboxTopicOption(BaseModel):
    value: str
    label: str


class ToolboxTopicTemplateResponse(BaseModel):
    topic: str
    category: str
    default_title: str
    default_body: str
    key_points: list[str]
    required_ppe: list[str] = Field(default_factory=list)
    do_list: list[str] = Field(default_factory=list)
    dont_list: list[str] = Field(default_factory=list)
    ppe_reminders: list[str] = Field(default_factory=list)


class ToolboxTalkCreateRequest(BaseModel):
    company_id: uuid.UUID | None = Field(
        default=None,
        description="Required for platform administrators; ignored for company admins.",
    )
    title: str = Field(min_length=1, max_length=300)
    topic: str = Field(min_length=1, max_length=64)
    topic_custom: str | None = Field(default=None, max_length=200)
    topic_category: str | None = Field(default=None, max_length=120)
    location_id: uuid.UUID | None = None
    talk_body: str = Field(min_length=1, max_length=50000)
    presenter_user_id: uuid.UUID | None = None
    scheduled_date: date | None = None


class ToolboxTalkPatchRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    topic: str | None = Field(default=None, min_length=1, max_length=64)
    topic_custom: str | None = Field(default=None, max_length=200)
    topic_category: str | None = Field(default=None, max_length=120)
    location_id: uuid.UUID | None = None
    talk_body: str | None = Field(default=None, min_length=1, max_length=50000)
    presenter_user_id: uuid.UUID | None = None
    scheduled_date: date | None = None


class ToolboxTalkAttendeeResponse(BaseModel):
    user_id: uuid.UUID
    user_email: str | None = None
    display_name: str | None = None
    status: str
    signed_at: datetime | None = None
    signature_name: str | None = None
    signature_method: str = "not_signed"
    manual_signature_note: str | None = None
    has_signature: bool = False
    declined_reason: str | None = None


class ToolboxTalkSummaryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    location_id: uuid.UUID | None
    title: str
    topic: str
    topic_display: str
    scheduled_date: date | None
    status: str
    published_at: datetime | None
    completed_at: datetime | None


class ToolboxTalkDetailResponse(ToolboxTalkSummaryResponse):
    topic_custom: str | None
    topic_category: str | None
    talk_body: str
    presenter_user_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None
    attendees: list[ToolboxTalkAttendeeResponse] = Field(default_factory=list)


class ToolboxTalkAttendeesAddRequest(BaseModel):
    user_ids: list[uuid.UUID] = Field(default_factory=list)
    all_site_users: bool = False


class ToolboxTalkSignRequest(BaseModel):
    attended_ack: bool = False
    signature_name: str = Field(min_length=2, max_length=200)
    signature_image_data: str = Field(
        min_length=50,
        description="PNG data URL. Stored privately; never returned in JSON.",
    )


class ToolboxTalkManualSignRequest(BaseModel):
    signature_name: str = Field(min_length=2, max_length=200)
    manual_signature_note: str | None = Field(default=None, max_length=500)


class ToolboxTalkDeclineRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)
