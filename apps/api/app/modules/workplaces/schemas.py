import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class WorkplaceCreateRequest(BaseModel):
    company_id: uuid.UUID | None = None
    name: str = Field(min_length=2, max_length=160)
    code: str | None = Field(default=None, max_length=60)
    address: str | None = Field(default=None, max_length=300)
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.strip().split())
        if not normalized:
            raise ValueError("Workplace name is required.")
        return normalized


class WorkplaceStatusUpdateRequest(BaseModel):
    is_active: bool


class WorkplaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    name: str
    code: str | None
    address: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
