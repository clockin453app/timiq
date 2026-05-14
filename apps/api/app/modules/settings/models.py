"""Company and user display / notification preferences (no secrets, no providers)."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CompanyAppSettings(Base):
    __tablename__ = "company_app_settings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    timezone_name = mapped_column(String(64), nullable=True)
    date_format = mapped_column(String(32), nullable=True)
    time_format = mapped_column(String(8), nullable=True)
    currency_code = mapped_column(String(8), nullable=True)
    week_start_day = mapped_column(String(16), nullable=True)
    company_display_name = mapped_column(String(200), nullable=True)
    brand_primary_color = mapped_column(String(9), nullable=True)
    brand_logo_storage_path = mapped_column(String(512), nullable=True)
    notifications_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    email_notifications_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    push_notifications_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_by_user_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
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


class UserPreference(Base):
    __tablename__ = "user_preferences"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    locale = mapped_column(String(16), nullable=True)
    timezone_name = mapped_column(String(64), nullable=True)
    date_format = mapped_column(String(32), nullable=True)
    time_format = mapped_column(String(8), nullable=True)
    compact_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notification_email_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notification_in_app_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    push_notifications_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
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
