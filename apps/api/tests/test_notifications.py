"""Notification summary API smoke tests (no database)."""

from fastapi.testclient import TestClient

from app.main import app


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
