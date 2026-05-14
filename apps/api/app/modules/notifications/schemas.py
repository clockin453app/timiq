from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field

NotificationKind = Literal[
    "message",
    "announcement",
    "rams_ack",
    "toolbox_sign",
    "form_complete",
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

NotificationCategory = Literal["messages", "safety", "payroll", "time", "leave", "admin"]


class NotificationSummaryItem(BaseModel):
    kind: str
    target_key: str = ""
    title: str
    description: str
    href: str
    count: int = Field(ge=0, description="Actionable count for this row (e.g. unread messages in scope).")
    unseen_count: int = Field(ge=0, description="Same as count for current API; reserved for split seen/unseen UX.")
    priority: Literal["normal", "high"] = "normal"
    category: NotificationCategory | str = Field(
        description="UI bucket: messages, safety, payroll, time, leave, admin.",
    )
    group: str | None = Field(
        default=None,
        description="Deprecated alias of category for older clients.",
    )
    is_seen: bool = Field(
        default=False,
        description="False while the row is shown; informational rows are omitted once dismissed via mark-seen.",
    )


class NotificationSummaryResponse(BaseModel):
    total_count: int = Field(ge=0)
    items: list[NotificationSummaryItem]


class NotificationMarkSeenRequest(BaseModel):
    kind: str = Field(min_length=1, max_length=64)
    target_key: str = Field(default="", max_length=512)
    mark_all_for_kind: bool = False
    company_id: uuid.UUID | None = Field(
        default=None,
        description="Administrator: optional company scope for announcement bulk mark-read.",
    )


class NotificationMarkSeenResponse(BaseModel):
    ok: bool = True


class NotificationMarkAllSeenRequest(BaseModel):
    kinds: list[str] | None = Field(
        default=None,
        description="If omitted, all dismissible informational kinds for this actor are marked.",
    )
    company_id: uuid.UUID | None = Field(
        default=None,
        description="Administrator: optional company scope for announcement bulk mark-read.",
    )


class NotificationMarkAllSeenResponse(BaseModel):
    ok: bool = True
