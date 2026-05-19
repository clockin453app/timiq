"""On-demand accounting CSV exports (no OAuth, no third-party API calls)."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.core.export_csv import safe_export_filename
from app.modules.accounting.models import AccountingExportSettings
from app.modules.accounting.repository import add_export_run
from app.modules.accounting.schemas import (
    AccountingBudgetExportRequest,
    AccountingPayrollExportRequest,
)
from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import User
from app.modules.budgets.repository import list_expenses_for_budget
from app.modules.budgets.saved_budgets import _assert_can_access_budget, get_budget_detail
from app.modules.companies.repository import get_company_by_id
from app.modules.payroll.permissions import assert_payroll_admin_or_administrator, assert_payroll_company_scope
from app.modules.payroll.repository import list_items_for_period, list_periods_week_start_between
from app.modules.payroll.service import (
    _decimal_or_none,
    _effective_net_amount_for_item,
    _effective_tax_amount_for_item,
    _payment_mode_label,
    item_to_response,
)
from app.modules.payroll.models import PayrollItem, PayrollPeriod

TIMIQ_PAYROLL_NOTE = "TimIQ export-ready CSV (foundation only; not a certified integration). Manual import."
TIMIQ_BUDGET_NOTE = "TimIQ budget costs export-ready CSV (foundation only; not a certified integration)."


def _money_str(v: Decimal | None) -> str:
    if v is None:
        return ""
    return str(v.quantize(Decimal("0.01")))


def _resolve_status_filters(body: AccountingPayrollExportRequest) -> set[str]:
    statuses: set[str] = set()
    if body.include_approved:
        statuses.add("approved")
    if body.include_paid:
        statuses.add("paid")
    if body.include_pending:
        statuses.add("pending")
    return statuses


def _week_period_label(week_start: date) -> str:
    end = week_start + timedelta(days=6)
    return f"{week_start.isoformat()} to {end.isoformat()}"


def _nominal_for_item(
    mapping: AccountingExportSettings | None,
    cis: Decimal | None,
) -> str:
    if mapping is None:
        return ""
    if cis is not None and cis > 0 and mapping.nominal_code_cis:
        return mapping.nominal_code_cis.strip()
    if mapping.nominal_code_wages:
        return mapping.nominal_code_wages.strip()
    return ""


def _collect_payroll_items(
    db_session: Session,
    company_id: uuid.UUID,
    *,
    date_from: date,
    date_to: date,
    statuses: set[str],
) -> list[tuple[PayrollPeriod, PayrollItem]]:
    periods = list_periods_week_start_between(
        db_session,
        company_id,
        week_start_from=date_from,
        week_start_to=date_to,
    )
    out: list[tuple[PayrollPeriod, PayrollItem]] = []
    for period in periods:
        for item in list_items_for_period(db_session, period.id):
            if item.status in statuses:
                out.append((period, item))
    return out


def _payroll_summary_rows(
    pairs: list[tuple[PayrollPeriod, PayrollItem]],
) -> list[dict[str, Any]]:
    """One aggregate row per payroll week (all statuses combined per week in export)."""
    by_week: dict[date, list[PayrollItem]] = {}
    for period, item in pairs:
        by_week.setdefault(period.week_start, []).append(item)
    rows: list[dict[str, Any]] = []
    for week_start in sorted(by_week.keys()):
        items = by_week[week_start]
        gross = Decimal(0)
        cis = Decimal(0)
        net = Decimal(0)
        has_gross = False
        has_cis = False
        has_net = False
        for it in items:
            g = _decimal_or_none(it.gross_amount)
            if g is not None:
                gross += g
                has_gross = True
            t = _effective_tax_amount_for_item(it)
            if t is not None:
                cis += t
                has_cis = True
            n = _effective_net_amount_for_item(it)
            if n is not None:
                net += n
                has_net = True
        rows.append(
            {
                "week_start": week_start,
                "week_period": _week_period_label(week_start),
                "row_count_items": len(items),
                "gross": gross if has_gross else None,
                "cis": cis if has_cis else None,
                "net": net if has_net else None,
            }
        )
    return rows


def build_payroll_accounting_csv(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    company_name: str,
    body: AccountingPayrollExportRequest,
    mapping: AccountingExportSettings | None,
) -> tuple[bytes, int, Decimal, list[str]]:
    statuses = _resolve_status_filters(body)
    if not statuses:
        raise ValueError("Select at least one status (approved, paid, and/or pending).")

    pairs = _collect_payroll_items(
        db_session,
        company_id,
        date_from=body.date_from,
        date_to=body.date_to,
        statuses=statuses,
    )

    export_scope = "includes_pending" if body.include_pending else "approved_paid_only"
    provider = str(body.provider).strip().lower()

    buf = io.StringIO()
    w = csv.writer(buf)
    headers: list[str]

    if body.export_type == "payroll_summary":
        summary = _payroll_summary_rows(pairs)
        total_gross = Decimal(0)
        has_any_gross = False
        for r in summary:
            if r["gross"] is not None:
                total_gross += r["gross"]  # type: ignore[operator]
                has_any_gross = True
        total_amount = total_gross if has_any_gross else Decimal(0)

        if provider == "generic_csv":
            headers = [
                "timiq_export_note",
                "company_name",
                "week_period",
                "items_in_week",
                "gross_total",
                "cis_tax_total",
                "net_total",
                "export_provider",
                "export_scope",
                "nominal_code_wages",
                "tax_code",
            ]
            w.writerow(headers)
            nom = (mapping.nominal_code_wages or "") if mapping else ""
            taxc = (mapping.tax_code or "") if mapping else ""
            for r in summary:
                w.writerow(
                    [
                        TIMIQ_PAYROLL_NOTE,
                        company_name,
                        r["week_period"],
                        r["row_count_items"],
                        _money_str(r["gross"]),
                        _money_str(r["cis"]),
                        _money_str(r["net"]),
                        provider,
                        export_scope,
                        nom,
                        taxc,
                    ]
                )
        elif provider == "xero":
            headers = [
                "AccountCode",
                "Description",
                "Amount",
                "TaxType",
                "TimIQ_Company",
                "TimIQ_Week",
                "TimIQ_ItemCount",
                "TimIQ_CISTotal",
                "TimIQ_NetTotal",
                "TimIQ_ExportNote",
            ]
            w.writerow(headers)
            acct = (mapping.nominal_code_wages or "") if mapping else ""
            taxc = (mapping.tax_code or "") if mapping else ""
            for r in summary:
                desc = f"Payroll summary {r['week_period']}"
                w.writerow(
                    [
                        acct,
                        desc,
                        _money_str(r["gross"]),
                        taxc,
                        company_name,
                        r["week_period"],
                        r["row_count_items"],
                        _money_str(r["cis"]),
                        _money_str(r["net"]),
                        TIMIQ_PAYROLL_NOTE,
                    ]
                )
        elif provider == "quickbooks":
            headers = [
                "Category",
                "Description",
                "Amount",
                "TimIQ_Company",
                "TimIQ_Week",
                "TimIQ_CISTotal",
                "TimIQ_NetTotal",
                "TimIQ_ExportNote",
            ]
            w.writerow(headers)
            for r in summary:
                w.writerow(
                    [
                        "Payroll",
                        f"Payroll summary {r['week_period']}",
                        _money_str(r["gross"]),
                        company_name,
                        r["week_period"],
                        _money_str(r["cis"]),
                        _money_str(r["net"]),
                        TIMIQ_PAYROLL_NOTE,
                    ]
                )
        else:  # sage
            headers = [
                "NominalCode",
                "Details",
                "Net",
                "Tax",
                "TimIQ_Company",
                "TimIQ_Week",
                "TimIQ_ExportNote",
            ]
            w.writerow(headers)
            for r in summary:
                nom = (mapping.nominal_code_wages or "") if mapping else ""
                w.writerow(
                    [
                        nom,
                        f"Payroll summary {r['week_period']}",
                        _money_str(r["net"]),
                        _money_str(r["cis"]),
                        company_name,
                        r["week_period"],
                        TIMIQ_PAYROLL_NOTE,
                    ]
                )

        row_count = len(summary)
        return buf.getvalue().encode("utf-8"), row_count, total_amount, headers

    # payroll_items
    total_gross = Decimal(0)
    has_any_gross = False
    for _, it in pairs:
        g = _decimal_or_none(it.gross_amount)
        if g is not None:
            total_gross += g
            has_any_gross = True
    total_amount = total_gross if has_any_gross else Decimal(0)

    if provider == "generic_csv":
        headers = [
            "timiq_export_note",
            "company_name",
            "employee_name",
            "employee_email",
            "job_title",
            "week_period",
            "status",
            "payment_mode",
            "gross",
            "cis_tax",
            "net",
            "export_provider",
            "export_scope",
            "nominal_code",
            "tax_code",
        ]
        w.writerow(headers)
        for period, item in pairs:
            resp = item_to_response(db_session, item)
            cis = _effective_tax_amount_for_item(item)
            net = _effective_net_amount_for_item(item)
            gross = _decimal_or_none(item.gross_amount)
            nom = _nominal_for_item(mapping, cis)
            taxc = (mapping.tax_code or "") if mapping else ""
            email = (resp.employee_email or "") if body.include_email else ""
            w.writerow(
                [
                    TIMIQ_PAYROLL_NOTE,
                    company_name,
                    resp.employee_name or "",
                    email,
                    resp.employee_job_title or "",
                    _week_period_label(period.week_start),
                    item.status,
                    _payment_mode_label(item.payment_mode),
                    _money_str(gross),
                    _money_str(cis),
                    _money_str(net),
                    provider,
                    export_scope,
                    nom,
                    taxc,
                ]
            )
    elif provider == "xero":
        headers = [
            "AccountCode",
            "Description",
            "Amount",
            "TaxType",
            "TimIQ_Company",
            "TimIQ_Employee",
            "TimIQ_Week",
            "TimIQ_Status",
            "TimIQ_CIS",
            "TimIQ_Net",
            "TimIQ_PaymentMode",
            "TimIQ_ExportNote",
        ]
        w.writerow(headers)
        taxc = (mapping.tax_code or "") if mapping else ""
        for period, item in pairs:
            resp = item_to_response(db_session, item)
            cis = _effective_tax_amount_for_item(item)
            net = _effective_net_amount_for_item(item)
            gross = _decimal_or_none(item.gross_amount)
            acct = _nominal_for_item(mapping, cis)
            name = resp.employee_name or resp.employee_email or "Employee"
            desc = f"{name} — {_week_period_label(period.week_start)}"
            w.writerow(
                [
                    acct,
                    desc,
                    _money_str(gross),
                    taxc,
                    company_name,
                    name,
                    period.week_start.isoformat(),
                    item.status,
                    _money_str(cis),
                    _money_str(net),
                    _payment_mode_label(item.payment_mode),
                    TIMIQ_PAYROLL_NOTE,
                ]
            )
    elif provider == "quickbooks":
        headers = [
            "Category",
            "Description",
            "Amount",
            "TimIQ_Company",
            "TimIQ_Week",
            "TimIQ_Status",
            "TimIQ_CIS",
            "TimIQ_Net",
            "TimIQ_PaymentMode",
            "TimIQ_ExportNote",
        ]
        w.writerow(headers)
        for period, item in pairs:
            resp = item_to_response(db_session, item)
            cis = _effective_tax_amount_for_item(item)
            net = _effective_net_amount_for_item(item)
            gross = _decimal_or_none(item.gross_amount)
            cat = (resp.employee_job_title or "Payroll").strip() or "Payroll"
            name = resp.employee_name or resp.employee_email or "Employee"
            desc = f"{name} — {_week_period_label(period.week_start)}"
            w.writerow(
                [
                    cat,
                    desc,
                    _money_str(gross),
                    company_name,
                    period.week_start.isoformat(),
                    item.status,
                    _money_str(cis),
                    _money_str(net),
                    _payment_mode_label(item.payment_mode),
                    TIMIQ_PAYROLL_NOTE,
                ]
            )
    else:  # sage
        headers = [
            "NominalCode",
            "Details",
            "Net",
            "Tax",
            "TimIQ_Company",
            "TimIQ_Week",
            "TimIQ_Status",
            "TimIQ_ExportNote",
        ]
        w.writerow(headers)
        for period, item in pairs:
            resp = item_to_response(db_session, item)
            cis = _effective_tax_amount_for_item(item)
            net = _effective_net_amount_for_item(item)
            nom = _nominal_for_item(mapping, cis)
            name = resp.employee_name or resp.employee_email or "Employee"
            details = f"{name} — {_week_period_label(period.week_start)}"
            w.writerow(
                [
                    nom,
                    details,
                    _money_str(net),
                    _money_str(cis),
                    company_name,
                    period.week_start.isoformat(),
                    item.status,
                    TIMIQ_PAYROLL_NOTE,
                ]
            )

    row_count = len(pairs)
    return buf.getvalue().encode("utf-8"), row_count, total_amount, headers


def build_budget_costs_accounting_csv(
    db_session: Session,
    actor: User,
    *,
    budget_id: uuid.UUID,
    body: AccountingBudgetExportRequest,
    mapping: AccountingExportSettings | None,
) -> tuple[bytes, int, Decimal, list[str]]:
    detail = get_budget_detail(db_session, actor, budget_id)
    company = get_company_by_id(db_session, detail.budget.company_id)
    company_name = company.name if company else ""
    expenses = list_expenses_for_budget(db_session, budget_id=budget_id, limit=10000)
    provider = str(body.provider).strip().lower()

    labour_note = (
        f"total_labour_cost={detail.totals.total_labour_cost}; "
        f"finalized_labour_cost={detail.totals.finalized_labour_cost}; "
        f"estimated_labour_cost={detail.totals.estimated_labour_cost}"
    )

    total_amount = Decimal(str(sum(Decimal(str(e.amount)) for e in expenses))) if expenses else Decimal(0)

    buf = io.StringIO()
    w = csv.writer(buf)

    if provider == "generic_csv":
        headers = [
            "timiq_export_note",
            "company_name",
            "project_name",
            "category",
            "purchase_date",
            "supplier",
            "description",
            "amount",
            "vat",
            "invoice_ref",
            "labour_summary",
        ]
        w.writerow(headers)
        for e in sorted(expenses, key=lambda x: (x.purchase_date, x.created_at)):
            vat = "" if e.vat_amount is None else _money_str(Decimal(str(e.vat_amount)))
            w.writerow(
                [
                    TIMIQ_BUDGET_NOTE,
                    company_name,
                    detail.budget.name,
                    e.category,
                    e.purchase_date.isoformat(),
                    e.supplier or "",
                    e.description,
                    _money_str(Decimal(str(e.amount))),
                    vat,
                    e.invoice_ref or "",
                    labour_note,
                ]
            )
    elif provider == "xero":
        headers = [
            "AccountCode",
            "Description",
            "Amount",
            "TaxType",
            "TimIQ_Company",
            "TimIQ_Project",
            "TimIQ_Category",
            "TimIQ_PurchaseDate",
            "TimIQ_VAT",
            "TimIQ_InvoiceRef",
            "TimIQ_LabourSummary",
            "TimIQ_ExportNote",
        ]
        w.writerow(headers)
        taxc = (mapping.tax_code or "") if mapping else ""
        for e in sorted(expenses, key=lambda x: (x.purchase_date, x.created_at)):
            acct = (mapping.nominal_code_materials or mapping.nominal_code_wages or "") if mapping else ""
            desc = f"{detail.budget.name} — {e.description}"
            vat = "" if e.vat_amount is None else _money_str(Decimal(str(e.vat_amount)))
            w.writerow(
                [
                    acct,
                    desc,
                    _money_str(Decimal(str(e.amount))),
                    taxc,
                    company_name,
                    detail.budget.name,
                    e.category,
                    e.purchase_date.isoformat(),
                    vat,
                    e.invoice_ref or "",
                    labour_note,
                    TIMIQ_BUDGET_NOTE,
                ]
            )
    elif provider == "quickbooks":
        headers = [
            "Category",
            "Description",
            "Amount",
            "TimIQ_Company",
            "TimIQ_Project",
            "TimIQ_Supplier",
            "TimIQ_PurchaseDate",
            "TimIQ_VAT",
            "TimIQ_InvoiceRef",
            "TimIQ_LabourSummary",
            "TimIQ_ExportNote",
        ]
        w.writerow(headers)
        for e in sorted(expenses, key=lambda x: (x.purchase_date, x.created_at)):
            w.writerow(
                [
                    e.category,
                    f"{detail.budget.name} — {e.description}",
                    _money_str(Decimal(str(e.amount))),
                    company_name,
                    detail.budget.name,
                    e.supplier or "",
                    e.purchase_date.isoformat(),
                    "" if e.vat_amount is None else _money_str(Decimal(str(e.vat_amount))),
                    e.invoice_ref or "",
                    labour_note,
                    TIMIQ_BUDGET_NOTE,
                ]
            )
    else:  # sage
        headers = [
            "NominalCode",
            "Details",
            "Net",
            "Tax",
            "TimIQ_Company",
            "TimIQ_Project",
            "TimIQ_PurchaseDate",
            "TimIQ_InvoiceRef",
            "TimIQ_LabourSummary",
            "TimIQ_ExportNote",
        ]
        w.writerow(headers)
        for e in sorted(expenses, key=lambda x: (x.purchase_date, x.created_at)):
            nom = (mapping.nominal_code_materials or mapping.nominal_code_wages or "") if mapping else ""
            vat_dec = Decimal(str(e.vat_amount)) if e.vat_amount is not None else Decimal(0)
            amt = Decimal(str(e.amount))
            net_part = amt - vat_dec
            w.writerow(
                [
                    nom,
                    f"{detail.budget.name} — {e.description}",
                    _money_str(net_part),
                    _money_str(vat_dec if vat_dec != 0 else None),
                    company_name,
                    detail.budget.name,
                    e.purchase_date.isoformat(),
                    e.invoice_ref or "",
                    labour_note,
                    TIMIQ_BUDGET_NOTE,
                ]
            )

    row_count = len(expenses)
    return buf.getvalue().encode("utf-8"), row_count, total_amount, headers


def record_payroll_export(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID,
    body: AccountingPayrollExportRequest,
    row_count: int,
    total_amount: Decimal,
    file_name: str,
) -> uuid.UUID:
    filters = {
        "include_approved": body.include_approved,
        "include_paid": body.include_paid,
        "include_pending": body.include_pending,
        "export_type": body.export_type,
        "provider": body.provider,
        "include_email": body.include_email,
    }
    run = add_export_run(
        db_session,
        company_id=company_id,
        provider=body.provider,
        export_type=body.export_type,
        date_from=body.date_from,
        date_to=body.date_to,
        status="generated",
        created_by_user_id=actor.id,
        row_count=row_count,
        total_amount=total_amount,
        file_name=file_name,
        notes=None,
        filters_json=filters,
    )
    create_internal_audit_event(
        db_session,
        actor,
        action="accounting.payroll_export_generated",
        entity_type="accounting_export_run",
        entity_id=str(run.id),
        company_id=company_id,
        details={
            "company_id": str(company_id),
            "provider": body.provider,
            "export_type": body.export_type,
            "date_from": body.date_from.isoformat(),
            "date_to": body.date_to.isoformat(),
            "row_count": row_count,
            "total_amount": str(total_amount),
            "created_by": str(actor.id),
            "export_run_id": str(run.id),
        },
    )
    return run.id


def record_budget_export(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID,
    budget_id: uuid.UUID,
    provider: str,
    date_from: date,
    date_to: date,
    row_count: int,
    total_amount: Decimal,
    file_name: str,
) -> uuid.UUID:
    filters = {"provider": provider, "budget_id": str(budget_id)}
    run = add_export_run(
        db_session,
        company_id=company_id,
        provider=provider,
        export_type="budget_costs",
        date_from=date_from,
        date_to=date_to,
        status="generated",
        created_by_user_id=actor.id,
        row_count=row_count,
        total_amount=total_amount,
        file_name=file_name,
        notes=None,
        filters_json=filters,
    )
    create_internal_audit_event(
        db_session,
        actor,
        action="accounting.budget_export_generated",
        entity_type="accounting_export_run",
        entity_id=str(run.id),
        company_id=company_id,
        details={
            "company_id": str(company_id),
            "provider": provider,
            "export_type": "budget_costs",
            "budget_id": str(budget_id),
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
            "row_count": row_count,
            "total_amount": str(total_amount),
            "created_by": str(actor.id),
            "export_run_id": str(run.id),
        },
    )
    return run.id


def run_payroll_export(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID,
    body: AccountingPayrollExportRequest,
    mapping: AccountingExportSettings | None,
) -> tuple[bytes, str]:
    assert_payroll_admin_or_administrator(actor)
    assert_payroll_company_scope(actor, company_id)
    if body.date_from > body.date_to:
        raise ValueError("date_from must be on or before date_to.")

    company = get_company_by_id(db_session, company_id)
    company_name = company.name if company else ""

    csv_bytes, row_count, total_amount, _headers = build_payroll_accounting_csv(
        db_session,
        company_id=company_id,
        company_name=company_name,
        body=body,
        mapping=mapping,
    )
    file_name = safe_export_filename(
        "timiq-payroll",
        body.provider,
        str(body.date_from),
        str(body.date_to),
    ) + ".csv"
    record_payroll_export(
        db_session,
        actor,
        company_id=company_id,
        body=body,
        row_count=row_count,
        total_amount=total_amount,
        file_name=file_name,
    )
    return csv_bytes, file_name


def run_budget_export(
    db_session: Session,
    actor: User,
    *,
    budget_id: uuid.UUID,
    body: AccountingBudgetExportRequest,
    mapping: AccountingExportSettings | None,
) -> tuple[bytes, str]:
    detail = get_budget_detail(db_session, actor, budget_id)
    company_id = detail.budget.company_id
    d0 = detail.budget.start_date or date.today()
    d1 = detail.budget.end_date or d0
    csv_bytes, row_count, total_amount, _ = build_budget_costs_accounting_csv(
        db_session,
        actor,
        budget_id=budget_id,
        body=body,
        mapping=mapping,
    )
    file_name = safe_export_filename(
        "timiq-budget-costs",
        body.provider,
        str(budget_id),
        str(d0),
        str(d1),
    ) + ".csv"
    record_budget_export(
        db_session,
        actor,
        company_id=company_id,
        budget_id=budget_id,
        provider=body.provider,
        date_from=d0,
        date_to=d1,
        row_count=row_count,
        total_amount=total_amount,
        file_name=file_name,
    )
    return csv_bytes, file_name
