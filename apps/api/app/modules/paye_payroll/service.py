from __future__ import annotations

import html
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.auth.service import can_manage_user
from app.modules.companies.repository import get_company_by_id
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.paye_payroll import repository as paye_repo
from app.modules.paye_payroll.calculation import (
    amount,
    calculate_fixed_monthly_salary,
    money,
    tax_month_bounds,
)
from app.modules.paye_payroll.capabilities import list_paye_capabilities
from app.modules.paye_payroll.models import (
    CompanyPayeSettings,
    EmployeePayeSettings,
    MonthlyPayeItem,
    MonthlyPayePayComponent,
    MonthlyPayePeriod,
    PayeTaxYearRule,
)
from app.modules.paye_payroll.pdf_export import build_monthly_paye_payslip_pdf
from app.modules.paye_payroll.rules import SOURCE_NOTE, SUPPORTED_TAX_YEAR, paye_rules_2026_2027
from app.modules.paye_payroll.schemas import (
    CompanyPayeSettingsPatchRequest,
    CompanyPayeSettingsResponse,
    EmployeePayePayHistoryEntry,
    EmployeePayeSettingsPatchRequest,
    EmployeePayeSettingsResponse,
    PayeCapabilitiesResponse,
    PayeCapabilityCategoryResponse,
    PayeCapabilityResponse,
    MonthlyPayeItemResponse,
    MonthlyPayePeriodResponse,
    MonthlyPayeReportResponse,
    MonthlyPayeReportShellResponse,
    MonthlyPayeReportShellRow,
    MonthlyPayeSummaryResponse,
    PayePayComponentCreateRequest,
    PayePayComponentPatchRequest,
    PayePayComponentResponse,
)


class PayePayrollPermissionError(ValueError):
    pass


class PayePayrollNotFoundError(ValueError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _trim_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _resolve_company_id(actor: User, company_id: uuid.UUID | None) -> uuid.UUID:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if company_id is None:
            raise PayePayrollPermissionError("Select a company.")
        return company_id
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise PayePayrollPermissionError("Your account is not linked to a company.")
        if company_id is not None and company_id != actor.company_id:
            raise PayePayrollPermissionError("You cannot manage PAYE payroll for another company.")
        return actor.company_id
    raise PayePayrollPermissionError("PAYE payroll management requires Admin or Administrator.")


def _assert_company_exists(db_session: Session, company_id: uuid.UUID) -> None:
    if get_company_by_id(db_session, company_id) is None:
        raise PayePayrollNotFoundError("Company not found.")


def _target_employee_for_actor(db_session: Session, actor: User, user_id: uuid.UUID) -> User:
    target = get_user_by_id(db_session, user_id)
    if target is None or target.system_role != SystemRole.EMPLOYEE:
        raise PayePayrollNotFoundError("Employee not found.")
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return target
    if actor.system_role == SystemRole.ADMIN and can_manage_user(actor, target):
        return target
    raise PayePayrollPermissionError("You cannot manage PAYE settings for this employee.")


def _get_employee_settings(db_session: Session, user_id: uuid.UUID) -> EmployeePayeSettings | None:
    return db_session.get(EmployeePayeSettings, user_id)


def _get_or_create_employee_settings(db_session: Session, target: User) -> EmployeePayeSettings:
    if target.company_id is None:
        raise PayePayrollPermissionError("Employee must be linked to a company for PAYE settings.")
    row = _get_employee_settings(db_session, target.id)
    if row is not None:
        if row.company_id != target.company_id:
            row.company_id = target.company_id
        return row
    now = _now()
    row = EmployeePayeSettings(
        user_id=target.id,
        company_id=target.company_id,
        pay_frequency="monthly",
        salary_type="hourly",
        tax_basis="cumulative",
        student_loan_plan="none",
        postgraduate_loan=False,
        pension_enrolment_status="not_eligible",
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="relief_at_source",
        created_at=now,
        updated_at=now,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def read_employee_paye_settings(
    db_session: Session,
    actor: User,
    user_id: uuid.UUID,
) -> EmployeePayeSettingsResponse:
    target = _target_employee_for_actor(db_session, actor, user_id)
    row = _get_or_create_employee_settings(db_session, target)
    return EmployeePayeSettingsResponse.model_validate(row)


def patch_employee_paye_settings(
    db_session: Session,
    actor: User,
    user_id: uuid.UUID,
    request: EmployeePayeSettingsPatchRequest,
) -> EmployeePayeSettingsResponse:
    target = _target_employee_for_actor(db_session, actor, user_id)
    row = _get_or_create_employee_settings(db_session, target)
    data = request.model_dump(exclude_unset=True)
    for field, value in data.items():
        if field in {"tax_code", "ni_category"}:
            value = _trim_or_none(value)
        setattr(row, field, value)
    row.updated_at = _now()
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return EmployeePayeSettingsResponse.model_validate(row)


def _get_company_settings(db_session: Session, company_id: uuid.UUID) -> CompanyPayeSettings | None:
    return db_session.get(CompanyPayeSettings, company_id)


def _get_or_create_company_settings(db_session: Session, company_id: uuid.UUID) -> CompanyPayeSettings:
    _assert_company_exists(db_session, company_id)
    row = _get_company_settings(db_session, company_id)
    if row is not None:
        return row
    now = _now()
    row = CompanyPayeSettings(
        company_id=company_id,
        default_pension_basis="qualifying_earnings",
        rti_status="not_ready",
        created_at=now,
        updated_at=now,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def read_company_paye_settings(
    db_session: Session,
    actor: User,
    company_id: uuid.UUID | None,
) -> CompanyPayeSettingsResponse:
    cid = _resolve_company_id(actor, company_id)
    row = _get_or_create_company_settings(db_session, cid)
    return CompanyPayeSettingsResponse.model_validate(row)


def patch_company_paye_settings(
    db_session: Session,
    actor: User,
    request: CompanyPayeSettingsPatchRequest,
) -> CompanyPayeSettingsResponse:
    cid = _resolve_company_id(actor, request.company_id)
    row = _get_or_create_company_settings(db_session, cid)
    data = request.model_dump(exclude_unset=True, exclude={"company_id"})
    for field, value in data.items():
        if field in {
            "paye_reference",
            "accounts_office_reference",
            "pension_provider_name",
            "monthly_payday_rule",
            "default_tax_year",
        }:
            value = _trim_or_none(value)
        setattr(row, field, value)
    row.updated_at = _now()
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return CompanyPayeSettingsResponse.model_validate(row)


def read_paye_capabilities(actor: User) -> PayeCapabilitiesResponse:
    if actor.system_role not in (SystemRole.ADMINISTRATOR, SystemRole.ADMIN):
        raise PayePayrollPermissionError("PAYE capability coverage requires Admin or Administrator.")
    grouped: dict[str, list[PayeCapabilityResponse]] = {}
    for capability in list_paye_capabilities():
        grouped.setdefault(capability.category, []).append(
            PayeCapabilityResponse(
                key=capability.key,
                name=capability.name,
                category=capability.category,
                status=capability.status,  # type: ignore[arg-type]
                tax_years_supported=list(capability.tax_years_supported),
                source_note=capability.source_note,
                description=capability.description,
                unsupported_message=capability.unsupported_message,
            ),
        )
    return PayeCapabilitiesResponse(
        tax_year=SUPPORTED_TAX_YEAR,
        categories=[
            PayeCapabilityCategoryResponse(category=category, capabilities=capabilities)
            for category, capabilities in grouped.items()
        ],
    )


def _display_name(profile: EmployeeProfile | None) -> str | None:
    if profile is None:
        return None
    value = " ".join(part for part in [profile.first_name, profile.last_name] if part).strip()
    return value or None


def monthly_paye_report_shell(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    year: int,
    month: int,
    employee_user_id: uuid.UUID | None,
) -> MonthlyPayeReportShellResponse:
    cid = _resolve_company_id(actor, company_id)
    company_settings = _get_or_create_company_settings(db_session, cid)
    stmt = (
        select(User, EmployeeProfile, EmployeePayeSettings)
        .outerjoin(EmployeeProfile, EmployeeProfile.user_id == User.id)
        .outerjoin(EmployeePayeSettings, EmployeePayeSettings.user_id == User.id)
        .where(User.company_id == cid)
        .where(User.system_role == SystemRole.EMPLOYEE)
        .where(User.is_active.is_(True))
        .order_by(User.email.asc())
    )
    if employee_user_id is not None:
        stmt = stmt.where(User.id == employee_user_id)
    rows = []
    for user, profile, paye_settings in db_session.execute(stmt).all():
        payroll_type = getattr(profile, "payroll_type", None) or "cis_subcontractor"
        rows.append(
            MonthlyPayeReportShellRow(
                user_id=user.id,
                employee_email=user.email,
                employee_name=_display_name(profile),
                payroll_type=payroll_type,
                tax_code=getattr(paye_settings, "tax_code", None),
                ni_category=getattr(paye_settings, "ni_category", None),
                status="not_calculated",
            ),
        )
    return MonthlyPayeReportShellResponse(
        company_id=cid,
        year=year,
        month=month,
        calculation_enabled=False,
        message="PAYE calculation engine is not enabled yet. Configure employee and company PAYE settings first.",
        company_settings_configured=bool(
            company_settings.paye_reference
            or company_settings.accounts_office_reference
            or company_settings.pension_provider_name
        ),
        rows=rows,
    )


def _assert_supported_tax_year(tax_year: str) -> None:
    if tax_year != SUPPORTED_TAX_YEAR:
        raise PayePayrollPermissionError("Only tax year 2026-2027 is supported in Phase 2A.")


def _ensure_tax_year_rule(db_session: Session, tax_year: str) -> PayeTaxYearRule:
    _assert_supported_tax_year(tax_year)
    row = paye_repo.get_tax_year_rule(db_session, tax_year)
    if row is not None and row.rules_json:
        return row
    now = _now()
    if row is None:
        row = PayeTaxYearRule(tax_year=tax_year, created_at=now, updated_at=now)
    row.rules_json = paye_rules_2026_2027()
    row.source_note = SOURCE_NOTE
    row.updated_at = now
    paye_repo.save_tax_year_rule(db_session, row)
    return row


def _company_settings_configured(settings: CompanyPayeSettings | None) -> bool:
    return bool(
        settings
        and (
            settings.paye_reference
            or settings.accounts_office_reference
            or settings.pension_provider_name
            or settings.default_employee_pension_percent is not None
            or settings.default_employer_pension_percent is not None
        )
    )


def _period_for_tax_month(
    *,
    company_id: uuid.UUID,
    tax_year: str,
    tax_month: int,
    actor_id: uuid.UUID | None,
) -> MonthlyPayePeriod:
    period_start, period_end = tax_month_bounds(tax_year, tax_month)
    now = _now()
    return MonthlyPayePeriod(
        company_id=company_id,
        tax_year=tax_year,
        tax_month=tax_month,
        period_start=period_start,
        period_end=period_end,
        pay_date=period_end,
        status="pending",
        calculated_at=now,
        calculated_by_user_id=actor_id,
        created_at=now,
        updated_at=now,
    )


def _decimal_field(obj: object, field: str) -> Decimal:
    return amount(getattr(obj, field, None))


def _sum_prior(prior_items: list[MonthlyPayeItem], field: str) -> Decimal:
    total = Decimal("0.00")
    for item in prior_items:
        if getattr(item, "unsupported_reason", None):
            continue
        total += _decimal_field(item, field)
    return money(total)


def _assign_ytd(item: MonthlyPayeItem, prior_items: list[MonthlyPayeItem]) -> None:
    if item.unsupported_reason:
        return
    item.ytd_gross_pay = money(_sum_prior(prior_items, "gross_pay") + _decimal_field(item, "gross_pay"))
    item.ytd_taxable_pay = money(_sum_prior(prior_items, "taxable_pay") + _decimal_field(item, "taxable_pay"))
    item.ytd_paye_tax = money(_sum_prior(prior_items, "paye_tax") + _decimal_field(item, "paye_tax"))
    item.ytd_employee_ni = money(_sum_prior(prior_items, "employee_ni") + _decimal_field(item, "employee_ni"))
    item.ytd_employer_ni = money(_sum_prior(prior_items, "employer_ni") + _decimal_field(item, "employer_ni"))
    item.ytd_employee_pension = money(
        _sum_prior(prior_items, "employee_pension") + _decimal_field(item, "employee_pension")
    )
    item.ytd_employer_pension = money(
        _sum_prior(prior_items, "employer_pension") + _decimal_field(item, "employer_pension")
    )
    item.ytd_student_loan = money(_sum_prior(prior_items, "student_loan") + _decimal_field(item, "student_loan"))
    item.ytd_postgraduate_loan = money(
        _sum_prior(prior_items, "postgraduate_loan_deduction") + _decimal_field(item, "postgraduate_loan_deduction")
    )
    item.ytd_net_pay = money(_sum_prior(prior_items, "net_pay") + _decimal_field(item, "net_pay"))


def _employee_item_response(
    db_session: Session,
    item: MonthlyPayeItem,
) -> MonthlyPayeItemResponse:
    user = get_user_by_id(db_session, item.user_id)
    profile = get_employee_profile_by_user_id(db_session, item.user_id)
    return MonthlyPayeItemResponse(
        id=item.id,
        period_id=item.period_id,
        company_id=item.company_id,
        user_id=item.user_id,
        employee_email=user.email if user is not None else None,
        employee_name=_display_name(profile),
        payroll_type=item.payroll_type,
        pay_frequency=item.pay_frequency,
        salary_type=item.salary_type,
        monthly_salary=item.monthly_salary,
        tax_code=item.tax_code,
        tax_basis=item.tax_basis,
        ni_category=item.ni_category,
        student_loan_plan=item.student_loan_plan,
        postgraduate_loan=item.postgraduate_loan,
        pension_enrolment_status=item.pension_enrolment_status,
        employee_pension_percent=item.employee_pension_percent,
        employer_pension_percent=item.employer_pension_percent,
        pension_scheme_basis=item.pension_scheme_basis,
        pension_relief_method=item.pension_relief_method,
        bonus_pay=_decimal_field(item, "bonus_pay"),
        commission_pay=_decimal_field(item, "commission_pay"),
        component_pay=_decimal_field(item, "component_pay"),
        gross_pay=item.gross_pay,
        taxable_pay=item.taxable_pay,
        niable_pay=item.niable_pay,
        pensionable_pay=item.pensionable_pay,
        paye_tax=item.paye_tax,
        employee_ni=item.employee_ni,
        employer_ni=item.employer_ni,
        employee_pension=item.employee_pension,
        employer_pension=item.employer_pension,
        student_loan=item.student_loan,
        postgraduate_loan_deduction=item.postgraduate_loan_deduction,
        other_deductions=item.other_deductions,
        additions=item.additions,
        total_deductions=item.total_deductions,
        net_pay=item.net_pay,
        ytd_gross_pay=item.ytd_gross_pay,
        ytd_taxable_pay=item.ytd_taxable_pay,
        ytd_paye_tax=item.ytd_paye_tax,
        ytd_employee_ni=item.ytd_employee_ni,
        ytd_employer_ni=item.ytd_employer_ni,
        ytd_employee_pension=item.ytd_employee_pension,
        ytd_employer_pension=item.ytd_employer_pension,
        ytd_student_loan=item.ytd_student_loan,
        ytd_postgraduate_loan=item.ytd_postgraduate_loan,
        ytd_net_pay=item.ytd_net_pay,
        status=item.status,
        approved_at=item.approved_at,
        approved_by_user_id=item.approved_by_user_id,
        paid_at=item.paid_at,
        paid_by_user_id=item.paid_by_user_id,
        component_snapshot=item.component_snapshot or [],
        calculation_snapshot=item.calculation_snapshot or {},
        unsupported_reason=item.unsupported_reason,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _summary(items: list[MonthlyPayeItem]) -> MonthlyPayeSummaryResponse:
    supported = [item for item in items if not item.unsupported_reason]
    return MonthlyPayeSummaryResponse(
        employees=len(supported),
        total_gross=money(sum((_decimal_field(item, "gross_pay") for item in supported), Decimal("0.00"))),
        bonus_pay=money(sum((_decimal_field(item, "bonus_pay") for item in supported), Decimal("0.00"))),
        commission_pay=money(sum((_decimal_field(item, "commission_pay") for item in supported), Decimal("0.00"))),
        component_pay=money(sum((_decimal_field(item, "component_pay") for item in supported), Decimal("0.00"))),
        taxable_pay=money(sum((_decimal_field(item, "taxable_pay") for item in supported), Decimal("0.00"))),
        paye_tax=money(sum((_decimal_field(item, "paye_tax") for item in supported), Decimal("0.00"))),
        employee_ni=money(sum((_decimal_field(item, "employee_ni") for item in supported), Decimal("0.00"))),
        employer_ni=money(sum((_decimal_field(item, "employer_ni") for item in supported), Decimal("0.00"))),
        employee_pension=money(sum((_decimal_field(item, "employee_pension") for item in supported), Decimal("0.00"))),
        employer_pension=money(sum((_decimal_field(item, "employer_pension") for item in supported), Decimal("0.00"))),
        student_loans=money(sum((_decimal_field(item, "student_loan") for item in supported), Decimal("0.00"))),
        postgraduate_loans=money(
            sum((_decimal_field(item, "postgraduate_loan_deduction") for item in supported), Decimal("0.00"))
        ),
        total_deductions=money(sum((_decimal_field(item, "total_deductions") for item in supported), Decimal("0.00"))),
        net_pay=money(sum((_decimal_field(item, "net_pay") for item in supported), Decimal("0.00"))),
        unsupported_count=len(items) - len(supported),
    )


def monthly_paye_report(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    tax_year: str,
    tax_month: int,
    employee_id: uuid.UUID | None,
) -> MonthlyPayeReportResponse:
    _assert_supported_tax_year(tax_year)
    cid = _resolve_company_id(actor, company_id)
    period = paye_repo.get_monthly_period(db_session, company_id=cid, tax_year=tax_year, tax_month=tax_month)
    settings = _get_or_create_company_settings(db_session, cid)
    if period is None:
        return MonthlyPayeReportResponse(
            company_id=cid,
            tax_year=tax_year,
            tax_month=tax_month,
            message="No Monthly PAYE calculation has been run for this tax month yet.",
            company_settings_configured=_company_settings_configured(settings),
            period=None,
            rows=[],
            summary=_summary([]),
        )
    items = paye_repo.list_items_for_period(db_session, period.id)
    if employee_id is not None:
        items = [item for item in items if item.user_id == employee_id]
    return MonthlyPayeReportResponse(
        company_id=cid,
        tax_year=tax_year,
        tax_month=tax_month,
        message="Monthly PAYE report loaded.",
        company_settings_configured=_company_settings_configured(settings),
        period=MonthlyPayePeriodResponse.model_validate(period),
        rows=[_employee_item_response(db_session, item) for item in items],
        summary=_summary(items),
    )


PAYE_PAYSLIP_REQUIRED_FIELDS = (
    "gross_pay",
    "taxable_pay",
    "paye_tax",
    "employee_ni",
    "employer_ni",
    "employee_pension",
    "employer_pension",
    "student_loan",
    "postgraduate_loan_deduction",
    "other_deductions",
    "total_deductions",
    "net_pay",
    "ytd_gross_pay",
    "ytd_taxable_pay",
    "ytd_paye_tax",
    "ytd_employee_ni",
    "ytd_employee_pension",
    "ytd_student_loan",
    "ytd_postgraduate_loan",
    "ytd_net_pay",
)


def _assert_paye_payslip_eligible(item: MonthlyPayeItem, period: MonthlyPayePeriod | None) -> MonthlyPayePeriod:
    if period is None:
        raise PayePayrollNotFoundError("Monthly PAYE period not found.")
    if item.status not in {"approved", "paid"}:
        raise PayePayrollPermissionError("PAYE payslips are available only for approved or paid items.")
    if item.unsupported_reason:
        raise PayePayrollPermissionError("PAYE payslips are not available for unsupported rows.")
    missing = [field for field in PAYE_PAYSLIP_REQUIRED_FIELDS if getattr(item, field, None) is None]
    if missing:
        raise PayePayrollPermissionError("PAYE payslip is missing calculated values.")
    return period


def _paye_payslip_context_for_item(
    db_session: Session,
    item: MonthlyPayeItem,
    period: MonthlyPayePeriod,
) -> tuple[MonthlyPayeItem, MonthlyPayePeriod, User, EmployeeProfile | None, str]:
    owner = get_user_by_id(db_session, item.user_id)
    if owner is None:
        raise PayePayrollNotFoundError("Employee not found.")
    profile = get_employee_profile_by_user_id(db_session, item.user_id)
    company = get_company_by_id(db_session, item.company_id)
    return item, period, owner, profile, company.name if company is not None else "Company"


def _load_paye_payslip_context(
    db_session: Session,
    actor: User,
    item_id: uuid.UUID,
) -> tuple[MonthlyPayeItem, MonthlyPayePeriod, User, EmployeeProfile | None, str]:
    if actor.system_role not in (SystemRole.ADMINISTRATOR, SystemRole.ADMIN):
        raise PayePayrollPermissionError("PAYE payslips are available to Admin or Administrator only.")
    item = paye_repo.get_monthly_item_by_id(db_session, item_id)
    if item is None:
        raise PayePayrollNotFoundError("Monthly PAYE item not found.")
    period = _assert_paye_payslip_eligible(item, paye_repo.get_monthly_period_by_id(db_session, item.period_id))
    _resolve_company_id(actor, item.company_id)
    return _paye_payslip_context_for_item(db_session, item, period)


def _load_own_paye_payslip_context(
    db_session: Session,
    actor: User,
    item_id: uuid.UUID,
) -> tuple[MonthlyPayeItem, MonthlyPayePeriod, User, EmployeeProfile | None, str]:
    item = paye_repo.get_monthly_item_by_id(db_session, item_id)
    if item is None:
        raise PayePayrollNotFoundError("Monthly PAYE item not found.")
    if item.user_id != actor.id:
        raise PayePayrollPermissionError("You can only view your own PAYE payslips.")
    period = _assert_paye_payslip_eligible(item, paye_repo.get_monthly_period_by_id(db_session, item.period_id))
    return _paye_payslip_context_for_item(db_session, item, period)


def _paye_employee_name(profile: EmployeeProfile | None, owner: User) -> str:
    display = _display_name(profile)
    return display or owner.email


def _money_html(value: object | None) -> str:
    if value is None:
        return "-"
    return f"GBP {Decimal(str(value)):,.2f}"


def _paye_period_label(period: MonthlyPayePeriod) -> str:
    return f"{period.period_start.isoformat()} to {period.period_end.isoformat()}"


def _paye_payslip_values(item: MonthlyPayeItem) -> dict[str, Decimal | None]:
    return {
        "gross_pay": _decimal_field(item, "gross_pay"),
        "bonus_pay": _decimal_field(item, "bonus_pay"),
        "commission_pay": _decimal_field(item, "commission_pay"),
        "component_pay": _decimal_field(item, "component_pay"),
        "taxable_pay": _decimal_field(item, "taxable_pay"),
        "paye_tax": _decimal_field(item, "paye_tax"),
        "employee_ni": _decimal_field(item, "employee_ni"),
        "employer_ni": _decimal_field(item, "employer_ni"),
        "employee_pension": _decimal_field(item, "employee_pension"),
        "employer_pension": _decimal_field(item, "employer_pension"),
        "student_loan": _decimal_field(item, "student_loan"),
        "postgraduate_loan": _decimal_field(item, "postgraduate_loan_deduction"),
        "other_deductions": _decimal_field(item, "other_deductions"),
        "net_pay": _decimal_field(item, "net_pay"),
        "ytd_gross_pay": _decimal_field(item, "ytd_gross_pay"),
        "ytd_taxable_pay": _decimal_field(item, "ytd_taxable_pay"),
        "ytd_paye_tax": _decimal_field(item, "ytd_paye_tax"),
        "ytd_employee_ni": _decimal_field(item, "ytd_employee_ni"),
        "ytd_employee_pension": _decimal_field(item, "ytd_employee_pension"),
        "ytd_student_loan": _decimal_field(item, "ytd_student_loan"),
        "ytd_postgraduate_loan": _decimal_field(item, "ytd_postgraduate_loan"),
        "ytd_net_pay": _decimal_field(item, "ytd_net_pay"),
    }


def _has_required_paye_payslip_values(item: MonthlyPayeItem) -> bool:
    return all(getattr(item, field, None) is not None for field in PAYE_PAYSLIP_REQUIRED_FIELDS)


def list_my_paye_pay_history(db_session: Session, actor: User) -> list[EmployeePayePayHistoryEntry]:
    rows = paye_repo.list_employee_paye_pay_history(db_session, user_id=actor.id)
    result: list[EmployeePayePayHistoryEntry] = []
    company_names: dict[uuid.UUID, str] = {}
    for item, period in rows:
        if item.status not in {"approved", "paid"} or item.unsupported_reason:
            continue
        if not _has_required_paye_payslip_values(item):
            continue
        if item.company_id not in company_names:
            company = get_company_by_id(db_session, item.company_id)
            company_names[item.company_id] = company.name if company is not None else "Company"
        result.append(
            EmployeePayePayHistoryEntry(
                id=item.id,
                period_id=period.id,
                company_id=item.company_id,
                company_name=company_names[item.company_id],
                tax_year=period.tax_year,
                tax_month=period.tax_month,
                period_start=period.period_start,
                period_end=period.period_end,
                pay_date=period.pay_date,
                gross_pay=_decimal_field(item, "gross_pay"),
                paye_tax=_decimal_field(item, "paye_tax"),
                employee_ni=_decimal_field(item, "employee_ni"),
                employee_pension=_decimal_field(item, "employee_pension"),
                student_loan=_decimal_field(item, "student_loan"),
                postgraduate_loan_deduction=_decimal_field(item, "postgraduate_loan_deduction"),
                net_pay=_decimal_field(item, "net_pay"),
                status=item.status,
            )
        )
    return result


def render_monthly_paye_payslip_html(db_session: Session, actor: User, item_id: uuid.UUID) -> str:
    item, period, owner, profile, company_name = _load_paye_payslip_context(db_session, actor, item_id)
    values = _paye_payslip_values(item)
    employee_name = _paye_employee_name(profile, owner)
    generated = _now().strftime("%Y-%m-%d %H:%M UTC")
    ni_number = (profile.national_insurance_number or "").strip() if profile is not None else ""
    status = "Paid" if item.status == "paid" else "Approved"
    ytd_loans = (values["ytd_student_loan"] or Decimal(0)) + (values["ytd_postgraduate_loan"] or Decimal(0))

    def row(label: str, value: str) -> str:
        return f"<div class=\"row\"><span>{html.escape(label)}</span><strong>{html.escape(value)}</strong></div>"

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Monthly PAYE Payslip</title>
<style>
body {{ margin: 0; background: #f4f6f8; color: #111827; font-family: Arial, sans-serif; }}
.wrap {{ max-width: 920px; margin: 0 auto; padding: 18px; }}
.actions {{ display: flex; justify-content: space-between; margin-bottom: 12px; }}
button {{ border: 1px solid #cbd5e1; background: white; padding: 8px 12px; border-radius: 8px; cursor: pointer; }}
.card {{ background: #fff; border: 1px solid #d9e0ea; border-radius: 16px; padding: 28px; box-shadow: 0 16px 34px rgba(15,23,42,.08); }}
.head {{ display: grid; grid-template-columns: 1fr 1fr; gap: 18px; border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; }}
.right {{ text-align: right; }}
.company {{ font-size: 20px; font-weight: 800; }}
.doc {{ font-size: 22px; font-weight: 800; }}
.muted {{ color: #64748b; font-size: 12px; }}
.grid {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 18px; }}
.section {{ border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; }}
h2 {{ color: #2f6f9e; font-size: 13px; margin: 0 0 10px; text-transform: uppercase; letter-spacing: .04em; }}
.row {{ display: flex; justify-content: space-between; gap: 16px; border-top: 1px solid #f1f5f9; padding: 8px 0; font-size: 14px; }}
.row:first-of-type {{ border-top: 0; }}
.net {{ background: #f8fafc; border-color: #cbd5e1; }}
@media print {{ .actions {{ display:none; }} body {{ background:white; }} .card {{ box-shadow:none; border:0; }} }}
</style></head><body>
<div class="wrap">
  <div class="actions">
    <button onclick="window.history.back()" type="button">Back</button>
    <button onclick="window.print()" type="button">Save / Print Payslip</button>
  </div>
  <main class="card">
    <header class="head">
      <div>
        <div class="company">{html.escape(company_name)}</div>
        <p class="muted">Company</p>
        <h1>{html.escape(employee_name)}</h1>
        <p class="muted">{html.escape(owner.email)}</p>
        <p class="muted">National Insurance: {html.escape(ni_number or "Not provided")}</p>
      </div>
      <div class="right">
        <div class="doc">Monthly PAYE Payslip</div>
        <p>{html.escape(_paye_period_label(period))}</p>
        <p class="muted">Pay date: {html.escape(period.pay_date.isoformat())}</p>
        <p class="muted">Generated: {html.escape(generated)}</p>
      </div>
    </header>
    <section class="grid">
      <div class="section">
        <h2>Payroll details</h2>
        {row("Status", status)}
        {row("Tax code", item.tax_code or "Not provided")}
        {row("NI category", item.ni_category or "Not provided")}
        {row("Pay period", _paye_period_label(period))}
        {row("Pay date", period.pay_date.isoformat())}
      </div>
      <div class="section net">
        <h2>Net pay</h2>
        {row("Gross pay", _money_html(values["gross_pay"]))}
        {row("Total deductions", _money_html(_decimal_field(item, "total_deductions")))}
        {row("Net pay", _money_html(values["net_pay"]))}
      </div>
      <div class="section">
        <h2>Pay and deductions</h2>
        {row("Taxable pay", _money_html(values["taxable_pay"]))}
        {row("Bonus pay", _money_html(values["bonus_pay"]))}
        {row("Commission pay", _money_html(values["commission_pay"]))}
        {row("Total additional pay", _money_html(values["component_pay"]))}
        {row("PAYE tax", _money_html(values["paye_tax"]))}
        {row("Employee NI", _money_html(values["employee_ni"]))}
        {row("Employee pension contribution", _money_html(values["employee_pension"]))}
        {row("Student loan deduction", _money_html(values["student_loan"]))}
        {row("Postgraduate loan deduction", _money_html(values["postgraduate_loan"]))}
        {row("Other deductions", _money_html(values["other_deductions"]))}
      </div>
      <div class="section">
        <h2>Year to date</h2>
        {row("YTD gross pay", _money_html(values["ytd_gross_pay"]))}
        {row("YTD taxable pay", _money_html(values["ytd_taxable_pay"]))}
        {row("YTD PAYE tax", _money_html(values["ytd_paye_tax"]))}
        {row("YTD employee NI", _money_html(values["ytd_employee_ni"]))}
        {row("YTD employee pension", _money_html(values["ytd_employee_pension"]))}
        {row("YTD student/postgraduate loan", _money_html(ytd_loans))}
        {row("YTD net pay", _money_html(values["ytd_net_pay"]))}
      </div>
      <div class="section">
        <h2>Employer information (employer cost only)</h2>
        {row("Employer pension contribution", _money_html(_decimal_field(item, "employer_pension")))}
        {row("Employer NI", _money_html(_decimal_field(item, "employer_ni")))}
      </div>
    </section>
  </main>
</div></body></html>"""


def render_monthly_paye_payslip_pdf(db_session: Session, actor: User, item_id: uuid.UUID) -> tuple[bytes, str]:
    item, period, owner, profile, company_name = _load_paye_payslip_context(db_session, actor, item_id)
    employee_name = _paye_employee_name(profile, owner)
    ni_number = (profile.national_insurance_number or "").strip() if profile is not None else None
    values = _paye_payslip_values(item)
    body = build_monthly_paye_payslip_pdf(
        company_name=company_name,
        employee_name=employee_name,
        employee_email=owner.email,
        national_insurance_number=ni_number,
        tax_code=item.tax_code,
        ni_category=item.ni_category,
        pay_period=_paye_period_label(period),
        pay_date=period.pay_date,
        generated_at=_now().strftime("%Y-%m-%d %H:%M UTC"),
        status_label="Paid" if item.status == "paid" else "Approved",
        values=values,
    )
    return body, f"timiq-paye-payslip-{period.tax_year}-month-{period.tax_month:02d}.pdf"


def render_own_monthly_paye_payslip_html(db_session: Session, actor: User, item_id: uuid.UUID) -> str:
    item, period, owner, profile, company_name = _load_own_paye_payslip_context(db_session, actor, item_id)
    values = _paye_payslip_values(item)
    employee_name = _paye_employee_name(profile, owner)
    generated = _now().strftime("%Y-%m-%d %H:%M UTC")
    ni_number = (profile.national_insurance_number or "").strip() if profile is not None else ""
    status = "Paid" if item.status == "paid" else "Approved"
    ytd_loans = (values["ytd_student_loan"] or Decimal(0)) + (values["ytd_postgraduate_loan"] or Decimal(0))

    def row(label: str, value: str) -> str:
        return f"<div class=\"row\"><span>{html.escape(label)}</span><strong>{html.escape(value)}</strong></div>"

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Monthly PAYE Payslip</title>
<style>
body {{ margin: 0; background: #f4f6f8; color: #111827; font-family: Arial, sans-serif; }}
.wrap {{ max-width: 920px; margin: 0 auto; padding: 18px; }}
.actions {{ display: flex; justify-content: space-between; margin-bottom: 12px; }}
button {{ border: 1px solid #cbd5e1; background: white; padding: 8px 12px; border-radius: 8px; cursor: pointer; }}
.card {{ background: #fff; border: 1px solid #d9e0ea; border-radius: 16px; padding: 28px; box-shadow: 0 16px 34px rgba(15,23,42,.08); }}
.head {{ display: grid; grid-template-columns: 1fr 1fr; gap: 18px; border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; }}
.right {{ text-align: right; }}
.company {{ font-size: 20px; font-weight: 800; }}
.doc {{ font-size: 22px; font-weight: 800; }}
.muted {{ color: #64748b; font-size: 12px; }}
.grid {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 18px; }}
.section {{ border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; }}
h2 {{ color: #2f6f9e; font-size: 13px; margin: 0 0 10px; text-transform: uppercase; letter-spacing: .04em; }}
.row {{ display: flex; justify-content: space-between; gap: 16px; border-top: 1px solid #f1f5f9; padding: 8px 0; font-size: 14px; }}
.row:first-of-type {{ border-top: 0; }}
.net {{ background: #f8fafc; border-color: #cbd5e1; }}
@media print {{ .actions {{ display:none; }} body {{ background:white; }} .card {{ box-shadow:none; border:0; }} }}
</style></head><body>
<div class="wrap">
  <div class="actions">
    <button onclick="window.history.back()" type="button">Back</button>
    <button onclick="window.print()" type="button">Save / Print Payslip</button>
  </div>
  <main class="card">
    <header class="head">
      <div>
        <div class="company">{html.escape(company_name)}</div>
        <p class="muted">Company</p>
        <h1>{html.escape(employee_name)}</h1>
        <p class="muted">{html.escape(owner.email)}</p>
        <p class="muted">National Insurance: {html.escape(ni_number or "Not provided")}</p>
      </div>
      <div class="right">
        <div class="doc">Monthly PAYE Payslip</div>
        <p>{html.escape(_paye_period_label(period))}</p>
        <p class="muted">Pay date: {html.escape(period.pay_date.isoformat())}</p>
        <p class="muted">Generated: {html.escape(generated)}</p>
      </div>
    </header>
    <section class="grid">
      <div class="section">
        <h2>Payroll details</h2>
        {row("Status", status)}
        {row("Tax code", item.tax_code or "Not provided")}
        {row("NI category", item.ni_category or "Not provided")}
        {row("Pay period", _paye_period_label(period))}
        {row("Pay date", period.pay_date.isoformat())}
      </div>
      <div class="section net">
        <h2>Net pay</h2>
        {row("Gross pay", _money_html(values["gross_pay"]))}
        {row("Total deductions", _money_html(_decimal_field(item, "total_deductions")))}
        {row("Net pay", _money_html(values["net_pay"]))}
      </div>
      <div class="section">
        <h2>Pay and deductions</h2>
        {row("Taxable pay", _money_html(values["taxable_pay"]))}
        {row("Bonus pay", _money_html(values["bonus_pay"]))}
        {row("Commission pay", _money_html(values["commission_pay"]))}
        {row("Total additional pay", _money_html(values["component_pay"]))}
        {row("PAYE tax", _money_html(values["paye_tax"]))}
        {row("Employee NI", _money_html(values["employee_ni"]))}
        {row("Employee pension contribution", _money_html(values["employee_pension"]))}
        {row("Student loan deduction", _money_html(values["student_loan"]))}
        {row("Postgraduate loan deduction", _money_html(values["postgraduate_loan"]))}
        {row("Other deductions", _money_html(values["other_deductions"]))}
      </div>
      <div class="section">
        <h2>Year to date</h2>
        {row("YTD gross pay", _money_html(values["ytd_gross_pay"]))}
        {row("YTD taxable pay", _money_html(values["ytd_taxable_pay"]))}
        {row("YTD PAYE tax", _money_html(values["ytd_paye_tax"]))}
        {row("YTD employee NI", _money_html(values["ytd_employee_ni"]))}
        {row("YTD employee pension", _money_html(values["ytd_employee_pension"]))}
        {row("YTD student/postgraduate loan", _money_html(ytd_loans))}
        {row("YTD net pay", _money_html(values["ytd_net_pay"]))}
      </div>
      <div class="section">
        <h2>Employer information (employer cost only)</h2>
        {row("Employer pension contribution", _money_html(_decimal_field(item, "employer_pension")))}
        {row("Employer NI", _money_html(_decimal_field(item, "employer_ni")))}
      </div>
    </section>
  </main>
</div></body></html>"""


def render_own_monthly_paye_payslip_pdf(db_session: Session, actor: User, item_id: uuid.UUID) -> tuple[bytes, str]:
    item, period, owner, profile, company_name = _load_own_paye_payslip_context(db_session, actor, item_id)
    employee_name = _paye_employee_name(profile, owner)
    ni_number = (profile.national_insurance_number or "").strip() if profile is not None else None
    values = _paye_payslip_values(item)
    body = build_monthly_paye_payslip_pdf(
        company_name=company_name,
        employee_name=employee_name,
        employee_email=owner.email,
        national_insurance_number=ni_number,
        tax_code=item.tax_code,
        ni_category=item.ni_category,
        pay_period=_paye_period_label(period),
        pay_date=period.pay_date,
        generated_at=_now().strftime("%Y-%m-%d %H:%M UTC"),
        status_label="Paid" if item.status == "paid" else "Approved",
        values=values,
    )
    return body, f"timiq-paye-payslip-{period.tax_year}-month-{period.tax_month:02d}.pdf"


def _unsupported_item(
    *,
    period: MonthlyPayePeriod,
    user: User,
    profile: EmployeeProfile | None,
    settings: EmployeePayeSettings | None,
    reason: str,
) -> MonthlyPayeItem:
    now = _now()
    return MonthlyPayeItem(
        period_id=period.id,
        company_id=period.company_id,
        user_id=user.id,
        payroll_type=getattr(profile, "payroll_type", None) or "paye_employee",
        pay_frequency=getattr(settings, "pay_frequency", None) or "monthly",
        salary_type=getattr(settings, "salary_type", None) or "hourly",
        monthly_salary=getattr(settings, "monthly_salary", None),
        tax_code=getattr(settings, "tax_code", None),
        tax_basis=getattr(settings, "tax_basis", None) or "cumulative",
        ni_category=getattr(settings, "ni_category", None),
        student_loan_plan=getattr(settings, "student_loan_plan", None) or "none",
        postgraduate_loan=bool(getattr(settings, "postgraduate_loan", False)),
        pension_enrolment_status=getattr(settings, "pension_enrolment_status", None) or "not_eligible",
        employee_pension_percent=getattr(settings, "employee_pension_percent", None),
        employer_pension_percent=getattr(settings, "employer_pension_percent", None),
        pension_scheme_basis=getattr(settings, "pension_scheme_basis", None) or "qualifying_earnings",
        pension_relief_method=getattr(settings, "pension_relief_method", None) or "relief_at_source",
        other_deductions=Decimal("0.00"),
        additions=Decimal("0.00"),
        status="pending",
        calculation_snapshot={"phase": "2A", "supported": False, "reason": reason},
        unsupported_reason=reason,
        created_at=now,
        updated_at=now,
    )


def _component_response(component: MonthlyPayePayComponent) -> PayePayComponentResponse:
    return PayePayComponentResponse.model_validate(component)


def _assert_component_type(value: str) -> str:
    if value not in {"bonus", "commission"}:
        raise PayePayrollPermissionError("PAYE component type must be bonus or commission.")
    return value


def _component_period_locked(db_session: Session, *, company_id: uuid.UUID, tax_year: str, tax_month: int) -> bool:
    period = paye_repo.get_monthly_period(db_session, company_id=company_id, tax_year=tax_year, tax_month=tax_month)
    return bool(period is not None and period.status in {"approved", "paid"})


def _assert_components_unlocked(db_session: Session, *, company_id: uuid.UUID, tax_year: str, tax_month: int) -> None:
    if _component_period_locked(db_session, company_id=company_id, tax_year=tax_year, tax_month=tax_month):
        raise PayePayrollPermissionError("PAYE components are locked once the period is approved or paid.")


def _target_paye_employee_for_component(db_session: Session, actor: User, user_id: uuid.UUID, company_id: uuid.UUID) -> User:
    target = _target_employee_for_actor(db_session, actor, user_id)
    if target.company_id != company_id:
        raise PayePayrollPermissionError("PAYE component employee must belong to the selected company.")
    return target


def list_pay_components(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    tax_year: str,
    tax_month: int,
    user_id: uuid.UUID | None,
) -> list[PayePayComponentResponse]:
    _assert_supported_tax_year(tax_year)
    cid = _resolve_company_id(actor, company_id)
    rows = paye_repo.list_pay_components(db_session, company_id=cid, tax_year=tax_year, tax_month=tax_month, user_id=user_id)
    return [_component_response(row) for row in rows]


def create_pay_component(
    db_session: Session,
    actor: User,
    request: PayePayComponentCreateRequest,
) -> PayePayComponentResponse:
    _assert_supported_tax_year(request.tax_year)
    cid = _resolve_company_id(actor, request.company_id)
    _assert_components_unlocked(db_session, company_id=cid, tax_year=request.tax_year, tax_month=request.tax_month)
    _target_paye_employee_for_component(db_session, actor, request.user_id, cid)
    now = _now()
    period = paye_repo.get_monthly_period(db_session, company_id=cid, tax_year=request.tax_year, tax_month=request.tax_month)
    component = MonthlyPayePayComponent(
        company_id=cid,
        user_id=request.user_id,
        tax_year=request.tax_year,
        tax_month=request.tax_month,
        period_id=period.id if period is not None else None,
        component_type=_assert_component_type(request.component_type),
        description=_trim_or_none(request.description),
        amount=money(amount(request.amount)),
        taxable=request.taxable,
        niable=request.niable,
        pensionable=request.pensionable,
        created_by_user_id=actor.id,
        created_at=now,
        updated_at=now,
    )
    paye_repo.save_pay_component(db_session, component)
    db_session.commit()
    return _component_response(component)


def patch_pay_component(
    db_session: Session,
    actor: User,
    component_id: uuid.UUID,
    request: PayePayComponentPatchRequest,
) -> PayePayComponentResponse:
    component = paye_repo.get_pay_component_by_id(db_session, component_id)
    if component is None:
        raise PayePayrollNotFoundError("PAYE component not found.")
    _resolve_company_id(actor, component.company_id)
    _target_paye_employee_for_component(db_session, actor, component.user_id, component.company_id)
    _assert_components_unlocked(
        db_session,
        company_id=component.company_id,
        tax_year=component.tax_year,
        tax_month=component.tax_month,
    )
    if request.description is not None:
        component.description = _trim_or_none(request.description)
    if request.amount is not None:
        component.amount = money(amount(request.amount))
    if request.taxable is not None:
        component.taxable = request.taxable
    if request.niable is not None:
        component.niable = request.niable
    if request.pensionable is not None:
        component.pensionable = request.pensionable
    component.updated_at = _now()
    db_session.commit()
    return _component_response(component)


def delete_pay_component(db_session: Session, actor: User, component_id: uuid.UUID) -> None:
    component = paye_repo.get_pay_component_by_id(db_session, component_id)
    if component is None:
        raise PayePayrollNotFoundError("PAYE component not found.")
    _resolve_company_id(actor, component.company_id)
    _target_paye_employee_for_component(db_session, actor, component.user_id, component.company_id)
    _assert_components_unlocked(
        db_session,
        company_id=component.company_id,
        tax_year=component.tax_year,
        tax_month=component.tax_month,
    )
    paye_repo.delete_pay_component(db_session, component)
    db_session.commit()


def _component_summary(components: list[MonthlyPayePayComponent]) -> dict[str, Decimal | list[dict]]:
    bonus = Decimal("0.00")
    commission = Decimal("0.00")
    gross = Decimal("0.00")
    taxable = Decimal("0.00")
    niable = Decimal("0.00")
    pensionable = Decimal("0.00")
    snapshot: list[dict] = []
    for component in components:
        value = money(amount(component.amount))
        if component.component_type == "bonus":
            bonus += value
        elif component.component_type == "commission":
            commission += value
        gross += value
        if component.taxable:
            taxable += value
        if component.niable:
            niable += value
        if component.pensionable:
            pensionable += value
        snapshot.append(
            {
                "id": str(component.id),
                "type": component.component_type,
                "description": component.description,
                "amount": str(value),
                "taxable": bool(component.taxable),
                "niable": bool(component.niable),
                "pensionable": bool(component.pensionable),
            }
        )
    return {
        "bonus_pay": money(bonus),
        "commission_pay": money(commission),
        "component_pay": money(gross),
        "taxable_additions": money(taxable),
        "niable_additions": money(niable),
        "pensionable_additions": money(pensionable),
        "snapshot": snapshot,
    }


def _calculated_item(
    db_session: Session,
    *,
    period: MonthlyPayePeriod,
    user: User,
    profile: EmployeeProfile | None,
    settings: EmployeePayeSettings,
    company_settings: CompanyPayeSettings,
    components: list[MonthlyPayePayComponent] | None = None,
) -> MonthlyPayeItem:
    now = _now()
    employee_percent = amount(
        settings.employee_pension_percent
        if settings.employee_pension_percent is not None
        else company_settings.default_employee_pension_percent
    )
    employer_percent = amount(
        settings.employer_pension_percent
        if settings.employer_pension_percent is not None
        else company_settings.default_employer_pension_percent
    )
    prior_items = paye_repo.list_prior_items_for_user_tax_year(
        db_session,
        company_id=period.company_id,
        user_id=user.id,
        tax_year=period.tax_year,
        before_tax_month=period.tax_month,
    )
    component_summary = _component_summary(components or [])
    calculation = calculate_fixed_monthly_salary(
        monthly_salary=amount(settings.monthly_salary),
        tax_code=settings.tax_code,
        tax_basis=settings.tax_basis,
        tax_month=period.tax_month,
        ni_category=settings.ni_category,
        pension_enrolment_status=settings.pension_enrolment_status,
        employee_pension_percent=employee_percent,
        employer_pension_percent=employer_percent,
        pension_scheme_basis=settings.pension_scheme_basis,
        pension_relief_method=settings.pension_relief_method,
        student_loan_plan=settings.student_loan_plan,
        postgraduate_loan=settings.postgraduate_loan,
        taxable_additions=amount(component_summary["taxable_additions"]),
        niable_additions=amount(component_summary["niable_additions"]),
        pensionable_additions=amount(component_summary["pensionable_additions"]),
        gross_additions=amount(component_summary["component_pay"]),
        prior_ytd_taxable_pay=_sum_prior(prior_items, "taxable_pay"),
        prior_ytd_paye_tax=_sum_prior(prior_items, "paye_tax"),
    )
    item = MonthlyPayeItem(
        period_id=period.id,
        company_id=period.company_id,
        user_id=user.id,
        payroll_type=getattr(profile, "payroll_type", None) or "paye_employee",
        pay_frequency=settings.pay_frequency,
        salary_type=settings.salary_type,
        monthly_salary=settings.monthly_salary,
        tax_code=(settings.tax_code or "").strip().upper() or None,
        tax_basis=settings.tax_basis,
        ni_category=(settings.ni_category or "").strip().upper() or None,
        student_loan_plan=settings.student_loan_plan,
        postgraduate_loan=settings.postgraduate_loan,
        pension_enrolment_status=settings.pension_enrolment_status,
        employee_pension_percent=employee_percent,
        employer_pension_percent=employer_percent,
        pension_scheme_basis=settings.pension_scheme_basis,
        pension_relief_method=settings.pension_relief_method,
        bonus_pay=amount(component_summary["bonus_pay"]),
        commission_pay=amount(component_summary["commission_pay"]),
        component_pay=amount(component_summary["component_pay"]),
        status="pending",
        component_snapshot=component_summary["snapshot"],
        calculation_snapshot={
            "phase": "2A",
            "tax_year": period.tax_year,
            "tax_month": period.tax_month,
            "rules_source": SOURCE_NOTE,
            "fixed_monthly_salary_only": True,
            "pay_components_phase": "4A",
        },
        unsupported_reason=calculation["unsupported_reason"],
        created_at=now,
        updated_at=now,
    )
    for field in {
        "gross_pay",
        "taxable_pay",
        "niable_pay",
        "pensionable_pay",
        "paye_tax",
        "employee_ni",
        "employer_ni",
        "employee_pension",
        "employer_pension",
        "student_loan",
        "postgraduate_loan_deduction",
        "other_deductions",
        "additions",
        "total_deductions",
        "net_pay",
    }:
        setattr(item, field, calculation[field])
    _assign_ytd(item, prior_items)
    return item


def recalculate_monthly_paye(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    tax_year: str,
    tax_month: int,
) -> MonthlyPayeReportResponse:
    _ensure_tax_year_rule(db_session, tax_year)
    cid = _resolve_company_id(actor, company_id)
    settings = _get_or_create_company_settings(db_session, cid)
    period = paye_repo.get_monthly_period(db_session, company_id=cid, tax_year=tax_year, tax_month=tax_month)
    if period is None:
        period = _period_for_tax_month(company_id=cid, tax_year=tax_year, tax_month=tax_month, actor_id=actor.id)
        db_session.add(period)
        db_session.flush()
    elif period.status in {"approved", "paid"}:
        raise PayePayrollPermissionError("Approved or paid PAYE periods cannot be recalculated.")
    else:
        period.calculated_at = _now()
        period.calculated_by_user_id = actor.id
        period.updated_at = _now()
        paye_repo.clear_component_item_links_for_period(db_session, period.id)
        paye_repo.delete_pending_items_for_period(db_session, period.id)

    for user, profile, employee_settings in paye_repo.list_paye_candidates_for_company(db_session, company_id=cid):
        components = paye_repo.list_pay_components(
            db_session,
            company_id=cid,
            tax_year=tax_year,
            tax_month=tax_month,
            user_id=user.id,
        )
        for component in components:
            component.period_id = period.id
        if employee_settings is None:
            item = _unsupported_item(
                period=period,
                user=user,
                profile=profile,
                settings=None,
                reason="PAYE employee settings are required before calculation.",
            )
        elif employee_settings.pay_frequency != "monthly":
            item = _unsupported_item(
                period=period,
                user=user,
                profile=profile,
                settings=employee_settings,
                reason="Only monthly PAYE frequency is supported in Phase 2A.",
            )
        elif employee_settings.salary_type != "fixed_monthly_salary":
            item = _unsupported_item(
                period=period,
                user=user,
                profile=profile,
                settings=employee_settings,
                reason="Only fixed monthly salary is supported in Phase 2A.",
            )
        elif amount(employee_settings.monthly_salary) <= 0:
            item = _unsupported_item(
                period=period,
                user=user,
                profile=profile,
                settings=employee_settings,
                reason="Monthly salary must be greater than zero.",
            )
        else:
            item = _calculated_item(
                db_session,
                period=period,
                user=user,
                profile=profile,
                settings=employee_settings,
                company_settings=settings,
                components=components,
            )
            db_session.add(item)
            db_session.flush()
            for component in components:
                component.item_id = item.id
            continue
        db_session.add(item)
        db_session.flush()
        if not item.unsupported_reason:
            for component in components:
                component.item_id = item.id
    db_session.commit()
    return monthly_paye_report(
        db_session,
        actor,
        company_id=cid,
        tax_year=tax_year,
        tax_month=tax_month,
        employee_id=None,
    )


def approve_monthly_paye_period(
    db_session: Session,
    actor: User,
    period_id: uuid.UUID,
) -> MonthlyPayeReportResponse:
    period = paye_repo.get_monthly_period_by_id(db_session, period_id)
    if period is None:
        raise PayePayrollNotFoundError("Monthly PAYE period not found.")
    _resolve_company_id(actor, period.company_id)
    if period.status != "pending":
        raise PayePayrollPermissionError("Only pending PAYE periods can be approved.")
    items = paye_repo.list_items_for_period(db_session, period.id)
    if any(item.unsupported_reason for item in items):
        raise PayePayrollPermissionError("Cannot approve PAYE period while unsupported rows are present.")
    now = _now()
    period.status = "approved"
    period.approved_at = now
    period.approved_by_user_id = actor.id
    period.updated_at = now
    for item in items:
        if item.status == "pending":
            item.status = "approved"
            item.approved_at = now
            item.approved_by_user_id = actor.id
            item.updated_at = now
    db_session.commit()
    return monthly_paye_report(
        db_session,
        actor,
        company_id=period.company_id,
        tax_year=period.tax_year,
        tax_month=period.tax_month,
        employee_id=None,
    )


def mark_monthly_paye_period_paid(
    db_session: Session,
    actor: User,
    period_id: uuid.UUID,
) -> MonthlyPayeReportResponse:
    period = paye_repo.get_monthly_period_by_id(db_session, period_id)
    if period is None:
        raise PayePayrollNotFoundError("Monthly PAYE period not found.")
    _resolve_company_id(actor, period.company_id)
    if period.status != "approved":
        raise PayePayrollPermissionError("Only approved PAYE periods can be marked paid.")
    items = paye_repo.list_items_for_period(db_session, period.id)
    if any(item.status != "approved" for item in items):
        raise PayePayrollPermissionError("All PAYE items must be approved before marking paid.")
    now = _now()
    period.status = "paid"
    period.paid_at = now
    period.paid_by_user_id = actor.id
    period.updated_at = now
    for item in items:
        item.status = "paid"
        item.paid_at = now
        item.paid_by_user_id = actor.id
        item.updated_at = now
    db_session.commit()
    return monthly_paye_report(
        db_session,
        actor,
        company_id=period.company_id,
        tax_year=period.tax_year,
        tax_month=period.tax_month,
        employee_id=None,
    )


def undo_paid_monthly_paye_period(
    db_session: Session,
    actor: User,
    period_id: uuid.UUID,
) -> MonthlyPayeReportResponse:
    period = paye_repo.get_monthly_period_by_id(db_session, period_id)
    if period is None:
        raise PayePayrollNotFoundError("Monthly PAYE period not found.")
    _resolve_company_id(actor, period.company_id)
    if period.status != "paid":
        raise PayePayrollPermissionError("Only paid PAYE periods can be moved back to approved.")
    items = paye_repo.list_items_for_period(db_session, period.id)
    now = _now()
    period.status = "approved"
    period.paid_at = None
    period.paid_by_user_id = None
    period.updated_at = now
    for item in items:
        if item.status == "paid":
            item.status = "approved"
            item.paid_at = None
            item.paid_by_user_id = None
            item.updated_at = now
    db_session.commit()
    return monthly_paye_report(
        db_session,
        actor,
        company_id=period.company_id,
        tax_year=period.tax_year,
        tax_month=period.tax_month,
        employee_id=None,
    )
