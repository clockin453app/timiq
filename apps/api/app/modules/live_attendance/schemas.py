import uuid
from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class LiveAttendanceEmployeeRow(BaseModel):
    user_id: uuid.UUID
    display_name: str
    email: str | None = None
    job_title: str | None = None
    company_id: uuid.UUID | None = None
    company_name: str | None = None
    location_name: str | None = None
    location_id: uuid.UUID | None = None
    status: str
    clock_in_at: datetime | None = None
    clock_out_at: datetime | None = None
    running_seconds: int | None = None
    today_completed_worked_seconds: int | None = None
    open_shift_id: uuid.UUID | None = None
    clock_source: str | None = None


class LiveAttendanceSummary(BaseModel):
    total_employees: int
    present_today: int
    open_shifts: int
    absent_count: int
    attendance_rate: float | None = None
    late_arrivals: int | None = None


class LiveAttendanceResponse(BaseModel):
    generated_at: datetime
    summary: LiveAttendanceSummary
    employees: list[LiveAttendanceEmployeeRow]


class ManualClockInRequest(BaseModel):
    user_id: uuid.UUID
    location_id: uuid.UUID
    reason: str = Field(..., min_length=1, max_length=2000)


class ManualClockOutRequest(BaseModel):
    user_id: uuid.UUID | None = None
    shift_id: uuid.UUID | None = None
    reason: str = Field(..., min_length=1, max_length=2000)

    @model_validator(mode="after")
    def exactly_one_target(self) -> "ManualClockOutRequest":
        has_user = self.user_id is not None
        has_shift = self.shift_id is not None
        if has_user == has_shift:
            raise ValueError("Provide exactly one of user_id or shift_id.")
        return self


class ManualClockActionResponse(BaseModel):
    shift_id: uuid.UUID
    status: str
    clock_in_at: datetime | None = None
    clock_out_at: datetime | None = None
    worked_seconds: int | None = None
