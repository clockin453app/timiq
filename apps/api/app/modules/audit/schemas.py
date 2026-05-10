import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AuditEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    actor_user_id: uuid.UUID | None
    company_id: uuid.UUID | None
    action: str
    entity_type: str
    entity_id: str | None
    details: dict[str, Any]
    created_at: datetime


class AuditEventCreateRequest(BaseModel):
    action: str = Field(min_length=2, max_length=120)
    entity_type: str = Field(min_length=2, max_length=120)
    entity_id: str | None = Field(default=None, max_length=120)
    company_id: uuid.UUID | None = None
    details: dict[str, Any] = Field(default_factory=dict)
