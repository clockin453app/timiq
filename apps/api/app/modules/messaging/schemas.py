from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

AUDIENCE_TYPES = frozenset({"company", "administrators", "all_companies"})
PRIORITIES = frozenset({"normal", "important", "urgent"})


class ColleagueResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    email: str
    display_name: str


class AnnouncementCreateRequest(BaseModel):
    company_id: uuid.UUID | None = None
    audience_type: str
    priority: str = "normal"
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1, max_length=50000)
    published_at: datetime | None = None
    expires_at: datetime | None = None

    @field_validator("audience_type")
    @classmethod
    def _aud(cls, v: str) -> str:
        s = v.strip().lower()
        if s not in AUDIENCE_TYPES:
            raise ValueError("Invalid audience_type.")
        return s

    @field_validator("priority")
    @classmethod
    def _pri(cls, v: str) -> str:
        s = v.strip().lower()
        if s not in PRIORITIES:
            raise ValueError("Invalid priority.")
        return s


class AnnouncementPatchRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    body: str | None = Field(default=None, min_length=1, max_length=50000)
    priority: str | None = None
    published_at: datetime | None = None
    expires_at: datetime | None = None

    @field_validator("priority")
    @classmethod
    def _pri(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip().lower()
        if s not in PRIORITIES:
            raise ValueError("Invalid priority.")
        return s


class AnnouncementListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID | None
    title: str
    body: str
    audience_type: str
    priority: str
    published_at: datetime | None
    expires_at: datetime | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    read_at: datetime | None
    read_count: int | None = None


class AnnouncementReadEntry(BaseModel):
    user_id: uuid.UUID
    read_at: datetime


class AnnouncementDetailResponse(AnnouncementListItem):
    read_count: int | None = None
    reads: list[AnnouncementReadEntry] | None = None


class ConversationCreateRequest(BaseModel):
    company_id: uuid.UUID | None = None
    conversation_type: str = Field(default="direct", max_length=16)
    title: str | None = Field(default=None, max_length=200)
    participant_user_ids: list[uuid.UUID]
    initial_message: str = Field(..., min_length=1, max_length=4000)

    @field_validator("conversation_type")
    @classmethod
    def _conv_type(cls, v: str) -> str:
        s = v.strip().lower()
        if s not in ("direct", "group"):
            raise ValueError("conversation_type must be direct or group.")
        return s

    @model_validator(mode="after")
    def _group_title_rule(self) -> ConversationCreateRequest:
        if self.conversation_type == "group":
            t = (self.title or "").strip()
            if not t:
                raise ValueError("title is required for group conversations.")
            self.title = t
        else:
            self.title = None
        return self


class ConversationPatchRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)


class ConversationParticipantsAddRequest(BaseModel):
    user_ids: list[uuid.UUID] = Field(default_factory=list, min_length=1)


class ConversationListItem(BaseModel):
    id: uuid.UUID
    company_id: uuid.UUID
    conversation_type: str = "direct"
    title: str | None = None
    participant_count: int = 0
    other_user_display_name: str | None = None
    updated_at: datetime
    participant_user_ids: list[uuid.UUID]
    last_message_preview: str | None
    last_message_at: datetime | None


class MessageCreateRequest(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    conversation_id: uuid.UUID
    sender_user_id: uuid.UUID
    body: str
    created_at: datetime
