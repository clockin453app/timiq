from __future__ import annotations

import csv
import html
import io
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.budgets.models import BudgetExpense, BudgetProject
from app.modules.budgets.repository import (
    delete_budget_expense,
    get_budget_expense,
    get_budget_project,
    list_budget_projects,
    list_company_shifts_clock_in_window,
    list_expenses_for_budget,
    save_budget_expense,
    save_budget_project,
    sum_expense_amount_total,
    sum_expense_amounts_by_category,
)
from app.modules.budgets.schemas import (
    BudgetCategoryTotals,
    BudgetEmployeeLabourBreakdown,
    BudgetExpenseCreateRequest,
    BudgetExpensePatchRequest,
    BudgetExpenseResponse,
    BudgetLiveTotals,
    BudgetProjectCreateRequest,
    BudgetProjectDetailResponse,
    BudgetProjectPatchRequest,
    BudgetProjectSummary,
)
from app.modules.companies.models import CompanyTimePolicy
from app.modules.companies.repository import get_company_by_id
from app.modules.companies.service import ensure_company_time_policy
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.payroll.models import PayrollItem
from app.modules.payroll.repository import get_period_by_company_week, list_items_for_period
from app.modules.time_clock.models import TimeShift
from app.modules.time_records.calculation import compute_shift_metrics
from app.modules.time_records.permissions import can_view_time_record_shift_owner
from app.modules.workplaces.repository import get_workplace_by_id

MONEY_QUANT = Decimal("0.01")
MAX_SHIFTS_SCAN = 8000


def _resolve_company_id(actor: User, company_id: uuid.UUID | None) -> uuid.UUID:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if company_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select a company.")
        return company_id
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your account is not linked to a company.")
        return actor.company_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission.")


def _assert_budget_company_admin(actor: User, company_id: uuid.UUID) -> None:
    if actor.system_role == SystemRole.ADMIN and company_id != actor.company_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot view another company's data.")


def _assert_can_access_budget(actor: User, project: BudgetProject) -> None:
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id != project.company_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot access this budget.")


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


def _monday_week_start_for_instant(policy_timezone: str, instant_utc: datetime) -> date:
    try:
        tz = ZoneInfo(policy_timezone)
    except Exception:
        tz = ZoneInfo("UTC")
    local = instant_utc.astimezone(tz)
    d = local.date()
    return d - timedelta(days=d.weekday())


def _payroll_item_for_user_week(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    week_start: date,
) -> PayrollItem | None:
    period = get_period_by_company_week(db_session, company_id, week_start)
    if period is None:
        return None
    for item in list_items_for_period(db_session, period.id):
        if item.user_id == user_id:
            return item
    return None


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


def _decimal_from_item_gross(item: PayrollItem | None) -> Decimal | None:
    if item is None or item.gross_amount is None:
        return None
    return Decimal(str(item.gross_amount))


def _validate_fk_scope(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    location_id: uuid.UUID | None,
    workplace_id: uuid.UUID | None,
) -> None:
    if location_id is not None:
        loc = db_session.get(Location, location_id)
        if loc is None or loc.company_id != company_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found.")
    if workplace_id is not None:
        wp = get_workplace_by_id(db_session, workplace_id)
        if wp is None or wp.company_id != company_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workplace not found.")


def _location_name(db_session: Session, location_id: uuid.UUID | None) -> str | None:
    if location_id is None:
        return None
    loc = db_session.get(Location, location_id)
    return loc.name if loc is not None else None


def _workplace_name(db_session: Session, workplace_id: uuid.UUID | None) -> str | None:
    if workplace_id is None:
        return None
    wp = get_workplace_by_id(db_session, workplace_id)
    return wp.name if wp is not None else None


def _compute_labour_and_expenses(
    db_session: Session,
    actor: User,
    project: BudgetProject,
) -> tuple[
    BudgetLiveTotals,
    list[BudgetEmployeeLabourBreakdown],
    BudgetCategoryTotals,
    list[BudgetExpenseResponse],
]:
    policy = ensure_company_time_policy(db_session, project.company_id)
    end_local = project.end_date or datetime.now(timezone.utc).astimezone(ZoneInfo(policy.timezone_name)).date()
    start_local = project.start_date or (end_local - timedelta(days=3650))
    end_exclusive = end_local + timedelta(days=1)
    start_utc, end_utc = _parse_bounds_from_dates(policy, start_local, end_exclusive)
    if start_utc is None or end_utc is None:
        raise HTTPException(status_code=500, detail="Could not build date bounds.")

    loc_filter = project.location_id
    rows = list_company_shifts_clock_in_window(
        db_session,
        company_id=project.company_id,
        start_utc=start_utc,
        end_utc=end_utc,
        location_id=loc_filter,
        user_id=None,
        limit=MAX_SHIFTS_SCAN + 1,
    )
    if len(rows) > MAX_SHIFTS_SCAN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Too many shifts for this budget window; narrow dates or set a site filter.",
        )

    warnings: list[str] = []
    if project.workplace_id is not None:
        warnings.append(
            "Workplace is recorded on this budget but clock sites are not linked to workplaces yet; "
            "labour totals are not filtered by workplace.",
        )

    emp_fin: dict[uuid.UUID, Decimal] = {}
    emp_est: dict[uuid.UUID, Decimal] = {}
    emp_sec: dict[uuid.UUID, int] = {}
    emp_shifts: dict[uuid.UUID, int] = {}
    emp_profile: dict[uuid.UUID, EmployeeProfile | None] = {}
    emp_user: dict[uuid.UUID, User] = {}

    total_clocked = total_payable = total_payroll = total_break = 0
    open_shift_count = 0
    missing_rate_count = 0

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
        emp_user[uid] = owner
        emp_profile[uid] = profile

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
        emp_sec[uid] = emp_sec.get(uid, 0) + rnd
        emp_shifts[uid] = emp_shifts.get(uid, 0) + 1

        week_start = _monday_week_start_for_instant(policy.timezone_name, shift.clock_in_at)
        item = _payroll_item_for_user_week(
            db_session,
            company_id=project.company_id,
            user_id=uid,
            week_start=week_start,
        )
        gross = _decimal_from_item_gross(item)
        finalized = Decimal("0.00")
        estimated = Decimal("0.00")
        if (
            item is not None
            and item.status in ("approved", "paid")
            and gross is not None
            and item.rounded_total_seconds > 0
        ):
            finalized = (Decimal(rnd) / Decimal(int(item.rounded_total_seconds))) * gross
            finalized = finalized.quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
        else:
            hourly = _hourly_from_profile(profile)
            if hourly is None:
                missing_rate_count += 1
            else:
                estimated = (Decimal(rnd) / Decimal(3600)) * hourly
                estimated = estimated.quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)

        emp_fin[uid] = emp_fin.get(uid, Decimal("0.00")) + finalized
        emp_est[uid] = emp_est.get(uid, Decimal("0.00")) + estimated

    finalized_labour = sum(emp_fin.values(), Decimal("0.00")).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    estimated_labour = sum(emp_est.values(), Decimal("0.00")).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    total_labour = (finalized_labour + estimated_labour).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)

    if estimated_labour > 0:
        warnings.append("Estimated labour is included for weeks or employees without approved/paid payroll rows.")

    cat_map = sum_expense_amounts_by_category(db_session, project.id)

    def _cat(name: str) -> Decimal:
        return Decimal(str(cat_map.get(name, 0))).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)

    cats = BudgetCategoryTotals(
        materials=_cat("materials"),
        tools=_cat("tools"),
        equipment=_cat("equipment"),
        subcontractor=_cat("subcontractor"),
        plant_hire=_cat("plant_hire"),
        transport=_cat("transport"),
        other=_cat("other"),
    )
    total_expenses = Decimal(str(sum_expense_amount_total(db_session, project.id))).quantize(
        MONEY_QUANT,
        rounding=ROUND_HALF_UP,
    )
    total_spent = (total_labour + total_expenses).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    planned = Decimal(str(project.planned_budget_amount)).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)

    remaining = max(planned - total_spent, Decimal("0.00"))
    over_amt = max(total_spent - planned, Decimal("0.00"))
    used_pct: Decimal | None = None
    labour_pct: Decimal | None = None
    exp_pct: Decimal | None = None
    if planned > 0:
        used_pct = ((total_spent / planned) * Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        labour_pct = ((total_labour / planned) * Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        exp_pct = ((total_expenses / planned) * Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    estimate_note = (
        "Labour uses approved/paid payroll gross allocated by each shift's share of that week's rounded hours "
        "when available; otherwise payroll-rounded hours times the employee profile hourly rate."
    )

    totals = BudgetLiveTotals(
        planned_budget_amount=planned,
        finalized_labour_cost=finalized_labour,
        estimated_labour_cost=estimated_labour,
        total_labour_cost=total_labour,
        total_expenses=total_expenses,
        total_spent=total_spent,
        remaining_budget=remaining,
        over_budget_amount=over_amt,
        budget_used_percent=used_pct,
        labour_percent_of_budget=labour_pct,
        expenses_percent_of_budget=exp_pct,
        total_materials=cats.materials,
        total_tools=cats.tools,
        total_equipment=cats.equipment,
        total_subcontractor=cats.subcontractor,
        total_plant_hire=cats.plant_hire,
        total_transport=cats.transport,
        total_other=cats.other,
        total_clocked_seconds=total_clocked,
        total_payable_seconds=total_payable,
        total_payroll_seconds=total_payroll,
        total_break_seconds=total_break,
        open_shift_count=open_shift_count,
        missing_rate_count=missing_rate_count,
        warnings=warnings,
        estimate_note=estimate_note,
    )

    breakdown: list[BudgetEmployeeLabourBreakdown] = []
    for uid in sorted(emp_shifts.keys(), key=lambda u: (emp_user[u].email or "").lower()):
        fin = emp_fin.get(uid, Decimal("0.00")).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
        est = emp_est.get(uid, Decimal("0.00")).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
        breakdown.append(
            BudgetEmployeeLabourBreakdown(
                user_id=uid,
                employee_name=_employee_display_name(emp_profile.get(uid)),
                employee_email=emp_user[uid].email or "",
                job_title=_employee_job_title(emp_profile.get(uid)),
                shift_count=emp_shifts.get(uid, 0),
                total_payroll_seconds=emp_sec.get(uid, 0),
                finalized_labour_cost=fin,
                estimated_labour_cost=est,
                total_labour_cost=(fin + est).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP),
            ),
        )

    recent = [BudgetExpenseResponse.model_validate(e) for e in list_expenses_for_budget(db_session, budget_id=project.id, limit=50)]

    return totals, breakdown, cats, recent


def _project_to_summary(
    db_session: Session,
    project: BudgetProject,
    totals: BudgetLiveTotals,
) -> BudgetProjectSummary:
    return BudgetProjectSummary(
        id=project.id,
        company_id=project.company_id,
        name=project.name,
        description=project.description,
        client_name=project.client_name,
        reference_code=project.reference_code,
        location_id=project.location_id,
        location_name=_location_name(db_session, project.location_id),
        workplace_id=project.workplace_id,
        workplace_name=_workplace_name(db_session, project.workplace_id),
        status=project.status,
        start_date=project.start_date,
        end_date=project.end_date,
        planned_budget_amount=Decimal(str(project.planned_budget_amount)),
        notes=project.notes,
        total_spent=totals.total_spent,
        remaining_budget=totals.remaining_budget,
        budget_used_percent=totals.budget_used_percent,
    )


def list_saved_budgets(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    status: str | None,
    location_id: uuid.UUID | None,
    workplace_id: uuid.UUID | None,
    search: str | None,
    date_from: date | None,
    date_to: date | None,
    limit: int,
    offset: int,
) -> list[BudgetProjectSummary]:
    cid = _resolve_company_id(actor, company_id)
    _assert_budget_company_admin(actor, cid)
    rows = list_budget_projects(
        db_session,
        company_id=cid,
        status=status,
        location_id=location_id,
        workplace_id=workplace_id,
        search=search,
        date_from=date_from,
        date_to=date_to,
        limit=min(limit, 100),
        offset=offset,
    )
    out: list[BudgetProjectSummary] = []
    for p in rows:
        _assert_can_access_budget(actor, p)
        totals, _, _, _ = _compute_labour_and_expenses(db_session, actor, p)
        out.append(_project_to_summary(db_session, p, totals))
    return out


def create_budget(
    db_session: Session,
    actor: User,
    body: BudgetProjectCreateRequest,
) -> BudgetProjectDetailResponse:
    cid = _resolve_company_id(actor, body.company_id if actor.system_role == SystemRole.ADMINISTRATOR else None)
    _assert_budget_company_admin(actor, cid)
    _validate_fk_scope(db_session, company_id=cid, location_id=body.location_id, workplace_id=body.workplace_id)

    row = BudgetProject(
        company_id=cid,
        name=body.name.strip(),
        description=body.description,
        workplace_id=body.workplace_id,
        location_id=body.location_id,
        client_name=body.client_name,
        reference_code=body.reference_code,
        status=body.status,
        start_date=body.start_date,
        end_date=body.end_date,
        planned_budget_amount=float(body.planned_budget_amount),
        notes=body.notes,
        created_by_user_id=actor.id,
    )
    save_budget_project(db_session, row)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.created",
        entity_type="budget",
        entity_id=str(row.id),
        company_id=cid,
        details={"budget_id": str(row.id), "fields": ["name", "status", "planned_budget_amount"]},
    )
    return get_budget_detail(db_session, actor, row.id)


def get_budget_detail(db_session: Session, actor: User, budget_id: uuid.UUID) -> BudgetProjectDetailResponse:
    project = get_budget_project(db_session, budget_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found.")
    _assert_can_access_budget(actor, project)

    totals, breakdown, cats, recent = _compute_labour_and_expenses(db_session, actor, project)
    summary = _project_to_summary(db_session, project, totals)
    return BudgetProjectDetailResponse(
        budget=summary,
        totals=totals,
        breakdown_by_employee=breakdown,
        breakdown_by_category=cats,
        recent_expenses=recent,
    )


def patch_budget(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    body: BudgetProjectPatchRequest,
) -> BudgetProjectDetailResponse:
    project = get_budget_project(db_session, budget_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found.")
    _assert_can_access_budget(actor, project)

    changed: list[str] = []
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        project.name = body.name.strip()  # type: ignore[union-attr]
        changed.append("name")
    if "description" in data:
        project.description = body.description
        changed.append("description")
    if "workplace_id" in data:
        if body.workplace_id is not None:
            _validate_fk_scope(
                db_session,
                company_id=project.company_id,
                location_id=None,
                workplace_id=body.workplace_id,
            )
        project.workplace_id = body.workplace_id
        changed.append("workplace_id")
    if "location_id" in data:
        if body.location_id is not None:
            _validate_fk_scope(
                db_session,
                company_id=project.company_id,
                location_id=body.location_id,
                workplace_id=None,
            )
        project.location_id = body.location_id
        changed.append("location_id")
    if "client_name" in data:
        project.client_name = body.client_name
        changed.append("client_name")
    if "reference_code" in data:
        project.reference_code = body.reference_code
        changed.append("reference_code")
    if "status" in data:
        project.status = body.status  # type: ignore[assignment]
        changed.append("status")
    if "start_date" in data:
        project.start_date = body.start_date
        changed.append("start_date")
    if "end_date" in data:
        project.end_date = body.end_date
        changed.append("end_date")
    if "planned_budget_amount" in data:
        project.planned_budget_amount = float(body.planned_budget_amount)  # type: ignore[arg-type]
        changed.append("planned_budget_amount")
    if "notes" in data:
        project.notes = body.notes
        changed.append("notes")

    save_budget_project(db_session, project)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.updated",
        entity_type="budget",
        entity_id=str(project.id),
        company_id=project.company_id,
        details={"budget_id": str(project.id), "changed_fields": changed},
    )
    return get_budget_detail(db_session, actor, budget_id)


def archive_budget(db_session: Session, actor: User, budget_id: uuid.UUID) -> BudgetProjectDetailResponse:
    project = get_budget_project(db_session, budget_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found.")
    _assert_can_access_budget(actor, project)
    project.status = "archived"
    save_budget_project(db_session, project)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.archived",
        entity_type="budget",
        entity_id=str(project.id),
        company_id=project.company_id,
        details={"budget_id": str(project.id)},
    )
    return get_budget_detail(db_session, actor, budget_id)


def create_expense(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    body: BudgetExpenseCreateRequest,
) -> BudgetExpenseResponse:
    project = get_budget_project(db_session, budget_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found.")
    _assert_can_access_budget(actor, project)

    row = BudgetExpense(
        budget_id=project.id,
        company_id=project.company_id,
        category=body.category,
        description=body.description.strip(),
        supplier=body.supplier,
        purchase_date=body.purchase_date,
        amount=float(body.amount),
        vat_amount=float(body.vat_amount) if body.vat_amount is not None else None,
        invoice_ref=body.invoice_ref,
        notes=body.notes,
        created_by_user_id=actor.id,
    )
    save_budget_expense(db_session, row)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.expense_created",
        entity_type="budget_expense",
        entity_id=str(row.id),
        company_id=project.company_id,
        details={
            "budget_id": str(project.id),
            "expense_id": str(row.id),
            "category": row.category,
            "amount": str(body.amount),
            "purchase_date": str(body.purchase_date),
        },
    )
    return BudgetExpenseResponse.model_validate(row)


def patch_expense(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    expense_id: uuid.UUID,
    body: BudgetExpensePatchRequest,
) -> BudgetExpenseResponse:
    project = get_budget_project(db_session, budget_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found.")
    _assert_can_access_budget(actor, project)
    row = get_budget_expense(db_session, expense_id)
    if row is None or row.budget_id != budget_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense not found.")

    changed: list[str] = []
    data = body.model_dump(exclude_unset=True)
    if "category" in data:
        row.category = body.category  # type: ignore[assignment]
        changed.append("category")
    if "description" in data:
        row.description = body.description.strip()  # type: ignore[union-attr]
        changed.append("description")
    if "supplier" in data:
        row.supplier = body.supplier
        changed.append("supplier")
    if "purchase_date" in data:
        row.purchase_date = body.purchase_date  # type: ignore[assignment]
        changed.append("purchase_date")
    if "amount" in data:
        row.amount = float(body.amount)  # type: ignore[arg-type]
        changed.append("amount")
    if "vat_amount" in data:
        row.vat_amount = float(body.vat_amount) if body.vat_amount is not None else None
        changed.append("vat_amount")
    if "invoice_ref" in data:
        row.invoice_ref = body.invoice_ref
        changed.append("invoice_ref")
    if "notes" in data:
        row.notes = body.notes
        changed.append("notes")

    save_budget_expense(db_session, row)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.expense_updated",
        entity_type="budget_expense",
        entity_id=str(row.id),
        company_id=project.company_id,
        details={"budget_id": str(project.id), "expense_id": str(row.id), "changed_fields": changed},
    )
    return BudgetExpenseResponse.model_validate(row)


def remove_expense(db_session: Session, actor: User, budget_id: uuid.UUID, expense_id: uuid.UUID) -> None:
    project = get_budget_project(db_session, budget_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found.")
    _assert_can_access_budget(actor, project)
    row = get_budget_expense(db_session, expense_id)
    if row is None or row.budget_id != budget_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense not found.")
    delete_budget_expense(db_session, expense_id)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.expense_deleted",
        entity_type="budget_expense",
        entity_id=str(expense_id),
        company_id=project.company_id,
        details={"budget_id": str(project.id), "expense_id": str(expense_id)},
    )


def list_expenses_api(db_session: Session, actor: User, budget_id: uuid.UUID) -> list[BudgetExpenseResponse]:
    project = get_budget_project(db_session, budget_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found.")
    _assert_can_access_budget(actor, project)
    return [BudgetExpenseResponse.model_validate(e) for e in list_expenses_for_budget(db_session, budget_id=budget_id)]


def export_budget_csv(db_session: Session, actor: User, budget_id: uuid.UUID) -> tuple[bytes, str]:
    detail = get_budget_detail(db_session, actor, budget_id)
    company = get_company_by_id(db_session, detail.budget.company_id)
    company_name = company.name if company else ""

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Budget report"])
    w.writerow(["Project", detail.budget.name])
    w.writerow(["Client", detail.budget.client_name or ""])
    w.writerow(["Company", company_name])
    w.writerow(["Location", detail.budget.location_name or ""])
    w.writerow(["Reference", detail.budget.reference_code or ""])
    w.writerow(["Date range", f"{detail.budget.start_date} – {detail.budget.end_date}"])
    w.writerow(["Planned budget", str(detail.totals.planned_budget_amount)])
    w.writerow(["Finalized labour", str(detail.totals.finalized_labour_cost)])
    w.writerow(["Estimated labour", str(detail.totals.estimated_labour_cost)])
    w.writerow(["Total labour", str(detail.totals.total_labour_cost)])
    w.writerow(["Total expenses", str(detail.totals.total_expenses)])
    w.writerow(["Total spent", str(detail.totals.total_spent)])
    w.writerow(["Remaining", str(detail.totals.remaining_budget)])
    w.writerow(["Over budget", str(detail.totals.over_budget_amount)])
    w.writerow([])
    w.writerow(["Employee", "Email", "Shifts", "Payroll seconds", "Finalized labour", "Estimated labour", "Total"])
    for row in detail.breakdown_by_employee:
        w.writerow(
            [
                row.employee_name or row.employee_email,
                row.employee_email,
                row.shift_count,
                row.total_payroll_seconds,
                str(row.finalized_labour_cost),
                str(row.estimated_labour_cost),
                str(row.total_labour_cost),
            ],
        )
    w.writerow([])
    w.writerow(["Expenses"])
    w.writerow(["Date", "Category", "Supplier", "Description", "Amount", "VAT", "Invoice ref"])
    for e in list_expenses_for_budget(db_session, budget_id=budget_id, limit=2000):
        w.writerow(
            [
                str(e.purchase_date),
                e.category,
                e.supplier or "",
                e.description,
                str(e.amount),
                str(e.vat_amount) if e.vat_amount is not None else "",
                e.invoice_ref or "",
            ],
        )

    body = buf.getvalue().encode("utf-8")
    fname = f"budget-{budget_id}.csv"
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.report_exported",
        entity_type="budget",
        entity_id=str(budget_id),
        company_id=detail.budget.company_id,
        details={"budget_id": str(budget_id), "export_type": "csv"},
    )
    return body, fname


def export_budget_print_html(db_session: Session, actor: User, budget_id: uuid.UUID) -> str:
    detail = get_budget_detail(db_session, actor, budget_id)
    company = get_company_by_id(db_session, detail.budget.company_id)
    company_name = html.escape(company.name if company else "")
    title = html.escape(detail.budget.name)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    def esc(s: str | None) -> str:
        return html.escape(s or "")

    rows_html = "".join(
        f"<tr><td>{esc(r.employee_name or r.employee_email)}</td><td>{esc(r.employee_email)}</td>"
        f"<td class='num'>{r.shift_count}</td><td class='num'>{r.total_payroll_seconds}</td>"
        f"<td class='num'>{r.finalized_labour_cost}</td><td class='num'>{r.estimated_labour_cost}</td>"
        f"<td class='num'>{r.total_labour_cost}</td></tr>"
        for r in detail.breakdown_by_employee
    )
    exp_html = "".join(
        f"<tr><td>{e.purchase_date}</td><td>{esc(e.category)}</td><td>{esc(e.supplier)}</td>"
        f"<td>{esc(e.description)}</td><td class='num'>{e.amount}</td>"
        f"<td class='num'>{e.vat_amount if e.vat_amount is not None else ''}</td>"
        f"<td>{esc(e.invoice_ref)}</td></tr>"
        for e in list_expenses_for_budget(db_session, budget_id=budget_id, limit=2000)
    )
    warns = "".join(f"<li>{html.escape(w)}</li>" for w in detail.totals.warnings)

    html_out = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>{title}</title>
<style>
  body {{ font-family: system-ui, sans-serif; color: #111827; margin: 24px; }}
  h1 {{ font-size: 22px; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }}
  th, td {{ border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; }}
  th {{ background: #f3f4f6; }}
  .num {{ text-align: right; }}
  .summary td {{ font-weight: 600; }}
  @media print {{ body {{ margin: 12mm; }} }}
</style></head><body>
<h1>{title}</h1>
<p><strong>Company:</strong> {company_name} &nbsp;|&nbsp; <strong>Client:</strong> {esc(detail.budget.client_name)}
 &nbsp;|&nbsp; <strong>Site:</strong> {esc(detail.budget.location_name)}</p>
<p><strong>Reference:</strong> {esc(detail.budget.reference_code)} &nbsp;|&nbsp;
<strong>Period:</strong> {detail.budget.start_date} – {detail.budget.end_date}</p>
<p><strong>Generated:</strong> {now}</p>
<table class="summary">
<tr><td>Planned budget</td><td class="num">{detail.totals.planned_budget_amount}</td></tr>
<tr><td>Total labour</td><td class="num">{detail.totals.total_labour_cost}</td></tr>
<tr><td>Total expenses</td><td class="num">{detail.totals.total_expenses}</td></tr>
<tr><td>Total spent</td><td class="num">{detail.totals.total_spent}</td></tr>
<tr><td>Remaining</td><td class="num">{detail.totals.remaining_budget}</td></tr>
<tr><td>Over budget</td><td class="num">{detail.totals.over_budget_amount}</td></tr>
</table>
<p><strong>Notes</strong></p><p>{esc(detail.totals.estimate_note)}</p>
{"<p><strong>Warnings</strong></p><ul>" + warns + "</ul>" if warns else ""}
<h2>Labour by employee</h2>
<table><thead><tr><th>Employee</th><th>Email</th><th>Shifts</th><th>Payroll sec</th>
<th>Finalized</th><th>Estimated</th><th>Total</th></tr></thead><tbody>{rows_html or "<tr><td colspan='7'>No data</td></tr>"}</tbody></table>
<h2>Expenses</h2>
<table><thead><tr><th>Date</th><th>Category</th><th>Supplier</th><th>Description</th><th>Amount</th><th>VAT</th><th>Invoice</th></tr></thead>
<tbody>{exp_html or "<tr><td colspan='7'>No expenses</td></tr>"}</tbody></table>
</body></html>"""

    create_internal_audit_event(
        db_session,
        actor,
        action="budget.report_exported",
        entity_type="budget",
        entity_id=str(budget_id),
        company_id=detail.budget.company_id,
        details={"budget_id": str(budget_id), "export_type": "print_html"},
    )
    return html_out
