from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.employee_profiles.models import EmployeeProfile


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


def list_users_visible_to_user_with_profile_names(
    db_session: Session,
    actor: User,
) -> list[tuple[User, str | None, str | None]]:
    ep = EmployeeProfile
    if actor.system_role == SystemRole.ADMINISTRATOR:
        statement = (
            select(User, ep.first_name, ep.last_name)
            .outerjoin(ep, ep.user_id == User.id)
            .order_by(User.created_at.desc())
        )
    elif actor.company_id is None:
        return []
    else:
        statement = (
            select(User, ep.first_name, ep.last_name)
            .outerjoin(ep, ep.user_id == User.id)
            .where(User.company_id == actor.company_id)
            .order_by(User.created_at.desc())
        )

    rows = db_session.execute(statement).all()
    return [(row[0], row[1], row[2]) for row in rows]


def delete_user_record(db_session: Session, user: User) -> None:
    db_session.delete(user)
    db_session.commit()


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
