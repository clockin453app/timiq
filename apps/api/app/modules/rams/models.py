from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RamsAssessment(Base):
    __tablename__ = "rams_assessments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    location_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("locations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    title = mapped_column(String(300), nullable=False)
    reference = mapped_column(String(120), nullable=True)
    work_activity = mapped_column(String(2000), nullable=False)
    description = mapped_column(Text, nullable=True)
    status = mapped_column(String(32), nullable=False, default="draft", index=True)
    risk_level = mapped_column(String(32), nullable=False, default="medium")
    review_due_date = mapped_column(Date, nullable=True)
    ppe_json = mapped_column(JSONB, nullable=False, default=list)
    no_special_ppe = mapped_column(Boolean, nullable=False, default=False)
    created_by_user_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_by_user_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    published_at = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_at = mapped_column(DateTime(timezone=True), nullable=True)
    archived_at = mapped_column(DateTime(timezone=True), nullable=True)
    project_name = mapped_column(String(300), nullable=True)
    client_name = mapped_column(String(300), nullable=True)
    principal_contractor = mapped_column(String(300), nullable=True)
    subcontractor_name = mapped_column(String(300), nullable=True)
    site_address = mapped_column(Text, nullable=True)
    revision = mapped_column(String(32), nullable=False, default="01")
    reason_for_issue = mapped_column(Text, nullable=True)
    produced_by_name = mapped_column(String(200), nullable=True)
    checked_by_name = mapped_column(String(200), nullable=True)
    approved_by_name = mapped_column(String(200), nullable=True)
    emergency_contact = mapped_column(String(500), nullable=True)
    site_manager = mapped_column(String(200), nullable=True)
    first_aider = mapped_column(String(200), nullable=True)
    fire_marshal = mapped_column(String(200), nullable=True)
    muster_point = mapped_column(String(500), nullable=True)
    nearest_hospital = mapped_column(String(500), nullable=True)
    emergency_arrangements = mapped_column(Text, nullable=True)
    site_security = mapped_column(Text, nullable=True)
    welfare_arrangements = mapped_column(Text, nullable=True)
    public_protection = mapped_column(Text, nullable=True)
    deliveries_storage = mapped_column(Text, nullable=True)
    scope_of_works = mapped_column(Text, nullable=True)
    sequence_of_works = mapped_column(JSONB, nullable=True)
    pre_start_checklist = mapped_column(JSONB, nullable=True)
    plant_tools = mapped_column(JSONB, nullable=True)
    training_requirements = mapped_column(JSONB, nullable=True)
    coshh_items = mapped_column(JSONB, nullable=True)
    glove_requirements = mapped_column(JSONB, nullable=True)
    method_statement_sections = mapped_column(JSONB, nullable=True)


class RamsHazard(Base):
    __tablename__ = "rams_hazards"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assessment_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("rams_assessments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    company_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    hazard = mapped_column(String(2000), nullable=False)
    who_might_be_harmed = mapped_column(String(2000), nullable=True)
    initial_likelihood = mapped_column(Integer, nullable=False)
    initial_severity = mapped_column(Integer, nullable=False)
    control_measures = mapped_column(Text, nullable=False)
    residual_likelihood = mapped_column(Integer, nullable=False)
    residual_severity = mapped_column(Integer, nullable=False)
    sort_order = mapped_column(Integer, nullable=False, default=0)
    created_at = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class RamsAttachment(Base):
    __tablename__ = "rams_attachments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assessment_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("rams_assessments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    company_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    section_key = mapped_column(String(64), nullable=False)
    hazard_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("rams_hazards.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    method_step_key = mapped_column(String(120), nullable=True)
    original_filename = mapped_column(String(500), nullable=False)
    content_type = mapped_column(String(120), nullable=False)
    file_size_bytes = mapped_column(Integer, nullable=False)
    storage_path = mapped_column(String(500), nullable=False)
    caption = mapped_column(String(500), nullable=True)
    created_by_user_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class RamsAcknowledgement(Base):
    __tablename__ = "rams_acknowledgements"
    __table_args__ = (UniqueConstraint("assessment_id", "user_id", name="uq_rams_ack_assessment_user"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assessment_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("rams_assessments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    company_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status = mapped_column(String(32), nullable=False, default="pending", index=True)
    acknowledgement_name = mapped_column(String(200), nullable=True)
    acknowledged_at = mapped_column(DateTime(timezone=True), nullable=True)
    declined_reason = mapped_column(String(2000), nullable=True)
    signature_image_path = mapped_column(String(512), nullable=True)
    created_at = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
