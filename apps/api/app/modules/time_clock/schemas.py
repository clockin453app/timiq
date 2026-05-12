import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class GeolocationPayload(BaseModel):
    """Reference shape; clock-in/out use equivalent fields as multipart Form data plus selfie file."""

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_meters: float = Field(ge=0, le=5000)
    timestamp_utc: datetime


class AssignedSiteStatus(BaseModel):
    """Active assigned work sites for the current user (for maps / clock UI)."""

    id: uuid.UUID
    name: str
    latitude: float
    longitude: float
    geofence_radius_meters: int


class ClockStatusResponse(BaseModel):
    has_open_shift: bool
    open_shift_id: uuid.UUID | None = None
    open_shift_clock_in_at: datetime | None = Field(
        default=None,
        description="UTC clock-in time for the user's open shift; null when not clocked in.",
    )
    status: str
    active_location_count: int
    current_break_open: bool
    assigned_sites: list[AssignedSiteStatus]
    current_status: str = Field(
        description=(
            "UI flow: not_clocked_in | on_shift | open_break | completed_today | no_assigned_sites"
        ),
    )
    has_completed_shift_today: bool = False
    open_break_id: uuid.UUID | None = None
    open_shift_location_id: uuid.UUID | None = None
    open_shift_location_name: str | None = None
    can_clock_in: bool = False
    can_clock_out: bool = False
    clock_in_blocked_reason: str | None = None
    clock_out_blocked_reason: str | None = None


class ClockActionResponse(BaseModel):
    shift_id: uuid.UUID
    status: str
    worked_seconds: int | None = None
    break_seconds: int | None = None


class BreakActionResponse(BaseModel):
    shift_id: uuid.UUID
    break_id: uuid.UUID
    status: str


class TimeShiftResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    company_id: uuid.UUID | None
    location_id: uuid.UUID
    status: str
    clock_in_at: datetime
    clock_in_latitude: float
    clock_in_longitude: float
    clock_in_accuracy_meters: float
    clock_in_distance_to_site_meters: float
    clock_out_at: datetime | None
    clock_out_latitude: float | None
    clock_out_longitude: float | None
    clock_out_accuracy_meters: float | None
    clock_out_distance_to_site_meters: float | None
    worked_seconds: int | None
    break_seconds: int
    created_at: datetime
    updated_at: datetime


class ClockSelfieMetadataResponse(BaseModel):
    """Safe selfie metadata for APIs; never includes storage paths."""

    id: uuid.UUID
    time_shift_id: uuid.UUID
    phase: str
    content_type: str
    file_size_bytes: int
    captured_at: datetime
    created_at: datetime
    clock_in_at: datetime
    clock_out_at: datetime | None


class ClockSelfieReviewItemResponse(BaseModel):
    """Aggregated selfie row for admin review; never includes storage paths."""

    id: uuid.UUID
    user_id: uuid.UUID
    user_email: str
    employee_name: str | None = None
    company_name: str | None = None
    phase: str
    captured_at: datetime
    clock_in_at: datetime
    clock_out_at: datetime | None
    content_type: str
    file_size_bytes: int
