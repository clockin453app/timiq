"""Notification summary API smoke tests (no database)."""

import uuid
from contextlib import ExitStack
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.modules.auth.models import SystemRole
from app.modules.notifications.schemas import (
    NotificationMarkAllSeenItem,
    NotificationMarkAllSeenRequest,
    NotificationMarkSeenRequest,
)
from app.modules.notifications.service import (
    get_notification_summary,
    mark_all_informational_seen,
    mark_notification_seen,
)


def test_notifications_summary_route_registered() -> None:
    paths = [getattr(r, "path", "") for r in app.routes if hasattr(r, "path")]
    assert "/api/notifications/summary" in paths


def test_notifications_summary_requires_authentication() -> None:
    client = TestClient(app)
    response = client.get("/api/notifications/summary")
    assert response.status_code == 401


def test_notifications_mark_seen_route_registered() -> None:
    paths = [getattr(r, "path", "") for r in app.routes if hasattr(r, "path")]
    assert "/api/notifications/mark-seen" in paths


def test_notifications_mark_seen_requires_authentication() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/notifications/mark-seen",
        json={"kind": "week_report_ready", "target_key": "week:2026-05-11"},
    )
    assert response.status_code == 401


def test_notifications_mark_all_seen_route_registered() -> None:
    paths = [getattr(r, "path", "") for r in app.routes if hasattr(r, "path")]
    assert "/api/notifications/mark-all-seen" in paths


def test_notifications_mark_all_seen_requires_authentication() -> None:
    client = TestClient(app)
    response = client.post("/api/notifications/mark-all-seen", json={})
    assert response.status_code == 401


def test_notification_summary_item_schema_has_category() -> None:
    from app.modules.notifications.schemas import NotificationSummaryItem

    row = NotificationSummaryItem(
        kind="message",
        target_key="message:x",
        title="T",
        description="D",
        href="/messages?tab=messages",
        count=2,
        unseen_count=2,
        category="messages",
        group="messages",
    )
    dumped = row.model_dump()
    assert dumped["category"] == "messages"
    assert dumped["unseen_count"] == 2


def _admin(company_id: uuid.UUID) -> MagicMock:
    user = MagicMock()
    user.id = uuid.uuid4()
    user.company_id = company_id
    user.system_role = SystemRole.ADMIN
    return user


def _summary_base_patches():
    return [
        patch("app.modules.notifications.service.count_unread_visible_announcements", return_value=0),
        patch("app.modules.notifications.service.message_bell_items", return_value=[]),
        patch("app.modules.notifications.service.notif_seen_repo.list_unseen_records_for_user", return_value=[]),
        patch("app.modules.notifications.service.sf_repo.count_submissions_for_review", return_value=0),
        patch("app.modules.notifications.service.tt_repo.count_talks_for_company_by_status", return_value=0),
        patch("app.modules.notifications.service.leave_repo.count_pending_leave_for_company", return_value=0),
        patch("app.modules.notifications.service.time_clock_repo.count_open_shifts_for_company_employees", return_value=0),
        patch("app.modules.notifications.service.payroll_repo.count_rate_missing_payroll_items_for_company", return_value=0),
    ]


def _start_patches(stack: ExitStack, patches):
    for item in patches:
        stack.enter_context(item)


def test_payroll_pending_approval_appears_when_count_positive() -> None:
    cid = uuid.uuid4()
    actor = _admin(cid)
    latest = datetime(2026, 5, 16, 9, 0, tzinfo=timezone.utc)
    with ExitStack() as stack:
        _start_patches(
            stack,
            [
                *_summary_base_patches(),
                patch("app.modules.notifications.service.notif_seen_repo.has_seen", return_value=False),
                patch("app.modules.notifications.service.rams_repo.assessment_status_fingerprint_for_company", return_value=(0, None)),
                patch("app.modules.notifications.service.payroll_repo.pending_payroll_items_fingerprint_for_company", return_value=(2, latest)),
            ],
        )
        summary = get_notification_summary(MagicMock(), actor, company_id=None)
    item = next(i for i in summary.items if i.kind == "payroll_pending")
    assert item.count == 2
    assert item.target_key == f"payroll_pending:{cid}:2:{latest.isoformat()}"


def test_payroll_pending_approval_hidden_when_actionable_count_zero() -> None:
    cid = uuid.uuid4()
    actor = _admin(cid)
    with ExitStack() as stack:
        _start_patches(
            stack,
            [
                *_summary_base_patches(),
                patch("app.modules.notifications.service.notif_seen_repo.has_seen", return_value=False),
                patch("app.modules.notifications.service.rams_repo.assessment_status_fingerprint_for_company", return_value=(0, None)),
                patch("app.modules.notifications.service.payroll_repo.pending_payroll_items_fingerprint_for_company", return_value=(0, None)),
            ],
        )
        summary = get_notification_summary(MagicMock(), actor, company_id=None)

    assert all(i.kind != "payroll_pending" for i in summary.items)


def test_mark_seen_hides_current_payroll_pending_key() -> None:
    db = MagicMock()
    actor = _admin(uuid.uuid4())
    body = NotificationMarkSeenRequest(kind="payroll_pending", target_key="payroll_pending:co:2:ts")
    with patch("app.modules.notifications.service.notif_seen_repo.upsert_seen") as upsert:
        mark_notification_seen(db, actor, body)
    upsert.assert_called_once_with(db, user_id=actor.id, kind="payroll_pending", target_key="payroll_pending:co:2:ts")


def test_same_payroll_pending_count_and_timestamp_does_not_reappear() -> None:
    cid = uuid.uuid4()
    actor = _admin(cid)
    latest = datetime(2026, 5, 16, 9, 0, tzinfo=timezone.utc)
    with ExitStack() as stack:
        _start_patches(
            stack,
            [
                *_summary_base_patches(),
                patch("app.modules.notifications.service.notif_seen_repo.has_seen", return_value=True),
                patch("app.modules.notifications.service.rams_repo.assessment_status_fingerprint_for_company", return_value=(0, None)),
                patch("app.modules.notifications.service.payroll_repo.pending_payroll_items_fingerprint_for_company", return_value=(2, latest)),
            ],
        )
        summary = get_notification_summary(MagicMock(), actor, company_id=None)
    assert all(i.kind != "payroll_pending" for i in summary.items)


def test_increased_payroll_pending_count_reappears_with_new_key() -> None:
    cid = uuid.uuid4()
    actor = _admin(cid)
    latest = datetime(2026, 5, 16, 9, 0, tzinfo=timezone.utc)

    def has_seen(*_args, **kwargs):
        return kwargs["target_key"].startswith(f"payroll_pending:{cid}:2:")

    with ExitStack() as stack:
        _start_patches(
            stack,
            [
                *_summary_base_patches(),
                patch("app.modules.notifications.service.notif_seen_repo.has_seen", side_effect=has_seen),
                patch("app.modules.notifications.service.rams_repo.assessment_status_fingerprint_for_company", return_value=(0, None)),
                patch("app.modules.notifications.service.payroll_repo.pending_payroll_items_fingerprint_for_company", return_value=(3, latest)),
            ],
        )
        summary = get_notification_summary(MagicMock(), actor, company_id=None)
    item = next(i for i in summary.items if i.kind == "payroll_pending")
    assert item.count == 3
    assert item.target_key == f"payroll_pending:{cid}:3:{latest.isoformat()}"


def test_rams_drafts_alert_hides_after_seen() -> None:
    cid = uuid.uuid4()
    actor = _admin(cid)
    latest = datetime(2026, 5, 16, 10, 0, tzinfo=timezone.utc)
    with ExitStack() as stack:
        _start_patches(
            stack,
            [
                *_summary_base_patches(),
                patch("app.modules.notifications.service.notif_seen_repo.has_seen", return_value=True),
                patch("app.modules.notifications.service.rams_repo.assessment_status_fingerprint_for_company", return_value=(4, latest)),
                patch("app.modules.notifications.service.payroll_repo.pending_payroll_items_fingerprint_for_company", return_value=(0, None)),
            ],
        )
        summary = get_notification_summary(MagicMock(), actor, company_id=None)
    assert all(i.kind != "rams_review" for i in summary.items)


def test_changed_rams_draft_count_reappears() -> None:
    cid = uuid.uuid4()
    actor = _admin(cid)
    latest = datetime(2026, 5, 16, 10, 0, tzinfo=timezone.utc)

    def has_seen(*_args, **kwargs):
        return kwargs["target_key"].startswith(f"rams_review:{cid}:4:")

    with ExitStack() as stack:
        _start_patches(
            stack,
            [
                *_summary_base_patches(),
                patch("app.modules.notifications.service.notif_seen_repo.has_seen", side_effect=has_seen),
                patch("app.modules.notifications.service.rams_repo.assessment_status_fingerprint_for_company", return_value=(5, latest)),
                patch("app.modules.notifications.service.payroll_repo.pending_payroll_items_fingerprint_for_company", return_value=(0, None)),
            ],
        )
        summary = get_notification_summary(MagicMock(), actor, company_id=None)
    item = next(i for i in summary.items if i.kind == "rams_review")
    assert item.count == 5


def test_mark_all_seen_handles_visible_computed_and_persistent_items() -> None:
    db = MagicMock()
    actor = _admin(uuid.uuid4())
    body = NotificationMarkAllSeenRequest(
        items=[
            NotificationMarkAllSeenItem(kind="rams_review", target_key="rams_review:co:4:ts"),
            NotificationMarkAllSeenItem(kind="payroll_pending", target_key="payroll_pending:co:2:ts"),
            NotificationMarkAllSeenItem(kind="attendance_late_arrival", target_key="attendance:late_arrival:x"),
            NotificationMarkAllSeenItem(kind="message_received", target_key="message:x"),
        ],
    )
    with (
        patch("app.modules.notifications.service.notif_seen_repo.upsert_seen") as upsert,
        patch("app.modules.notifications.service.notif_seen_repo.mark_record_seen") as mark_record,
    ):
        mark_all_informational_seen(db, actor, body)
    assert upsert.call_count == 2
    assert mark_record.call_count == 2
    mark_record.assert_any_call(db, user_id=actor.id, kind="attendance_late_arrival", dedupe_key="attendance:late_arrival:x")
    mark_record.assert_any_call(db, user_id=actor.id, kind="message_received", dedupe_key="message:x")
