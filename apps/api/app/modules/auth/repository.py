import uuid

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


def _profile_field_value(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def get_employee_profile_fields_for_user(
    db_session: Session,
    user_id: uuid.UUID,
) -> tuple[str | None, str | None, str | None, bool]:
    """Current user's employee profile names + face-reference flag for auth session responses."""
    ep = EmployeeProfile
    row = db_session.execute(
        select(
            ep.first_name,
            ep.last_name,
            ep.job_title,
            ep.face_reference_storage_path,
            ep.face_check_consent_at,
        ).where(ep.user_id == user_id),
    ).first()
    if row is None:
        return None, None, None, False

    try:
        storage_path = (row[3] or "").strip() if row[3] is not None else ""
        consent_at = row[4]
        face_configured = consent_at is not None and bool(storage_path)
        return (
            _profile_field_value(row[0]),
            _profile_field_value(row[1]),
            _profile_field_value(row[2]),
            face_configured,
        )
    except (IndexError, TypeError):
        return None, None, None, False


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
    *,
    company_id: uuid.UUID | None = None,
) -> list[tuple[User, str | None, str | None, str | None, str | None, bool]]:
    ep = EmployeeProfile
    columns = (
        User,
        ep.first_name,
        ep.last_name,
        ep.job_title,
        ep.payroll_type,
        ep.face_reference_storage_path,
    )
    if actor.system_role == SystemRole.ADMINISTRATOR:
        statement = select(*columns).outerjoin(ep, ep.user_id == User.id).order_by(User.created_at.desc())
        if company_id is not None:
            statement = statement.where(User.company_id == company_id)
    elif actor.company_id is None:
        return []
    else:
        statement = (
            select(*columns)
            .outerjoin(ep, ep.user_id == User.id)
            .where(User.company_id == actor.company_id)
            .order_by(User.created_at.desc())
        )

    rows = db_session.execute(statement).all()
    result: list[tuple[User, str | None, str | None, str | None, str | None, bool]] = []
    for row in rows:
        storage_path = (row[5] or "").strip() if row[5] is not None else ""
        result.append(
            (
                row[0],
                row[1],
                row[2],
                row[3],
                (row[4] or "").strip() or None,
                bool(storage_path),
            ),
        )
    return result


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


def set_user_active_session_id(
    db_session: Session,
    user: User,
    session_id: uuid.UUID | None,
) -> User:
    user.active_session_id = session_id
    return update_user(db_session, user)
