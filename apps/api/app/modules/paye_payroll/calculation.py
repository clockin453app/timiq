from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP

from app.modules.paye_payroll.rules import SUPPORTED_TAX_YEAR

MONEY = Decimal("0.01")
FOUR_PLACES = Decimal("0.0001")
ZERO = Decimal("0.00")
NUMERIC_L_TAX_CODE = re.compile(r"^[0-9]+L$")


class PayeCalculationError(ValueError):
    pass


def money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def amount(value: object | None) -> Decimal:
    if value is None:
        return ZERO
    return Decimal(str(value))


def tax_month_bounds(tax_year: str, tax_month: int) -> tuple[date, date]:
    if tax_year != SUPPORTED_TAX_YEAR:
        raise PayeCalculationError("Only tax year 2026-2027 is supported in Phase 2A.")
    if tax_month < 1 or tax_month > 12:
        raise PayeCalculationError("Tax month must be between 1 and 12.")
    starts = {
        1: (2026, 4, 6),
        2: (2026, 5, 6),
        3: (2026, 6, 6),
        4: (2026, 7, 6),
        5: (2026, 8, 6),
        6: (2026, 9, 6),
        7: (2026, 10, 6),
        8: (2026, 11, 6),
        9: (2026, 12, 6),
        10: (2027, 1, 6),
        11: (2027, 2, 6),
        12: (2027, 3, 6),
    }
    start = date(*starts[tax_month])
    if tax_month == 12:
        next_start = date(2027, 4, 6)
    else:
        next_start = date(*starts[tax_month + 1])
    end = next_start - timedelta(days=1)
    return start, end


def validate_numeric_l_tax_code(tax_code: str | None) -> tuple[Decimal | None, str | None]:
    code = (tax_code or "").strip().upper()
    if not code:
        return None, "Tax code is required for PAYE calculation."
    if not NUMERIC_L_TAX_CODE.fullmatch(code):
        return None, f"Tax code {code} is not supported in Phase 2A. Use numeric L codes only."
    return Decimal(code[:-1]) * Decimal(10), None


def _tax_due_for_band_slice(taxable_after_allowance: Decimal, multiplier: Decimal) -> Decimal:
    basic_limit = Decimal("37700.00") * multiplier
    higher_limit = Decimal("112570.00") * multiplier
    basic_pay = min(taxable_after_allowance, basic_limit)
    higher_pay = min(max(taxable_after_allowance - basic_limit, ZERO), higher_limit - basic_limit)
    additional_pay = max(taxable_after_allowance - higher_limit, ZERO)
    return money((basic_pay * Decimal("0.20")) + (higher_pay * Decimal("0.40")) + (additional_pay * Decimal("0.45")))


def calculate_paye_tax(
    *,
    taxable_pay: Decimal,
    tax_code_allowance: Decimal,
    tax_basis: str,
    tax_month: int,
    prior_ytd_taxable_pay: Decimal,
    prior_ytd_paye_tax: Decimal,
) -> Decimal:
    if tax_basis == "month1":
        monthly_allowance = tax_code_allowance / Decimal(12)
        taxable_after_allowance = max(taxable_pay - monthly_allowance, ZERO)
        return _tax_due_for_band_slice(taxable_after_allowance, Decimal(1) / Decimal(12))
    if tax_basis != "cumulative":
        raise PayeCalculationError("Tax basis is not supported in Phase 2A.")
    multiplier = Decimal(tax_month) / Decimal(12)
    ytd_taxable = prior_ytd_taxable_pay + taxable_pay
    ytd_allowance = tax_code_allowance * multiplier
    ytd_taxable_after_allowance = max(ytd_taxable - ytd_allowance, ZERO)
    ytd_tax_due = _tax_due_for_band_slice(ytd_taxable_after_allowance, multiplier)
    return max(money(ytd_tax_due - prior_ytd_paye_tax), ZERO)


def calculate_employee_ni_category_a(gross_pay: Decimal) -> Decimal:
    primary = Decimal("1048.00")
    upper = Decimal("4189.00")
    main_band = min(max(gross_pay - primary, ZERO), upper - primary)
    upper_band = max(gross_pay - upper, ZERO)
    return money((main_band * Decimal("0.08")) + (upper_band * Decimal("0.02")))


def calculate_employer_ni_category_a(gross_pay: Decimal) -> Decimal:
    secondary = Decimal("417.00")
    return money(max(gross_pay - secondary, ZERO) * Decimal("0.15"))


def calculate_pension(
    *,
    gross_pay: Decimal,
    enrolment_status: str,
    basis: str,
    relief_method: str,
    employee_percent: Decimal,
    employer_percent: Decimal,
) -> dict[str, Decimal | str | None]:
    if enrolment_status != "enrolled":
        return {
            "pensionable_pay": ZERO,
            "employee_pension": ZERO,
            "employer_pension": ZERO,
            "taxable_reduction": ZERO,
            "unsupported_reason": None,
        }
    if basis == "qualifying_earnings":
        lower = Decimal("6240.00") / Decimal(12)
        upper = Decimal("50270.00") / Decimal(12)
        pensionable = max(min(gross_pay, upper) - lower, ZERO)
    elif basis == "total_earnings":
        pensionable = gross_pay
    else:
        return {"unsupported_reason": f"Pension basis {basis} is not supported in Phase 2A."}

    gross_employee_contribution = money(pensionable * employee_percent / Decimal(100))
    employer_contribution = money(pensionable * employer_percent / Decimal(100))
    if relief_method == "net_pay_arrangement":
        employee_deduction = gross_employee_contribution
        taxable_reduction = gross_employee_contribution
    elif relief_method == "relief_at_source":
        employee_deduction = money(gross_employee_contribution * Decimal("0.80"))
        taxable_reduction = ZERO
    else:
        return {"unsupported_reason": f"Pension relief method {relief_method} is not supported in Phase 2A."}

    return {
        "pensionable_pay": money(pensionable),
        "employee_pension": employee_deduction,
        "employer_pension": employer_contribution,
        "taxable_reduction": taxable_reduction,
        "unsupported_reason": None,
    }


def calculate_student_loan(plan: str, gross_pay: Decimal) -> Decimal:
    thresholds = {
        "none": None,
        "plan_1": Decimal("2241.66"),
        "plan_2": Decimal("2448.75"),
        "plan_4": Decimal("2816.25"),
        "plan_5": Decimal("2083.33"),
    }
    if plan not in thresholds:
        raise PayeCalculationError(f"Student loan plan {plan} is not supported in Phase 2A.")
    threshold = thresholds[plan]
    if threshold is None:
        return ZERO
    return ((max(gross_pay - threshold, ZERO) * Decimal("0.09")).quantize(Decimal("1"), rounding=ROUND_DOWN))


def calculate_postgraduate_loan(enabled: bool, gross_pay: Decimal) -> Decimal:
    if not enabled:
        return ZERO
    return ((max(gross_pay - Decimal("1750.00"), ZERO) * Decimal("0.06")).quantize(Decimal("1"), rounding=ROUND_DOWN))


def unsupported_result(reason: str) -> dict[str, object]:
    return {
        "unsupported_reason": reason,
        "gross_pay": None,
        "taxable_pay": None,
        "niable_pay": None,
        "pensionable_pay": None,
        "paye_tax": None,
        "employee_ni": None,
        "employer_ni": None,
        "employee_pension": None,
        "employer_pension": None,
        "student_loan": None,
        "postgraduate_loan_deduction": None,
        "other_deductions": ZERO,
        "additions": ZERO,
        "total_deductions": None,
        "net_pay": None,
    }


def calculate_fixed_monthly_salary(
    *,
    monthly_salary: Decimal,
    tax_code: str | None,
    tax_basis: str,
    tax_month: int,
    ni_category: str | None,
    pension_enrolment_status: str,
    employee_pension_percent: Decimal,
    employer_pension_percent: Decimal,
    pension_scheme_basis: str,
    pension_relief_method: str,
    student_loan_plan: str,
    postgraduate_loan: bool,
    taxable_additions: Decimal = ZERO,
    niable_additions: Decimal = ZERO,
    pensionable_additions: Decimal = ZERO,
    gross_additions: Decimal = ZERO,
    prior_ytd_taxable_pay: Decimal = ZERO,
    prior_ytd_paye_tax: Decimal = ZERO,
) -> dict[str, object]:
    if monthly_salary <= 0:
        return unsupported_result("Monthly salary must be greater than zero.")
    allowance, tax_code_error = validate_numeric_l_tax_code(tax_code)
    if tax_code_error is not None or allowance is None:
        return unsupported_result(tax_code_error or "Tax code is not supported in Phase 2A.")
    if (ni_category or "").strip().upper() != "A":
        return unsupported_result("NI category must be A for Phase 2A.")
    if tax_basis not in {"cumulative", "month1"}:
        return unsupported_result("Tax basis must be cumulative or month1 for Phase 2A.")

    base_salary = money(monthly_salary)
    gross = money(base_salary + gross_additions)
    niable = money(base_salary + niable_additions)
    pensionable_gross = money(base_salary + pensionable_additions)
    pension = calculate_pension(
        gross_pay=pensionable_gross,
        enrolment_status=pension_enrolment_status,
        basis=pension_scheme_basis,
        relief_method=pension_relief_method,
        employee_percent=employee_pension_percent,
        employer_percent=employer_pension_percent,
    )
    if pension.get("unsupported_reason"):
        return unsupported_result(str(pension["unsupported_reason"]))

    taxable = money(base_salary + taxable_additions - amount(pension["taxable_reduction"]))
    paye_tax = calculate_paye_tax(
        taxable_pay=taxable,
        tax_code_allowance=allowance,
        tax_basis=tax_basis,
        tax_month=tax_month,
        prior_ytd_taxable_pay=prior_ytd_taxable_pay,
        prior_ytd_paye_tax=prior_ytd_paye_tax,
    )
    employee_ni = calculate_employee_ni_category_a(niable)
    employer_ni = calculate_employer_ni_category_a(niable)
    student_loan = calculate_student_loan(student_loan_plan, niable)
    postgraduate_loan_deduction = calculate_postgraduate_loan(postgraduate_loan, niable)
    other_deductions = ZERO
    additions = ZERO
    employee_pension = amount(pension["employee_pension"])
    total_deductions = money(paye_tax + employee_ni + employee_pension + student_loan + postgraduate_loan_deduction + other_deductions)
    net = money(gross + additions - total_deductions)
    return {
        "unsupported_reason": None,
        "gross_pay": gross,
        "taxable_pay": taxable,
        "niable_pay": niable,
        "pensionable_pay": amount(pension["pensionable_pay"]),
        "paye_tax": paye_tax,
        "employee_ni": employee_ni,
        "employer_ni": employer_ni,
        "employee_pension": employee_pension,
        "employer_pension": amount(pension["employer_pension"]),
        "student_loan": student_loan,
        "postgraduate_loan_deduction": postgraduate_loan_deduction,
        "other_deductions": other_deductions,
        "additions": additions,
        "total_deductions": total_deductions,
        "net_pay": net,
    }
