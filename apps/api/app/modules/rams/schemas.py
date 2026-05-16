from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class RamsDocumentPresetHazardPublic(BaseModel):
    hazard: str
    who_might_be_harmed: str
    initial_likelihood: int
    initial_severity: int
    control_measures: str
    residual_likelihood: int
    residual_severity: int


class RamsDocumentPresetPublic(BaseModel):
    id: str
    title: str
    work_activity: str
    description: str
    risk_level: str
    ppe: list[str]
    hazards: list[RamsDocumentPresetHazardPublic]
    hazard_count: int
    mandatory_gloves: list[str] | None = None
    pre_start_checklist: list[str] | None = None
    sequence_of_works: list[dict[str, object]] | None = None
    plant_tools: list[str] | None = None
    training_requirements: list[str] | None = None
    coshh_items: list[str] | None = None
    glove_requirements: list[str] | None = None
    method_statement_sections: list[dict[str, object]] | None = None


class RamsPresetsResponse(BaseModel):
    hazard_examples: list[str]
    ppe_options: list[str]
    document_presets: list[RamsDocumentPresetPublic]
    assessment_presets: list[RamsDocumentPresetPublic]


class RamsFromPresetRequest(BaseModel):
    preset_id: str = Field(min_length=1, max_length=64)
    company_id: uuid.UUID | None = None
    location_id: uuid.UUID | None = None
    review_due_date: date | None = None
    reference: str | None = Field(default=None, max_length=120)
    project_name: str | None = Field(default=None, max_length=300)
    client_name: str | None = Field(default=None, max_length=300)
    principal_contractor: str | None = Field(default=None, max_length=300)
    subcontractor_name: str | None = Field(default=None, max_length=300)
    site_address: str | None = None


class RamsSignoffProgress(BaseModel):
    total_assigned: int
    pending: int
    acknowledged: int
    declined: int


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
    project_name: str | None = Field(default=None, max_length=300)
    client_name: str | None = Field(default=None, max_length=300)
    principal_contractor: str | None = Field(default=None, max_length=300)
    subcontractor_name: str | None = Field(default=None, max_length=300)
    site_address: str | None = None
    revision: str | None = Field(default=None, max_length=32)
    reason_for_issue: str | None = None
    produced_by_name: str | None = Field(default=None, max_length=200)
    checked_by_name: str | None = Field(default=None, max_length=200)
    approved_by_name: str | None = Field(default=None, max_length=200)
    emergency_contact: str | None = Field(default=None, max_length=500)
    site_manager: str | None = Field(default=None, max_length=200)
    first_aider: str | None = Field(default=None, max_length=200)
    fire_marshal: str | None = Field(default=None, max_length=200)
    muster_point: str | None = Field(default=None, max_length=500)
    nearest_hospital: str | None = Field(default=None, max_length=500)
    emergency_arrangements: str | None = None
    site_security: str | None = None
    welfare_arrangements: str | None = None
    public_protection: str | None = None
    deliveries_storage: str | None = None
    scope_of_works: str | None = None
    sequence_of_works: list[dict[str, object]] | None = None
    pre_start_checklist: list[str] | None = None
    plant_tools: list[str] | None = None
    training_requirements: list[str] | None = None
    coshh_items: list[str] | None = None
    glove_requirements: list[str] | None = None
    method_statement_sections: list[dict[str, object]] | None = None


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
    signature_method: str = "not_signed"
    manual_signature_note: str | None = None
    declined_reason: str | None
    has_signature: bool = False


class RamsAcknowledgementsAddRequest(BaseModel):
    user_ids: list[uuid.UUID] = Field(default_factory=list)
    all_site_users: bool = False


class RamsAcknowledgeRequest(BaseModel):
    read_understood_ack: bool = False
    acknowledgement_name: str = Field(min_length=1, max_length=200)
    signature_image_data: str = Field(
        min_length=50,
        description="PNG data URL. Stored privately; never returned in JSON.",
    )


class RamsManualSignRequest(BaseModel):
    acknowledgement_name: str = Field(min_length=1, max_length=200)
    manual_signature_note: str | None = Field(default=None, max_length=500)


class RamsDeclineRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class RamsAttachmentResponse(BaseModel):
    id: uuid.UUID
    assessment_id: uuid.UUID
    section_key: str
    hazard_id: uuid.UUID | None
    method_step_key: str | None
    caption: str | None
    original_filename: str
    content_type: str
    file_size_bytes: int
    created_at: datetime
    download_href: str


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
    project_name: str | None = None
    client_name: str | None = None
    principal_contractor: str | None = None
    subcontractor_name: str | None = None
    site_address: str | None = None
    revision: str | None = None
    reason_for_issue: str | None = None
    produced_by_name: str | None = None
    checked_by_name: str | None = None
    approved_by_name: str | None = None
    emergency_contact: str | None = None
    site_manager: str | None = None
    first_aider: str | None = None
    fire_marshal: str | None = None
    muster_point: str | None = None
    nearest_hospital: str | None = None
    emergency_arrangements: str | None = None
    site_security: str | None = None
    welfare_arrangements: str | None = None
    public_protection: str | None = None
    deliveries_storage: str | None = None
    scope_of_works: str | None = None
    sequence_of_works: list[dict[str, object]] | None = None
    pre_start_checklist: list[str] | None = None
    plant_tools: list[str] | None = None
    training_requirements: list[str] | None = None
    coshh_items: list[str] | None = None
    glove_requirements: list[str] | None = None
    method_statement_sections: list[dict[str, object]] | None = None
    hazards: list[RamsHazardResponse]
    acknowledgements: list[RamsAcknowledgementResponse]
    attachments: list[RamsAttachmentResponse] = Field(default_factory=list)
    signoff_progress: RamsSignoffProgress | None = None
