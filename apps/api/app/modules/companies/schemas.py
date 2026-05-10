import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CompanyCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.strip().split())

        if not normalized:
            raise ValueError("Company name is required.")

        return normalized


class CompanyUpdateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.strip().split())

        if not normalized:
            raise ValueError("Company name is required.")

        return normalized


class CompanyStatusUpdateRequest(BaseModel):
    is_active: bool


class CompanyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime