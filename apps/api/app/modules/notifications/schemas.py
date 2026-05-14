from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

NotificationKind = Literal[
    "message",
    "announcement",
    "rams_ack",
    "toolbox_sign",
    "form_review",
    "rams_review",
    "toolbox_review",
    "payslip_ready",
    "week_report_ready",
    "payroll_pending",
    "time_review",
    "leave_request_pending",
    "leave_approved",
    "leave_rejected",
]


class NotificationSummaryItem(BaseModel):
    kind: str
    target_key: str = ""
    title: str
    description: str
    href: str
    count: int = Field(ge=0, description="Unseen / actionable count for the bell badge.")
    priority: Literal["normal", "high"] = "normal"
    group: str | None = Field(
        default=None,
        description="Optional UI bucket: messages, safety, payroll, time, admin.",
    )


class NotificationSummaryResponse(BaseModel):
    total_count: int = Field(ge=0)
    items: list[NotificationSummaryItem]


class NotificationMarkSeenRequest(BaseModel):
    kind: str = Field(min_length=1, max_length=64)
    target_key: str = Field(default="", max_length=512)
    mark_all_for_kind: bool = False


class NotificationMarkSeenResponse(BaseModel):
    ok: bool = True
