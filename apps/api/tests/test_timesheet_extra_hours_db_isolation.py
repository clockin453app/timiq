"""DB-backed payroll isolation and audit transaction tests for Extra hours."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.modules.audit.models import AuditEvent
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company, CompanyTimePolicy
from app.modules.locations.models import Location
from app.modules.payroll.models import PayrollItem, PayrollPeriod
from app.modules.payroll.service import get_payroll_report
from app.modules.time_clock.models import TimeShift
from app.modules.timesheet_extra_hours.models import TimesheetExtraHours
from app.modules.timesheet_extra_hours.schemas import TimesheetExtraHoursCreate, TimesheetExtraHoursPatch
from app.modules.timesheet_extra_hours.service import (
    create_extra_hours,
    delete_extra_hours,
    patch_extra_hours,
)

# Import model registry so create_all sees dependent tables.
from app.db import models as _models  # noqa: F401

LOCAL_ADMIN_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
DB_NAME = "timiq_extra_hours_it"


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
    reason="Local Postgres required for Extra hours DB integration tests",
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


def _seed_payroll_world(session: Session) -> dict:
    company = Company(id=uuid.uuid4(), name=f"EH Co {uuid.uuid4().hex[:8]}", is_active=True)
    admin = User(
        id=uuid.uuid4(),
        email=f"admin-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        system_role=SystemRole.ADMIN,
        company_id=None,
        is_active=True,
    )
    # company admin must belong to company
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
        rounding_increment_minutes=30,
        rounding_mode="nearest",
        break_deduction_minutes=30,
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
    week_start = date(2026, 7, 27)
    clock_in = datetime(2026, 7, 28, 8, 0, tzinfo=timezone.utc)
    clock_out = datetime(2026, 7, 28, 16, 0, tzinfo=timezone.utc)
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
        worked_seconds=8 * 3600,
        break_seconds=0,
    )
    period = PayrollPeriod(
        id=uuid.uuid4(),
        company_id=company.id,
        week_start=week_start,
        timezone_name="Europe/London",
        calculated_at=datetime(2026, 7, 29, 10, 0, tzinfo=timezone.utc),
        calculated_by_user_id=admin.id,
    )
    item = PayrollItem(
        id=uuid.uuid4(),
        period_id=period.id,
        user_id=employee.id,
        company_id=company.id,
        regular_seconds=8 * 3600,
        overtime_seconds=0,
        rounded_total_seconds=8 * 3600,
        hourly_rate_snapshot=Decimal("12.5000"),
        tax_rate_snapshot=Decimal("20.0000"),
        overtime_multiplier_snapshot=Decimal("1.5000"),
        gross_amount=Decimal("100.0000"),
        tax_amount=Decimal("20.0000"),
        net_amount=Decimal("80.0000"),
        other_deductions_amount=Decimal("0.0000"),
        payment_mode="net_payment",
        payment_mode_source="profile",
        policy_snapshot={},
        status="pending",
        rate_missing=False,
    )
    session.add(company)
    session.flush()
    session.add_all([admin, employee, policy, location])
    session.flush()
    session.add_all([shift, period])
    session.flush()
    session.add(item)
    session.commit()
    return {
        "company": company,
        "admin": admin,
        "employee": employee,
        "location": location,
        "shift": shift,
        "period": period,
        "item": item,
        "week_start": week_start,
    }


def _capture_authoritative_state(session: Session, *, company_id: uuid.UUID, week_start: date, actor: User) -> dict:
    session.expire_all()
    report = get_payroll_report(
        session,
        actor,
        company_id=company_id,
        week_start=week_start,
        auto_recalculate_if_safe=False,
    )
    shifts = list(
        session.scalars(
            select(TimeShift).where(
                TimeShift.company_id == company_id,
                TimeShift.status == "completed",
            )
        ).all()
    )
    items = list(
        session.scalars(select(PayrollItem).where(PayrollItem.company_id == company_id)).all()
    )
    period = session.scalars(
        select(PayrollPeriod).where(
            PayrollPeriod.company_id == company_id,
            PayrollPeriod.week_start == week_start,
        )
    ).first()
    return {
        "total_rounded_seconds": report.period.total_rounded_seconds,
        "total_regular_seconds": report.period.total_regular_seconds,
        "total_overtime_seconds": report.period.total_overtime_seconds,
        "total_gross": str(report.period.total_gross) if report.period.total_gross is not None else None,
        "total_tax": str(report.period.total_tax) if report.period.total_tax is not None else None,
        "total_net": str(report.period.total_net) if report.period.total_net is not None else None,
        "total_other_deductions": str(report.period.total_other_deductions),
        "pending_count": report.period.pending_count,
        "approved_count": report.period.approved_count,
        "paid_count": report.period.paid_count,
        "payroll_needs_recalculation": report.alerts.payroll_needs_recalculation,
        "payroll_period_not_calculated": report.alerts.payroll_period_not_calculated,
        "period_calculated_at": period.calculated_at.isoformat() if period and period.calculated_at else None,
        "item_rows": sorted(
            [
                (
                    str(i.id),
                    i.status,
                    i.rounded_total_seconds,
                    str(i.gross_amount),
                    str(i.tax_amount),
                    str(i.net_amount),
                    str(i.other_deductions_amount),
                )
                for i in items
            ]
        ),
        "shift_rows": sorted(
            [
                (
                    str(s.id),
                    s.status,
                    s.worked_seconds,
                    s.break_seconds,
                    s.clock_in_at.isoformat(),
                    s.clock_out_at.isoformat() if s.clock_out_at else None,
                )
                for s in shifts
            ]
        ),
        "clocked_seconds": sum(int(s.worked_seconds or 0) for s in shifts),
    }


def test_extra_hours_create_marks_stale_without_mutating_shift_or_item_money(db_session: Session) -> None:
    world = _seed_payroll_world(db_session)
    before = _capture_authoritative_state(
        db_session,
        company_id=world["company"].id,
        week_start=world["week_start"],
        actor=world["admin"],
    )
    assert before["total_rounded_seconds"] == 8 * 3600
    assert before["clocked_seconds"] == 8 * 3600
    assert before["period_calculated_at"] is not None

    created = create_extra_hours(
        db_session,
        world["admin"],
        TimesheetExtraHoursCreate(
            company_id=world["company"].id,
            user_id=world["employee"].id,
            work_date=date(2026, 8, 1),
            duration_minutes=60,
            reason="saturday_bonus_hour",
        ),
    )
    assert created.affects_payroll is True
    after_create = _capture_authoritative_state(
        db_session,
        company_id=world["company"].id,
        week_start=world["week_start"],
        actor=world["admin"],
    )
    assert after_create["shift_rows"] == before["shift_rows"]
    assert after_create["clocked_seconds"] == before["clocked_seconds"]
    assert after_create["item_rows"] == before["item_rows"]
    assert after_create["period_calculated_at"] is None
    assert after_create["payroll_needs_recalculation"] is True

    patch_extra_hours(
        db_session,
        world["admin"],
        created.id,
        TimesheetExtraHoursPatch(duration_minutes=90),
    )
    after_update = _capture_authoritative_state(
        db_session,
        company_id=world["company"].id,
        week_start=world["week_start"],
        actor=world["admin"],
    )
    assert after_update["shift_rows"] == before["shift_rows"]
    assert after_update["item_rows"] == before["item_rows"]
    assert after_update["period_calculated_at"] is None

    delete_extra_hours(db_session, world["admin"], created.id)
    after_delete = _capture_authoritative_state(
        db_session,
        company_id=world["company"].id,
        week_start=world["week_start"],
        actor=world["admin"],
    )
    assert after_delete["shift_rows"] == before["shift_rows"]
    assert after_delete["item_rows"] == before["item_rows"]

    # Soft-deleted entry excluded from normal lists / still present with deleted_at
    row = db_session.get(TimesheetExtraHours, created.id)
    assert row is not None
    assert row.deleted_at is not None


def test_audit_failure_rolls_back_create_update_and_delete(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    world = _seed_payroll_world(db_session)

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
                duration_minutes=45,
                reason="training",
            ),
        )
    assert db_session.scalars(select(TimesheetExtraHours)).all() == []
    assert db_session.scalars(select(AuditEvent)).all() == []

    # Restore real audit, create a committed row, then fail update/delete audits.
    from app.modules.audit.service import create_internal_audit_event as real_audit

    monkeypatch.setattr(
        "app.modules.timesheet_extra_hours.service.create_internal_audit_event",
        real_audit,
    )
    created = create_extra_hours(
        db_session,
        world["admin"],
        TimesheetExtraHoursCreate(
            company_id=world["company"].id,
            user_id=world["employee"].id,
            work_date=date(2026, 8, 1),
            duration_minutes=30,
            reason="travel",
        ),
    )
    entry_id = created.id
    original_minutes = created.duration_minutes

    monkeypatch.setattr(
        "app.modules.timesheet_extra_hours.service.create_internal_audit_event",
        _boom,
    )
    with pytest.raises(RuntimeError, match="audit failed"):
        patch_extra_hours(
            db_session,
            world["admin"],
            entry_id,
            TimesheetExtraHoursPatch(duration_minutes=120),
        )
    db_session.expire_all()
    row = db_session.get(TimesheetExtraHours, entry_id)
    assert row is not None
    assert row.duration_minutes == original_minutes
    assert row.deleted_at is None

    with pytest.raises(RuntimeError, match="audit failed"):
        delete_extra_hours(db_session, world["admin"], entry_id)
    db_session.expire_all()
    row = db_session.get(TimesheetExtraHours, entry_id)
    assert row is not None
    assert row.deleted_at is None
