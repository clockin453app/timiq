from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.modules.auth.models import AccountActionToken, AccountTokenPurpose


def invalidate_unused_tokens_for_user_purpose(
    db_session: Session,
    user_id: uuid.UUID,
    purpose: AccountTokenPurpose,
) -> None:
    now = datetime.now(timezone.utc)
    stmt = (
        update(AccountActionToken)
        .where(
            AccountActionToken.user_id == user_id,
            AccountActionToken.purpose == purpose.value,
            AccountActionToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    db_session.execute(stmt)


def insert_account_token(
    db_session: Session,
    *,
    user_id: uuid.UUID,
    email_normalized: str,
    token_hash: str,
    purpose: AccountTokenPurpose,
    expires_at: datetime,
    created_by_user_id: uuid.UUID | None,
    request_ip_hash: str | None,
    user_agent_hash: str | None,
    invite_meta: dict | None,
) -> AccountActionToken:
    now = datetime.now(timezone.utc)
    row = AccountActionToken(
        user_id=user_id,
        email_normalized=email_normalized,
        token_hash=token_hash,
        purpose=purpose.value,
        expires_at=expires_at,
        used_at=None,
        created_by_user_id=created_by_user_id,
        created_at=now,
        request_ip_hash=request_ip_hash,
        user_agent_hash=user_agent_hash,
        invite_meta=invite_meta,
    )
    db_session.add(row)
    db_session.flush()
    return row


def get_unused_token_by_hash(
    db_session: Session,
    token_hash: str,
    purpose: AccountTokenPurpose,
) -> AccountActionToken | None:
    stmt = select(AccountActionToken).where(
        AccountActionToken.token_hash == token_hash,
        AccountActionToken.purpose == purpose.value,
        AccountActionToken.used_at.is_(None),
    )
    return db_session.scalar(stmt)


def mark_token_used(db_session: Session, row: AccountActionToken) -> None:
    row.used_at = datetime.now(timezone.utc)
    db_session.add(row)
    db_session.flush()


def count_recent_tokens(
    db_session: Session,
    user_id: uuid.UUID,
    purpose: AccountTokenPurpose,
    *,
    since: datetime,
) -> int:
    stmt = (
        select(func.count())
        .select_from(AccountActionToken)
        .where(
            AccountActionToken.user_id == user_id,
            AccountActionToken.purpose == purpose.value,
            AccountActionToken.created_at >= since,
        )
    )
    return int(db_session.scalar(stmt) or 0)
