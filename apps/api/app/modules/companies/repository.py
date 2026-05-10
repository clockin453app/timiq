import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.companies.models import Company


def get_company_by_id(db_session: Session, company_id: uuid.UUID) -> Company | None:
    statement = select(Company).where(Company.id == company_id)
    return db_session.scalar(statement)


def get_company_by_name(db_session: Session, name: str) -> Company | None:
    statement = select(Company).where(Company.name == name.strip())
    return db_session.scalar(statement)


def list_companies(db_session: Session) -> list[Company]:
    statement = select(Company).order_by(Company.name.asc())
    return list(db_session.scalars(statement).all())


def save_company(db_session: Session, company: Company) -> Company:
    db_session.add(company)
    db_session.commit()
    db_session.refresh(company)
    return company


def update_company(db_session: Session, company: Company) -> Company:
    db_session.add(company)
    db_session.commit()
    db_session.refresh(company)
    return company
