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
    title: str
    description: str
    href: str
    count: int = Field(ge=0)
    priority: Literal["normal", "high"] = "normal"


class NotificationSummaryResponse(BaseModel):
    total_count: int = Field(ge=0)
    items: list[NotificationSummaryItem]
