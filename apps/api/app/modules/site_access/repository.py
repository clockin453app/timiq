import uuid

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.modules.site_access.models import EmployeeLocationAccess


def get_site_access(
    db_session: Session,
    user_id: uuid.UUID,
    location_id: uuid.UUID,
) -> EmployeeLocationAccess | None:
    statement = (
        select(EmployeeLocationAccess)
        .where(EmployeeLocationAccess.user_id == user_id)
        .where(EmployeeLocationAccess.location_id == location_id)
    )
    return db_session.scalar(statement)


def list_site_access(db_session: Session) -> list[EmployeeLocationAccess]:
    statement = select(EmployeeLocationAccess).order_by(
        EmployeeLocationAccess.created_at.desc()
    )
    return list(db_session.scalars(statement).all())


def list_site_access_for_user(
    db_session: Session,
    user_id: uuid.UUID,
) -> list[EmployeeLocationAccess]:
    statement = (
        select(EmployeeLocationAccess)
        .where(EmployeeLocationAccess.user_id == user_id)
        .order_by(EmployeeLocationAccess.created_at.desc())
    )
    return list(db_session.scalars(statement).all())


def list_site_access_for_location_ids(
    db_session: Session,
    location_ids: list[uuid.UUID],
) -> list[EmployeeLocationAccess]:
    if not location_ids:
        return []

    statement = (
        select(EmployeeLocationAccess)
        .where(EmployeeLocationAccess.location_id.in_(location_ids))
        .order_by(EmployeeLocationAccess.created_at.desc())
    )
    return list(db_session.scalars(statement).all())


def save_site_access(
    db_session: Session,
    site_access: EmployeeLocationAccess,
) -> EmployeeLocationAccess:
    db_session.add(site_access)
    db_session.commit()
    db_session.refresh(site_access)
    return site_access


def delete_site_access(
    db_session: Session,
    user_id: uuid.UUID,
    location_id: uuid.UUID,
) -> None:
    statement = (
        delete(EmployeeLocationAccess)
        .where(EmployeeLocationAccess.user_id == user_id)
        .where(EmployeeLocationAccess.location_id == location_id)
    )
    db_session.execute(statement)
    db_session.commit()


def delete_all_site_access_for_user(db_session: Session, user_id: uuid.UUID) -> None:
    statement = delete(EmployeeLocationAccess).where(EmployeeLocationAccess.user_id == user_id)
    db_session.execute(statement)
