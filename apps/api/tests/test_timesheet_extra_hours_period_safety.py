"""Payroll period attribution, dual-week invalidation, and transaction safety."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company, CompanyTimePolicy
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.payroll.models import PayrollItem, PayrollPeriod
from app.modules.payroll.service import (
    payroll_week_start_for_work_date,
    recalculate_payroll,
)
from app.modules.time_clock.models import TimeShift
from app.modules.timesheet_extra_hours.models import TimesheetExtraHours
from app.modules.timesheet_extra_hours.schemas import TimesheetExtraHoursCreate, TimesheetExtraHoursPatch
from app.modules.timesheet_extra_hours.service import (
    create_extra_hours,
    delete_extra_hours,
    patch_extra_hours,
)
from app.db import models as _models  # noqa: F401

LOCAL_ADMIN_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
DB_NAME = "timiq_extra_hours_period_it"


def _local_postgres_available() -> bool:
    try:
        eng = create_engine(LOCAL_ADMIN_URL, isolation_level="AUTOCOMMIT")
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _local_postgres_available(),
    reason="Local Postgres required for Extra hours period/transaction tests",
)


@pytest.fixture()
def db_session() -> Session:
    admin = create_engine(LOCAL_ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :n"),
            {"n": DB_NAME},
        ).scalar()
        if exists:
            conn.execute(text(f'DROP DATABASE "{DB_NAME}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{DB_NAME}"'))

    target_url = f"postgresql+psycopg://postgres:postgres@127.0.0.1:5432/{DB_NAME}"
    engine = create_engine(target_url)
    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE "{DB_NAME}" WITH (FORCE)'))
        admin.dispose()


def test_payroll_week_start_matches_authoritative_monday_cis_convention() -> None:
    """CompanyTimePolicy has no alternate week-start day; CIS weeks are Monday-start."""
    cols = {c.name for c in inspect(CompanyTimePolicy).mapper.columns}
    assert "week_start_day" not in cols
    assert "payroll_week_start_weekday" not in cols
    assert payroll_week_start_for_work_date(date(2026, 7, 27)) == date(2026, 7, 27)  # Monday
    assert payroll_week_start_for_work_date(date(2026, 8, 1)) == date(2026, 7, 27)  # Saturday
    assert payroll_week_start_for_work_date(date(2026, 8, 2)) == date(2026, 7, 27)  # Sunday
    assert payroll_week_start_for_work_date(date(2026, 8, 3)) == date(2026, 8, 3)  # next Monday


def test_work_date_near_midnight_uses_company_local_calendar_date() -> None:
    """Extra hours work_date is company-local; week boundary matches payroll Monday helper."""
    tz = ZoneInfo("Pacific/Auckland")
    # UTC instant that is already next calendar day in Auckland
    utc_instant = datetime(2026, 8, 2, 12, 30, tzinfo=timezone.utc)
    local_date = utc_instant.astimezone(tz).date()
    assert local_date == date(2026, 8, 3)
    assert payroll_week_start_for_work_date(local_date) == date(2026, 8, 3)


def _seed(session: Session, *, week_a: date, week_b: date) -> dict:
    company = Company(id=uuid.uuid4(), name=f"Period Co {uuid.uuid4().hex[:6]}", is_active=True)
    admin = User(
        id=uuid.uuid4(),
        email=f"a-{uuid.uuid4().hex[:6]}@ex.com",
        password_hash="x",
        system_role=SystemRole.ADMIN,
        company_id=None,
        is_active=True,
    )
    admin.company_id = company.id
    employee = User(
        id=uuid.uuid4(),
        email=f"e-{uuid.uuid4().hex[:6]}@ex.com",
        password_hash="x",
        system_role=SystemRole.EMPLOYEE,
        company_id=company.id,
        is_active=True,
    )
    policy = CompanyTimePolicy(
        company_id=company.id,
        timezone_name="Europe/London",
        standard_start_time="08:00",
        overtime_after_hours=8.5,
        overtime_multiplier=1.5,
        rounding_increment_minutes=15,
        rounding_mode="nearest",
        break_deduction_minutes=0,
    )
    location = Location(
        id=uuid.uuid4(),
        company_id=company.id,
        name="Site",
        address="1",
        latitude=51.5,
        longitude=-0.1,
        geofence_radius_meters=100,
        is_active=True,
    )
    profile = EmployeeProfile(
        user_id=employee.id,
        company_id=company.id,
        first_name="A",
        last_name="B",
        hourly_rate=Decimal("10.0000"),
        payment_mode="net_payment",
        payroll_type="cis_subcontractor",
    )
    session.add(company)
    session.flush()
    session.add_all([admin, employee, policy, location, profile])
    session.flush()

    def _period(ws: date) -> PayrollPeriod:
        p = PayrollPeriod(
            id=uuid.uuid4(),
            company_id=company.id,
            week_start=ws,
            timezone_name="Europe/London",
            calculated_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
            calculated_by_user_id=admin.id,
        )
        session.add(p)
        session.flush()
        session.add(
            PayrollItem(
                id=uuid.uuid4(),
                period_id=p.id,
                user_id=employee.id,
                company_id=company.id,
                regular_seconds=3600,
                overtime_seconds=0,
                rounded_total_seconds=3600,
                hourly_rate_snapshot=Decimal("10"),
                tax_rate_snapshot=Decimal("0"),
                overtime_multiplier_snapshot=Decimal("1.5"),
                gross_amount=Decimal("10"),
                tax_amount=Decimal("0"),
                net_amount=Decimal("10"),
                other_deductions_amount=Decimal("0"),
                payment_mode="net_payment",
                payment_mode_source="profile",
                policy_snapshot={},
                status="pending",
                rate_missing=False,
            )
        )
        return p

    pa = _period(week_a)
    pb = _period(week_b)
    unrelated = _period(week_a - timedelta(days=7))
    session.commit()
    return {
        "company": company,
        "admin": admin,
        "employee": employee,
        "week_a": week_a,
        "week_b": week_b,
        "period_a": pa,
        "period_b": pb,
        "period_unrelated": unrelated,
    }


def test_patch_work_date_across_weeks_invalidates_both_periods(db_session: Session) -> None:
    week_a = date(2026, 7, 27)
    week_b = date(2026, 8, 3)
    world = _seed(db_session, week_a=week_a, week_b=week_b)

    created = create_extra_hours(
        db_session,
        world["admin"],
        TimesheetExtraHoursCreate(
            company_id=world["company"].id,
            user_id=world["employee"].id,
            work_date=date(2026, 8, 2),  # Sunday of week A
            duration_minutes=60,
            reason="saturday_bonus_hour",
        ),
    )
    db_session.refresh(world["period_a"])
    db_session.refresh(world["period_b"])
    db_session.refresh(world["period_unrelated"])
    assert world["period_a"].calculated_at is None
    assert world["period_b"].calculated_at is not None
    assert world["period_unrelated"].calculated_at is not None

    # Restore calculated_at on A so we can observe the second invalidation clearly
    world["period_a"].calculated_at = datetime(2026, 7, 2, tzinfo=timezone.utc)
    world["period_b"].calculated_at = datetime(2026, 7, 2, tzinfo=timezone.utc)
    db_session.commit()

    patch_extra_hours(
        db_session,
        world["admin"],
        created.id,
        TimesheetExtraHoursPatch(work_date=date(2026, 8, 3)),  # Monday of week B
    )
    db_session.refresh(world["period_a"])
    db_session.refresh(world["period_b"])
    db_session.refresh(world["period_unrelated"])
    assert world["period_a"].calculated_at is None
    assert world["period_b"].calculated_at is None
    assert world["period_unrelated"].calculated_at is not None


def test_same_week_work_date_change_invalidates_once(db_session: Session) -> None:
    week_a = date(2026, 7, 27)
    week_b = date(2026, 8, 3)
    world = _seed(db_session, week_a=week_a, week_b=week_b)
    created = create_extra_hours(
        db_session,
        world["admin"],
        TimesheetExtraHoursCreate(
            company_id=world["company"].id,
            user_id=world["employee"].id,
            work_date=date(2026, 7, 28),
            duration_minutes=30,
            reason="training",
        ),
    )
    world["period_a"].calculated_at = datetime(2026, 7, 2, tzinfo=timezone.utc)
    world["period_b"].calculated_at = datetime(2026, 7, 2, tzinfo=timezone.utc)
    db_session.commit()

    patch_extra_hours(
        db_session,
        world["admin"],
        created.id,
        TimesheetExtraHoursPatch(work_date=date(2026, 7, 31)),  # still week A
    )
    db_session.refresh(world["period_a"])
    db_session.refresh(world["period_b"])
    assert world["period_a"].calculated_at is None
    assert world["period_b"].calculated_at is not None


def test_audit_failure_rolls_back_create_and_stale_marker(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    week_a = date(2026, 7, 27)
    week_b = date(2026, 8, 3)
    world = _seed(db_session, week_a=week_a, week_b=week_b)
    before_calc = world["period_a"].calculated_at
    assert before_calc is not None

    def _boom(*_a, **_k):
        raise RuntimeError("audit failed")

    monkeypatch.setattr(
        "app.modules.timesheet_extra_hours.service.create_internal_audit_event",
        _boom,
    )
    with pytest.raises(RuntimeError, match="audit failed"):
        create_extra_hours(
            db_session,
            world["admin"],
            TimesheetExtraHoursCreate(
                company_id=world["company"].id,
                user_id=world["employee"].id,
                work_date=date(2026, 8, 1),
                duration_minutes=60,
                reason="training",
            ),
        )

    rows = list(db_session.scalars(select(TimesheetExtraHours)).all())
    assert rows == []
    db_session.refresh(world["period_a"])
    assert world["period_a"].calculated_at == before_calc


def test_invalidation_failure_rolls_back_create(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    week_a = date(2026, 7, 27)
    week_b = date(2026, 8, 3)
    world = _seed(db_session, week_a=week_a, week_b=week_b)
    before_calc = world["period_a"].calculated_at

    def _boom(*_a, **_k):
        raise RuntimeError("invalidate failed")

    monkeypatch.setattr(
        "app.modules.timesheet_extra_hours.service.mark_payroll_period_needs_recalculation",
        _boom,
    )
    with pytest.raises(RuntimeError, match="invalidate failed"):
        create_extra_hours(
            db_session,
            world["admin"],
            TimesheetExtraHoursCreate(
                company_id=world["company"].id,
                user_id=world["employee"].id,
                work_date=date(2026, 8, 1),
                duration_minutes=60,
                reason="travel",
            ),
        )
    assert list(db_session.scalars(select(TimesheetExtraHours)).all()) == []
    db_session.refresh(world["period_a"])
    assert world["period_a"].calculated_at == before_calc


def test_delete_failure_during_audit_does_not_soft_delete(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    week_a = date(2026, 7, 27)
    week_b = date(2026, 8, 3)
    world = _seed(db_session, week_a=week_a, week_b=week_b)
    created = create_extra_hours(
        db_session,
        world["admin"],
        TimesheetExtraHoursCreate(
            company_id=world["company"].id,
            user_id=world["employee"].id,
            work_date=date(2026, 8, 1),
            duration_minutes=45,
            reason="other",
        ),
    )
    world["period_a"].calculated_at = datetime(2026, 7, 3, tzinfo=timezone.utc)
    db_session.commit()

    def _boom(*_a, **_k):
        raise RuntimeError("audit failed on delete")

    monkeypatch.setattr(
        "app.modules.timesheet_extra_hours.service.create_internal_audit_event",
        _boom,
    )
    with pytest.raises(RuntimeError, match="audit failed on delete"):
        delete_extra_hours(db_session, world["admin"], created.id)

    row = db_session.get(TimesheetExtraHours, created.id)
    assert row is not None
    assert row.deleted_at is None
    db_session.refresh(world["period_a"])
    assert world["period_a"].calculated_at is not None


def test_flush_failure_rolls_back_create(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    week_a = date(2026, 7, 27)
    week_b = date(2026, 8, 3)
    world = _seed(db_session, week_a=week_a, week_b=week_b)
    before_calc = world["period_a"].calculated_at

    def _boom(*_a, **_k):
        raise RuntimeError("flush failed")

    monkeypatch.setattr("app.modules.timesheet_extra_hours.service.repo.add", _boom)
    with pytest.raises(RuntimeError, match="flush failed"):
        create_extra_hours(
            db_session,
            world["admin"],
            TimesheetExtraHoursCreate(
                company_id=world["company"].id,
                user_id=world["employee"].id,
                work_date=date(2026, 8, 1),
                duration_minutes=60,
                reason="training",
            ),
        )
    assert list(db_session.scalars(select(TimesheetExtraHours)).all()) == []
    db_session.refresh(world["period_a"])
    assert world["period_a"].calculated_at == before_calc


def test_patch_work_date_preserves_row_when_audit_fails(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    week_a = date(2026, 7, 27)
    week_b = date(2026, 8, 3)
    world = _seed(db_session, week_a=week_a, week_b=week_b)
    created = create_extra_hours(
        db_session,
        world["admin"],
        TimesheetExtraHoursCreate(
            company_id=world["company"].id,
            user_id=world["employee"].id,
            work_date=date(2026, 8, 2),
            duration_minutes=60,
            reason="saturday_bonus_hour",
        ),
    )
    world["period_a"].calculated_at = datetime(2026, 7, 2, tzinfo=timezone.utc)
    world["period_b"].calculated_at = datetime(2026, 7, 2, tzinfo=timezone.utc)
    db_session.commit()

    def _boom(*_a, **_k):
        raise RuntimeError("audit failed on patch")

    monkeypatch.setattr(
        "app.modules.timesheet_extra_hours.service.create_internal_audit_event",
        _boom,
    )
    with pytest.raises(RuntimeError, match="audit failed on patch"):
        patch_extra_hours(
            db_session,
            world["admin"],
            created.id,
            TimesheetExtraHoursPatch(work_date=date(2026, 8, 3)),
        )

    row = db_session.get(TimesheetExtraHours, created.id)
    assert row is not None
    assert row.work_date == date(2026, 8, 2)
    db_session.refresh(world["period_a"])
    db_session.refresh(world["period_b"])
    assert world["period_a"].calculated_at is not None
    assert world["period_b"].calculated_at is not None
