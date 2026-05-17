"""Single active session enforcement for signed auth cookies."""

import base64
import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request

from app.modules.auth import router as auth_router
from app.modules.auth.account_access_service import (
    change_my_password,
    complete_password_reset_with_token,
)
from app.modules.auth.dependencies import get_authenticated_user
from app.modules.auth.models import AccountTokenPurpose, SystemRole, User
from app.modules.auth.router import login, logout
from app.modules.auth.schemas import LoginRequest, PasswordChangeRequest, ResetPasswordWithTokenRequest
from app.modules.auth.service import reset_user_password_by_admin
from app.modules.auth.session_tokens import _get_session_secret, create_session_token, read_session_token


def _request_with_cookie(token: str | None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if token is not None:
        headers.append((b"cookie", f"timiq_session={token}".encode("utf-8")))
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers})


def _user(*, user_id: uuid.UUID | None = None, active_session_id: uuid.UUID | None = None) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=user_id or uuid.uuid4(),
        company_id=uuid.uuid4(),
        email="user@example.com",
        password_hash="hash",
        system_role=SystemRole.EMPLOYEE,
        is_active=True,
        created_at=now,
        updated_at=now,
        active_session_id=active_session_id,
    )


def _cookie_value(response: Response) -> str:
    raw = response.headers["set-cookie"]
    cookie = SimpleCookie()
    cookie.load(raw)
    return cookie["timiq_session"].value


def test_login_creates_active_session_id_and_cookie_sid() -> None:
    user = _user(active_session_id=None)
    response = Response()

    def set_session(_db, target: User, session_id: uuid.UUID) -> User:
        target.active_session_id = session_id
        return target

    with (
        patch("app.modules.auth.router.authenticate_user", return_value=user),
        patch("app.modules.auth.router.set_user_active_session_id", side_effect=set_session) as set_active,
    ):
        result = login(LoginRequest(email=user.email, password="Password123"), response, MagicMock())

    claims = read_session_token(_cookie_value(response))
    assert result.user.id == user.id
    assert claims.user_id == user.id
    assert claims.session_id == user.active_session_id
    set_active.assert_called_once()


def test_old_session_token_returns_401_after_new_login_rotates_session(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid.uuid4()
    old_sid = uuid.uuid4()
    new_sid = uuid.uuid4()
    token = create_session_token(user_id, old_sid)
    user = _user(user_id=user_id, active_session_id=new_sid)
    monkeypatch.setattr("app.modules.auth.dependencies.get_user_by_id", lambda _db, _uid: user)

    with pytest.raises(HTTPException) as exc:
        get_authenticated_user(_request_with_cookie(token), MagicMock())

    assert exc.value.status_code == 401


def test_session_token_missing_sid_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid.uuid4()
    payload_json = json.dumps(
        {"sub": str(user_id), "exp": int(time.time()) + 300},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload_json).decode("utf-8")
    signature = hmac.new(_get_session_secret(), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    token = f"{payload_b64}.{base64.urlsafe_b64encode(signature).decode('utf-8')}"
    monkeypatch.setattr("app.modules.auth.dependencies.get_user_by_id", lambda _db, _uid: None)

    with pytest.raises(HTTPException) as exc:
        get_authenticated_user(_request_with_cookie(token), MagicMock())

    assert exc.value.status_code == 401


def test_current_session_token_works(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid.uuid4()
    sid = uuid.uuid4()
    token = create_session_token(user_id, sid)
    user = _user(user_id=user_id, active_session_id=sid)
    monkeypatch.setattr("app.modules.auth.dependencies.get_user_by_id", lambda _db, _uid: user)

    request = _request_with_cookie(token)
    assert get_authenticated_user(request, MagicMock()) is user
    assert request.state.auth_session_id == sid


def test_different_users_do_not_invalidate_each_other(monkeypatch: pytest.MonkeyPatch) -> None:
    user_one = _user(active_session_id=uuid.uuid4())
    user_two = _user(active_session_id=uuid.uuid4())
    users = {user_one.id: user_one, user_two.id: user_two}
    monkeypatch.setattr("app.modules.auth.dependencies.get_user_by_id", lambda _db, uid: users[uid])

    assert get_authenticated_user(_request_with_cookie(create_session_token(user_one.id, user_one.active_session_id)), MagicMock()) is user_one
    assert get_authenticated_user(_request_with_cookie(create_session_token(user_two.id, user_two.active_session_id)), MagicMock()) is user_two


def test_logout_clears_only_matching_active_session() -> None:
    active_sid = uuid.uuid4()
    user = _user(active_session_id=active_sid)
    response = Response()

    with (
        patch("app.modules.auth.router.get_user_by_id", return_value=user),
        patch("app.modules.auth.router.set_user_active_session_id") as set_active,
    ):
        logout(_request_with_cookie(create_session_token(user.id, active_sid)), response, MagicMock())

    set_active.assert_called_once()
    assert set_active.call_args.args[2] is None


def test_logout_with_old_session_does_not_clear_new_active_session() -> None:
    user = _user(active_session_id=uuid.uuid4())
    response = Response()

    with (
        patch("app.modules.auth.router.get_user_by_id", return_value=user),
        patch("app.modules.auth.router.set_user_active_session_id") as set_active,
    ):
        logout(_request_with_cookie(create_session_token(user.id, uuid.uuid4())), response, MagicMock())

    set_active.assert_not_called()


def test_password_change_invalidates_active_session() -> None:
    user = _user(active_session_id=uuid.uuid4())
    body = PasswordChangeRequest(current_password="Password123", new_password="NewPassword123")

    with (
        patch("app.modules.auth.account_access_service.verify_password", return_value=True),
        patch("app.modules.auth.account_access_service.hash_password", return_value="new-hash"),
        patch("app.modules.auth.account_access_service.update_user", return_value=user),
        patch("app.modules.auth.account_access_service.create_internal_audit_event"),
    ):
        change_my_password(MagicMock(), user, body)

    assert user.active_session_id is None


def test_password_reset_invalidates_active_session() -> None:
    user = _user(active_session_id=uuid.uuid4())
    token_row = SimpleNamespace(
        user_id=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        purpose=AccountTokenPurpose.PASSWORD_RESET,
    )

    with (
        patch("app.modules.auth.account_access_service.hash_account_token", return_value="hash"),
        patch("app.modules.auth.account_access_service.token_repo.get_unused_token_by_hash", return_value=token_row),
        patch("app.modules.auth.account_access_service.get_user_by_id", return_value=user),
        patch("app.modules.auth.account_access_service.hash_password", return_value="new-hash"),
        patch("app.modules.auth.account_access_service.token_repo.mark_token_used"),
        patch("app.modules.auth.account_access_service.update_user", return_value=user),
        patch("app.modules.auth.account_access_service.create_internal_audit_event"),
    ):
        complete_password_reset_with_token(
            MagicMock(),
            ResetPasswordWithTokenRequest(token="reset-token", new_password="NewPassword123"),
        )

    assert user.active_session_id is None


def test_admin_password_reset_invalidates_active_session() -> None:
    target = _user(active_session_id=uuid.uuid4())
    actor = _user()
    actor.system_role = SystemRole.ADMINISTRATOR

    with (
        patch("app.modules.auth.service.get_user_by_id", return_value=target),
        patch("app.modules.auth.service.hash_password", return_value="new-hash"),
        patch("app.modules.auth.service.update_user", return_value=target),
    ):
        reset_user_password_by_admin(
            MagicMock(),
            actor,
            target.id,
            SimpleNamespace(password="NewPassword123"),
        )

    assert target.active_session_id is None
