import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.locations.models import Location


def get_location_by_id(
    db_session: Session,
    location_id: uuid.UUID,
) -> Location | None:
    statement = select(Location).where(Location.id == location_id)
    return db_session.scalar(statement)


def get_location_by_company_and_name(
    db_session: Session,
    company_id: uuid.UUID,
    name: str,
) -> Location | None:
    statement = (
        select(Location)
        .where(Location.company_id == company_id)
        .where(Location.name == name.strip())
    )
    return db_session.scalar(statement)


def list_locations(db_session: Session) -> list[Location]:
    statement = select(Location).order_by(Location.created_at.desc())
    return list(db_session.scalars(statement).all())


def list_locations_by_company(
    db_session: Session,
    company_id: uuid.UUID,
) -> list[Location]:
    statement = (
        select(Location)
        .where(Location.company_id == company_id)
        .order_by(Location.created_at.desc())
    )
    return list(db_session.scalars(statement).all())


def save_location(db_session: Session, location: Location) -> Location:
    db_session.add(location)
    db_session.commit()
    db_session.refresh(location)
    return location


def update_location(db_session: Session, location: Location) -> Location:
    db_session.add(location)
    db_session.commit()
    db_session.refresh(location)
    return location