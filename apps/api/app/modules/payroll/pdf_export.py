"""ReportLab A4-portrait payroll report — compact employee pages."""

from __future__ import annotations

import html
from datetime import date, datetime, timezone
from decimal import Decimal
from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
    HRFlowable,
)

from app.modules.payroll.hierarchical_report import (
    REPORT_HEADER_TINT,
    REPORT_MUTED,
    REPORT_NAVY,
    REPORT_NET,
    REPORT_SLATE,
    STATUS_BADGE_COLORS,
    PayrollEmployeeBlock,
    PayrollHierarchicalReport,
    PayrollWeekBlock,
    employee_identity_lines,
    employee_role_line,
    employee_summary_badge,
    hours_display,
    is_single_week_report,
    money_display,
    status_badge_kind,
    status_display,
)

_PAGE_WIDTH, _PAGE_HEIGHT = A4
_MARGIN_X = 11 * mm
_MARGIN_TOP = 10 * mm
_MARGIN_BOTTOM = 12 * mm
_PRINTABLE_WIDTH = _PAGE_WIDTH - (2 * _MARGIN_X)

# Day | Site | Hours | OT  (~22 / 48 / 15 / 15)
_DAY_COL_FRACS = (0.22, 0.48, 0.15, 0.15)
_DAY_COL_WIDTHS = [round(_PRINTABLE_WIDTH * f, 4) for f in _DAY_COL_FRACS]
_DAY_COL_WIDTHS[1] = _PRINTABLE_WIDTH - _DAY_COL_WIDTHS[0] - _DAY_COL_WIDTHS[2] - _DAY_COL_WIDTHS[3]

# Body text target: ~8.5–9.5pt (never below ~8.5 for readability).
_BODY_PT = 9.0
_MIN_BODY_PT = 8.5


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(text or "—").replace("\n", "<br/>"), style)


def _p_html(markup: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(markup, style)


class _NumberedCanvas(pdf_canvas.Canvas):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._saved_page_states: list[dict[str, Any]] = []
        self._continued_name: str | None = None

    def showPage(self) -> None:  # noqa: N802
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        page_count = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self._draw_page_footer(page_count)
            super().showPage()
        super().save()

    def _draw_page_footer(self, page_count: int) -> None:
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#6b7280"))
        y = 5.5 * mm
        self.drawString(_MARGIN_X, y, "TimIQ Payroll Report")
        self.drawRightString(_PAGE_WIDTH - _MARGIN_X, y, f"Page {self._pageNumber} of {page_count}")
        self.restoreState()


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "PRTitle",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=14,
            spaceAfter=2,
            textColor=colors.HexColor("#111827"),
        ),
        "meta": ParagraphStyle(
            "PRMeta",
            parent=base["Normal"],
            fontSize=8.5,
            leading=10,
            textColor=colors.HexColor("#374151"),
        ),
        "emp": ParagraphStyle(
            "PREmp",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=14,
            spaceBefore=0,
            spaceAfter=0,
            textColor=colors.HexColor(REPORT_NAVY),
        ),
        "emp_kicker": ParagraphStyle(
            "PREmpKicker",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=9.5,
            spaceBefore=0,
            spaceAfter=0,
            textColor=colors.HexColor(REPORT_MUTED),
        ),
        "emp_email": ParagraphStyle(
            "PREmpEmail",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8.5,
            leading=10.5,
            spaceBefore=0,
            spaceAfter=0,
            textColor=colors.HexColor(REPORT_MUTED),
        ),
        "emp_role": ParagraphStyle(
            "PREmpRole",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=10,
            spaceBefore=0,
            spaceAfter=0,
            textColor=colors.HexColor(REPORT_SLATE),
        ),
        "emp_badge": ParagraphStyle(
            "PREmpBadge",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8.5,
            leading=10.5,
            alignment=TA_RIGHT,
            textColor=colors.HexColor(REPORT_SLATE),
        ),
        "emp_cont": ParagraphStyle(
            "PREmpCont",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=12,
            textColor=colors.HexColor("#111827"),
        ),
        "week": ParagraphStyle(
            "PRWeek",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=11,
            spaceBefore=0,
            spaceAfter=1,
            textColor=colors.HexColor("#111827"),
        ),
        "cell": ParagraphStyle(
            "PRCell",
            parent=base["Normal"],
            fontSize=_BODY_PT,
            leading=10.5,
            textColor=colors.HexColor("#111827"),
        ),
        "cell_r": ParagraphStyle(
            "PRCellR",
            parent=base["Normal"],
            fontSize=_BODY_PT,
            leading=10.5,
            alignment=TA_RIGHT,
            textColor=colors.HexColor("#111827"),
        ),
        "hdr": ParagraphStyle(
            "PRHdr",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=9.5,
            textColor=colors.HexColor("#111827"),
        ),
        "hdr_r": ParagraphStyle(
            "PRHdrR",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=9.5,
            alignment=TA_RIGHT,
            textColor=colors.HexColor("#111827"),
        ),
        "label": ParagraphStyle(
            "PRLabel",
            parent=base["Normal"],
            fontSize=8,
            leading=9.5,
            textColor=colors.HexColor("#4b5563"),
        ),
        "value": ParagraphStyle(
            "PRValue",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8.5,
            leading=10,
            alignment=TA_RIGHT,
            textColor=colors.HexColor("#111827"),
        ),
        "metric": ParagraphStyle(
            "PRMetric",
            parent=base["Normal"],
            fontSize=8,
            leading=9.5,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#4b5563"),
        ),
        "metric_v": ParagraphStyle(
            "PRMetricV",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=11,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#111827"),
        ),
        "metric_v_gross": ParagraphStyle(
            "PRMetricGross",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=11,
            alignment=TA_CENTER,
            textColor=colors.HexColor(REPORT_NAVY),
        ),
        "metric_v_muted": ParagraphStyle(
            "PRMetricMuted",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=11,
            alignment=TA_CENTER,
            textColor=colors.HexColor(REPORT_SLATE),
        ),
        "metric_v_net": ParagraphStyle(
            "PRMetricNet",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=11,
            alignment=TA_CENTER,
            textColor=colors.HexColor(REPORT_NET),
        ),
        "money_cell": ParagraphStyle(
            "PRMoneyCell",
            parent=base["Normal"],
            fontSize=8,
            leading=9.5,
            textColor=colors.HexColor("#111827"),
        ),
        "money_cell_r": ParagraphStyle(
            "PRMoneyCellR",
            parent=base["Normal"],
            fontSize=8,
            leading=9.5,
            alignment=TA_RIGHT,
            textColor=colors.HexColor("#111827"),
        ),
        "footer": ParagraphStyle(
            "PRWeekFoot",
            parent=base["Normal"],
            fontSize=8,
            leading=9.5,
            textColor=colors.HexColor("#111827"),
        ),
        "footer_b": ParagraphStyle(
            "PRWeekFootB",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=9.5,
            textColor=colors.HexColor("#111827"),
        ),
        "notes": ParagraphStyle(
            "PRNotes",
            parent=base["Normal"],
            fontSize=8,
            leading=9.5,
            textColor=colors.HexColor("#374151"),
        ),
        "small": ParagraphStyle(
            "PRSmall",
            parent=base["Normal"],
            fontSize=8,
            leading=9.5,
            textColor=colors.HexColor("#6b7280"),
        ),
    }


def _compact_report_summary(report: PayrollHierarchicalReport, s: dict[str, ParagraphStyle]) -> Table:
    row = [
        _p(f"Hours {report.total_hours_seconds / 3600:,.2f}", s["footer_b"]),
        _p(f"Employees {report.employee_count}", s["footer_b"]),
        _p(f"Gross {money_display(report.total_gross)}", s["footer_b"]),
        _p(f"CIS {money_display(report.total_cis_tax)}", s["footer_b"]),
        _p(f"Net {money_display(report.total_net)}", s["footer_b"]),
    ]
    w = _PRINTABLE_WIDTH / 5
    table = Table([row], colWidths=[w] * 5)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#e5e7eb")),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7eb")),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ],
        ),
    )
    return table


def _money_pair(label: str, amount: str, *, amount_color: str, strong: bool, right: bool, s: dict[str, ParagraphStyle]) -> Paragraph:
    weight_open, weight_close = ("<b>", "</b>") if strong else ("", "")
    markup = (
        f'<font color="{REPORT_MUTED}">{html.escape(label)}</font> '
        f'<font color="{amount_color}">{weight_open}{html.escape(amount)}{weight_close}</font>'
    )
    return _p_html(markup, s["money_cell_r"] if right else s["money_cell"])


def _status_badge(status: str) -> Table:
    kind = status_badge_kind(status)
    bg, fg, border = STATUS_BADGE_COLORS[kind]
    label = status_display(status)
    badge_style = ParagraphStyle(
        f"PRStatusBadge_{kind}",
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        alignment=TA_CENTER,
        textColor=colors.HexColor(fg),
    )
    badge = Table([[Paragraph(html.escape(label), badge_style)]])
    badge.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg)),
                ("BOX", (0, 0), (-1, -1), 0.45, colors.HexColor(border)),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 0.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0.5),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ],
        ),
    )
    wrap = Table([[badge]])
    wrap.setStyle(
        TableStyle(
            [
                ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ],
        ),
    )
    return wrap


def _employee_summary_table(
    report: PayrollHierarchicalReport,
    emp: PayrollEmployeeBlock,
    s: dict[str, ParagraphStyle],
) -> list[Any]:
    badge = employee_summary_badge(report, emp)
    primary, email_line = employee_identity_lines(emp)
    identity_rows: list[list[Any]] = [
        [_p("EMPLOYEE", s["emp_kicker"])],
        [_p(primary, s["emp"])],
    ]
    if email_line:
        identity_rows.append([_p(email_line, s["emp_email"])])
    identity_rows.append([_p(employee_role_line(emp), s["emp_role"])])
    identity = Table(identity_rows, colWidths=[_PRINTABLE_WIDTH * 0.72])
    identity.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0.4),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ],
        ),
    )
    head = Table(
        [[identity, _p(badge, s["emp_badge"])]],
        colWidths=[_PRINTABLE_WIDTH * 0.72, _PRINTABLE_WIDTH * 0.28],
    )
    head.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(REPORT_HEADER_TINT)),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                ("LEFTPADDING", (0, 0), (0, -1), 5),
                ("LEFTPADDING", (1, 0), (1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ],
        ),
    )
    metrics = Table(
        [
            [
                _p("Days", s["metric"]),
                _p("Weeks", s["metric"]),
                _p("Hours", s["metric"]),
                _p("OT", s["metric"]),
            ],
            [
                _p(str(emp.days_worked), s["metric_v"]),
                _p(str(emp.weeks_worked), s["metric_v"]),
                _p(hours_display(emp.hours), s["metric_v"]),
                _p(hours_display(emp.ot_hours), s["metric_v"]),
            ],
            [
                _p("Gross", s["metric"]),
                _p("CIS", s["metric"]),
                _p("Other ded.", s["metric"]),
                _p("Net", s["metric"]),
            ],
            [
                _p(money_display(emp.gross), s["metric_v_gross"]),
                _p(money_display(emp.cis_tax), s["metric_v_muted"]),
                _p(money_display(emp.other_deductions), s["metric_v_muted"]),
                _p(money_display(emp.net), s["metric_v_net"]),
            ],
        ],
        colWidths=[_PRINTABLE_WIDTH * 0.25] * 4,
    )
    metrics.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                ("BACKGROUND", (0, 2), (-1, 2), colors.HexColor("#f3f4f6")),
                ("BACKGROUND", (3, 3), (3, 3), colors.HexColor("#ecfdf5")),
                ("BOX", (0, 0), (-1, -1), 0.45, colors.HexColor("#9ca3af")),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 1.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ],
        ),
    )
    return [head, Spacer(1, 1.2 * mm), metrics, Spacer(1, 1.6 * mm)]


def _week_unit_bits(week: PayrollWeekBlock, s: dict[str, ParagraphStyle]) -> list[Any]:
    day_data: list[list[Any]] = [
        [
            _p("Day", s["hdr"]),
            _p("Site", s["hdr"]),
            _p("Hours", s["hdr_r"]),
            _p("OT", s["hdr_r"]),
        ],
    ]
    if week.days:
        for day in week.days:
            site = day.site
            if day.role:
                site = f"{site}\n({day.role})"
            day_data.append(
                [
                    _p(day.day_label, s["cell"]),
                    _p(site, s["cell"]),
                    _p(hours_display(day.hours), s["cell_r"]),
                    _p(hours_display(day.ot_hours) if day.ot_hours is not None else "—", s["cell_r"]),
                ],
            )
    else:
        day_data.append(
            [
                _p("—", s["cell"]),
                _p("No worked days with payable hours", s["cell"]),
                _p("—", s["cell_r"]),
                _p("—", s["cell_r"]),
            ],
        )

    days_count = len(week.days)
    metrics_band = (
        f"Days {days_count} · Hours {hours_display(week.hours)} · "
        f"OT {hours_display(week.ot_hours)}"
    )
    money_w = _PRINTABLE_WIDTH / 4
    money_row = Table(
        [
            [
                _money_pair("Gross", money_display(week.gross), amount_color=REPORT_NAVY, strong=True, right=False, s=s),
                _money_pair("CIS", money_display(week.cis_tax), amount_color=REPORT_SLATE, strong=False, right=False, s=s),
                _money_pair("Other", money_display(week.other_deductions), amount_color=REPORT_SLATE, strong=False, right=False, s=s),
                _money_pair("Net", money_display(week.net), amount_color=REPORT_NET, strong=True, right=True, s=s),
            ],
        ],
        colWidths=[money_w] * 4,
    )
    money_row.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (2, 0), colors.HexColor("#f8fafc")),
                ("BACKGROUND", (3, 0), (3, 0), colors.HexColor("#ecfdf5")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ],
        ),
    )
    day_data.append([_p(metrics_band, s["footer_b"]), "", "", _status_badge(week.status)])
    day_data.append([money_row, "", "", ""])

    last = len(day_data) - 1
    days_table = Table(day_data, colWidths=_DAY_COL_WIDTHS)
    style_cmds: list[tuple[Any, ...]] = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
        ("BOX", (0, 0), (-1, -1), 0.45, colors.HexColor("#9ca3af")),
        ("INNERGRID", (0, 0), (-1, last - 2), 0.3, colors.HexColor("#d1d5db")),
        ("LINEABOVE", (0, last - 1), (-1, last - 1), 0.6, colors.HexColor("#6b7280")),
        ("SPAN", (0, last - 1), (2, last - 1)),
        ("SPAN", (0, last), (-1, last)),
        ("BACKGROUND", (0, last - 1), (-1, last - 1), colors.HexColor("#f3f4f6")),
        ("VALIGN", (0, 0), (-1, last - 2), "TOP"),
        ("VALIGN", (0, last - 1), (-1, last), "MIDDLE"),
        ("ALIGN", (3, last - 1), (3, last - 1), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        ("ALIGN", (2, 0), (-1, last - 2), "RIGHT"),
        ("LEFTPADDING", (0, last), (-1, last), 0),
        ("RIGHTPADDING", (0, last), (-1, last), 0),
        ("TOPPADDING", (0, last), (-1, last), 0),
        ("BOTTOMPADDING", (0, last), (-1, last), 0),
    ]
    days_table.setStyle(TableStyle(style_cmds))
    return [
        _p(week.week_label, s["week"]),
        days_table,
        Spacer(1, 1.5 * mm),
    ]


def _week_unit(week: PayrollWeekBlock, s: dict[str, ParagraphStyle]) -> KeepTogether:
    return KeepTogether(_week_unit_bits(week, s))


def _employee_divider() -> list[Any]:
    return [
        Spacer(1, 1.2 * mm),
        HRFlowable(
            width="100%",
            thickness=0.7,
            color=colors.HexColor("#9ca3af"),
            spaceBefore=0,
            spaceAfter=0,
        ),
        Spacer(1, 1.6 * mm),
    ]


def _employee_story_bits(
    report: PayrollHierarchicalReport,
    emp: PayrollEmployeeBlock,
    s: dict[str, ParagraphStyle],
    *,
    keep_whole_block: bool,
) -> list[Any]:
    """Build flowables for one employee.

    When keep_whole_block is True (single-week packing), wrap identity + summary +
    all weeks in one KeepTogether so the block does not split mid-page.
    """
    header = _employee_summary_table(report, emp, s)
    if not emp.weeks:
        return [KeepTogether(header)]
    if keep_whole_block:
        bits: list[Any] = [*header]
        for week in emp.weeks:
            bits.extend(_week_unit_bits(week, s))
        return [KeepTogether(bits)]
    first_bits = [*header, *_week_unit_bits(emp.weeks[0], s)]
    out: list[Any] = [KeepTogether(first_bits)]
    for week in emp.weeks[1:]:
        out.append(_week_unit(week, s))
    return out


def build_hierarchical_payroll_pdf(report: PayrollHierarchicalReport) -> bytes:
    s = _styles()
    assert _BODY_PT >= _MIN_BODY_PT
    single_week = is_single_week_report(report)

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=_MARGIN_X,
        rightMargin=_MARGIN_X,
        topMargin=_MARGIN_TOP,
        bottomMargin=_MARGIN_BOTTOM,
        title="TimIQ Payroll Report",
        author="TimIQ",
    )
    story: list[Any] = []

    # Compact report header (page 1 — not repeated per employee).
    story.append(_p("TimIQ Payroll Report", s["title"]))
    story.append(_p(f"Company: {report.company_name}", s["meta"]))
    story.append(_p(f"Period: {report.period_label}", s["meta"]))
    story.append(_p(f"Filter: {report.employee_filter_label}", s["meta"]))
    story.append(_p(f"Timezone: {report.timezone_name}", s["meta"]))
    story.append(_p(f"Generated: {report.generated_label}", s["small"]))
    story.append(Spacer(1, 1.5 * mm))
    story.append(_compact_report_summary(report, s))
    note_body = " · ".join(report.alert_lines) if report.alert_lines else "No additional notes for this report."
    story.append(Spacer(1, 1 * mm))
    story.append(_p(f"Notes: {note_body}", s["notes"]))

    if not report.employees:
        story.append(Spacer(1, 2 * mm))
        story.append(_p("No payable payroll rows for this selected range.", s["meta"]))
    elif single_week:
        # Single payroll week: pack complete employee blocks onto shared pages.
        story.append(Spacer(1, 2 * mm))
        for emp_index, emp in enumerate(report.employees):
            if emp_index > 0:
                story.extend(_employee_divider())
            story.extend(_employee_story_bits(report, emp, s, keep_whole_block=True))
    else:
        # Multi-week / monthly: each employee begins on a fresh page.
        for emp in report.employees:
            story.append(PageBreak())
            story.extend(_employee_story_bits(report, emp, s, keep_whole_block=False))

    doc.build(story, canvasmaker=_NumberedCanvas)
    return buf.getvalue()


# Public geometry constants (tests + layout math).
_COL_WIDTHS = _DAY_COL_WIDTHS


def build_payroll_report_pdf(
    *,
    company_name: str,
    week_start: date,
    week_end: date,
    timezone_name: str,
    rows: list[dict[str, Any]],
    total_hours_seconds: int,
    total_gross: Decimal | None,
    total_cis_tax: Decimal | None,
    total_net: Decimal | None,
    alert_lines: list[str],
    period_label: str | None = None,
    employee_filter_label: str = "All employees",
    generated_label: str | None = None,
) -> bytes:
    """Compatibility shim: map legacy flat rows into hierarchical PDF layout."""
    from app.modules.payroll.hierarchical_report import (
        build_hierarchical_payroll_report,
        format_week_label,
    )

    shift_rows: list[dict[str, Any]] = []
    payroll_rows: list[dict[str, Any]] = []
    for row in rows:
        period = str(row.get("period") or "")
        looks_like_day = len(period) == 10 and period[4] == "-" and period[7] == "-"
        hours_raw = str(row.get("hours") or "").strip()
        try:
            hours_val = Decimal(hours_raw) if hours_raw and hours_raw not in {"—", "-"} else Decimal("0")
        except Exception:
            hours_val = Decimal("0")
        if looks_like_day or (
            str(row.get("gross") or "—") in {"—", "-", ""} and hours_val > 0 and " to " not in period
        ):
            shift_rows.append(
                {
                    "user_id": row.get("user_id") or row.get("employee_email") or row.get("employee"),
                    "employee": row.get("employee"),
                    "employee_email": row.get("employee_email") or "",
                    "role": row.get("role") or "—",
                    "period": week_start.isoformat(),
                    "shift_date": period if looks_like_day else week_start.isoformat(),
                    "location": row.get("location") or row.get("site") or "—",
                    "hours": row.get("hours") or "0",
                    "ot_hours": row.get("ot_hours") or "",
                    "status": row.get("status") or "completed",
                },
            )
        else:
            payroll_rows.append(
                {
                    "user_id": row.get("user_id") or row.get("employee_email") or row.get("employee"),
                    "employee": row.get("employee"),
                    "employee_email": row.get("employee_email") or "",
                    "role": row.get("role") or "—",
                    "period": period if " to " in period else f"{week_start.isoformat()} to {week_end.isoformat()}",
                    "hours": row.get("hours") or "0",
                    "ot_hours": row.get("ot_hours") or "0",
                    "gross": row.get("gross"),
                    "cis_tax": row.get("cis_tax"),
                    "net": row.get("net"),
                    "other_deductions": row.get("other_deductions"),
                    "status": row.get("status") or "—",
                },
            )

    label = period_label or format_week_label(week_start, week_end)
    report = build_hierarchical_payroll_report(
        company_name=company_name,
        period_label=label,
        timezone_name=timezone_name,
        employee_filter_label=employee_filter_label,
        generated_label=generated_label
        or datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC"),
        alert_lines=alert_lines,
        shift_rows=shift_rows,
        payroll_rows=payroll_rows,
        total_hours_seconds=total_hours_seconds,
        total_gross=total_gross,
        total_cis_tax=total_cis_tax,
        total_net=total_net,
    )
    return build_hierarchical_payroll_pdf(report)


def build_payroll_item_payslip_pdf(
    *,
    company_name: str,
    employee_name: str,
    employee_email: str,
    job_title: str | None,
    week_start: date,
    week_end: date,
    timezone_name: str,
    payment_mode: str,
    status: str,
    regular_seconds: int,
    overtime_seconds: int,
    rounded_total_seconds: int,
    hourly_rate: Decimal | None,
    overtime_rate: Decimal | None,
    tax_rate: Decimal | None,
    tax_label: str,
    gross_amount: Decimal | None,
    tax_amount: Decimal | None,
    other_deductions_amount: Decimal,
    net_amount: Decimal | None,
    rate_missing: bool,
    generated_at: datetime | None = None,
) -> bytes:
    """Single-item payslip PDF (CIS-aware labels via tax_label)."""
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "PayslipTitle",
        parent=styles["Heading1"],
        fontSize=14,
        spaceAfter=6,
        textColor=colors.HexColor("#111827"),
    )
    meta_style = ParagraphStyle(
        "PayslipMeta",
        parent=styles["Normal"],
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#374151"),
    )
    label_style = ParagraphStyle(
        "PayslipLabel",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.HexColor("#4b5563"),
    )
    value_style = ParagraphStyle(
        "PayslipValue",
        parent=styles["Normal"],
        fontSize=9,
        alignment=TA_RIGHT,
        textColor=colors.HexColor("#111827"),
    )

    def _hours(seconds: int) -> str:
        return f"{seconds / 3600:.2f}"

    def _money(value: Decimal | None) -> str:
        if value is None:
            return "—"
        return f"£{value:,.2f}"

    def _rate(value: Decimal | None) -> str:
        if value is None:
            return "—"
        return f"£{value:,.2f}/hr"

    def _cell(text: str, style: ParagraphStyle) -> Paragraph:
        return Paragraph(html.escape(text), style)

    generated = generated_at or datetime.now(timezone.utc)
    if generated.tzinfo is None:
        generated = generated.replace(tzinfo=timezone.utc)

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=f"TimIQ Payslip {week_start.isoformat()}",
        author="TimIQ",
    )
    story: list[Any] = []
    story.append(_cell("TimIQ Payslip", title_style))
    story.append(_cell(f"Company: {company_name}", meta_style))
    story.append(_cell(f"Employee: {employee_name}", meta_style))
    story.append(_cell(f"Email: {employee_email}", meta_style))
    if job_title:
        story.append(_cell(f"Role: {job_title}", meta_style))
    story.append(
        _cell(
            f"Period: {week_start.isoformat()} → {week_end.isoformat()} ({timezone_name})",
            meta_style,
        ),
    )
    story.append(_cell(f"Payment mode: {payment_mode}", meta_style))
    story.append(_cell(f"Status: {status}", meta_style))
    story.append(
        _cell(
            f"Generated: {generated.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
            meta_style,
        ),
    )
    if rate_missing:
        story.append(_cell("Warning: hourly rate missing for this item.", meta_style))
    story.append(Spacer(1, 4 * mm))

    rows = [
        [_cell("Regular hours", label_style), _cell(_hours(regular_seconds), value_style)],
        [_cell("Overtime hours", label_style), _cell(_hours(overtime_seconds), value_style)],
        [_cell("Total hours", label_style), _cell(_hours(rounded_total_seconds), value_style)],
        [_cell("Hourly rate", label_style), _cell(_rate(hourly_rate), value_style)],
        [_cell("Overtime rate", label_style), _cell(_rate(overtime_rate), value_style)],
        [
            _cell(f"{tax_label} rate", label_style),
            _cell("—" if tax_rate is None else f"{tax_rate:.2f}%", value_style),
        ],
        [_cell("Gross", label_style), _cell(_money(gross_amount), value_style)],
        [_cell(tax_label, label_style), _cell(_money(tax_amount), value_style)],
        [_cell("Other deductions", label_style), _cell(_money(other_deductions_amount), value_style)],
        [_cell("Net", label_style), _cell(_money(net_amount), value_style)],
    ]
    table = Table(rows, colWidths=[100 * mm, 70 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d1d5db")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#ecfdf5")),
            ],
        ),
    )
    story.append(table)
    story.append(Spacer(1, 6 * mm))
    story.append(
        _cell(
            "This payslip is generated from the stored payroll item for the selected week.",
            meta_style,
        ),
    )

    def _footer(canvas: pdf_canvas.Canvas, doc_obj: SimpleDocTemplate) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#6b7280"))
        y = 10 * mm
        canvas.drawString(doc_obj.leftMargin, y, "TimIQ Payslip")
        canvas.drawRightString(doc_obj.pagesize[0] - doc_obj.rightMargin, y, f"Page {doc_obj.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
