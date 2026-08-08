# Payroll / shift report — A4 portrait hierarchical layout

## Exact current printable-width problem

The previous range PDF/print path flattened **shift days** and **payroll week totals** into one wide horizontal table:

`Employee | Role | Period | Hours | OT | Gross | CIS | Net | Other | Status`

That caused:

- Employee name/role/status repeated on every day row
- Money columns filled with `—` on day rows (large empty columns)
- Long ISO period strings (`2026-07-27 to 2026-08-02`) inflating width
- Tiny body fonts / tight margins used only to squeeze content
- Horizontal overflow / clipped columns on A4 portrait at 100% print scale

Portrait page size alone was not enough; the **row model** was too wide.

## Columns removed from daily rows

Daily worked-days table keeps only:

| Day | Site | Hours | OT |

Optional: Role — only when roles differ within that week.

Removed from day rows:

- Employee name
- Employee email
- Role (when constant for the week — shown once under employee header)
- Period / ISO week range
- Gross
- CIS tax
- Other deductions
- Net
- Payroll status

Those money/status fields move to the **Weekly payroll** block under each week.

## Proposed A4 portrait geometry

| Setting | Value |
|--------|--------|
| Page | A4 portrait (`595.27 × 841.89` pt) |
| Left/right margins | 12 mm |
| Top / bottom | 12 mm / 14 mm (footer clearance) |
| Printable width | ~171 mm (~486 pt) |
| Body text | 10–11 pt |
| Employee / week headings | 12–14 pt / 11 pt |
| Landscape | Not used for the normal payroll report |

Day table column fractions of printable width:

| Day/date | Site (wrap ≤2 lines) | Hours (right) | OT (right) |
|---------|----------------------|---------------|------------|
| ~22% | ~48% | ~15% | ~15% |

Weekly payroll + employee totals: compact two-column label/value tables (~45% / 55%), not a second 9-column grid.

Money: `£` + 2 decimals, right-aligned; status title-cased (`Paid` / `Pending`).

Dates:

- Day: `Mon 3 Aug`
- Week: `W32 · 3–9 Aug 2026`

## Page-break rules

1. Prefer `KeepTogether` for: week heading + first day rows + weekly payroll block (as practical).
2. Avoid a break between the last worked day of a week and its Weekly payroll block.
3. Employee sections may continue across pages when long.
4. Continuation pages: repeat document footer (`TimIQ Payroll Report` + page numbers); do not re-print useless identity on every day row.
5. Zero-hour shifts are filtered out before layout so they do not consume space or force awkward breaks.

## Employee-section rules

```
EMPLOYEE: <name>
ROLE: <primary role>

<week blocks…>

Employee period/month total
  Days worked / Weeks worked / Hours / OT / Gross / CIS / Other / Net
```

- Identity once at section start (not per day).
- After all weeks for that employee, emit period totals, then the next employee.

## Week-section rules

```
WEEK <n> · <short range>

Day table (worked days only)
Weekly payroll (label/value: Hours, OT, Gross, CIS, Other, Net, Status)
```

- Next week for the **same** employee follows immediately.
- Do not put Gross/CIS/Net on day rows.

## Visual PDF / print verification plan

Generate sample PDFs (ReportLab) and render pages to PNG at ~2× (≈150 dpi). Inspect at 100% print scale:

| # | Scenario | Checks |
|---|----------|--------|
| 1 | 1 employee / 1 week | Structure matches preferred sample; no ISO day strings; name once |
| 2 | 1 employee / 5 weeks | Cross-month week labels; pending + paid; long site wrap; multi-role column only when needed |
| 3 | 10 employees | Compact stacking; no right overflow; footers clear of content |
| 4 | Zero-hour noise | `0.00` Friday absent from day table |
| * | Long names / sites | Two-line wrap; Hours/OT stay narrow |
| * | Pending vs paid | Status visible, badge/text not overflowing |

Pass criteria (all scenarios):

- Page size A4 portrait
- Content + table borders inside left/right margins (no positive overflow beyond printable edge)
- No horizontal scroll model in print HTML (`overflow-x` not required)
- No tiny <10 pt body font used only to fit width
- Money and status remain visible
- Page footer does not overlap body content

Artifacts (local, not committed): `.tmp-payroll-a4-samples/*.pdf`, `images/*.png`, `metrics.json`.

### Visual verification results (2026-08-08)

Rendered ReportLab PDFs → PNG at 2× and inspected:

| Scenario | Pages | Overflow | Notes |
|----------|-------|----------|-------|
| 1 emp / 1 week | 1 | none (content x 34–561 pt inside 12 mm margins) | Matches preferred structure; name once; `Paid` status |
| 1 emp / 5 weeks | 3 | none | Long site wrap ≤2 lines; cross-month labels; Paid + Pending on last week; employee month total |
| 10 employees | 11 | none | Long names; mixed sites; footers clear |
| Zero-hour noise | 1 | none | PDF identical size to 1-week baseline (0 h row dropped) |

All pages A4 portrait (`595.3 × 841.9` pt). No long ISO period strings in body text.

## Implementation map

| Piece | Path |
|-------|------|
| Hierarchy builder | `apps/api/app/modules/payroll/hierarchical_report.py` |
| Print HTML | `apps/api/app/modules/payroll/print_html.py` |
| PDF | `apps/api/app/modules/payroll/pdf_export.py` |
| Wiring | `apps/api/app/modules/payroll/service.py` (`export_print_html`, `export_pdf_report`) |
| Tests | `apps/api/tests/test_payroll_report_print_layout.py` |
