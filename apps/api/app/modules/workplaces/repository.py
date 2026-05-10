import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.workplaces.models import Workplace


def get_workplace_by_id(db_session: Session, workplace_id: uuid.UUID) -> Workplace | None:
    statement = select(Workplace).where(Workplace.id == workplace_id)
    return db_session.scalar(statement)


def get_workplace_by_company_and_name(
    db_session: Session,
    company_id: uuid.UUID,
    name: str,
) -> Workplace | None:
    statement = (
        select(Workplace)
        .where(Workplace.company_id == company_id)
        .where(Workplace.name == name.strip())
    )
    return db_session.scalar(statement)


def list_workplaces(db_session: Session) -> list[Workplace]:
    statement = select(Workplace).order_by(Workplace.created_at.desc())
    return list(db_session.scalars(statement).all())


def list_workplaces_by_company(db_session: Session, company_id: uuid.UUID) -> list[Workplace]:
    statement = (
        select(Workplace)
        .where(Workplace.company_id == company_id)
        .order_by(Workplace.created_at.desc())
    )
    return list(db_session.scalars(statement).all())


def save_workplace(db_session: Session, workplace: Workplace) -> Workplace:
    db_session.add(workplace)
    db_session.commit()
    db_session.refresh(workplace)
    return workplace


def update_workplace(db_session: Session, workplace: Workplace) -> Workplace:
    db_session.add(workplace)
    db_session.commit()
    db_session.refresh(workplace)
    return workplace
