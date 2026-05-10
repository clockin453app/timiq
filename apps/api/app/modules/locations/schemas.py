import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class LocationCreateRequest(BaseModel):
    company_id: Optional[uuid.UUID] = None
    name: str = Field(min_length=2, max_length=160)
    address: Optional[str] = Field(default=None, max_length=300)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    geofence_radius_meters: int = Field(default=100, ge=10, le=5000)
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.strip().split())

        if not normalized:
            raise ValueError("Location name is required.")

        return normalized

    @field_validator("address")
    @classmethod
    def normalize_address(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None

        normalized = " ".join(value.strip().split())

        return normalized or None


class LocationStatusUpdateRequest(BaseModel):
    is_active: bool


class LocationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    name: str
    address: Optional[str]
    latitude: float
    longitude: float
    geofence_radius_meters: int
    is_active: bool
    created_at: datetime
    updated_at: datetime