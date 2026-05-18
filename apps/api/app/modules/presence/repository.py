from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased

from app.modules.auth.models import User
from app.modules.companies.models import Company
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.presence.models import UserPresenceSession


def get_presence_session(
    db_session: Session,
    *,
    user_id: uuid.UUID,
    client_instance_id: str,
) -> UserPresenceSession | None:
    stmt = select(UserPresenceSession).where(
        UserPresenceSession.user_id == user_id,
        UserPresenceSession.client_instance_id == client_instance_id,
    )
    return db_session.scalar(stmt)


def add_presence_session(db_session: Session, session: UserPresenceSession) -> UserPresenceSession:
    db_session.add(session)
    return session


def count_seen_today(db_session: Session, *, since: datetime) -> int:
    stmt = (
        select(func.count(func.distinct(UserPresenceSession.user_id)))
        .select_from(UserPresenceSession)
        .where(UserPresenceSession.last_seen_at >= since)
    )
    return int(db_session.scalar(stmt) or 0)


def count_sessions_since(db_session: Session, *, since: datetime) -> int:
    stmt = select(func.count()).select_from(UserPresenceSession).where(
        UserPresenceSession.last_heartbeat_at >= since,
    )
    return int(db_session.scalar(stmt) or 0)


def list_presence_sessions(
    db_session: Session,
    *,
    since: datetime | None,
    search: str | None,
    limit: int,
    offset: int,
) -> tuple[list[tuple[UserPresenceSession, User, EmployeeProfile | None, Company | None]], int]:
    profile = aliased(EmployeeProfile)
    company = aliased(Company)
    conditions = []
    if since is not None:
        conditions.append(UserPresenceSession.last_heartbeat_at >= since)
    if search:
        like = f"%{search}%"
        full_name = func.coalesce(profile.first_name, "") + " " + func.coalesce(profile.last_name, "")
        conditions.append(
            or_(
                User.email.ilike(like),
                profile.first_name.ilike(like),
                profile.last_name.ilike(like),
                full_name.ilike(like),
                company.name.ilike(like),
                UserPresenceSession.current_path.ilike(like),
                UserPresenceSession.user_agent_summary.ilike(like),
                UserPresenceSession.role.ilike(like),
            ),
        )

    base = (
        select(UserPresenceSession, User, profile, company)
        .join(User, UserPresenceSession.user_id == User.id)
        .outerjoin(profile, profile.user_id == User.id)
        .outerjoin(company, UserPresenceSession.company_id == company.id)
    )
    count_stmt = (
        select(func.count())
        .select_from(UserPresenceSession)
        .join(User, UserPresenceSession.user_id == User.id)
        .outerjoin(profile, profile.user_id == User.id)
        .outerjoin(company, UserPresenceSession.company_id == company.id)
    )
    for condition in conditions:
        base = base.where(condition)
        count_stmt = count_stmt.where(condition)

    total = int(db_session.scalar(count_stmt) or 0)
    rows = db_session.execute(
        base.order_by(UserPresenceSession.last_heartbeat_at.desc())
        .offset(offset)
        .limit(limit),
    ).all()
    return [(row[0], row[1], row[2], row[3]) for row in rows], total
