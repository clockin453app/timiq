"""Payroll math from Batch 31 rounded seconds + policy rates."""

from decimal import Decimal, ROUND_HALF_UP
from datetime import date, datetime, time, timedelta, timezone
import uuid
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.modules.companies.models import CompanyTimePolicy
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.payroll_policies.service import effective_early_access_for_shift, effective_time_policy_for_shift
from app.modules.time_records.calculation import compute_shift_metrics
from app.modules.time_records.repository import list_time_shifts_for_payroll_week


def week_bounds_utc(policy: CompanyTimePolicy, week_start: date) -> tuple[datetime, datetime]:
    try:
        tz = ZoneInfo(policy.timezone_name)
    except Exception:
        tz = ZoneInfo("UTC")
    start_local = datetime.combine(week_start, time.min, tzinfo=tz)
    end_local = start_local + timedelta(days=7)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def sum_rounded_seconds_payroll_week(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    week_start: date,
    policy: CompanyTimePolicy,
) -> int:
    week_start_utc, week_end_utc = week_bounds_utc(policy, week_start)
    rows = list_time_shifts_for_payroll_week(
        db_session,
        company_id=company_id,
        subject_user_id=user_id,
        week_start_utc=week_start_utc,
        week_end_utc=week_end_utc,
    )
    total = 0
    for shift, location, _owner, profile in rows:
        pol = effective_time_policy_for_shift(db_session, shift, location)
        profile_early = bool(profile.early_access_enabled) if profile is not None else False
        early_access = effective_early_access_for_shift(
            db_session, location, profile_early_access=profile_early
        )
        metrics = compute_shift_metrics(
            clock_in_at_utc=shift.clock_in_at,
            clock_out_at_utc=shift.clock_out_at,
            break_seconds_tracked=int(shift.break_seconds or 0),
            early_access_enabled=early_access,
            policy=pol,
        )
        if metrics.rounded_seconds is not None:
            total += int(metrics.rounded_seconds)
    return total


def split_regular_overtime(
    total_rounded_seconds: int,
    overtime_after_hours: float,
) -> tuple[int, int]:
    threshold_sec = int(Decimal(str(overtime_after_hours)) * Decimal(3600))
    regular = min(total_rounded_seconds, threshold_sec)
    overtime = max(0, total_rounded_seconds - threshold_sec)
    return regular, overtime


def normalize_payroll_payment_mode(mode: str | None) -> str:
    """Null, empty, legacy 'net', or unknown values default to net_payment (CIS deducted)."""
    if mode is None:
        return "net_payment"
    m = str(mode).strip().lower()
    if m in ("", "net", "net_payment"):
        return "net_payment"
    if m in ("gross", "gross_payment"):
        return "gross_payment"
    return "net_payment"


def policy_snapshot_dict(policy: CompanyTimePolicy) -> dict:
    return {
        "standard_start_time": policy.standard_start_time,
        "overtime_after_hours": policy.overtime_after_hours,
        "overtime_multiplier": policy.overtime_multiplier,
        "rounding_increment_minutes": policy.rounding_increment_minutes,
        "rounding_mode": policy.rounding_mode,
        "break_deduction_minutes": policy.break_deduction_minutes,
        "break_deduction_after_minutes": policy.break_deduction_after_minutes,
        "rule_effective_from": policy.rule_effective_from.isoformat(),
        "timezone_name": policy.timezone_name,
    }


def compute_money_bundle(
    *,
    regular_seconds: int,
    overtime_seconds: int,
    hourly_rate: Decimal | None,
    overtime_multiplier: Decimal,
    tax_rate_percent: Decimal | None,
    other_deductions: Decimal,
    payment_mode: str | None = None,
) -> dict[str, object]:
    """Returns gross/tax/net/display fields and rate_missing.

    ``payment_mode``: ``gross_payment`` means no CIS deduction (tax and display tax are zero);
    ``net_payment`` (default) applies ``tax_rate_percent`` to gross for CIS.
    """
    if hourly_rate is None:
        return {
            "rate_missing": True,
            "gross_amount": None,
            "tax_amount": None,
            "net_amount": None,
            "display_tax_amount": None,
            "display_net_amount": None,
        }

    reg_hours = Decimal(regular_seconds) / Decimal(3600)
    ot_hours = Decimal(overtime_seconds) / Decimal(3600)
    regular_pay = reg_hours * hourly_rate
    overtime_pay = ot_hours * hourly_rate * overtime_multiplier
    gross = regular_pay + overtime_pay
    gross_q = gross.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)

    mode = normalize_payroll_payment_mode(payment_mode)
    if mode == "gross_payment":
        tax = Decimal(0)
        net = (gross_q - other_deductions).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    else:
        tr = tax_rate_percent if tax_rate_percent is not None else Decimal(0)
        tax = (gross_q * tr / Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        net = (gross_q - tax - other_deductions).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    return {
        "rate_missing": False,
        "gross_amount": gross_q,
        "tax_amount": tax,
        "net_amount": net,
        "display_tax_amount": tax,
        "display_net_amount": net,
    }


def resolve_effective_tax_rate_percent(
    profile: EmployeeProfile | None,
    company_default: float | None,
    workplace_tax: float | None,
) -> Decimal | None:
    """Employee profile override, else first workplace rate, else company default."""
    if profile is not None and profile.tax_rate is not None:
        return Decimal(str(profile.tax_rate))
    if workplace_tax is not None:
        return Decimal(str(workplace_tax))
    if company_default is not None:
        return Decimal(str(company_default))
    return None
