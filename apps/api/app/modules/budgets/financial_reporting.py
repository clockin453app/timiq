"""Phase 3 — budget financial overview summary and reporting exports (read-only)."""

from __future__ import annotations

import csv
import html
import io
import uuid
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy.orm import Session

from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import User
from app.modules.budgets.billing import (
    MONEY_QUANT,
    _company_local_today,
    _money,
    get_billing_summary,
)
from app.modules.budgets.payments import derive_display_status
from app.modules.budgets.repository import (
    list_customer_invoices_for_budget,
    map_active_payment_totals_for_budget,
)
from app.modules.budgets.saved_budgets import get_budget_detail
from app.modules.budgets.schemas import (
    BudgetBillingPosition,
    BudgetCostPosition,
    BudgetFinancialSummaryResponse,
    BudgetProfitability,
    InvoiceStatusCounts,
)
from app.modules.companies.repository import get_company_by_id

_FORMULA_PREFIXES = ("=", "+", "-", "@")


def _csv_protect(value: object) -> str:
    """Prefix formula-injection risk characters for spreadsheet-safe CSV cells."""
    if value is None:
        return ""
    s = str(value)
    if s and s[0] in _FORMULA_PREFIXES:
        return "'" + s
    return s


def _margin_percent(profit: Decimal, contract: Decimal) -> Decimal | None:
    if contract <= Decimal("0.00"):
        return None
    return (profit / contract * Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def get_financial_summary(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
) -> BudgetFinancialSummaryResponse:
    """Compose authoritative cost + billing + profitability overview."""
    # Billing access check first (employee / cross-company) before heavier cost scan.
    billing = get_billing_summary(db_session, actor, budget_id)
    detail = get_budget_detail(db_session, actor, budget_id)

    totals = detail.totals
    forecast_total_cost = totals.total_spent

    cost_position = BudgetCostPosition(
        planned_budget_amount=totals.planned_budget_amount,
        finalized_labour_cost=totals.finalized_labour_cost,
        estimated_labour_cost=totals.estimated_labour_cost,
        total_labour_cost=totals.total_labour_cost,
        total_expenses=totals.total_expenses,
        forecast_total_cost=forecast_total_cost,
        remaining_budget=totals.remaining_budget,
        over_budget_amount=totals.over_budget_amount,
        budget_used_percent=totals.budget_used_percent,
        open_shift_count=totals.open_shift_count,
        missing_rate_count=totals.missing_rate_count,
        warnings=list(totals.warnings),
        estimate_note=totals.estimate_note,
    )

    billing_position = BudgetBillingPosition(
        contract_value_net=billing.contract_value_net,
        billing_currency=billing.billing_currency,
        active_invoiced_net=billing.active_invoiced_net,
        vat_invoiced=billing.vat_invoiced,
        gross_invoiced=billing.gross_invoiced,
        remaining_to_invoice=billing.remaining_to_invoice,
        over_invoiced=billing.over_invoiced,
        payments_received_gross=billing.payments_received_gross,
        outstanding_gross=billing.outstanding_gross,
        overdue_outstanding_gross=billing.overdue_outstanding_gross,
        draft_count=billing.draft_count,
        issued_count=billing.issued_count,
        overdue_count=billing.overdue_count,
        void_count=billing.void_count,
        part_paid_count=billing.part_paid_count,
        paid_count=billing.paid_count,
        active_count=billing.active_count,
    )

    contract = billing.contract_value_net
    if contract is None:
        profitability = BudgetProfitability(
            forecast_revenue_net=None,
            forecast_total_cost=forecast_total_cost,
            forecast_profit=None,
            forecast_margin_percent=None,
        )
    else:
        profit = (contract - forecast_total_cost).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
        profitability = BudgetProfitability(
            forecast_revenue_net=contract,
            forecast_total_cost=forecast_total_cost,
            forecast_profit=profit,
            forecast_margin_percent=_margin_percent(profit, contract),
        )

    # Display-status counts (mutually exclusive) for the overview strip.
    today_local = _company_local_today(db_session, detail.budget.company_id)
    invoices = list_customer_invoices_for_budget(db_session, budget_id=budget_id, limit=5000)
    payment_map = map_active_payment_totals_for_budget(db_session, budget_id)
    status_counts = InvoiceStatusCounts()
    for inv in invoices:
        received = _money(payment_map.get(inv.id, 0))
        display = derive_display_status(inv, today_local, received)
        if display == "draft":
            status_counts.draft += 1
        elif display == "issued":
            status_counts.issued += 1
        elif display == "part_paid":
            status_counts.part_paid += 1
        elif display == "paid":
            status_counts.paid += 1
        elif display == "overdue":
            status_counts.overdue += 1
        elif display == "void":
            status_counts.void += 1

    return BudgetFinancialSummaryResponse(
        budget=detail.budget,
        cost_position=cost_position,
        billing_position=billing_position,
        profitability=profitability,
        invoice_status_counts=status_counts,
    )


def export_financial_summary_csv(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
) -> tuple[bytes, str]:
    summary = get_financial_summary(db_session, actor, budget_id)
    company = get_company_by_id(db_session, summary.budget.company_id)
    company_name = company.name if company else ""
    cost = summary.cost_position
    bill = summary.billing_position
    profit = summary.profitability
    counts = summary.invoice_status_counts

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([_csv_protect("Financial summary")])
    w.writerow([_csv_protect("Project"), _csv_protect(summary.budget.name)])
    w.writerow([_csv_protect("Client"), _csv_protect(summary.budget.client_name or "")])
    w.writerow([_csv_protect("Company"), _csv_protect(company_name)])
    w.writerow([_csv_protect("Reference"), _csv_protect(summary.budget.reference_code or "")])
    w.writerow([])
    w.writerow([_csv_protect("Cost position")])
    w.writerow([_csv_protect("Planned budget"), _csv_protect(cost.planned_budget_amount)])
    w.writerow([_csv_protect("Finalized labour"), _csv_protect(cost.finalized_labour_cost)])
    w.writerow([_csv_protect("Estimated labour"), _csv_protect(cost.estimated_labour_cost)])
    w.writerow([_csv_protect("Total labour"), _csv_protect(cost.total_labour_cost)])
    w.writerow([_csv_protect("Total expenses"), _csv_protect(cost.total_expenses)])
    w.writerow([_csv_protect("Forecast total cost"), _csv_protect(cost.forecast_total_cost)])
    w.writerow([_csv_protect("Remaining budget"), _csv_protect(cost.remaining_budget)])
    w.writerow([_csv_protect("Over budget"), _csv_protect(cost.over_budget_amount)])
    w.writerow([])
    w.writerow([_csv_protect("Billing position")])
    w.writerow([_csv_protect("Contract value (Net)"), _csv_protect(bill.contract_value_net or "")])
    w.writerow([_csv_protect("Billing currency"), _csv_protect(bill.billing_currency or "")])
    w.writerow([_csv_protect("Active invoiced (Net)"), _csv_protect(bill.active_invoiced_net)])
    w.writerow([_csv_protect("VAT invoiced"), _csv_protect(bill.vat_invoiced)])
    w.writerow([_csv_protect("Gross invoiced"), _csv_protect(bill.gross_invoiced)])
    w.writerow([_csv_protect("Remaining to invoice (Net)"), _csv_protect(bill.remaining_to_invoice or "")])
    w.writerow([_csv_protect("Over invoiced (Net)"), _csv_protect(bill.over_invoiced or "")])
    w.writerow([_csv_protect("Payments received (Gross)"), _csv_protect(bill.payments_received_gross)])
    w.writerow([_csv_protect("Outstanding (Gross)"), _csv_protect(bill.outstanding_gross)])
    w.writerow([_csv_protect("Overdue outstanding (Gross)"), _csv_protect(bill.overdue_outstanding_gross)])
    w.writerow([])
    w.writerow([_csv_protect("Profitability")])
    w.writerow([_csv_protect("Forecast revenue (Net)"), _csv_protect(profit.forecast_revenue_net or "")])
    w.writerow([_csv_protect("Forecast total cost"), _csv_protect(profit.forecast_total_cost or "")])
    w.writerow([_csv_protect("Forecast profit (Net)"), _csv_protect(profit.forecast_profit or "")])
    w.writerow([_csv_protect("Forecast margin %"), _csv_protect(profit.forecast_margin_percent or "")])
    w.writerow([])
    w.writerow([_csv_protect("Invoice status counts")])
    w.writerow([_csv_protect("Draft"), counts.draft])
    w.writerow([_csv_protect("Issued"), counts.issued])
    w.writerow([_csv_protect("Part paid"), counts.part_paid])
    w.writerow([_csv_protect("Paid"), counts.paid])
    w.writerow([_csv_protect("Overdue"), counts.overdue])
    w.writerow([_csv_protect("Void"), counts.void])

    body = buf.getvalue().encode("utf-8")
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.financial_summary_exported",
        entity_type="budget",
        entity_id=str(budget_id),
        company_id=summary.budget.company_id,
        details={
            "budget_id": str(budget_id),
            "report_type": "financial_summary",
            "format": "csv",
        },
    )
    return body, f"financial-summary-{budget_id}.csv"


def export_financial_summary_print_html(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
) -> str:
    summary = get_financial_summary(db_session, actor, budget_id)
    company = get_company_by_id(db_session, summary.budget.company_id)
    company_name = html.escape(company.name if company else "")
    title = html.escape(summary.budget.name)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    cost = summary.cost_position
    bill = summary.billing_position
    profit = summary.profitability
    counts = summary.invoice_status_counts

    def esc(s: object | None) -> str:
        return html.escape("" if s is None else str(s))

    html_out = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Financial summary — {title}</title>
<style>
  @page {{ size: portrait; margin: 14mm; @bottom-center {{ content: "Page " counter(page) " of " counter(pages); font-size: 10px; color: #4b5563; }} }}
  body {{ font-family: system-ui, sans-serif; color: #111827; margin: 24px; }}
  h1 {{ font-size: 22px; }}
  h2 {{ font-size: 16px; margin-top: 20px; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }}
  thead {{ display: table-header-group; }}
  th, td {{ border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; }}
  th {{ background: #f3f4f6; }}
  .num {{ text-align: right; }}
  @media print {{ body {{ margin: 0; }} }}
</style></head><body>
<h1>Financial summary — {title}</h1>
<p><strong>Company:</strong> {company_name} &nbsp;|&nbsp; <strong>Client:</strong> {esc(summary.budget.client_name)}
 &nbsp;|&nbsp; <strong>Reference:</strong> {esc(summary.budget.reference_code)}</p>
<p><strong>Generated:</strong> {now}</p>
<h2>Cost position</h2>
<table><thead><tr><th>Metric</th><th>Amount</th></tr></thead><tbody>
<tr><td>Planned budget</td><td class="num">{esc(cost.planned_budget_amount)}</td></tr>
<tr><td>Finalized labour</td><td class="num">{esc(cost.finalized_labour_cost)}</td></tr>
<tr><td>Estimated labour</td><td class="num">{esc(cost.estimated_labour_cost)}</td></tr>
<tr><td>Total labour</td><td class="num">{esc(cost.total_labour_cost)}</td></tr>
<tr><td>Total expenses</td><td class="num">{esc(cost.total_expenses)}</td></tr>
<tr><td>Forecast total cost</td><td class="num">{esc(cost.forecast_total_cost)}</td></tr>
<tr><td>Remaining budget</td><td class="num">{esc(cost.remaining_budget)}</td></tr>
<tr><td>Over budget</td><td class="num">{esc(cost.over_budget_amount)}</td></tr>
</tbody></table>
<h2>Billing position</h2>
<table><thead><tr><th>Metric</th><th>Amount</th></tr></thead><tbody>
<tr><td>Contract value (Net)</td><td class="num">{esc(bill.contract_value_net)}</td></tr>
<tr><td>Active invoiced (Net)</td><td class="num">{esc(bill.active_invoiced_net)}</td></tr>
<tr><td>VAT invoiced</td><td class="num">{esc(bill.vat_invoiced)}</td></tr>
<tr><td>Gross invoiced</td><td class="num">{esc(bill.gross_invoiced)}</td></tr>
<tr><td>Remaining to invoice (Net)</td><td class="num">{esc(bill.remaining_to_invoice)}</td></tr>
<tr><td>Over invoiced (Net)</td><td class="num">{esc(bill.over_invoiced)}</td></tr>
<tr><td>Payments received (Gross)</td><td class="num">{esc(bill.payments_received_gross)}</td></tr>
<tr><td>Outstanding (Gross)</td><td class="num">{esc(bill.outstanding_gross)}</td></tr>
<tr><td>Overdue outstanding (Gross)</td><td class="num">{esc(bill.overdue_outstanding_gross)}</td></tr>
</tbody></table>
<h2>Profitability</h2>
<table><thead><tr><th>Metric</th><th>Amount</th></tr></thead><tbody>
<tr><td>Forecast revenue (Net)</td><td class="num">{esc(profit.forecast_revenue_net)}</td></tr>
<tr><td>Forecast total cost</td><td class="num">{esc(profit.forecast_total_cost)}</td></tr>
<tr><td>Forecast profit (Net)</td><td class="num">{esc(profit.forecast_profit)}</td></tr>
<tr><td>Forecast margin %</td><td class="num">{esc(profit.forecast_margin_percent)}</td></tr>
</tbody></table>
<h2>Invoice status counts</h2>
<table><thead><tr><th>Status</th><th>Count</th></tr></thead><tbody>
<tr><td>Draft</td><td class="num">{counts.draft}</td></tr>
<tr><td>Issued</td><td class="num">{counts.issued}</td></tr>
<tr><td>Part paid</td><td class="num">{counts.part_paid}</td></tr>
<tr><td>Paid</td><td class="num">{counts.paid}</td></tr>
<tr><td>Overdue</td><td class="num">{counts.overdue}</td></tr>
<tr><td>Void</td><td class="num">{counts.void}</td></tr>
</tbody></table>
</body></html>"""

    create_internal_audit_event(
        db_session,
        actor,
        action="budget.financial_summary_exported",
        entity_type="budget",
        entity_id=str(budget_id),
        company_id=summary.budget.company_id,
        details={
            "budget_id": str(budget_id),
            "report_type": "financial_summary",
            "format": "print_html",
        },
    )
    return html_out


def _invoice_register_rows(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
) -> tuple[BudgetFinancialSummaryResponse, list[dict[str, object]]]:
    """Load summary (for access + meta) and invoice register rows with batched payments."""
    summary = get_financial_summary(db_session, actor, budget_id)
    today_local = _company_local_today(db_session, summary.budget.company_id)
    invoices = list_customer_invoices_for_budget(db_session, budget_id=budget_id, limit=5000)
    payment_map = map_active_payment_totals_for_budget(db_session, budget_id)

    rows: list[dict[str, object]] = []
    for inv in invoices:
        received = _money(payment_map.get(inv.id, 0))
        gross = _money(inv.gross_amount)
        outstanding = max(gross - received, Decimal("0.00")).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
        rows.append(
            {
                "invoice_number": inv.invoice_number or "",
                "customer_name": inv.customer_name,
                "invoice_date": inv.invoice_date.isoformat() if inv.invoice_date else "",
                "due_date": inv.due_date.isoformat() if inv.due_date else "",
                "net_amount": _money(inv.net_amount),
                "vat_amount": _money(inv.vat_amount),
                "gross_amount": gross,
                "payments_received": received,
                "outstanding": outstanding,
                "effective_status": derive_display_status(inv, today_local, received),
                "reference": inv.reference or "",
            },
        )
    return summary, rows


def export_invoice_register_csv(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
) -> tuple[bytes, str]:
    summary, rows = _invoice_register_rows(db_session, actor, budget_id)

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([_csv_protect("Invoice register")])
    w.writerow([_csv_protect("Project"), _csv_protect(summary.budget.name)])
    w.writerow([])
    w.writerow(
        [
            _csv_protect("Invoice number"),
            _csv_protect("Customer"),
            _csv_protect("Invoice date"),
            _csv_protect("Due date"),
            _csv_protect("Net"),
            _csv_protect("VAT"),
            _csv_protect("Gross"),
            _csv_protect("Payments received"),
            _csv_protect("Outstanding"),
            _csv_protect("Effective status"),
            _csv_protect("Reference"),
        ],
    )
    for row in rows:
        w.writerow(
            [
                _csv_protect(row["invoice_number"]),
                _csv_protect(row["customer_name"]),
                _csv_protect(row["invoice_date"]),
                _csv_protect(row["due_date"]),
                _csv_protect(row["net_amount"]),
                _csv_protect(row["vat_amount"]),
                _csv_protect(row["gross_amount"]),
                _csv_protect(row["payments_received"]),
                _csv_protect(row["outstanding"]),
                _csv_protect(row["effective_status"]),
                _csv_protect(row["reference"]),
            ],
        )

    body = buf.getvalue().encode("utf-8")
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.invoice_register_exported",
        entity_type="budget",
        entity_id=str(budget_id),
        company_id=summary.budget.company_id,
        details={
            "budget_id": str(budget_id),
            "report_type": "invoice_register",
            "format": "csv",
        },
    )
    return body, f"invoice-register-{budget_id}.csv"


def export_invoice_register_print_html(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
) -> str:
    summary, rows = _invoice_register_rows(db_session, actor, budget_id)
    company = get_company_by_id(db_session, summary.budget.company_id)
    company_name = html.escape(company.name if company else "")
    title = html.escape(summary.budget.name)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    def esc(s: object | None) -> str:
        return html.escape("" if s is None else str(s))

    body_rows = "".join(
        f"<tr>"
        f"<td>{esc(r['invoice_number'])}</td>"
        f"<td>{esc(r['customer_name'])}</td>"
        f"<td>{esc(r['invoice_date'])}</td>"
        f"<td>{esc(r['due_date'])}</td>"
        f"<td class='num'>{esc(r['net_amount'])}</td>"
        f"<td class='num'>{esc(r['vat_amount'])}</td>"
        f"<td class='num'>{esc(r['gross_amount'])}</td>"
        f"<td class='num'>{esc(r['payments_received'])}</td>"
        f"<td class='num'>{esc(r['outstanding'])}</td>"
        f"<td>{esc(r['effective_status'])}</td>"
        f"<td>{esc(r['reference'])}</td>"
        f"</tr>"
        for r in rows
    ) or "<tr><td colspan='11'>No invoices</td></tr>"

    html_out = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Invoice register — {title}</title>
<style>
  @page {{ size: portrait; margin: 14mm; @bottom-center {{ content: "Page " counter(page) " of " counter(pages); font-size: 10px; color: #4b5563; }} }}
  body {{ font-family: system-ui, sans-serif; color: #111827; margin: 24px; }}
  h1 {{ font-size: 22px; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 11px; }}
  thead {{ display: table-header-group; }}
  th, td {{ border: 1px solid #d1d5db; padding: 5px 6px; text-align: left; }}
  th {{ background: #f3f4f6; }}
  .num {{ text-align: right; }}
  @media print {{ body {{ margin: 0; }} }}
</style></head><body>
<h1>Invoice register — {title}</h1>
<p><strong>Company:</strong> {company_name} &nbsp;|&nbsp; <strong>Client:</strong> {esc(summary.budget.client_name)}
 &nbsp;|&nbsp; <strong>Reference:</strong> {esc(summary.budget.reference_code)}</p>
<p><strong>Generated:</strong> {now}</p>
<table>
<thead>
<tr>
<th>Invoice number</th><th>Customer</th><th>Invoice date</th><th>Due date</th>
<th>Net</th><th>VAT</th><th>Gross</th>
<th>Payments received</th><th>Outstanding</th><th>Effective status</th><th>Reference</th>
</tr>
</thead>
<tbody>{body_rows}</tbody>
</table>
</body></html>"""

    create_internal_audit_event(
        db_session,
        actor,
        action="budget.invoice_register_exported",
        entity_type="budget",
        entity_id=str(budget_id),
        company_id=summary.budget.company_id,
        details={
            "budget_id": str(budget_id),
            "report_type": "invoice_register",
            "format": "print_html",
        },
    )
    return html_out
