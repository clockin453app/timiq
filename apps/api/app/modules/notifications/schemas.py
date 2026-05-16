from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field

NotificationKind = Literal[
    "message",
    "message_received",
    "announcement",
    "announcement_published",
    "rams_ack",
    "rams_ack_required",
    "toolbox_sign",
    "toolbox_sign_required",
    "form_complete",
    "form_submitted",
    "form_reviewed",
    "form_rejected",
    "form_review",
    "rams_review",
    "toolbox_review",
    "payslip_ready",
    "week_report_ready",
    "payroll_pending",
    "time_review",
    "leave_request_pending",
    "leave_request_submitted",
    "leave_request_approved",
    "leave_request_rejected",
    "leave_approved",
    "leave_rejected",
    "face_check_setup",
    "attendance_late_arrival",
    "attendance_forgot_clock_in",
    "attendance_forgot_clock_out",
    "push_test",
    "payroll_paid",
]

NotificationCategory = Literal["messages", "safety", "payroll", "time", "leave", "admin", "account"]


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


class NotificationMarkAllSeenItem(BaseModel):
    kind: str = Field(min_length=1, max_length=64)
    target_key: str = Field(min_length=1, max_length=512)


class NotificationMarkAllSeenRequest(BaseModel):
    kinds: list[str] | None = Field(
        default=None,
        description="If omitted, all dismissible informational kinds for this actor are marked.",
    )
    items: list[NotificationMarkAllSeenItem] | None = Field(
        default=None,
        description="Visible notification rows to mark seen by exact kind and target_key.",
    )
    company_id: uuid.UUID | None = Field(
        default=None,
        description="Administrator: optional company scope for announcement bulk mark-read.",
    )


class NotificationMarkAllSeenResponse(BaseModel):
    ok: bool = True


class PushPublicKeyResponse(BaseModel):
    enabled: bool
    public_key: str = ""


class PushSubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=512)
    auth: str = Field(min_length=1, max_length=512)


class PushSubscriptionBody(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2048)
    keys: PushSubscriptionKeys
    user_agent: str | None = Field(default=None, max_length=500)
    device_label: str | None = Field(default=None, max_length=120)


class PushSubscriptionResponse(BaseModel):
    ok: bool = True
    enabled: bool = True


class PushUnsubscribeBody(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2048)


class PushTestResponse(BaseModel):
    ok: bool = True
    sent: int = 0
    enabled: bool = True
