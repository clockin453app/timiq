"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui";
import type { BudgetCategoryTotals, BudgetFinancialSummaryResponse } from "@/features/budgets/api";
import {
  BudgetCategoryBreakdown,
  BudgetMetricRow,
  BudgetOverviewPanel,
  BudgetUsageProgress,
  BudgetWarningStrip,
  moneyDisplay,
  percentDisplay,
} from "./budget-ui";

const CATEGORY_KEYS = [
  "materials",
  "tools",
  "equipment",
  "subcontractor",
  "plant_hire",
  "transport",
  "other",
] as const;

type CategoryEntry = { key: (typeof CATEGORY_KEYS)[number]; amount: number };

function categoryAmount(cats: BudgetCategoryTotals, key: (typeof CATEGORY_KEYS)[number]): number {
  const n = Number(cats[key]);
  return Number.isFinite(n) ? n : 0;
}

function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return NaN;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

export function BudgetOverviewFinancial(props: {
  summary: BudgetFinancialSummaryResponse;
  breakdownByCategory?: BudgetCategoryTotals | null;
  showZeroCategories: boolean;
  onToggleZeroCategories: () => void;
  hasOperationalSite: boolean;
  canEdit: boolean;
  onEditBudget: () => void;
  labourHelpOpen: boolean;
  onToggleLabourHelp: () => void;
}) {
  const cost = props.summary.cost_position;
  const billing = props.summary.billing_position;
  const profit = props.summary.profitability;

  const overBudget = num(cost.over_budget_amount) > 0;
  const costPct = num(cost.budget_used_percent);
  const costPctBar = Number.isFinite(costPct) ? Math.max(0, costPct) : 0;

  const contractNet = billing.contract_value_net;
  const contractConfigured = contractNet !== null && contractNet !== undefined;
  const overInvoicedAmt = num(billing.over_invoiced);
  const isOverInvoiced = Number.isFinite(overInvoicedAmt) && overInvoicedAmt > 0;
  const overdueGross = num(billing.overdue_outstanding_gross);
  const hasOverdue = Number.isFinite(overdueGross) && overdueGross > 0;

  let invoicedPct = NaN;
  if (contractConfigured) {
    const contract = num(contractNet);
    const invoiced = num(billing.active_invoiced_net);
    if (contract > 0 && Number.isFinite(invoiced)) {
      invoicedPct = (invoiced / contract) * 100;
    } else if (contract === 0 && invoiced > 0) {
      invoicedPct = 100;
    } else if (contract === 0) {
      invoicedPct = 0;
    }
  }

  const forecastProfit = num(profit.forecast_profit);
  const profitNegative = Number.isFinite(forecastProfit) && forecastProfit < 0;

  const categoryRows: { nonZero: CategoryEntry[]; zeros: CategoryEntry[] } = (() => {
    if (!props.breakdownByCategory) {
      return { nonZero: [], zeros: [] };
    }
    const entries = CATEGORY_KEYS.map((key) => ({
      key,
      amount: categoryAmount(props.breakdownByCategory!, key),
    }));
    return {
      nonZero: entries.filter((e) => e.amount > 0),
      zeros: entries.filter((e) => e.amount === 0),
    };
  })();

  const zeroToggle: ReactNode =
    categoryRows.zeros.length > 0 ? (
      <button
        className="min-h-[44px] text-xs font-medium text-[var(--color-text-muted)] underline decoration-dotted hover:text-[var(--color-text)]"
        type="button"
        onClick={props.onToggleZeroCategories}
      >
        {props.showZeroCategories ? "Hide zero categories" : "Show zero categories"}
      </button>
    ) : null;

  return (
    <div className="min-w-0 max-w-full space-y-4">
      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
        <BudgetOverviewPanel title="Cost position">
          <BudgetMetricRow label="Planned cost budget" value={moneyDisplay(cost.planned_budget_amount)} />
          <BudgetMetricRow label="Forecast total cost" value={moneyDisplay(cost.forecast_total_cost)} />
          <BudgetMetricRow
            label={overBudget ? "Over budget" : "Cost budget remaining"}
            value={
              overBudget ? moneyDisplay(cost.over_budget_amount) : moneyDisplay(cost.remaining_budget)
            }
            valueClassName={overBudget ? "text-[var(--color-danger-700)]" : undefined}
          />
          <BudgetUsageProgress
            ariaLabel="% of cost budget used"
            isOver={overBudget}
            percentUsedDisplay={percentDisplay(cost.budget_used_percent)}
            percentUsedNumeric={costPctBar}
          />
          <BudgetMetricRow label="Finalised labour" value={moneyDisplay(cost.finalized_labour_cost)} />
          <BudgetMetricRow label="Estimated labour" value={moneyDisplay(cost.estimated_labour_cost)} />
          <BudgetMetricRow label="Purchases" value={moneyDisplay(cost.total_expenses)} />
          <BudgetMetricRow label="Open shifts" value={String(cost.open_shift_count)} />
          <BudgetMetricRow label="Missing rates" value={String(cost.missing_rate_count)} />

          {overBudget ? (
            <BudgetWarningStrip tone="danger">
              Forecast total cost exceeds the planned cost budget by {moneyDisplay(cost.over_budget_amount)}.
            </BudgetWarningStrip>
          ) : null}
          {cost.open_shift_count > 0 ? (
            <BudgetWarningStrip>
              {cost.open_shift_count} open shift(s) are not included in labour cost.
            </BudgetWarningStrip>
          ) : null}
          {cost.missing_rate_count > 0 ? (
            <BudgetWarningStrip>
              {cost.missing_rate_count} employee(s) missing hourly rate.
            </BudgetWarningStrip>
          ) : null}
        </BudgetOverviewPanel>

        <BudgetOverviewPanel title="Billing position">
          <BudgetMetricRow
            label="Contract value Net"
            value={contractConfigured ? moneyDisplay(contractNet) : "Not configured"}
            valueClassName={!contractConfigured ? "text-[var(--color-text-muted)]" : undefined}
          />
          <BudgetMetricRow label="Amount invoiced Net" value={moneyDisplay(billing.active_invoiced_net)} />
          <BudgetMetricRow label="VAT" value={moneyDisplay(billing.vat_invoiced)} />
          <BudgetMetricRow label="Gross" value={moneyDisplay(billing.gross_invoiced)} />
          {contractConfigured ? (
            <BudgetMetricRow
              label="Remaining to invoice Net"
              value={
                isOverInvoiced
                  ? "—"
                  : moneyDisplay(billing.remaining_to_invoice)
              }
            />
          ) : null}
          {isOverInvoiced ? (
            <BudgetMetricRow
              label="Over-invoiced"
              value={moneyDisplay(billing.over_invoiced)}
              valueClassName="text-[var(--color-danger-700)]"
            />
          ) : null}
          <BudgetMetricRow
            label="Payments received Gross"
            value={moneyDisplay(billing.payments_received_gross)}
          />
          <BudgetMetricRow label="Outstanding Gross" value={moneyDisplay(billing.outstanding_gross)} />
          <BudgetMetricRow
            label="Overdue outstanding Gross"
            value={moneyDisplay(billing.overdue_outstanding_gross)}
            valueClassName={hasOverdue ? "text-[var(--color-danger-700)]" : undefined}
          />

          {contractConfigured && Number.isFinite(invoicedPct) ? (
            <BudgetUsageProgress
              ariaLabel="Contract invoiced progress (Net / Net)"
              isOver={isOverInvoiced}
              percentUsedDisplay={percentDisplay(invoicedPct)}
              percentUsedNumeric={Math.max(0, invoicedPct)}
            />
          ) : null}

          {isOverInvoiced ? (
            <BudgetWarningStrip tone="danger">
              Active invoiced Net exceeds contract value by {moneyDisplay(billing.over_invoiced)}.
            </BudgetWarningStrip>
          ) : null}
          {hasOverdue ? (
            <BudgetWarningStrip tone="danger">
              Overdue outstanding Gross: {moneyDisplay(billing.overdue_outstanding_gross)}.
            </BudgetWarningStrip>
          ) : null}
        </BudgetOverviewPanel>

        <BudgetOverviewPanel title="Profitability">
          {profit.forecast_profit === null || profit.forecast_profit === undefined ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--color-text)]">
                Set contract value to calculate forecast profit.
              </p>
              <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
                Forecast profit uses the current Contract value and forecast project costs.
              </p>
              <BudgetMetricRow
                label="Forecast total cost"
                value={moneyDisplay(profit.forecast_total_cost ?? cost.forecast_total_cost)}
              />
            </div>
          ) : (
            <>
              <BudgetMetricRow
                label="Forecast revenue Net"
                value={moneyDisplay(profit.forecast_revenue_net)}
              />
              <BudgetMetricRow
                label="Forecast total cost"
                value={moneyDisplay(profit.forecast_total_cost)}
              />
              <BudgetMetricRow
                label="Forecast profit"
                value={moneyDisplay(profit.forecast_profit)}
                valueClassName={
                  profitNegative ? "text-[var(--color-danger-700)]" : "text-[var(--color-success-700)]"
                }
              />
              <BudgetMetricRow
                label="Forecast margin"
                value={percentDisplay(profit.forecast_margin_percent)}
                valueClassName={profitNegative ? "text-[var(--color-danger-700)]" : undefined}
              />
              {profitNegative ? (
                <BudgetWarningStrip tone="danger">
                  Forecast loss of {moneyDisplay(Math.abs(forecastProfit))}.
                </BudgetWarningStrip>
              ) : null}
              <p className="text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                Forecast profit uses the current Contract value and forecast project costs.
              </p>
            </>
          )}
        </BudgetOverviewPanel>
      </div>

      {props.breakdownByCategory ? (
        <BudgetCategoryBreakdown
          rows={
            props.showZeroCategories
              ? [...categoryRows.nonZero, ...categoryRows.zeros]
              : categoryRows.nonZero.length > 0
                ? categoryRows.nonZero
                : categoryRows.zeros
          }
          showZeroToggle={zeroToggle}
        />
      ) : null}

      {!props.hasOperationalSite ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-warning-700)] bg-[var(--color-warning-50)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--color-warning-700)]">
            Select an operational site to calculate labour accurately.
          </p>
          {props.canEdit ? (
            <Button size="sm" type="button" variant="secondary" onClick={props.onEditBudget}>
              Edit budget
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)]">
          Labour totals are filtered by the selected operational site.
        </p>
      )}

      {cost.warnings.length > 0 ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-warning-700)] bg-[var(--color-warning-50)] px-3 py-2.5 text-sm text-[var(--color-warning-700)]">
          <ul className="list-inside list-disc space-y-1">
            {cost.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {cost.estimate_note ? (
        <div className="border-t border-[var(--color-border)] pt-3">
          <button
            aria-expanded={props.labourHelpOpen}
            className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left text-sm font-medium text-[var(--color-text)]"
            type="button"
            onClick={props.onToggleLabourHelp}
          >
            <span>How labour is calculated</span>
            <span className="text-[var(--color-text-muted)]">{props.labourHelpOpen ? "−" : "+"}</span>
          </button>
          {props.labourHelpOpen ? (
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">{cost.estimate_note}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
