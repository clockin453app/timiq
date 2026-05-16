import uuid
from datetime import date, datetime, timezone
from sqlalchemy import Date, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class NotificationSeen(Base):
    """User-dismissed notification surface (informational kinds); not used for actionable workflow items."""

    __tablename__ = "notification_seen"
    __table_args__ = (UniqueConstraint("user_id", "kind", "target_key", name="uq_notification_seen_user_kind_target"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_key: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class NotificationRecord(Base):
    """Persistent in-app notification row created by backend jobs and workflow events."""

    __tablename__ = "notification_records"
    __table_args__ = (
        UniqueConstraint(
            "recipient_user_id",
            "kind",
            "dedupe_key",
            name="uq_notification_records_recipient_kind_dedupe",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipient_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    dedupe_key: Mapped[str] = mapped_column(String(512), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    href: Mapped[str] = mapped_column(String(300), nullable=False, default="/")
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default="normal")
    category: Mapped[str] = mapped_column(String(32), nullable=False, default="admin")
    source_rule_type: Mapped[str] = mapped_column(String(64), nullable=True, index=True)
    subject_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    shift_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("time_shifts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    work_date: Mapped[date] = mapped_column(Date, nullable=True, index=True)
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
