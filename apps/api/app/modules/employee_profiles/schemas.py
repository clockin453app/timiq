import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class EmployeeProfileUpdateRequest(BaseModel):
    first_name: str | None = Field(default=None, max_length=120)
    last_name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    job_title: str | None = Field(default=None, max_length=120)
    start_date: date | None = None
    emergency_contact_name: str | None = Field(default=None, max_length=120)
    emergency_contact_phone: str | None = Field(default=None, max_length=30)
    is_onboarded: bool | None = None


class EmployeeProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    company_id: uuid.UUID | None
    company_name: str | None = None
    first_name: str | None
    last_name: str | None
    phone: str | None
    job_title: str | None
    start_date: date | None
    emergency_contact_name: str | None
    emergency_contact_phone: str | None
    is_onboarded: bool
    created_at: datetime
    updated_at: datetime
