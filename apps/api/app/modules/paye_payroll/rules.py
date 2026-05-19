from __future__ import annotations

from datetime import datetime, timezone


SUPPORTED_TAX_YEAR = "2026-2027"

SOURCE_URLS = [
    "https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027",
    "https://www.gov.uk/government/publications/sl3-student-loan-deduction-tables/2026-to-2027-student-and-postgraduate-loan-deduction-tables",
    "https://www.gov.uk/government/publications/review-of-the-automatic-enrolment-earnings-trigger-and-qualifying-earnings-band-for-202627/review-of-the-automatic-enrolment-earnings-trigger-and-qualifying-earnings-band-for-202627",
    "https://www.gov.uk/workplace-pensions/what-you-your-employer-and-the-government-pay",
]

SOURCE_NOTE = (
    "PAYE Phase 2A limited 2026-2027 rules encoded from official GOV.UK/HMRC/DWP employer "
    "rates and thresholds, student/postgraduate loan deduction tables, automatic enrolment "
    "qualifying earnings band review, and workplace pension contribution guidance. Supports "
    "fixed monthly salary, numeric L tax codes, NI category A only; not HMRC-certified payroll software."
)

INCOMPLETE_TAX_YEAR_RULES_MESSAGE = (
    "PAYE rules for this tax year are incomplete. Load or repair the tax-year rules before recalculating."
)


def tax_year_rules_json_is_complete(rules_json: object | None) -> bool:
    if not isinstance(rules_json, dict) or not rules_json:
        return False
    return "income_tax" in rules_json and "national_insurance" in rules_json


def paye_rules_2026_2027() -> dict:
    return {
        "tax_year": SUPPORTED_TAX_YEAR,
        "source_note": SOURCE_NOTE,
        "source_urls": SOURCE_URLS,
        "encoded_at": datetime.now(timezone.utc).isoformat(),
        "tax_year_start": "2026-04-06",
        "tax_year_end": "2027-04-05",
        "income_tax": {
            "region": "england_wales_northern_ireland_standard",
            "personal_allowance_annual": "12570.00",
            "basic_rate_limit_annual": "37700.00",
            "higher_rate_limit_above_allowance_annual": "112570.00",
            "rates": [
                {"name": "basic", "rate": "0.20"},
                {"name": "higher", "rate": "0.40"},
                {"name": "additional", "rate": "0.45"},
            ],
            "supported_tax_code_pattern": "^[0-9]+L$",
        },
        "national_insurance": {
            "category": "A",
            "monthly_thresholds": {
                "lower_earnings_limit": "559.00",
                "primary_threshold": "1048.00",
                "secondary_threshold": "417.00",
                "upper_earnings_limit": "4189.00",
            },
            "employee_rates": {
                "primary_to_upper": "0.08",
                "above_upper": "0.02",
            },
            "employer_rates": {
                "above_secondary": "0.15",
            },
        },
        "pension": {
            "qualifying_earnings_annual_lower": "6240.00",
            "qualifying_earnings_annual_upper": "50270.00",
            "minimum_employee_percent": "5.00",
            "minimum_employer_percent": "3.00",
            "supported_bases": ["qualifying_earnings", "total_earnings"],
            "supported_relief_methods": ["relief_at_source", "net_pay_arrangement"],
        },
        "student_loans": {
            "rounding": "round_down_to_whole_pounds",
            "plans": {
                "plan_1": {"monthly_threshold": "2241.66", "rate": "0.09"},
                "plan_2": {"monthly_threshold": "2448.75", "rate": "0.09"},
                "plan_4": {"monthly_threshold": "2816.25", "rate": "0.09"},
                "plan_5": {"monthly_threshold": "2083.33", "rate": "0.09"},
            },
            "postgraduate": {"monthly_threshold": "1750.00", "rate": "0.06"},
        },
    }
