"""Shift integrity: false-failure fix, duplicates, idempotency, transactions."""

from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session, sessionmaker
from unittest.mock import MagicMock, patch

from app.db.base import Base
from app.db import models as _models  # noqa: F401
from app.modules.audit.models import AuditEvent
from app.modules.auth.models import SystemRole, User
from app.modules.auth.security import hash_password
from app.modules.companies.models import Company, CompanyTimePolicy
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.payroll.models import PayrollItem, PayrollPeriod
from app.modules.payroll.service import mark_payroll_period_needs_recalculation
from app.modules.site_access.models import EmployeeLocationAccess
from app.modules.time_clock.models import TimeShift
from app.modules.time_clock.repository import local_work_date_for_instant
from app.modules.time_records.admin_manual_service import (
    AdminTimeAdjustmentError,
    admin_create_completed_shift,
    admin_patch_completed_shift,
)
from app.modules.timesheet_extra_hours.models import TimesheetExtraHours
from app.modules.timesheet_extra_hours.schemas import TimesheetExtraHoursCreate
from app.modules.timesheet_extra_hours.service import create_extra_hours

LOCAL_ADMIN_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
DB_NAME = "timiq_disposable_shift_integrity_it"


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
    reason="Local Postgres required for shift-integrity tests",
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


def _seed(session: Session) -> dict:
    company = Company(id=uuid.uuid4(), name=f"Shift Co {uuid.uuid4().hex[:6]}", is_active=True)
    session.add(company)
    session.flush()
    policy = CompanyTimePolicy(
        company_id=company.id,
        timezone_name="Europe/London",
        standard_start_time="08:00",
        overtime_after_hours=8.5,
        overtime_multiplier=1.5,
        rounding_increment_minutes=15,
        rounding_mode="nearest",
        break_deduction_minutes=0,
        break_deduction_after_minutes=360,
    )
    admin = User(
        id=uuid.uuid4(),
        email=f"admin-{uuid.uuid4().hex[:6]}@ex.com",
        password_hash=hash_password("Password123!"),
        system_role=SystemRole.ADMINISTRATOR,
        company_id=None,
        is_active=True,
    )
    employee = User(
        id=uuid.uuid4(),
        email=f"emp-{uuid.uuid4().hex[:6]}@ex.com",
        password_hash=hash_password("Password123!"),
        system_role=SystemRole.EMPLOYEE,
        company_id=company.id,
        is_active=True,
    )
    location = Location(
        id=uuid.uuid4(),
        company_id=company.id,
        name="Site A",
        address="1 Test Street",
        latitude=51.5,
        longitude=-0.12,
        geofence_radius_meters=100,
        is_active=True,
    )
    session.add_all([policy, admin, employee, location])
    session.flush()
    session.add(
        EmployeeProfile(
            user_id=employee.id,
            company_id=company.id,
            first_name="Test",
            last_name="Employee",
            job_title="Operative",
            hourly_rate=Decimal("12.0000"),
            payment_mode="net_payment",
            payroll_type="cis_subcontractor",
        )
    )
    session.add(
        EmployeeLocationAccess(
            user_id=employee.id,
            location_id=location.id,
        )
    )
    session.commit()
    return {
        "company": company,
        "admin": admin,
        "employee": employee,
        "location": location,
        "engine": session.get_bind(),
    }


def _count_shifts(session: Session, user_id: uuid.UUID) -> int:
    return int(
        session.scalar(select(func.count()).select_from(TimeShift).where(TimeShift.user_id == user_id)) or 0
    )


def _count_audit(session: Session, action: str) -> int:
    return int(
        session.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == action)) or 0
    )


def _create_kwargs(seed: dict, *, day: date | None = None, client_action_id: uuid.UUID | None = None) -> dict:
    work = day or date(2026, 8, 5)
    tz = ZoneInfo("Europe/London")
    clock_in = datetime(work.year, work.month, work.day, 8, 0, tzinfo=tz).astimezone(timezone.utc)
    clock_out = datetime(work.year, work.month, work.day, 16, 0, tzinfo=tz).astimezone(timezone.utc)
    body = {
        "user_id": seed["employee"].id,
        "location_id": seed["location"].id,
        "clock_in_at": clock_in,
        "clock_out_at": clock_out,
        "break_seconds": None,
        "break_minutes": 30,
        "reason": "Admin entered full shift",
        "client_action_id": client_action_id,
    }
    return body


def test_mark_payroll_forwards_commit_kwarg() -> None:
    mock_invalidate = MagicMock(return_value=True)
    with patch(
        "app.modules.payroll.service.invalidate_period_calculation_for_company_week",
        mock_invalidate,
    ):
        mark_payroll_period_needs_recalculation(
            MagicMock(),
            company_id=uuid.uuid4(),
            week_start=date(2026, 8, 3),
            commit=False,
        )
    mock_invalidate.assert_called_once()
    assert mock_invalidate.call_args.kwargs["commit"] is False


def test_one_create_inserts_one_shift_and_returns_success(db_session: Session) -> None:
    seed = _seed(db_session)
    row, recalc, week_start, company_id, replay = admin_create_completed_shift(
        db_session, seed["admin"], **_create_kwargs(seed)
    )
    assert replay is False
    assert recalc is True
    assert company_id == seed["company"].id
    assert week_start == date(2026, 8, 3)
    assert _count_shifts(db_session, seed["employee"].id) == 1
    assert row.shift_id  # type: ignore[attr-defined]
    assert _count_audit(db_session, "time_record.shift_created_by_admin") == 1


def test_required_post_write_failure_rolls_back_shift(db_session: Session) -> None:
    seed = _seed(db_session)
    with patch(
        "app.modules.time_records.admin_manual_service._mark_payroll_weeks_needing_recalculation",
        side_effect=RuntimeError("payroll boom"),
    ):
        with pytest.raises(RuntimeError, match="payroll boom"):
            admin_create_completed_shift(db_session, seed["admin"], **_create_kwargs(seed))
    db_session.rollback()
    assert _count_shifts(db_session, seed["employee"].id) == 0
    assert _count_audit(db_session, "time_record.shift_created_by_admin") == 0


def test_non_core_post_commit_style_still_saved_when_response_build_succeeds(db_session: Session) -> None:
    """Core path commits shift+payroll+audit atomically; response uses committed row."""
    seed = _seed(db_session)
    row, _, _, _, replay = admin_create_completed_shift(db_session, seed["admin"], **_create_kwargs(seed))
    assert replay is False
    assert _count_shifts(db_session, seed["employee"].id) == 1
    assert row.rounded_seconds is not None  # type: ignore[attr-defined]


def test_lost_response_retry_same_client_action_id_leaves_one_row(db_session: Session) -> None:
    seed = _seed(db_session)
    action_id = uuid.uuid4()
    first, _, _, _, replay1 = admin_create_completed_shift(
        db_session, seed["admin"], **_create_kwargs(seed, client_action_id=action_id)
    )
    second, _, _, _, replay2 = admin_create_completed_shift(
        db_session, seed["admin"], **_create_kwargs(seed, client_action_id=action_id)
    )
    assert replay1 is False
    assert replay2 is True
    assert first.shift_id == second.shift_id  # type: ignore[attr-defined]
    assert _count_shifts(db_session, seed["employee"].id) == 1
    assert _count_audit(db_session, "time_record.shift_created_by_admin") == 1


def test_double_create_without_idempotency_rejected_same_day(db_session: Session) -> None:
    seed = _seed(db_session)
    admin_create_completed_shift(db_session, seed["admin"], **_create_kwargs(seed))
    with pytest.raises(AdminTimeAdjustmentError) as exc:
        admin_create_completed_shift(db_session, seed["admin"], **_create_kwargs(seed))
    assert exc.value.http_status == 409
    assert exc.value.code == "shift_already_exists"
    assert _count_shifts(db_session, seed["employee"].id) == 1


def test_concurrent_creates_leave_one_row(db_session: Session) -> None:
    seed = _seed(db_session)
    engine = seed["engine"]
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    results: list[str] = []
    barrier = threading.Barrier(2)

    def worker(action_suffix: str) -> None:
        session = factory()
        try:
            barrier.wait(timeout=10)
            try:
                admin_create_completed_shift(
                    session,
                    seed["admin"],
                    **_create_kwargs(seed, client_action_id=uuid.uuid4()),
                )
                results.append(f"ok-{action_suffix}")
            except AdminTimeAdjustmentError as exc:
                results.append(f"dup-{exc.code}")
            except Exception as exc:  # noqa: BLE001
                results.append(f"err-{type(exc).__name__}")
        finally:
            session.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(worker, ["a", "b"]))

    assert _count_shifts(db_session, seed["employee"].id) == 1
    assert any(r.startswith("ok-") for r in results)
    assert any(r.startswith("dup-") for r in results) or results.count("ok-a") + results.count("ok-b") == 1


def test_different_date_allowed(db_session: Session) -> None:
    seed = _seed(db_session)
    admin_create_completed_shift(db_session, seed["admin"], **_create_kwargs(seed, day=date(2026, 8, 5)))
    admin_create_completed_shift(db_session, seed["admin"], **_create_kwargs(seed, day=date(2026, 8, 6)))
    assert _count_shifts(db_session, seed["employee"].id) == 2


def test_payable_hours_adjustment_still_allowed(db_session: Session) -> None:
    seed = _seed(db_session)
    admin_create_completed_shift(db_session, seed["admin"], **_create_kwargs(seed))
    create_extra_hours(
        db_session,
        seed["admin"],
        TimesheetExtraHoursCreate(
            user_id=seed["employee"].id,
            company_id=seed["company"].id,
            work_date=date(2026, 8, 5),
            duration_minutes=30,
            reason="other",
            note="Top-up",
            location_id=seed["location"].id,
        ),
    )
    extras = db_session.scalars(select(TimesheetExtraHours)).all()
    assert len(extras) == 1
    assert _count_shifts(db_session, seed["employee"].id) == 1


def test_update_modifies_one_row_and_never_creates(db_session: Session) -> None:
    seed = _seed(db_session)
    row, _, _, _, _ = admin_create_completed_shift(db_session, seed["admin"], **_create_kwargs(seed))
    shift_id = uuid.UUID(str(row.shift_id))  # type: ignore[attr-defined]
    tz = ZoneInfo("Europe/London")
    new_out = datetime(2026, 8, 5, 17, 0, tzinfo=tz).astimezone(timezone.utc)
    for _ in range(3):
        admin_patch_completed_shift(
            db_session,
            seed["admin"],
            shift_id=shift_id,
            clock_in_at=None,
            clock_out_at=new_out,
            location_id=None,
            break_seconds=None,
            break_minutes=30,
            reason="Corrected clock out",
        )
    assert _count_shifts(db_session, seed["employee"].id) == 1
    shift = db_session.get(TimeShift, shift_id)
    assert shift is not None
    assert shift.clock_out_at == new_out


def test_update_missing_and_stale_shift_id_fail_clearly(db_session: Session) -> None:
    seed = _seed(db_session)
    missing = uuid.uuid4()
    with pytest.raises(AdminTimeAdjustmentError, match="Shift not found") as exc:
        admin_patch_completed_shift(
            db_session,
            seed["admin"],
            shift_id=missing,
            clock_in_at=None,
            clock_out_at=datetime(2026, 8, 5, 16, 0, tzinfo=timezone.utc),
            location_id=None,
            break_seconds=None,
            break_minutes=0,
            reason="Nope",
        )
    assert exc.value.http_status == 404


def test_update_rejects_move_onto_occupied_date(db_session: Session) -> None:
    seed = _seed(db_session)
    first, _, _, _, _ = admin_create_completed_shift(
        db_session, seed["admin"], **_create_kwargs(seed, day=date(2026, 8, 5))
    )
    second, _, _, _, _ = admin_create_completed_shift(
        db_session, seed["admin"], **_create_kwargs(seed, day=date(2026, 8, 6))
    )
    tz = ZoneInfo("Europe/London")
    with pytest.raises(AdminTimeAdjustmentError) as exc:
        admin_patch_completed_shift(
            db_session,
            seed["admin"],
            shift_id=uuid.UUID(str(second.shift_id)),  # type: ignore[attr-defined]
            clock_in_at=datetime(2026, 8, 5, 9, 0, tzinfo=tz).astimezone(timezone.utc),
            clock_out_at=datetime(2026, 8, 5, 17, 0, tzinfo=tz).astimezone(timezone.utc),
            location_id=None,
            break_seconds=None,
            break_minutes=0,
            reason="Move onto occupied day",
        )
    assert exc.value.code == "shift_already_exists"
    assert exc.value.existing_shift_id == uuid.UUID(str(first.shift_id))  # type: ignore[attr-defined]
    assert _count_shifts(db_session, seed["employee"].id) == 2


def test_europe_london_overnight_belongs_to_clock_in_date(db_session: Session) -> None:
    seed = _seed(db_session)
    tz = ZoneInfo("Europe/London")
    clock_in = datetime(2026, 8, 5, 22, 0, tzinfo=tz).astimezone(timezone.utc)
    clock_out = datetime(2026, 8, 6, 6, 0, tzinfo=tz).astimezone(timezone.utc)
    assert local_work_date_for_instant("Europe/London", clock_in) == date(2026, 8, 5)
    admin_create_completed_shift(
        db_session,
        seed["admin"],
        user_id=seed["employee"].id,
        location_id=seed["location"].id,
        clock_in_at=clock_in,
        clock_out_at=clock_out,
        break_seconds=0,
        break_minutes=None,
        reason="Night shift",
        client_action_id=None,
    )
    # Same clock-in local date must be rejected even if mostly next calendar day.
    with pytest.raises(AdminTimeAdjustmentError) as exc:
        admin_create_completed_shift(
            db_session,
            seed["admin"],
            user_id=seed["employee"].id,
            location_id=seed["location"].id,
            clock_in_at=datetime(2026, 8, 5, 23, 0, tzinfo=tz).astimezone(timezone.utc),
            clock_out_at=datetime(2026, 8, 6, 7, 0, tzinfo=tz).astimezone(timezone.utc),
            break_seconds=0,
            break_minutes=None,
            reason="Duplicate night",
            client_action_id=None,
        )
    assert exc.value.code == "shift_already_exists"
    assert _count_shifts(db_session, seed["employee"].id) == 1


def test_rejected_duplicate_changes_no_payroll_data(db_session: Session) -> None:
    seed = _seed(db_session)
    company_id = seed["company"].id
    week_start = date(2026, 8, 3)
    period = PayrollPeriod(
        id=uuid.uuid4(),
        company_id=company_id,
        week_start=week_start,
        timezone_name="Europe/London",
        calculated_at=datetime.now(timezone.utc),
        calculated_by_user_id=seed["admin"].id,
    )
    db_session.add(period)
    db_session.flush()
    item = PayrollItem(
        id=uuid.uuid4(),
        period_id=period.id,
        company_id=company_id,
        user_id=seed["employee"].id,
        status="pending",
        regular_seconds=0,
        overtime_seconds=0,
        rounded_total_seconds=0,
        gross_amount=Decimal("0"),
        tax_amount=Decimal("0"),
        net_amount=Decimal("0"),
        policy_snapshot={},
    )
    db_session.add(item)
    db_session.commit()

    admin_create_completed_shift(db_session, seed["admin"], **_create_kwargs(seed))
    db_session.refresh(period)
    assert period.calculated_at is None

    period.calculated_at = datetime.now(timezone.utc)
    db_session.commit()
    calculated_before = period.calculated_at

    with pytest.raises(AdminTimeAdjustmentError):
        admin_create_completed_shift(db_session, seed["admin"], **_create_kwargs(seed))

    db_session.refresh(period)
    assert period.calculated_at == calculated_before
    assert _count_shifts(db_session, seed["employee"].id) == 1
