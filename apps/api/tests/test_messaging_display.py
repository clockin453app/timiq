"""Messaging participant names and notification deep links (mocked database)."""

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.modules.auth.models import SystemRole, User
from app.modules.messaging.models import Conversation, Message
from app.modules.messaging.schemas import MessageParticipantSummary
from app.modules.messaging.service import (
    MessagingPermissionError,
    _conversation_to_list_item,
    _message_to_response,
    list_messages,
    message_bell_items,
)


def _user(role: SystemRole, company_id: uuid.UUID | None, user_id: uuid.UUID | None = None) -> User:
    u = MagicMock(spec=User)
    u.system_role = role
    u.company_id = company_id
    u.id = user_id or uuid.uuid4()
    u.email = "actor@example.com"
    u.is_active = True
    return u


def test_message_response_includes_sender_display_name() -> None:
    db = MagicMock()
    sender_id = uuid.uuid4()
    msg = Message(
        id=uuid.uuid4(),
        conversation_id=uuid.uuid4(),
        sender_user_id=sender_id,
        body="Hello",
        created_at=datetime.now(timezone.utc),
    )
    with patch("app.modules.messaging.service._peer_display_name", return_value="Alex Smith"):
        row = _message_to_response(db, msg)
    assert row.sender_display_name == "Alex Smith"
    assert row.sender_user_id == sender_id


def test_conversation_list_item_includes_participants() -> None:
    db = MagicMock()
    viewer = uuid.uuid4()
    other = uuid.uuid4()
    conv = Conversation(
        id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        created_by_user_id=viewer,
        conversation_type="direct",
        title=None,
        updated_at=datetime.now(timezone.utc),
    )
    part_a = MagicMock()
    part_a.user_id = viewer
    part_b = MagicMock()
    part_b.user_id = other

    with patch("app.modules.messaging.service.list_participants_for_conversation", return_value=[part_a, part_b]):
        with patch("app.modules.messaging.service.get_last_message", return_value=None):
            with patch(
                "app.modules.messaging.service._participant_summary",
                side_effect=lambda _db, uid: MessageParticipantSummary(
                    user_id=uid,
                    display_name="Peer" if uid == other else "Me",
                    email="peer@example.com" if uid == other else "me@example.com",
                ),
            ):
                with patch("app.modules.messaging.service._peer_display_name", return_value="Peer"):
                    item = _conversation_to_list_item(db, conv, viewer)

    assert len(item.participants) == 2
    assert item.other_user_display_name == "Peer"


def test_list_messages_denied_for_non_participant() -> None:
    db = MagicMock()
    actor = _user(SystemRole.EMPLOYEE, uuid.uuid4())
    cid = uuid.uuid4()
    with patch("app.modules.messaging.service.get_participant", return_value=None):
        with pytest.raises(MessagingPermissionError, match="not part"):
            list_messages(db, actor, cid, limit=50, offset=0)


def test_message_bell_item_deep_link_includes_conversation_id() -> None:
    db = MagicMock()
    user_id = uuid.uuid4()
    conv_id = uuid.uuid4()
    conv = Conversation(
        id=conv_id,
        company_id=uuid.uuid4(),
        created_by_user_id=user_id,
        conversation_type="direct",
        title=None,
        updated_at=datetime.now(timezone.utc),
    )
    list_item = MagicMock()
    list_item.conversation_type = "direct"
    list_item.title = None
    list_item.other_user_display_name = "Jordan Lee"

    with patch(
        "app.modules.messaging.service.count_conversations_with_unread_incoming",
        return_value=1,
    ):
        with patch(
            "app.modules.messaging.service.list_conversation_ids_with_unread_ordered",
            return_value=[conv_id],
        ):
            with patch("app.modules.messaging.service.get_conversation", return_value=conv):
                with patch(
                    "app.modules.messaging.service.count_unread_incoming_in_conversation",
                    return_value=2,
                ):
                    with patch(
                        "app.modules.messaging.service._conversation_to_list_item",
                        return_value=list_item,
                    ):
                        rows = message_bell_items(db, user_id=user_id)

    assert len(rows) == 1
    assert f"conversation={conv_id}" in rows[0].href
    assert rows[0].href.startswith("/messages?tab=messages&")
