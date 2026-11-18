# TIMIQ Finance - Metric / Formula / API / Source Matrix (V3)

**Scope:** Finance Core only (worktree `ui-finance-redesign-v2`).
**Rule:** Every displayed total must reconcile to contributions, or show **SOURCE BREAKDOWN UNAVAILABLE - NOT VERIFIED**.

## Authoritative forecast composition

From `compose_cvr_forecast` (`apps/api/app/modules/finance/cvr_forecast.py`):

```
approved_contract = original_contract + approved_variations + approved_dayworks_in_contract
actual_incurred   = actual_eligible_cost + cis_labour_gross
forecast_final    = actual_incurred + open_commitment + cost_to_complete   # CTC required
forecast_profit   = approved_contract - forecast_final                      # contract required
margin_%          = profit / approved_contract * 100
```

Missing CTC -> Forecast Final Cost / Profit = `missing` (never forced to 0).

| Metric | Formula / field | API | Source records | Reconcilable |
|---|---|---|---|---|
| Original Contract | Latest finance_contract_values.amount | GET /api/finance/cvr | No revision list | NO |
| Approved Variations | Sum approved variations | GET /cvr + registers/variations | Variation rows | YES |
| Approved Dayworks in Contract | Sum approved dayworks with counts_in_contract_value | GET /cvr + registers/dayworks | Daywork rows | YES |
| Contract / Approved Value | original + variations + dayworks | GET /cvr | Partial (contract history missing) | PARTIAL |
| Approved Budget | Sum approved budget lines | GET /cvr + /budgets | Version totals only | PARTIAL |
| Actual Eligible Cost | Sum posted amount_eligible allocations | GET /cvr + GET /cvr/source-breakdown | Allocation to document | YES (new GET) |
| CIS Labour Gross | Sum posted CIS project splits | GET /cvr | No split register | NO |
| Cost to Date / Actual Incurred | eligible + CIS gross (once) | GET /cvr + GET /cvr/source-breakdown?metric=cost_to_date | Eligible docs YES; CIS split register NO | PARTIAL (Diff 0 still PARTIAL) |
| Open Commitments | committed - draws | GET /cvr + registers/commitments | Commitments YES; draws NO | PARTIAL |
| Additional CTC | Latest CTC estimate | GET /cvr | No revision list | NO |
| Forecast Final Cost | incurred + open + CTC | Derived | Inherits gaps | PARTIAL |
| Forecast Profit / Margin % | contract - final | Derived | Inherits gaps | PARTIAL |
| Customer Invoiced / Cash / Outstanding | As-of or registers | GET /cvr/as-of, registers | Invoice/receipt rows | YES |
| Supplier outstanding / Gross / Paid / Credits | Company liability | GET /supplier-position, supplier-invoices | Documents | YES company-wide |
| Certified Value | Sum posted certificates (unvalidated) | GET /cvr/as-of + certificates | Certificate rows | PARTIAL |
| Internal VOW | Experimental / missing in Core | - | - | NO |
| Cost categories | GROUP BY cost code eligible | GET /cost-categories + source-breakdown | Aggregate + lines | YES via breakdown |

## BLOCKED (cannot fake)

1. Contract value revision history list
2. CTC revision history list
3. CIS project splits register
4. Commitment draws register
5. Budget line / cost-code JOIN drilldown
6. Internal VOW / monthly snapshot Core history
7. Supplier outstanding as project KPI (company-wide by design)
8. Invented monthly snapshots / previous forecasts

## Pilot / safety

- All Finance GETs remain behind module + company + pilot guards.
- Preview / LIVE pilot stays READ-ONLY for mutations.
- DEMO fixtures only on `/dev/finance-visual` (production `notFound()`).
