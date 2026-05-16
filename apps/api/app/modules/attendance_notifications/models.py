import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def _default_weekdays() -> list[int]:
    return [0, 1, 2, 3, 4]


class AttendanceNotificationSettings(Base):
    __tablename__ = "attendance_notification_settings"
    __table_args__ = (
        UniqueConstraint("company_id", name="uq_attendance_notification_settings_company_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    late_arrival_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    late_arrival_grace_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=15)
    late_arrival_notify_employee: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    late_arrival_notify_admins: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    forgot_clock_in_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    forgot_clock_in_check_time: Mapped[str] = mapped_column(String(5), nullable=False, default="09:30")
    forgot_clock_in_notify_employee: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    forgot_clock_in_notify_admins: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    forgot_clock_out_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    forgot_clock_out_threshold_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=12)
    forgot_clock_out_repeat_hours: Mapped[int] = mapped_column(Integer, nullable=True)
    forgot_clock_out_notify_employee: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    forgot_clock_out_notify_admins: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    ignore_approved_leave: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    active_weekdays: Mapped[list[int]] = mapped_column(JSONB, nullable=False, default=_default_weekdays)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
