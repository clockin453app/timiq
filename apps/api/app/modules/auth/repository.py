from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User


def get_user_by_email(db_session: Session, email: str) -> User | None:
    statement = select(User).where(User.email == email.strip().lower())
    return db_session.scalar(statement)


def get_user_by_id(db_session: Session, user_id) -> User | None:
    statement = select(User).where(User.id == user_id)
    return db_session.scalar(statement)


def list_users(db_session: Session) -> list[User]:
    statement = select(User).order_by(User.created_at.desc())
    return list(db_session.scalars(statement).all())


def list_users_visible_to_user(db_session: Session, actor: User) -> list[User]:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return list_users(db_session)

    if actor.company_id is None:
        return []

    statement = (
        select(User)
        .where(User.company_id == actor.company_id)
        .order_by(User.created_at.desc())
    )

    return list(db_session.scalars(statement).all())


def save_user(db_session: Session, user: User) -> User:
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def update_user(db_session: Session, user: User) -> User:
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user
