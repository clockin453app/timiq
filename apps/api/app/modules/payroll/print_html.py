"""Print-ready HTML for hierarchical payroll reports (A4 portrait)."""

from __future__ import annotations

import html

from app.modules.payroll.hierarchical_report import (
    PayrollHierarchicalReport,
    hours_display,
    money_display,
)


def render_hierarchical_payroll_print_html(report: PayrollHierarchicalReport) -> str:
    name = html.escape(report.company_name)
    notes_text = "Notes: " + (
        " · ".join(report.alert_lines) if report.alert_lines else "No additional notes for this report."
    )
    sections: list[str] = []
    for emp in report.employees:
        week_html: list[str] = []
        for week in emp.weeks:
            day_rows: list[str] = []
            if week.days:
                for day in week.days:
                    site = html.escape(day.site)
                    if day.role:
                        site = f"{site}<br/><span class=\"muted\">({html.escape(day.role)})</span>"
                    ot = hours_display(day.ot_hours) if day.ot_hours is not None else "—"
                    day_rows.append(
                        "<tr>"
                        f"<td>{html.escape(day.day_label)}</td>"
                        f"<td class=\"site\">{site}</td>"
                        f"<td class=\"num\">{hours_display(day.hours)}</td>"
                        f"<td class=\"num\">{ot}</td>"
                        "</tr>",
                    )
            else:
                day_rows.append(
                    '<tr><td colspan="4" class="empty">No worked days with payable hours</td></tr>',
                )
            status_raw = (week.status or "—").strip() or "—"
            status_key = status_raw.lower()
            status_cls = (
                f"status status-{status_key}"
                if status_key in {"completed", "pending", "paid"}
                else "status"
            )
            week_html.append(
                f"""
<section class="week-block">
  <h3>{html.escape(week.week_label)}</h3>
  <table class="days">
    <thead><tr><th>Day</th><th>Site</th><th class="num">Hours</th><th class="num">OT</th></tr></thead>
    <tbody>{"".join(day_rows)}</tbody>
  </table>
  <div class="weekly-pay">
    <h4>Weekly payroll</h4>
    <dl>
      <div><dt>Hours</dt><dd>{hours_display(week.hours)}</dd></div>
      <div><dt>OT</dt><dd>{hours_display(week.ot_hours)}</dd></div>
      <div><dt>Gross</dt><dd>{money_display(week.gross)}</dd></div>
      <div><dt>CIS tax</dt><dd>{money_display(week.cis_tax)}</dd></div>
      <div><dt>Other deductions</dt><dd>{money_display(week.other_deductions)}</dd></div>
      <div><dt>Net</dt><dd>{money_display(week.net)}</dd></div>
      <div><dt>Status</dt><dd><span class="{status_cls}">{html.escape(status_raw.title() if status_raw != "—" else status_raw)}</span></dd></div>
    </dl>
  </div>
</section>
""",
            )
        sections.append(
            f"""
<article class="employee-block">
  <header>
    <h2>EMPLOYEE: {html.escape(emp.employee_name)}</h2>
    <p class="role">ROLE: {html.escape(emp.role or "—")}</p>
  </header>
  {"".join(week_html)}
  <section class="employee-total">
    <h3>{html.escape(report.totals_heading)}</h3>
    <dl>
      <div><dt>Days worked</dt><dd>{emp.days_worked}</dd></div>
      <div><dt>Weeks worked</dt><dd>{emp.weeks_worked}</dd></div>
      <div><dt>Hours</dt><dd>{hours_display(emp.hours)}</dd></div>
      <div><dt>OT</dt><dd>{hours_display(emp.ot_hours)}</dd></div>
      <div><dt>Gross</dt><dd>{money_display(emp.gross)}</dd></div>
      <div><dt>CIS</dt><dd>{money_display(emp.cis_tax)}</dd></div>
      <div><dt>Other deductions</dt><dd>{money_display(emp.other_deductions)}</dd></div>
      <div><dt>Net</dt><dd>{money_display(emp.net)}</dd></div>
    </dl>
  </section>
</article>
""",
        )

    body_sections = "".join(sections) if sections else '<p class="empty">No payable payroll rows for this selected range.</p>'

    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<title>TimIQ Payroll Report — {name}</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0;
    padding: 16px 12px;
    color: #111827;
    background: #e5e7eb;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 11px;
    line-height: 1.35;
  }}
  .report-canvas {{
    margin: 0 auto;
    width: min(210mm, 100%);
    max-width: 210mm;
    background: #fff;
    border: 1px solid #d1d5db;
    padding: 12mm;
  }}
  h1 {{ margin: 0 0 8px; font-size: 16px; }}
  .meta {{ margin: 0 0 10px; font-size: 11px; color: #374151; }}
  .meta div {{ margin: 1px 0; }}
  .summary, .employee-total .dl, .weekly-pay dl, dl {{
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 12px;
    margin: 0;
  }}
  .summary {{
    background: #f8fafc;
    border: 1px solid #e5e7eb;
    padding: 8px 10px;
    margin-bottom: 8px;
  }}
  .summary div, .weekly-pay dl div, .employee-total dl div {{
    display: contents;
  }}
  dt {{ color: #4b5563; font-weight: 500; }}
  dd {{ margin: 0; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }}
  .notes {{ margin: 8px 0 12px; color: #374151; font-size: 10px; }}
  .employee-block {{
    break-inside: avoid-page;
    page-break-inside: auto;
    margin: 0 0 18px;
    padding-top: 4px;
    border-top: 2px solid #111827;
  }}
  .employee-block h2 {{ margin: 10px 0 2px; font-size: 13px; }}
  .role {{ margin: 0 0 8px; color: #374151; font-size: 11px; }}
  .week-block {{
    break-inside: avoid;
    page-break-inside: avoid;
    margin: 0 0 12px;
  }}
  .week-block h3 {{ margin: 0 0 4px; font-size: 12px; }}
  table.days {{
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin: 0 0 6px;
  }}
  table.days th, table.days td {{
    border: 1px solid #d1d5db;
    padding: 4px 5px;
    vertical-align: top;
    font-size: 10.5px;
  }}
  table.days th {{ background: #f3f4f6; text-align: left; font-size: 10px; }}
  table.days th.num, table.days td.num {{
    text-align: right;
    font-variant-numeric: tabular-nums;
    width: 15%;
  }}
  table.days td.site {{ width: 48%; word-wrap: break-word; overflow-wrap: anywhere; }}
  table.days td:first-child {{ width: 22%; }}
  .muted {{ color: #6b7280; font-size: 9.5px; }}
  .weekly-pay, .employee-total {{
    border: 1px solid #d1d5db;
    padding: 6px 8px;
    background: #fff;
  }}
  .weekly-pay h4, .employee-total h3 {{ margin: 0 0 4px; font-size: 11px; }}
  .employee-total {{ background: #f8fafc; border-color: #9ca3af; margin-top: 8px; }}
  .status {{
    display: inline-block;
    border: 1px solid #9ca3af;
    background: #f3f4f6;
    font-weight: 700;
    font-size: 10px;
    padding: 1px 5px;
  }}
  .status-completed, .status-paid {{ color: #166534; background: #dcfce7; border-color: #86efac; }}
  .status-pending {{ color: #9a3412; background: #ffedd5; border-color: #fdba74; }}
  .empty {{ text-align: center; color: #6b7280; }}
  .hint {{ margin-top: 12px; color: #6b7280; font-size: 10px; }}
  @page {{ size: A4 portrait; margin: 12mm; }}
  @media print {{
    body {{ background: #fff; padding: 0; }}
    .report-canvas {{ width: 100%; max-width: none; border: 0; padding: 0; box-shadow: none; }}
    .hint {{ display: none; }}
    .week-block {{ break-inside: avoid; page-break-inside: avoid; }}
    .employee-block > header {{ break-after: avoid; page-break-after: avoid; }}
  }}
</style>
</head>
<body>
<main class="report-canvas">
  <h1>TimIQ Payroll Report</h1>
  <div class="meta">
    <div><strong>Company:</strong> {name}</div>
    <div><strong>Period:</strong> {html.escape(report.period_label)}</div>
    <div><strong>Filter:</strong> {html.escape(report.employee_filter_label)}</div>
    <div><strong>Timezone:</strong> {html.escape(report.timezone_name)}</div>
    <div><strong>Generated:</strong> {html.escape(report.generated_label)}</div>
  </div>
  <div class="summary" aria-label="Report summary">
    <div><dt>Total hours</dt><dd>{report.total_hours_seconds / 3600:,.2f}</dd></div>
    <div><dt>Employees</dt><dd>{report.employee_count}</dd></div>
    <div><dt>Gross</dt><dd>{money_display(report.total_gross)}</dd></div>
    <div><dt>CIS tax</dt><dd>{money_display(report.total_cis_tax)}</dd></div>
    <div><dt>Net</dt><dd>{money_display(report.total_net)}</dd></div>
  </div>
  <p class="notes">{html.escape(notes_text)}</p>
  {body_sections}
  <p class="hint">Use your browser Print dialog for a paper or PDF copy. Report is A4 portrait.</p>
</main>
</body></html>"""
