"""Push subscriptions are bound to the active auth session."""

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from starlette.requests import Request

from app.modules.auth.models import SystemRole, User
from app.modules.notifications import repository as notification_repo
from app.modules.notifications.router import subscribe_push
from app.modules.notifications.schemas import PushSubscriptionBody, PushSubscriptionKeys


def _request_with_session(session_id: uuid.UUID) -> Request:
    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
    request.state.auth_session_id = session_id
    return request


def _user(session_id: uuid.UUID) -> User:
    user = MagicMock(spec=User)
    user.id = uuid.uuid4()
    user.company_id = uuid.uuid4()
    user.system_role = SystemRole.EMPLOYEE
    user.is_active = True
    user.active_session_id = session_id
    return user


def _body() -> PushSubscriptionBody:
    return PushSubscriptionBody(
        endpoint="https://push.example.test/endpoint",
        keys=PushSubscriptionKeys(p256dh="p256dh", auth="auth"),
        user_agent="pytest",
        device_label="test",
    )


def test_subscribe_endpoint_stores_current_session_id() -> None:
    session_id = uuid.uuid4()
    user = _user(session_id)
    row = SimpleNamespace(is_active=True)

    with patch("app.modules.notifications.router.notification_repo.upsert_push_subscription", return_value=row) as upsert:
        response = subscribe_push(_body(), _request_with_session(session_id), MagicMock(), user)

    assert response.ok is True
    assert upsert.call_args.kwargs["session_id"] == session_id
    assert upsert.call_args.kwargs["user_id"] == user.id


def test_upsert_push_subscription_sets_session_id_on_new_row(monkeypatch) -> None:
    db = MagicMock()
    session_id = uuid.uuid4()
    monkeypatch.setattr(notification_repo, "get_push_subscription_by_user_endpoint", lambda *_args, **_kwargs: None)

    row = notification_repo.upsert_push_subscription(
        db,
        user_id=uuid.uuid4(),
        endpoint="https://push.example.test/endpoint",
        p256dh="p256dh",
        auth="auth",
        session_id=session_id,
        user_agent="pytest",
        device_label="test",
    )

    assert row.session_id == session_id


def test_upsert_push_subscription_rebinds_existing_row_to_current_session(monkeypatch) -> None:
    db = MagicMock()
    session_id = uuid.uuid4()
    row = SimpleNamespace(
        p256dh="old",
        auth="old",
        session_id=uuid.uuid4(),
        user_agent=None,
        device_label=None,
        is_active=False,
        updated_at=None,
        last_seen_at=None,
        revoked_at="old",
    )
    monkeypatch.setattr(notification_repo, "get_push_subscription_by_user_endpoint", lambda *_args, **_kwargs: row)

    updated = notification_repo.upsert_push_subscription(
        db,
        user_id=uuid.uuid4(),
        endpoint="https://push.example.test/endpoint",
        p256dh="new",
        auth="new",
        session_id=session_id,
        user_agent="pytest",
        device_label="test",
    )

    assert updated is row
    assert row.session_id == session_id
    assert row.is_active is True
    assert row.revoked_at is None


def test_active_push_subscription_query_matches_current_user_session() -> None:
    db = MagicMock()
    db.scalars.return_value.all.return_value = []

    notification_repo.list_active_push_subscriptions_for_user(db, user_id=uuid.uuid4())

    statement_text = str(db.scalars.call_args.args[0])
    assert "push_subscriptions.session_id = users.active_session_id" in statement_text
