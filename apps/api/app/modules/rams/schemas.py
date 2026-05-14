from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class RamsPresetsResponse(BaseModel):
    hazard_examples: list[str]
    ppe_options: list[str]


class RamsAssessmentCreateRequest(BaseModel):
    company_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=300)
    reference: str | None = Field(default=None, max_length=120)
    work_activity: str = Field(min_length=1, max_length=2000)
    description: str | None = None
    location_id: uuid.UUID | None = None
    risk_level: str = Field(default="medium", max_length=32)
    review_due_date: date | None = None
    ppe_json: list[str] = Field(default_factory=list)
    no_special_ppe: bool = False


class RamsAssessmentPatchRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    reference: str | None = Field(default=None, max_length=120)
    work_activity: str | None = Field(default=None, min_length=1, max_length=2000)
    description: str | None = None
    location_id: uuid.UUID | None = None
    risk_level: str | None = Field(default=None, max_length=32)
    review_due_date: date | None = None
    ppe_json: list[str] | None = None
    no_special_ppe: bool | None = None


class RamsHazardCreateRequest(BaseModel):
    hazard: str = Field(min_length=1, max_length=2000)
    who_might_be_harmed: str | None = Field(default=None, max_length=2000)
    initial_likelihood: int = Field(ge=1, le=5)
    initial_severity: int = Field(ge=1, le=5)
    control_measures: str = Field(min_length=1)
    residual_likelihood: int = Field(ge=1, le=5)
    residual_severity: int = Field(ge=1, le=5)


class RamsHazardPatchRequest(BaseModel):
    hazard: str | None = Field(default=None, min_length=1, max_length=2000)
    who_might_be_harmed: str | None = Field(default=None, max_length=2000)
    initial_likelihood: int | None = Field(default=None, ge=1, le=5)
    initial_severity: int | None = Field(default=None, ge=1, le=5)
    control_measures: str | None = Field(default=None, min_length=1)
    residual_likelihood: int | None = Field(default=None, ge=1, le=5)
    residual_severity: int | None = Field(default=None, ge=1, le=5)
    sort_order: int | None = None


class RamsHazardResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    assessment_id: uuid.UUID
    hazard: str
    who_might_be_harmed: str | None
    initial_likelihood: int
    initial_severity: int
    initial_risk_score: int
    initial_risk_band: str
    control_measures: str
    residual_likelihood: int
    residual_severity: int
    residual_risk_score: int
    residual_risk_band: str
    residual_higher_than_initial: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime


class RamsAcknowledgementResponse(BaseModel):
    user_id: uuid.UUID
    user_email: str | None = None
    display_name: str | None = None
    status: str
    acknowledged_at: datetime | None
    acknowledgement_name: str | None
    declined_reason: str | None


class RamsAcknowledgementsAddRequest(BaseModel):
    user_ids: list[uuid.UUID] = Field(default_factory=list)
    all_site_users: bool = False


class RamsAcknowledgeRequest(BaseModel):
    read_understood_ack: bool = False
    acknowledgement_name: str = Field(min_length=1, max_length=200)


class RamsDeclineRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class RamsAssessmentListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    location_id: uuid.UUID | None
    title: str
    reference: str | None
    work_activity: str
    status: str
    risk_level: str
    review_due_date: date | None
    published_at: datetime | None
    reviewed_at: datetime | None
    updated_at: datetime
    my_ack_status: str | None = None


class RamsAssessmentDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=False)

    id: uuid.UUID
    company_id: uuid.UUID
    location_id: uuid.UUID | None
    title: str
    reference: str | None
    work_activity: str
    description: str | None
    status: str
    risk_level: str
    review_due_date: date | None
    ppe_json: list[str]
    no_special_ppe: bool
    created_by_user_id: uuid.UUID | None
    reviewed_by_user_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None
    reviewed_at: datetime | None
    archived_at: datetime | None
    hazards: list[RamsHazardResponse]
    acknowledgements: list[RamsAcknowledgementResponse]
