"""Print-ready HTML for hierarchical payroll reports (A4 portrait, employee pages)."""

from __future__ import annotations

import html

from app.modules.payroll.hierarchical_report import (
    REPORT_MUTED,
    REPORT_NAVY,
    REPORT_NET,
    REPORT_SLATE,
    STATUS_BADGE_COLORS,
    PayrollHierarchicalReport,
    employee_identity_lines,
    employee_role_line,
    employee_summary_badge,
    hours_display,
    is_single_week_report,
    money_display,
    status_badge_kind,
    status_display,
)


def render_hierarchical_payroll_print_html(report: PayrollHierarchicalReport) -> str:
    name = html.escape(report.company_name)
    notes_text = "Notes: " + (
        " · ".join(report.alert_lines) if report.alert_lines else "No additional notes for this report."
    )
    single_week = is_single_week_report(report)
    report_mode = "report-single-week" if single_week else "report-multi-week"
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
            status_raw = status_display(week.status)
            kind = status_badge_kind(week.status)
            days_count = len(week.days)
            metrics_band = (
                f"Days {days_count} · Hours {hours_display(week.hours)} · "
                f"OT {hours_display(week.ot_hours)}"
            )
            week_html.append(
                f"""
<section class="week-block">
  <h3>{html.escape(week.week_label)}</h3>
  <table class="days">
    <thead><tr><th>Day</th><th>Site</th><th class="num">Hours</th><th class="num">OT</th></tr></thead>
    <tbody>
      {"".join(day_rows)}
      <tr class="week-foot band1">
        <td colspan="3">{metrics_band}</td>
        <td class="status-cell"><span class="status-badge status-badge-{html.escape(kind)}">{html.escape(status_raw)}</span></td>
      </tr>
      <tr class="week-foot band2">
        <td colspan="4">
          <div class="money-row">
            <span class="money-gross"><span class="m-lab">Gross</span> <span class="m-val">{money_display(week.gross)}</span></span>
            <span class="money-cis"><span class="m-lab">CIS</span> <span class="m-val">{money_display(week.cis_tax)}</span></span>
            <span class="money-other"><span class="m-lab">Other</span> <span class="m-val">{money_display(week.other_deductions)}</span></span>
            <span class="money-net"><span class="m-lab">Net</span> <span class="m-val">{money_display(week.net)}</span></span>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</section>
""",
            )
        badge = html.escape(employee_summary_badge(report, emp))
        primary, email_line = employee_identity_lines(emp)
        role_line = employee_role_line(emp)
        email_html = (
            f'<p class="emp-email">{html.escape(email_line)}</p>' if email_line else ""
        )
        sections.append(
            f"""
<article class="employee-block">
  <header class="employee-head">
    <div class="emp-title">
      <p class="emp-kicker">EMPLOYEE</p>
      <h2 class="emp-name">{html.escape(primary)}</h2>
      {email_html}
      <p class="emp-role">{html.escape(role_line)}</p>
    </div>
    <div class="period-badge">{badge}</div>
  </header>
  <section class="employee-summary" aria-label="Employee summary">
    <div class="metrics">
      <div><span>Days</span><strong>{emp.days_worked}</strong></div>
      <div><span>Weeks</span><strong>{emp.weeks_worked}</strong></div>
      <div><span>Hours</span><strong>{hours_display(emp.hours)}</strong></div>
      <div><span>OT</span><strong>{hours_display(emp.ot_hours)}</strong></div>
      <div><span>Gross</span><strong class="money-gross">{money_display(emp.gross)}</strong></div>
      <div><span>CIS</span><strong class="money-cis">{money_display(emp.cis_tax)}</strong></div>
      <div><span>Other ded.</span><strong class="money-other">{money_display(emp.other_deductions)}</strong></div>
      <div class="metric-net"><span>Net</span><strong class="money-net">{money_display(emp.net)}</strong></div>
    </div>
  </section>
  {"".join(week_html)}
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
    padding: 12px 8px;
    color: #111827;
    background: #e5e7eb;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 9px;
    line-height: 1.3;
  }}
  .report-canvas {{
    margin: 0 auto;
    width: min(210mm, 100%);
    max-width: 210mm;
    background: #fff;
    border: 1px solid #d1d5db;
    padding: 11mm;
  }}
  h1 {{ margin: 0 0 4px; font-size: 13px; }}
  .meta {{ margin: 0 0 6px; font-size: 8.5px; color: #374151; }}
  .meta div {{ margin: 1px 0; }}
  .summary {{
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 2px;
    background: #f8fafc;
    border: 1px solid #e5e7eb;
    padding: 4px 6px;
    margin-bottom: 4px;
    font-size: 8px;
    font-weight: 700;
  }}
  .notes {{ margin: 4px 0 8px; color: #374151; font-size: 8px; }}
  /* Multi-week / monthly: one employee per printed page. */
  .report-multi-week .employee-block {{
    break-before: page;
    page-break-before: always;
    margin: 0 0 8px;
    padding-top: 2px;
  }}
  /* Single-week: pack employees; keep each block intact. */
  .report-single-week .employee-block {{
    break-before: auto;
    page-break-before: auto;
    break-inside: avoid;
    page-break-inside: avoid;
    margin: 0 0 10px;
    padding-top: 2px;
    border-top: 1px solid #9ca3af;
  }}
  .report-single-week .employee-block:first-of-type {{
    border-top: 0;
    padding-top: 0;
  }}
  .employee-head {{
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: flex-start;
    break-after: avoid;
    page-break-after: avoid;
    background: #f4f6f9;
    padding: 3px 6px 3px 7px;
    margin: 0 0 3px;
  }}
  .emp-title {{ min-width: 0; flex: 1; }}
  .emp-kicker {{
    margin: 0 0 1px;
    font-size: 7.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: {REPORT_MUTED};
  }}
  .employee-block h2.emp-name {{
    margin: 0 0 1px;
    font-size: 12.5px;
    font-weight: 700;
    color: {REPORT_NAVY};
    line-height: 1.15;
    overflow-wrap: anywhere;
  }}
  .emp-email {{
    margin: 0 0 1px;
    font-size: 8.5px;
    font-weight: 400;
    color: {REPORT_MUTED};
    overflow-wrap: anywhere;
  }}
  .emp-role {{
    margin: 0;
    color: {REPORT_SLATE};
    font-size: 8px;
  }}
  .period-badge {{
    flex-shrink: 0;
    font-size: 8.5px;
    font-weight: 600;
    color: {REPORT_SLATE};
    white-space: nowrap;
    padding-top: 1px;
  }}
  .employee-summary {{
    margin: 2px 0 5px;
    border: 1px solid #9ca3af;
    background: #fff;
  }}
  .employee-summary .metrics {{
    display: grid;
    grid-template-columns: repeat(4, 1fr);
  }}
  .employee-summary .metrics div {{
    border: 1px solid #e5e7eb;
    padding: 2px 4px;
    text-align: center;
  }}
  .employee-summary span {{
    display: block;
    color: #4b5563;
    font-size: 7.5px;
    font-weight: 600;
  }}
  .employee-summary strong {{
    display: block;
    font-size: 9px;
    font-variant-numeric: tabular-nums;
  }}
  .employee-summary strong.money-gross {{ color: {REPORT_NAVY}; font-weight: 600; }}
  .employee-summary strong.money-cis,
  .employee-summary strong.money-other {{ color: {REPORT_SLATE}; font-weight: 500; }}
  .employee-summary .metric-net {{ background: #ecfdf5; }}
  .employee-summary strong.money-net {{ color: {REPORT_NET}; font-weight: 700; }}
  .week-block {{
    break-inside: avoid;
    page-break-inside: avoid;
    margin: 0 0 6px;
  }}
  .week-block h3 {{
    margin: 0 0 2px;
    font-size: 9px;
    break-after: avoid;
    page-break-after: avoid;
  }}
  table.days {{
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin: 0;
    border: 1px solid #9ca3af;
  }}
  table.days th, table.days td {{
    border: 1px solid #d1d5db;
    padding: 1.5px 3px;
    vertical-align: top;
    font-size: 8.5px;
  }}
  table.days th {{ background: #f3f4f6; text-align: left; font-size: 8px; }}
  table.days th.num, table.days td.num {{
    text-align: right;
    font-variant-numeric: tabular-nums;
    width: 15%;
  }}
  table.days td.site {{ width: 48%; word-wrap: break-word; overflow-wrap: anywhere; }}
  table.days td:first-child {{ width: 22%; }}
  table.days tr.week-foot td {{
    background: #f8fafc;
    font-size: 8px;
    border-top: 1px solid #6b7280;
  }}
  table.days tr.week-foot.band1 td {{
    font-weight: 700;
    background: #f3f4f6;
    vertical-align: middle;
  }}
  table.days td.status-cell {{
    text-align: right;
    width: 15%;
    white-space: nowrap;
  }}
  table.days tr.week-foot.band2 td {{
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    padding: 0;
  }}
  .money-row {{
    display: grid;
    grid-template-columns: repeat(4, 1fr);
  }}
  .money-row > span {{ padding: 2px 4px; }}
  table.days tr.week-foot .m-lab {{ color: {REPORT_MUTED}; font-weight: 600; }}
  table.days tr.week-foot .money-gross .m-val {{ color: {REPORT_NAVY}; font-weight: 600; }}
  table.days tr.week-foot .money-cis .m-val,
  table.days tr.week-foot .money-other .m-val {{ color: {REPORT_SLATE}; font-weight: 500; }}
  table.days tr.week-foot .money-net {{ background: #ecfdf5; }}
  table.days tr.week-foot .money-net .m-val {{ color: {REPORT_NET}; font-weight: 700; }}
  .muted {{ color: #6b7280; font-size: 8px; }}
  .status-badge {{
    display: inline-block;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #334155;
    font-weight: 700;
    font-size: 8px;
    line-height: 1.2;
    padding: 1px 5px;
    border-radius: 3px;
    white-space: nowrap;
  }}
  .status-badge-paid {{
    color: {STATUS_BADGE_COLORS["paid"][1]};
    background: {STATUS_BADGE_COLORS["paid"][0]};
    border-color: {STATUS_BADGE_COLORS["paid"][2]};
  }}
  .status-badge-approved {{
    color: {STATUS_BADGE_COLORS["approved"][1]};
    background: {STATUS_BADGE_COLORS["approved"][0]};
    border-color: {STATUS_BADGE_COLORS["approved"][2]};
  }}
  .status-badge-pending {{
    color: {STATUS_BADGE_COLORS["pending"][1]};
    background: {STATUS_BADGE_COLORS["pending"][0]};
    border-color: {STATUS_BADGE_COLORS["pending"][2]};
  }}
  .status-badge-danger {{
    color: {STATUS_BADGE_COLORS["danger"][1]};
    background: {STATUS_BADGE_COLORS["danger"][0]};
    border-color: {STATUS_BADGE_COLORS["danger"][2]};
  }}
  .status-badge-neutral {{
    color: {STATUS_BADGE_COLORS["neutral"][1]};
    background: {STATUS_BADGE_COLORS["neutral"][0]};
    border-color: {STATUS_BADGE_COLORS["neutral"][2]};
  }}
  .empty {{ text-align: center; color: #6b7280; }}
  .hint {{ margin-top: 8px; color: #6b7280; font-size: 8px; }}
  @page {{ size: A4 portrait; margin: 11mm; }}
  @media print {{
    body {{ background: #fff; padding: 0; font-size: 9px; }}
    .report-canvas {{ width: 100%; max-width: none; border: 0; padding: 0; box-shadow: none; }}
    .hint {{ display: none; }}
    .report-multi-week .employee-block {{ break-before: page; page-break-before: always; }}
    .report-single-week .employee-block {{
      break-before: auto;
      page-break-before: auto;
      break-inside: avoid;
      page-break-inside: avoid;
    }}
    .week-block {{ break-inside: avoid; page-break-inside: avoid; }}
    .employee-head, .employee-summary {{ break-after: avoid; page-break-after: avoid; }}
  }}
</style>
</head>
<body>
<main class="report-canvas {report_mode}">
  <h1>TimIQ Payroll Report</h1>
  <div class="meta">
    <div><strong>Company:</strong> {name}</div>
    <div><strong>Period:</strong> {html.escape(report.period_label)}</div>
    <div><strong>Filter:</strong> {html.escape(report.employee_filter_label)}</div>
    <div><strong>Timezone:</strong> {html.escape(report.timezone_name)}</div>
    <div><strong>Generated:</strong> {html.escape(report.generated_label)}</div>
  </div>
  <div class="summary" aria-label="Report summary">
    <div>Hours {report.total_hours_seconds / 3600:,.2f}</div>
    <div>Employees {report.employee_count}</div>
    <div>Gross {money_display(report.total_gross)}</div>
    <div>CIS {money_display(report.total_cis_tax)}</div>
    <div>Net {money_display(report.total_net)}</div>
  </div>
  <p class="notes">{html.escape(notes_text)}</p>
  {body_sections}
  <p class="hint">Use your browser Print dialog for a paper or PDF copy. Report is A4 portrait · adaptive employee pagination.</p>
</main>
</body></html>"""
