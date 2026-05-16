import uuid
from unittest.mock import Mock

from app.modules.notifications import push_service


def test_push_payload_keeps_url_same_origin_path_only() -> None:
    payload = push_service.build_push_payload(
        notification_id=uuid.uuid4(),
        title="Alert",
        body="Please review this item.",
        href="https://example.com/steal",
        kind="late_arrival",
    )

    assert payload["url"] == "/"
    assert payload["title"] == "Alert"
    assert payload["body"] == "Please review this item."
    assert payload["kind"] == "late_arrival"


def test_push_payload_replaces_private_marker_text() -> None:
    payload = push_service.build_push_payload(
        notification_id=None,
        title="GPS latitude alert",
        body="storage path: /tmp/secret",
        href="/time-records",
        kind="forgot_clock_out",
    )

    assert payload["title"] == "You have a new TimIQ notification."
    assert payload["body"] == "You have a new TimIQ notification."
    assert payload["url"] == "/time-records"


def test_disabled_push_does_not_list_or_send(monkeypatch) -> None:
    monkeypatch.setattr(push_service.settings, "timiq_web_push_enabled", False)
    list_subscriptions = Mock()
    monkeypatch.setattr(push_service.notification_repo, "list_active_push_subscriptions_for_user", list_subscriptions)

    sent = push_service.send_push_for_notification_record(
        Mock(),
        notification_id=uuid.uuid4(),
        recipient_user_id=uuid.uuid4(),
        title="Late arrival",
        body="A safe notification body.",
        href="/time-records",
        kind="late_arrival",
    )

    assert sent == 0
    list_subscriptions.assert_not_called()
