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
