"""Merge company time policy with optional per-location (site) overrides for calculations."""

from __future__ import annotations

from app.modules.companies.models import CompanyTimePolicy
from app.modules.payroll_policies.models import LocationPayrollPolicy


def resolve_early_clock_in_for_site(*, profile_early_access: bool, site_allow_early: bool | None) -> bool:
    """Site flag wins when set; otherwise employee profile early_access_enabled."""
    if site_allow_early is None:
        return bool(profile_early_access)
    return bool(site_allow_early)


def merge_location_time_policy(
    company: CompanyTimePolicy,
    site: LocationPayrollPolicy | None,
) -> CompanyTimePolicy:
    """Return a detached CompanyTimePolicy for compute_shift_metrics (read-only use).

    When ``site`` is None, not enabled, or missing, returns the original ``company`` instance.
    When enabled, returns a new unsaved CompanyTimePolicy with per-field overlay (null site
    field → keep company value). Overtime and timezone always come from the company policy.
    """
    if site is None or not site.is_enabled:
        return company

    std = site.standard_start_time if (site.standard_start_time and str(site.standard_start_time).strip()) else company.standard_start_time
    brk_after = (
        site.break_deduction_after_minutes
        if site.break_deduction_after_minutes is not None
        else company.break_deduction_after_minutes
    )
    brk_min = (
        site.break_deduction_minutes if site.break_deduction_minutes is not None else company.break_deduction_minutes
    )
    rnd_inc = (
        site.rounding_increment_minutes
        if site.rounding_increment_minutes is not None
        else company.rounding_increment_minutes
    )
    rnd_mode = site.rounding_mode if (site.rounding_mode and str(site.rounding_mode).strip()) else company.rounding_mode

    return CompanyTimePolicy(
        company_id=company.company_id,
        standard_start_time=std,
        overtime_after_hours=company.overtime_after_hours,
        overtime_multiplier=company.overtime_multiplier,
        rounding_increment_minutes=rnd_inc,
        rounding_mode=rnd_mode,
        break_deduction_minutes=brk_min,
        break_deduction_after_minutes=brk_after,
        rule_effective_from=company.rule_effective_from,
        rule_note=company.rule_note,
        timezone_name=company.timezone_name,
        created_at=company.created_at,
        updated_at=company.updated_at,
    )
