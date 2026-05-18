from __future__ import annotations

from dataclasses import dataclass

from app.modules.paye_payroll.rules import SOURCE_NOTE, SUPPORTED_TAX_YEAR


CapabilityStatus = str


@dataclass(frozen=True)
class PayeCapability:
    key: str
    name: str
    category: str
    status: CapabilityStatus
    tax_years_supported: tuple[str, ...]
    source_note: str
    description: str
    unsupported_message: str | None = None


def _enabled(key: str, name: str, category: str, description: str) -> PayeCapability:
    return PayeCapability(
        key=key,
        name=name,
        category=category,
        status="enabled",
        tax_years_supported=(SUPPORTED_TAX_YEAR,),
        source_note=SOURCE_NOTE,
        description=description,
    )


def _not_supported(key: str, name: str, category: str, description: str) -> PayeCapability:
    return PayeCapability(
        key=key,
        name=name,
        category=category,
        status="not_supported",
        tax_years_supported=(),
        source_note="Not encoded for PAYE Phase 2B. Requires official source review and tests before activation.",
        description=description,
        unsupported_message=f"{name} is not supported yet and must not be calculated silently.",
    )


def _coming_soon(key: str, name: str, category: str, description: str) -> PayeCapability:
    return PayeCapability(
        key=key,
        name=name,
        category=category,
        status="coming_soon",
        tax_years_supported=(),
        source_note="Planned for a later PAYE phase after official rules and tests are approved.",
        description=description,
        unsupported_message=f"{name} is coming in a later PAYE phase.",
    )


PAYE_CAPABILITIES: tuple[PayeCapability, ...] = (
    _enabled("tax_codes.numeric_l", "Numeric L tax codes", "tax_codes", "Standard numeric L tax codes such as 1257L."),
    _enabled("tax_basis.cumulative", "Cumulative tax basis", "tax_codes", "Cumulative PAYE calculation for supported tax codes."),
    _enabled("tax_basis.month1", "Month 1 tax basis", "tax_codes", "Non-cumulative Month 1 basis for supported tax codes."),
    _not_supported("tax_codes.br", "BR tax code", "tax_codes", "Basic-rate-only tax code."),
    _not_supported("tax_codes.d0", "D0 tax code", "tax_codes", "Higher-rate-only tax code."),
    _not_supported("tax_codes.d1", "D1 tax code", "tax_codes", "Additional-rate-only tax code."),
    _not_supported("tax_codes.0t", "0T tax code", "tax_codes", "No personal allowance tax code."),
    _not_supported("tax_codes.nt", "NT tax code", "tax_codes", "No tax deducted tax code."),
    _not_supported("tax_codes.k", "K tax codes", "tax_codes", "Tax codes where deductions exceed allowances."),
    _not_supported("tax_codes.m_n", "Marriage allowance M/N tax codes", "tax_codes", "Marriage allowance transfer tax codes."),
    _not_supported("tax_codes.t", "T tax codes", "tax_codes", "Tax codes requiring HMRC review or other calculations."),
    _not_supported("tax_codes.scottish_s", "Scottish S tax codes", "tax_codes", "Scottish tax-band codes."),
    _not_supported("tax_codes.welsh_c", "Welsh C tax codes", "tax_codes", "Welsh tax-code prefix handling."),
    _not_supported("tax_codes.emergency_suffixes", "Emergency W1/M1/X suffixes", "tax_codes", "Emergency tax-code suffix parsing."),
    _enabled("ni.category_a", "NI category A", "national_insurance", "Standard Class 1 employee and employer NI category A."),
    _not_supported("ni.category_b", "NI category B", "national_insurance", "Reduced-rate NI category."),
    _not_supported("ni.category_c", "NI category C", "national_insurance", "State pension age NI category."),
    _not_supported("ni.category_h", "NI category H", "national_insurance", "Apprentice under 25 NI category."),
    _not_supported("ni.category_j", "NI category J", "national_insurance", "Deferred NI category."),
    _not_supported("ni.category_m", "NI category M", "national_insurance", "Under 21 NI category."),
    _not_supported("ni.category_v", "NI category V", "national_insurance", "Veteran NI category."),
    _not_supported("ni.category_z", "NI category Z", "national_insurance", "Under 21 deferred NI category."),
    _not_supported("ni.freeport", "Freeport NI categories", "national_insurance", "Freeport special-site NI categories F, I, L, S."),
    _not_supported("ni.investment_zone", "Investment Zone NI categories", "national_insurance", "Investment Zone NI categories N, E, D, K."),
    _enabled("pay_type.fixed_monthly_salary", "Fixed monthly salary", "pay_types", "Monthly salary value from PAYE employee settings."),
    _enabled("pay_type.hourly", "Hourly PAYE", "pay_types", "PAYE-specific hourly pay from completed time shifts."),
    _enabled("pay_type.overtime", "PAYE overtime", "pay_types", "PAYE overtime using a monthly threshold only."),
    _enabled("pay_type.bonus", "Bonus pay", "pay_types", "Taxable bonus pay component."),
    _enabled("pay_type.commission", "Commission pay", "pay_types", "Taxable commission pay component."),
    _enabled("pension.qualifying_earnings", "Qualifying earnings pension basis", "pensions", "Pension based on qualifying earnings band."),
    _enabled("pension.total_earnings", "Total earnings pension basis", "pensions", "Pension based on total gross earnings."),
    _enabled("pension.relief_at_source", "Relief at source pension method", "pensions", "Employee deduction net of basic-rate relief."),
    _enabled("pension.net_pay_arrangement", "Net pay arrangement pension method", "pensions", "Gross employee deduction reducing taxable pay."),
    _not_supported("pension.salary_sacrifice", "Salary sacrifice pension", "pensions", "Salary sacrifice pension arrangement."),
    _coming_soon("pension.auto_enrolment_assessment", "Auto-enrolment assessment", "pensions", "Worker eligibility and postponement assessment."),
    _coming_soon("pension.opt_out_refunds", "Pension opt-out refunds", "pensions", "Opt-out and refund workflow."),
    _enabled("loans.student_plan_1", "Student Loan Plan 1", "loans", "Monthly student loan Plan 1 deduction."),
    _enabled("loans.student_plan_2", "Student Loan Plan 2", "loans", "Monthly student loan Plan 2 deduction."),
    _enabled("loans.student_plan_4", "Student Loan Plan 4", "loans", "Monthly student loan Plan 4 deduction."),
    _enabled("loans.student_plan_5", "Student Loan Plan 5", "loans", "Monthly student loan Plan 5 deduction."),
    _enabled("loans.postgraduate", "Postgraduate Loan", "loans", "Monthly postgraduate loan deduction."),
    _not_supported("statutory_pay.ssp", "Statutory Sick Pay", "statutory_pay", "SSP calculation."),
    _not_supported("statutory_pay.smp", "Statutory Maternity Pay", "statutory_pay", "SMP calculation."),
    _not_supported("statutory_pay.spp", "Statutory Paternity Pay", "statutory_pay", "SPP calculation."),
    _not_supported("statutory_pay.sap", "Statutory Adoption Pay", "statutory_pay", "SAP calculation."),
    _not_supported("statutory_pay.shpp", "Shared Parental Pay", "statutory_pay", "ShPP calculation."),
    _not_supported("deductions.attachment_of_earnings", "Attachment of earnings", "deductions", "Court order attachment deductions."),
    _not_supported("deductions.child_maintenance", "Child maintenance deductions", "deductions", "Child maintenance deduction orders."),
    _not_supported("benefits.payrolled_benefits", "Payrolled benefits", "benefits", "Payrolled benefits and Class 1A handling."),
    _enabled("ytd.paye_items_only", "PAYE-only YTD totals", "reporting", "YTD totals use Monthly PAYE items only."),
    _not_supported("reporting.p45", "P45-ready data", "reporting", "P45-ready reporting fields."),
    _not_supported("reporting.p60", "P60-ready data", "reporting", "P60-ready reporting fields."),
    _not_supported("reporting.rti_fps_eps", "RTI FPS/EPS", "reporting", "HMRC RTI FPS/EPS submission workflow."),
)


def list_paye_capabilities() -> tuple[PayeCapability, ...]:
    return PAYE_CAPABILITIES
