from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.companies.models import CompanyTimePolicy
from app.modules.companies.repository import get_company_by_id
from app.modules.companies.service import ensure_company_time_policy
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.time_clock.models import TimeShift
from app.modules.time_records.calculation import compute_shift_metrics
from app.modules.time_records.permissions import can_view_time_record_shift_owner
from app.modules.workplaces.repository import get_workplace_by_id

from app.modules.budgets.repository import list_company_shifts_clock_in_window
from app.modules.budgets.schemas import (
    LabourCostEmployeeBreakdown,
    LabourCostLocationBreakdown,
    LabourCostResponse,
)

MAX_SHIFTS_SCAN = 8000
MAX_DATE_RANGE_DAYS = 370
MONEY_QUANT = Decimal("0.01")


def _fallback_policy() -> CompanyTimePolicy:
    now = datetime.now(timezone.utc)
    return CompanyTimePolicy(
        company_id=uuid.UUID(int=0),
        standard_start_time="08:00",
        overtime_after_hours=8.5,
        overtime_multiplier=1.5,
        rounding_increment_minutes=30,
        rounding_mode="nearest",
        break_deduction_minutes=30,
        break_deduction_after_minutes=360,
        rule_effective_from=now,
        rule_note="",
        timezone_name="Europe/London",
        created_at=now,
        updated_at=now,
    )


def _policy_company_id(shift: TimeShift, location: Location) -> uuid.UUID | None:
    return shift.company_id or location.company_id


def _load_policy(db_session: Session, shift: TimeShift, location: Location) -> CompanyTimePolicy:
    cid = _policy_company_id(shift, location)
    if cid is None:
        return _fallback_policy()
    return ensure_company_time_policy(db_session, cid)


def _parse_bounds_from_dates(
    policy: CompanyTimePolicy,
    start: date | None,
    end_exclusive: date | None,
) -> tuple[datetime | None, datetime | None]:
    try:
        tz = ZoneInfo(policy.timezone_name)
    except Exception:
        tz = ZoneInfo("UTC")

    start_utc: datetime | None = None
    end_utc: datetime | None = None

    if start is not None:
        start_local = datetime.combine(start, time.min, tzinfo=tz)
        start_utc = start_local.astimezone(timezone.utc)

    if end_exclusive is not None:
        end_local = datetime.combine(end_exclusive, time.min, tzinfo=tz)
        end_utc = end_local.astimezone(timezone.utc)

    return start_utc, end_utc


def _employee_display_name(profile: EmployeeProfile | None) -> str | None:
    if profile is None:
        return None
    first = (profile.first_name or "").strip()
    last = (profile.last_name or "").strip()
    if not first and not last:
        return None
    return f"{first} {last}".strip()


def _employee_job_title(profile: EmployeeProfile | None) -> str | None:
    if profile is None or profile.job_title is None:
        return None
    title = profile.job_title.strip()
    return title or None


def _hourly_from_profile(profile: EmployeeProfile | None) -> Decimal | None:
    if profile is None or profile.hourly_rate is None:
        return None
    return Decimal(str(profile.hourly_rate))


def _resolve_company_id(actor: User, company_id: uuid.UUID | None) -> uuid.UUID:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if company_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Select a company.",
            )
        return company_id
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your account is not linked to a company.",
            )
        return actor.company_id
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to perform this action.",
    )


def labour_cost_budget(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    date_from: date,
    date_to: date,
    location_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    workplace_id: uuid.UUID | None,
    planned_budget_amount: Decimal | None,
) -> LabourCostResponse:
    if date_to < date_from:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="date_to must be on or after date_from.",
        )
    if (date_to - date_from).days > MAX_DATE_RANGE_DAYS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Date range must be at most {MAX_DATE_RANGE_DAYS} days.",
        )

    resolved_company_id = _resolve_company_id(actor, company_id)

    if actor.system_role == SystemRole.ADMIN and company_id is not None and company_id != actor.company_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot view another company's data.",
        )

    company = get_company_by_id(db_session, resolved_company_id)
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found.")

    if workplace_id is not None:
        wp = get_workplace_by_id(db_session, workplace_id)
        if wp is None or wp.company_id != resolved_company_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workplace not found.")

    if location_id is not None:
        loc = db_session.get(Location, location_id)
        if loc is None or loc.company_id != resolved_company_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found.")

    if user_id is not None:
        target = get_user_by_id(db_session, user_id)
        if target is None or target.company_id != resolved_company_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
        if not can_view_time_record_shift_owner(actor, target):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot view this user's time records.",
            )

    policy = ensure_company_time_policy(db_session, resolved_company_id)
    end_exclusive_local = date_to + timedelta(days=1)
    start_utc, end_utc = _parse_bounds_from_dates(policy, date_from, end_exclusive_local)
    if start_utc is None or end_utc is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not build date bounds.",
        )

    rows = list_company_shifts_clock_in_window(
        db_session,
        company_id=resolved_company_id,
        start_utc=start_utc,
        end_utc=end_utc,
        location_id=location_id,
        user_id=user_id,
        limit=MAX_SHIFTS_SCAN + 1,
    )
    if len(rows) > MAX_SHIFTS_SCAN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Too many shifts in this range; narrow dates or add filters.",
        )

    emp_payroll: dict[uuid.UUID, int] = {}
    emp_cost: dict[uuid.UUID, Decimal] = {}
    emp_shifts: dict[uuid.UUID, int] = {}
    emp_profile: dict[uuid.UUID, EmployeeProfile | None] = {}
    emp_user: dict[uuid.UUID, User] = {}

    loc_payroll: dict[uuid.UUID, int] = {}
    loc_cost: dict[uuid.UUID, Decimal] = {}
    loc_shifts: dict[uuid.UUID, int] = {}
    loc_name: dict[uuid.UUID, str] = {}

    total_clocked = 0
    total_payable = 0
    total_payroll = 0
    total_break = 0
    open_shift_count = 0

    estimate_bits = [
        "Labour cost is estimated from completed shifts only, using company time policy "
        "payroll-rounded seconds multiplied by each employee's current profile hourly rate.",
        "Open shifts are counted but not costed.",
        "Dates are interpreted in the company policy timezone; the range is inclusive of "
        f"{date_from.isoformat()} through {date_to.isoformat()}.",
    ]
    if workplace_id is not None:
        estimate_bits.append(
            "Workplace is validated but does not filter shifts in this version (no workplace link on clock sites yet).",
        )

    for shift, location, owner, profile in rows:
        if not can_view_time_record_shift_owner(actor, owner):
            continue

        pol = _load_policy(db_session, shift, location)
        early_access = bool(profile.early_access_enabled) if profile is not None else False
        metrics = compute_shift_metrics(
            clock_in_at_utc=shift.clock_in_at,
            clock_out_at_utc=shift.clock_out_at,
            break_seconds_tracked=int(shift.break_seconds or 0),
            early_access_enabled=early_access,
            policy=pol,
        )

        uid = owner.id
        lid = location.id
        emp_user[uid] = owner
        emp_profile[uid] = profile
        loc_name[lid] = location.name

        if shift.status == "open":
            open_shift_count += 1
            continue

        if shift.status != "completed":
            continue

        act = metrics.actual_seconds or 0
        cnt = metrics.counted_seconds or 0
        rnd = metrics.rounded_seconds or 0
        brk = metrics.break_seconds

        total_clocked += act
        total_payable += cnt
        total_payroll += rnd
        total_break += brk

        emp_payroll[uid] = emp_payroll.get(uid, 0) + rnd
        emp_shifts[uid] = emp_shifts.get(uid, 0) + 1

        loc_payroll[lid] = loc_payroll.get(lid, 0) + rnd
        loc_shifts[lid] = loc_shifts.get(lid, 0) + 1

        hourly = _hourly_from_profile(profile)
        if hourly is None:
            shift_cost = Decimal("0.00")
        else:
            hours = Decimal(rnd) / Decimal(3600)
            shift_cost = (hours * hourly).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)

        emp_cost[uid] = emp_cost.get(uid, Decimal("0.00")) + shift_cost
        loc_cost[lid] = loc_cost.get(lid, Decimal("0.00")) + shift_cost

    actual_labour = sum(emp_cost.values(), Decimal("0.00")).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)

    rate_missing_count = sum(
        1 for uid, n in emp_shifts.items() if n > 0 and _hourly_from_profile(emp_profile.get(uid)) is None
    )

    payroll_hours = Decimal(total_payroll) / Decimal(3600) if total_payroll > 0 else Decimal(0)
    avg_hourly: Decimal | None = None
    if total_payroll > 0 and actual_labour > 0:
        avg_hourly = (actual_labour / payroll_hours).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)

    remaining: Decimal | None = None
    over_amt: Decimal | None = None
    used_pct: Decimal | None = None

    if planned_budget_amount is not None:
        pb = planned_budget_amount.quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
        if pb > 0:
            diff = (pb - actual_labour).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
            remaining = max(diff, Decimal("0.00"))
            over_amt = max((actual_labour - pb).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP), Decimal("0.00"))
            used_pct = ((actual_labour / pb) * Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        else:
            remaining = Decimal("0.00")
            over_amt = actual_labour if actual_labour > 0 else Decimal("0.00")
            used_pct = None
            estimate_bits.append("Planned budget is zero; budget used percent is omitted.")

    breakdown_employees: list[LabourCostEmployeeBreakdown] = []
    for uid in sorted(emp_shifts.keys(), key=lambda u: (emp_user[u].email or "").lower()):
        owner = emp_user[uid]
        profile = emp_profile.get(uid)
        hourly = _hourly_from_profile(profile)
        missing = hourly is None
        breakdown_employees.append(
            LabourCostEmployeeBreakdown(
                user_id=uid,
                employee_name=_employee_display_name(profile),
                employee_email=owner.email or "",
                job_title=_employee_job_title(profile),
                total_payroll_seconds=emp_payroll.get(uid, 0),
                hourly_rate=hourly,
                labour_cost=emp_cost.get(uid, Decimal("0.00")).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP),
                rate_missing=missing,
                shift_count=emp_shifts.get(uid, 0),
            ),
        )

    breakdown_locations: list[LabourCostLocationBreakdown] = []
    for lid in sorted(loc_shifts.keys(), key=lambda x: loc_name.get(x, "").lower()):
        breakdown_locations.append(
            LabourCostLocationBreakdown(
                location_id=lid,
                location_name=loc_name[lid],
                workplace_name=None,
                total_payroll_seconds=loc_payroll.get(lid, 0),
                labour_cost=loc_cost.get(lid, Decimal("0.00")).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP),
                shift_count=loc_shifts.get(lid, 0),
            ),
        )

    return LabourCostResponse(
        company_id=resolved_company_id,
        company_name=company.name,
        date_from=date_from,
        date_to=date_to,
        planned_budget_amount=planned_budget_amount,
        actual_labour_cost=actual_labour,
        remaining_budget=remaining,
        over_budget_amount=over_amt,
        budget_used_percent=used_pct,
        total_clocked_seconds=total_clocked,
        total_payable_seconds=total_payable,
        total_payroll_seconds=total_payroll,
        total_break_seconds=total_break,
        average_hourly_cost=avg_hourly,
        rate_missing_count=rate_missing_count,
        open_shift_count=open_shift_count,
        is_estimated=True,
        estimate_note=" ".join(estimate_bits),
        payroll_available=False,
        payroll_gross_total=None,
        breakdown_by_employee=breakdown_employees,
        breakdown_by_location=breakdown_locations,
    )
