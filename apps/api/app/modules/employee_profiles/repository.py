import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.employee_profiles.models import EmployeeProfile


def get_employee_profile_by_user_id(
    db_session: Session,
    user_id: uuid.UUID,
) -> EmployeeProfile | None:
    statement = select(EmployeeProfile).where(EmployeeProfile.user_id == user_id)
    return db_session.scalar(statement)


def save_employee_profile(
    db_session: Session,
    profile: EmployeeProfile,
) -> EmployeeProfile:
    db_session.add(profile)
    db_session.commit()
    db_session.refresh(profile)
    return profile


def update_employee_profile(
    db_session: Session,
    profile: EmployeeProfile,
) -> EmployeeProfile:
    db_session.add(profile)
    db_session.commit()
    db_session.refresh(profile)
    return profile


def delete_employee_profile_by_user_id(
    db_session: Session,
    user_id: uuid.UUID,
) -> None:
    profile = get_employee_profile_by_user_id(db_session, user_id)
    if profile is None:
        return
    db_session.delete(profile)
    db_session.flush()


def reset_employee_profile_after_history_clear(
    db_session: Session,
    user_id: uuid.UUID,
) -> None:
    profile = get_employee_profile_by_user_id(db_session, user_id)
    if profile is None:
        return
    profile.first_name = None
    profile.last_name = None
    profile.phone = None
    profile.job_title = None
    profile.start_date = None
    profile.emergency_contact_name = None
    profile.emergency_contact_phone = None
    profile.is_onboarded = False
    db_session.add(profile)
    db_session.flush()
