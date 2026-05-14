"""Site payroll policy merge and early clock-in resolution (pure logic)."""

import uuid
from datetime import datetime, timezone

from app.modules.companies.models import CompanyTimePolicy
from app.modules.payroll_policies.effective_policy import merge_location_time_policy, resolve_early_clock_in_for_site
from app.modules.payroll_policies.models import LocationPayrollPolicy


def _company() -> CompanyTimePolicy:
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    cid = uuid.uuid4()
    return CompanyTimePolicy(
        company_id=cid,
        standard_start_time="08:00",
        overtime_after_hours=8.5,
        overtime_multiplier=1.5,
        rounding_increment_minutes=30,
        rounding_mode="nearest",
        break_deduction_minutes=30,
        break_deduction_after_minutes=360,
        rule_effective_from=t,
        rule_note="",
        timezone_name="Europe/London",
        created_at=t,
        updated_at=t,
    )


def test_merge_null_site_fields_use_company() -> None:
    c = _company()
    lid = uuid.uuid4()
    site = LocationPayrollPolicy(
        id=uuid.uuid4(),
        company_id=c.company_id,
        location_id=lid,
        is_enabled=True,
        standard_start_time=None,
        allow_early_clock_in=None,
        break_deduction_after_minutes=None,
        break_deduction_minutes=None,
        rounding_increment_minutes=None,
        rounding_mode=None,
        notes=None,
        created_by_user_id=None,
        updated_by_user_id=None,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )
    m = merge_location_time_policy(c, site)
    assert m.standard_start_time == c.standard_start_time
    assert m.rounding_increment_minutes == c.rounding_increment_minutes


def test_merge_overlay_non_null_fields() -> None:
    c = _company()
    lid = uuid.uuid4()
    site = LocationPayrollPolicy(
        id=uuid.uuid4(),
        company_id=c.company_id,
        location_id=lid,
        is_enabled=True,
        standard_start_time="07:30",
        allow_early_clock_in=None,
        break_deduction_after_minutes=120,
        break_deduction_minutes=None,
        rounding_increment_minutes=15,
        rounding_mode="up",
        notes=None,
        created_by_user_id=None,
        updated_by_user_id=None,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )
    m = merge_location_time_policy(c, site)
    assert m.standard_start_time == "07:30"
    assert m.break_deduction_after_minutes == 120
    assert m.break_deduction_minutes == c.break_deduction_minutes
    assert m.rounding_increment_minutes == 15
    assert m.rounding_mode == "up"


def test_merge_disabled_site_returns_company_instance() -> None:
    c = _company()
    lid = uuid.uuid4()
    site = LocationPayrollPolicy(
        id=uuid.uuid4(),
        company_id=c.company_id,
        location_id=lid,
        is_enabled=False,
        standard_start_time="06:00",
        allow_early_clock_in=True,
        break_deduction_after_minutes=1,
        break_deduction_minutes=1,
        rounding_increment_minutes=1,
        rounding_mode="down",
        notes=None,
        created_by_user_id=None,
        updated_by_user_id=None,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )
    assert merge_location_time_policy(c, site) is c


def test_resolve_early_null_uses_profile() -> None:
    assert resolve_early_clock_in_for_site(profile_early_access=False, site_allow_early=None) is False
    assert resolve_early_clock_in_for_site(profile_early_access=True, site_allow_early=None) is True


def test_resolve_early_site_true_overrides_profile_false() -> None:
    assert resolve_early_clock_in_for_site(profile_early_access=False, site_allow_early=True) is True


def test_resolve_early_site_false_overrides_profile_true() -> None:
    assert resolve_early_clock_in_for_site(profile_early_access=True, site_allow_early=False) is False
