import uuid
from unittest.mock import Mock, patch

from app.modules.auth.models import SystemRole, User
from app.modules.messaging.models import Conversation, Message
from app.modules.messaging.service import _record_message_received_events
from app.modules.notifications import events
from app.modules.notifications import push_service
from app.modules.notifications.repository import create_notification_record_once


def _user(user_id: uuid.UUID, company_id: uuid.UUID | None = None) -> User:
    user = Mock(spec=User)
    user.id = user_id
    user.company_id = company_id or uuid.uuid4()
    user.email = "sender@example.com"
    user.system_role = SystemRole.EMPLOYEE
    user.is_active = True
    return user


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


def test_message_event_creates_records_for_recipients_not_sender() -> None:
    sender_id = uuid.uuid4()
    recipient_id = uuid.uuid4()
    company_id = uuid.uuid4()
    conversation_id = uuid.uuid4()
    message_id = uuid.uuid4()

    with patch("app.modules.notifications.events.create_notification_record_once", return_value=True) as create:
        created = events.record_message_received(
            Mock(),
            company_id=company_id,
            conversation_id=conversation_id,
            message_id=message_id,
            sender_user_id=sender_id,
            sender_display_name="Petre Rotaru",
            recipient_user_ids=[sender_id, recipient_id, recipient_id],
        )

    assert created == 1
    create.assert_called_once()
    kwargs = create.call_args.kwargs
    assert kwargs["recipient_user_id"] == recipient_id
    assert kwargs["kind"] == "message_received"
    assert kwargs["dedupe_key"] == f"message:{conversation_id}:{message_id}:{recipient_id}"
    assert kwargs["description"] == "You have a new message in TimIQ."
    assert kwargs["href"] == f"/messages?tab=messages&conversation={conversation_id}"


def test_message_service_keeps_recipient_when_not_active_in_conversation() -> None:
    sender_id = uuid.uuid4()
    recipient_id = uuid.uuid4()
    conversation_id = uuid.uuid4()
    company_id = uuid.uuid4()
    conversation = Conversation(id=conversation_id, company_id=company_id)
    message = Message(id=uuid.uuid4(), conversation_id=conversation_id, sender_user_id=sender_id, body="Hello")

    with patch("app.modules.messaging.service.is_user_active_in_conversation", return_value=False):
        with patch("app.modules.messaging.service._peer_display_name", return_value="Sender"):
            with patch("app.modules.messaging.service.record_message_received") as record:
                _record_message_received_events(
                    Mock(),
                    actor=_user(sender_id, company_id),
                    conversation=conversation,
                    message=message,
                    recipient_user_ids=[recipient_id],
                )

    assert record.call_args.kwargs["recipient_user_ids"] == [recipient_id]


def test_message_service_suppresses_recipient_active_in_same_conversation() -> None:
    sender_id = uuid.uuid4()
    recipient_id = uuid.uuid4()
    conversation_id = uuid.uuid4()
    company_id = uuid.uuid4()
    conversation = Conversation(id=conversation_id, company_id=company_id)
    message = Message(id=uuid.uuid4(), conversation_id=conversation_id, sender_user_id=sender_id, body="Hello")

    with patch("app.modules.messaging.service.is_user_active_in_conversation", return_value=True):
        with patch("app.modules.messaging.service._peer_display_name", return_value="Sender"):
            with patch("app.modules.messaging.service.record_message_received") as record:
                _record_message_received_events(
                    Mock(),
                    actor=_user(sender_id, company_id),
                    conversation=conversation,
                    message=message,
                    recipient_user_ids=[recipient_id],
                )

    assert record.call_args.kwargs["recipient_user_ids"] == []


def test_message_service_active_in_different_conversation_still_notifies() -> None:
    sender_id = uuid.uuid4()
    recipient_id = uuid.uuid4()
    conversation_id = uuid.uuid4()
    different_conversation_id = uuid.uuid4()
    company_id = uuid.uuid4()
    conversation = Conversation(id=conversation_id, company_id=company_id)
    message = Message(id=uuid.uuid4(), conversation_id=conversation_id, sender_user_id=sender_id, body="Hello")

    def active_check(_db, *, user_id, conversation_id, now):
        return user_id == recipient_id and conversation_id == different_conversation_id

    with patch("app.modules.messaging.service.is_user_active_in_conversation", side_effect=active_check):
        with patch("app.modules.messaging.service._peer_display_name", return_value="Sender"):
            with patch("app.modules.messaging.service.record_message_received") as record:
                _record_message_received_events(
                    Mock(),
                    actor=_user(sender_id, company_id),
                    conversation=conversation,
                    message=message,
                    recipient_user_ids=[recipient_id],
                )

    assert record.call_args.kwargs["recipient_user_ids"] == [recipient_id]


def test_message_service_stale_presence_still_notifies() -> None:
    sender_id = uuid.uuid4()
    recipient_id = uuid.uuid4()
    conversation_id = uuid.uuid4()
    company_id = uuid.uuid4()
    conversation = Conversation(id=conversation_id, company_id=company_id)
    message = Message(id=uuid.uuid4(), conversation_id=conversation_id, sender_user_id=sender_id, body="Hello")

    with patch("app.modules.messaging.service.is_user_active_in_conversation", return_value=False):
        with patch("app.modules.messaging.service._peer_display_name", return_value="Sender"):
            with patch("app.modules.messaging.service.record_message_received") as record:
                _record_message_received_events(
                    Mock(),
                    actor=_user(sender_id, company_id),
                    conversation=conversation,
                    message=message,
                    recipient_user_ids=[recipient_id],
                )

    assert record.call_args.kwargs["recipient_user_ids"] == [recipient_id]


def test_event_helpers_use_safe_generic_payloads() -> None:
    with patch("app.modules.notifications.events.create_notification_record_once", return_value=True) as create:
        events.record_payroll_paid(
            Mock(),
            company_id=uuid.uuid4(),
            payroll_item_id=uuid.uuid4(),
            employee_user_id=uuid.uuid4(),
        )

    kwargs = create.call_args.kwargs
    assert kwargs["kind"] == "payroll_paid"
    assert "amount" not in kwargs["description"].lower()
    assert kwargs["href"] == "/pay-history"


def test_create_notification_record_once_triggers_push_only_for_inserted_record() -> None:
    db = Mock()
    db.scalar.side_effect = [uuid.uuid4(), None]

    with patch("app.modules.notifications.push_service.send_push_for_notification_record") as send:
        first = create_notification_record_once(
            db,
            recipient_user_id=uuid.uuid4(),
            company_id=uuid.uuid4(),
            kind="message_received",
            dedupe_key="message:one",
            title="New message",
            description="You have a new message in TimIQ.",
            href="/messages",
        )
        second = create_notification_record_once(
            db,
            recipient_user_id=uuid.uuid4(),
            company_id=uuid.uuid4(),
            kind="message_received",
            dedupe_key="message:one",
            title="New message",
            description="You have a new message in TimIQ.",
            href="/messages",
        )

    assert first is True
    assert second is False
    assert send.call_count == 1


def test_attendance_notification_record_still_triggers_push() -> None:
    db = Mock()
    db.scalar.return_value = uuid.uuid4()

    with patch("app.modules.notifications.push_service.send_push_for_notification_record") as send:
        created = create_notification_record_once(
            db,
            recipient_user_id=uuid.uuid4(),
            company_id=uuid.uuid4(),
            kind="attendance_late_arrival",
            dedupe_key="attendance:late:one",
            title="Late arrival",
            description="A safe notification body.",
            href="/time-records",
        )

    assert created is True
    send.assert_called_once()
