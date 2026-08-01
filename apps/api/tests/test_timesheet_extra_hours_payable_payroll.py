"""DB-backed payable Extra hours + payroll calculation integration tests."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company, CompanyTimePolicy
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.payroll.calculation import (
    clocked_rounded_seconds_by_work_date_payroll_week,
    compute_money_bundle,
    regular_overtime_seconds_payroll_week,
    sum_clocked_rounded_seconds_payroll_week,
    sum_rounded_seconds_payroll_week,
)
from app.modules.payroll.models import PayrollItem, PayrollPeriod
from app.modules.payroll.service import get_payroll_report, recalculate_payroll
from app.modules.time_clock.models import TimeShift
from app.modules.timesheet_extra_hours.models import TimesheetExtraHours
from app.modules.timesheet_extra_hours.schemas import TimesheetExtraHoursCreate, TimesheetExtraHoursPatch
from app.modules.timesheet_extra_hours.service import (
    ExtraHoursError,
    create_extra_hours,
    delete_extra_hours,
    list_extra_hours_for_me,
    patch_extra_hours,
)

from app.db import models as _models  # noqa: F401

LOCAL_ADMIN_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
DB_NAME = "timiq_extra_hours_payable_it"


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
    reason="Local Postgres required for Extra hours payable payroll integration tests",
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


def _seed_world(session: Session, *, hourly: str = "10.0000") -> dict:
    company = Company(id=uuid.uuid4(), name=f"Pay EH {uuid.uuid4().hex[:8]}", is_active=True)
    admin = User(
        id=uuid.uuid4(),
        email=f"admin-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        system_role=SystemRole.ADMIN,
        company_id=None,
        is_active=True,
    )
    admin.company_id = company.id
    employee = User(
        id=uuid.uuid4(),
        email=f"emp-{uuid.uuid4().hex[:8]}@example.com",
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
        break_deduction_after_minutes=0,
    )
    location = Location(
        id=uuid.uuid4(),
        company_id=company.id,
        name="Site A",
        address="1 Test St",
        latitude=51.5,
        longitude=-0.1,
        geofence_radius_meters=100,
        is_active=True,
    )
    profile = EmployeeProfile(
        user_id=employee.id,
        company_id=company.id,
        first_name="Pay",
        last_name="Worker",
        hourly_rate=Decimal(hourly),
        payment_mode="net_payment",
        payroll_type="cis_subcontractor",
    )
    week_start = date(2026, 7, 27)
    # 1 hour completed shift in London policy day
    clock_in = datetime(2026, 7, 28, 7, 0, tzinfo=timezone.utc)  # 08:00 London BST
    clock_out = datetime(2026, 7, 28, 8, 0, tzinfo=timezone.utc)  # 09:00 London BST
    shift = TimeShift(
        id=uuid.uuid4(),
        user_id=employee.id,
        company_id=company.id,
        location_id=location.id,
        status="completed",
        clock_source="employee",
        clock_in_at=clock_in,
        clock_in_latitude=51.5,
        clock_in_longitude=-0.1,
        clock_in_accuracy_meters=5.0,
        clock_in_distance_to_site_meters=1.0,
        clock_out_at=clock_out,
        clock_out_latitude=51.5,
        clock_out_longitude=-0.1,
        clock_out_accuracy_meters=5.0,
        clock_out_distance_to_site_meters=1.0,
        worked_seconds=3600,
        break_seconds=0,
    )
    session.add(company)
    session.flush()
    session.add_all([admin, employee, policy, location, profile])
    session.flush()
    session.add(shift)
    session.commit()
    return {
        "company": company,
        "admin": admin,
        "employee": employee,
        "location": location,
        "policy": policy,
        "profile": profile,
        "shift": shift,
        "week_start": week_start,
    }


def test_payable_extra_hours_recalc_updates_hours_and_money(db_session: Session) -> None:
    world = _seed_world(db_session)
    company_id = world["company"].id
    week_start = world["week_start"]
    admin = world["admin"]
    employee = world["employee"]
    policy = world["policy"]
    shift = world["shift"]

    # Baseline recalculation (shift only)
    report0 = recalculate_payroll(db_session, admin, company_id=company_id, week_start=week_start)
    clocked = sum_clocked_rounded_seconds_payroll_week(
        db_session, company_id=company_id, user_id=employee.id, week_start=week_start, policy=policy
    )
    assert clocked == 3600
    assert report0.period.total_rounded_seconds == 3600
    item0 = next(i for i in report0.items if i.user_id == employee.id)
    assert item0.rounded_total_seconds == 3600
    expected0 = compute_money_bundle(
        regular_seconds=item0.regular_seconds,
        overtime_seconds=item0.overtime_seconds,
        hourly_rate=Decimal("10.0000"),
        overtime_multiplier=Decimal("1.5"),
        tax_rate_percent=Decimal("0"),
        other_deductions=Decimal("0"),
        payment_mode="net_payment",
    )
    assert str(item0.gross_amount) == str(expected0["gross_amount"])

    shift_before = (
        int(shift.worked_seconds or 0),
        int(shift.break_seconds or 0),
        shift.clock_in_at.astimezone(timezone.utc),
        shift.clock_out_at.astimezone(timezone.utc) if shift.clock_out_at else None,
    )

    created = create_extra_hours(
        db_session,
        admin,
        TimesheetExtraHoursCreate(
            company_id=company_id,
            user_id=employee.id,
            work_date=date(2026, 8, 1),  # Saturday in week
            duration_minutes=60,
            reason="saturday_bonus_hour",
        ),
    )
    assert created.affects_payroll is True

    period = db_session.scalars(
        select(PayrollPeriod).where(
            PayrollPeriod.company_id == company_id,
            PayrollPeriod.week_start == week_start,
        )
    ).one()
    assert period.calculated_at is None

    report_stale = get_payroll_report(
        db_session,
        admin,
        company_id=company_id,
        week_start=week_start,
        auto_recalculate_if_safe=False,
    )
    assert report_stale.alerts.payroll_needs_recalculation is True
    # Item money unchanged until Recalculate
    stale_item = db_session.get(PayrollItem, item0.id)
    assert stale_item is not None
    assert stale_item.rounded_total_seconds == 3600
    assert str(stale_item.gross_amount) == str(item0.gross_amount)

    db_session.refresh(shift)
    assert (
        int(shift.worked_seconds or 0),
        int(shift.break_seconds or 0),
        shift.clock_in_at.astimezone(timezone.utc),
        shift.clock_out_at.astimezone(timezone.utc) if shift.clock_out_at else None,
    ) == shift_before

    report1 = recalculate_payroll(db_session, admin, company_id=company_id, week_start=week_start)
    assert sum_clocked_rounded_seconds_payroll_week(
        db_session, company_id=company_id, user_id=employee.id, week_start=week_start, policy=policy
    ) == 3600
    total_live = sum_rounded_seconds_payroll_week(
        db_session, company_id=company_id, user_id=employee.id, week_start=week_start, policy=policy
    )
    assert total_live == 7200
    assert report1.period.total_rounded_seconds == 7200
    item1 = next(i for i in report1.items if i.user_id == employee.id)
    assert item1.rounded_total_seconds == 7200
    expected1 = compute_money_bundle(
        regular_seconds=item1.regular_seconds,
        overtime_seconds=item1.overtime_seconds,
        hourly_rate=Decimal("10.0000"),
        overtime_multiplier=Decimal("1.5"),
        tax_rate_percent=Decimal("0"),
        other_deductions=Decimal("0"),
        payment_mode="net_payment",
    )
    assert str(item1.gross_amount) == str(expected1["gross_amount"])
    assert Decimal(str(item1.gross_amount)) == Decimal("20.0000")

    # Repeated recalculation must not double-count
    report1b = recalculate_payroll(db_session, admin, company_id=company_id, week_start=week_start)
    item1b = next(i for i in report1b.items if i.user_id == employee.id)
    assert item1b.rounded_total_seconds == item1.rounded_total_seconds == 7200
    assert str(item1b.gross_amount) == str(item1.gross_amount)

    # Update to 2h
    patch_extra_hours(
        db_session,
        admin,
        created.id,
        TimesheetExtraHoursPatch(duration_minutes=120),
    )
    period = db_session.scalars(
        select(PayrollPeriod).where(
            PayrollPeriod.company_id == company_id,
            PayrollPeriod.week_start == week_start,
        )
    ).one()
    assert period.calculated_at is None
    report2 = recalculate_payroll(db_session, admin, company_id=company_id, week_start=week_start)
    item2 = next(i for i in report2.items if i.user_id == employee.id)
    assert item2.rounded_total_seconds == 3600 + 7200
    assert Decimal(str(item2.gross_amount)) == Decimal("30.0000")

    # Delete — return to shift-only
    delete_extra_hours(db_session, admin, created.id)
    report3 = recalculate_payroll(db_session, admin, company_id=company_id, week_start=week_start)
    item3 = next(i for i in report3.items if i.user_id == employee.id)
    assert item3.rounded_total_seconds == 3600
    assert Decimal(str(item3.gross_amount)) == Decimal("10.0000")

    db_session.refresh(shift)
    assert (
        int(shift.worked_seconds or 0),
        int(shift.break_seconds or 0),
        shift.clock_in_at.astimezone(timezone.utc),
        shift.clock_out_at.astimezone(timezone.utc) if shift.clock_out_at else None,
    ) == shift_before

    # Non-payroll historical row does not affect payroll
    legacy = TimesheetExtraHours(
        company_id=company_id,
        user_id=employee.id,
        work_date=date(2026, 7, 29),
        duration_minutes=180,
        reason="other",
        affects_payroll=False,
        created_by_user_id=admin.id,
    )
    db_session.add(legacy)
    db_session.commit()
    report4 = recalculate_payroll(db_session, admin, company_id=company_id, week_start=week_start)
    item4 = next(i for i in report4.items if i.user_id == employee.id)
    assert item4.rounded_total_seconds == 3600

    # Employee can read own adjustments
    mine = list_extra_hours_for_me(
        db_session,
        employee,
        start_date=week_start,
        end_date=date(2026, 8, 3),
    )
    assert any(r.id == legacy.id for r in mine)


def test_payable_blocked_when_period_approved(db_session: Session) -> None:
    world = _seed_world(db_session)
    company_id = world["company"].id
    week_start = world["week_start"]
    admin = world["admin"]
    report = recalculate_payroll(db_session, admin, company_id=company_id, week_start=week_start)
    item = next(i for i in report.items if i.user_id == world["employee"].id)
    row = db_session.get(PayrollItem, item.id)
    assert row is not None
    row.status = "approved"
    db_session.commit()

    with pytest.raises(ExtraHoursError, match="approved"):
        create_extra_hours(
            db_session,
            admin,
            TimesheetExtraHoursCreate(
                company_id=company_id,
                user_id=world["employee"].id,
                work_date=date(2026, 8, 1),
                duration_minutes=60,
                reason="training",
            ),
        )


def test_multiple_payable_adjustments_sum(db_session: Session) -> None:
    world = _seed_world(db_session)
    company_id = world["company"].id
    week_start = world["week_start"]
    admin = world["admin"]
    employee = world["employee"]
    policy = world["policy"]
    recalculate_payroll(db_session, admin, company_id=company_id, week_start=week_start)
    create_extra_hours(
        db_session,
        admin,
        TimesheetExtraHoursCreate(
            company_id=company_id,
            user_id=employee.id,
            work_date=date(2026, 7, 30),
            duration_minutes=30,
            reason="training",
        ),
    )
    create_extra_hours(
        db_session,
        admin,
        TimesheetExtraHoursCreate(
            company_id=company_id,
            user_id=employee.id,
            work_date=date(2026, 7, 31),
            duration_minutes=30,
            reason="travel",
        ),
    )
    report = recalculate_payroll(db_session, admin, company_id=company_id, week_start=week_start)
    item = next(i for i in report.items if i.user_id == employee.id)
    assert item.rounded_total_seconds == 3600 + 3600
    clocked_map = clocked_rounded_seconds_by_work_date_payroll_week(
        db_session, company_id=company_id, user_id=employee.id, week_start=week_start, policy=policy
    )
    assert sum(clocked_map.values()) == 3600
    reg, ot, total = regular_overtime_seconds_payroll_week(
        db_session, company_id=company_id, user_id=employee.id, week_start=week_start, policy=policy
    )
    assert total == reg + ot == 7200
