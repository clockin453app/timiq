import type { ReactNode } from "react";

import { formatMoneyGBP } from "@/features/payroll/format";

export function isoTodayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export function moneyDisplay(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  return formatMoneyGBP(String(value));
}

export function percentDisplay(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  const n = Number(value);
  if (Number.isNaN(n)) {
    return String(value);
  }
  return `${n.toFixed(1)}%`;
}

/** Legacy card stats — still used by Quick calculator. */
export function BudgetStatCard(props: { label: string; value: string; hint?: string }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
      <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">{props.label}</p>
      </div>
      <div className="px-3 py-3">
        <p className="text-lg font-semibold tabular-nums text-[var(--color-text)]">{props.value}</p>
        {props.hint ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">{props.hint}</p> : null}
      </div>
    </div>
  );
}

/** Shared segmented control (messages + legacy). Prefer budgetUnderlineTabClass for Budgets chrome. */
export function segmentBtnClass(active: boolean) {
  return [
    "rounded-[var(--radius-sm)] px-3 py-1.5 text-sm",
    active
      ? "border border-[var(--color-btn-active-border)] bg-[var(--color-btn-active-bg)] font-bold text-[var(--color-text)]"
      : "border border-transparent font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-header)] hover:text-[var(--color-text)]",
  ].join(" ");
}

/** Light underline tabs for Budgets Saved / Quick calculator and record tabs. */
export function budgetUnderlineTabClass(active: boolean) {
  return [
    "min-h-[44px] shrink-0 border-b-2 px-3 py-2 text-sm transition-colors",
    active
      ? "border-[var(--color-btn-primary-border)] font-semibold text-[var(--color-text)]"
      : "border-transparent font-medium text-[var(--color-text-muted)] hover:border-[var(--color-border-dark)] hover:text-[var(--color-text)]",
  ].join(" ");
}

export function expenseCategoryLabel(cat: string): string {
  return cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function budgetStatusBadgeTone(status: string): "default" | "success" | "warning" | "danger" {
  const s = status.toLowerCase();
  if (s === "active") {
    return "success";
  }
  if (s === "draft") {
    return "warning";
  }
  if (s === "archived") {
    return "default";
  }
  return "default";
}

function usageBarTone(isOver: boolean, percentUsed: number): { track: string; fill: string } {
  if (isOver) {
    return {
      track: "bg-[var(--color-danger-50)]",
      fill: "bg-[var(--color-danger-700)]",
    };
  }
  if (percentUsed >= 90) {
    return {
      track: "bg-[var(--color-warning-50)]",
      fill: "bg-[var(--color-warning-700)]",
    };
  }
  return {
    track: "bg-[var(--color-border)]",
    fill: "bg-[var(--color-btn-primary-bg)]",
  };
}

/** Progress bar with accessible value (may exceed 100% for over-budget / over-invoiced). */
export function BudgetUsageProgress(props: {
  percentUsedNumeric: number;
  percentUsedDisplay: string;
  ariaLabel: string;
  isOver?: boolean;
}) {
  const pct = Number.isFinite(props.percentUsedNumeric) ? Math.max(0, props.percentUsedNumeric) : 0;
  const fill = Math.min(100, pct);
  const isOver = props.isOver ?? pct > 100;
  const tone = usageBarTone(isOver, pct);
  const valueNow = Math.round(pct);

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-[var(--color-text-muted)]">{props.ariaLabel}</span>
        <span className="text-xs font-medium tabular-nums text-[var(--color-text)]">{props.percentUsedDisplay}</span>
      </div>
      <div
        aria-label={props.ariaLabel}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={valueNow}
        className={`h-2 w-full overflow-hidden rounded-full ${tone.track}`}
        role="progressbar"
      >
        <div className={`h-full rounded-full ${tone.fill}`} style={{ width: `${fill}%` }} />
      </div>
    </div>
  );
}

export function BudgetOverviewPanel(props: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={[
        "min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]",
        props.className ?? "",
      ].join(" ")}
    >
      <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2.5">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">{props.title}</h3>
      </div>
      <div className="min-w-0 space-y-3 p-3">{props.children}</div>
    </section>
  );
}

export function BudgetMetricRow(props: {
  label: string;
  value: string;
  valueClassName?: string;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-[var(--color-text-muted)]">{props.label}</p>
        {props.hint ? <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{props.hint}</p> : null}
      </div>
      <p
        className={[
          "shrink-0 text-sm font-semibold tabular-nums text-[var(--color-text)]",
          props.valueClassName ?? "",
        ].join(" ")}
      >
        {props.value}
      </p>
    </div>
  );
}

export function BudgetWarningStrip(props: { children: ReactNode; tone?: "warning" | "danger" }) {
  const tone = props.tone ?? "warning";
  const cls =
    tone === "danger"
      ? "border-[var(--color-danger-700)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)]"
      : "border-[var(--color-warning-700)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]";
  return (
    <div className={`rounded-[var(--radius-sm)] border px-2.5 py-2 text-xs ${cls}`}>{props.children}</div>
  );
}

/** Legacy single-column cost summary — kept for calculator / older callers. */
export function BudgetFinancialSummary(props: {
  plannedDisplay: string;
  spentDisplay: string;
  remainingOrOverDisplay: string;
  isOverBudget: boolean;
  percentUsedDisplay: string;
  percentUsedNumeric: number;
}) {
  const fill = props.isOverBudget ? 100 : Math.min(100, Math.max(0, props.percentUsedNumeric));
  const tone = usageBarTone(props.isOverBudget, props.percentUsedNumeric);

  return (
    <section className="border-b border-[var(--color-border)] pb-5">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-end">
        <div className="min-w-0 space-y-3">
          <p className="text-sm text-[var(--color-text-muted)]">
            {props.isOverBudget ? "Over budget" : "Remaining"}
          </p>
          <p
            className={
              props.isOverBudget
                ? "text-3xl font-semibold tracking-tight tabular-nums text-[var(--color-danger-700)] sm:text-4xl"
                : "text-3xl font-semibold tracking-tight tabular-nums text-[var(--color-text)] sm:text-4xl"
            }
          >
            {props.remainingOrOverDisplay}
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            <span className="font-medium tabular-nums text-[var(--color-text)]">{props.percentUsedDisplay}</span> used
          </p>
          <div className={`h-2 w-full overflow-hidden rounded-full ${tone.track}`}>
            <div className={`h-full rounded-full ${tone.fill}`} style={{ width: `${fill}%` }} />
          </div>
        </div>
        <dl className="grid min-w-0 grid-cols-2 gap-4 border-t border-[var(--color-border)] pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <div className="min-w-0">
            <dt className="text-sm text-[var(--color-text-muted)]">Planned budget</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-[var(--color-text)]">{props.plannedDisplay}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-[var(--color-text-muted)]">Total spent</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-[var(--color-text)]">{props.spentDisplay}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

export function BudgetOperationalMetrics(props: {
  finalizedLabour: string;
  estimatedLabour: string;
  purchases: string;
  openShiftsLabel: string;
  openShiftsHint?: string;
}) {
  const cells = [
    { label: "Finalised labour", value: props.finalizedLabour },
    { label: "Estimated labour", value: props.estimatedLabour },
    { label: "Purchases / expenses", value: props.purchases },
    { label: "Open shifts / rates", value: props.openShiftsLabel, hint: props.openShiftsHint },
  ];

  return (
    <section className="border-b border-[var(--color-border)] py-4">
      <div className="grid grid-cols-1 gap-0 sm:grid-cols-2 lg:grid-cols-4">
        {cells.map((cell, index) => (
          <div
            key={cell.label}
            className={[
              "min-w-0 py-3 sm:px-4",
              index > 0 ? "border-t border-[var(--color-border)] sm:border-t-0" : "",
              index % 2 === 1 ? "sm:border-l sm:border-[var(--color-border)]" : "",
              index > 0 ? "lg:border-l lg:border-[var(--color-border)]" : "",
              index === 2 ? "sm:border-t sm:border-[var(--color-border)] lg:border-t-0" : "",
              index === 3 ? "sm:border-t sm:border-[var(--color-border)] lg:border-t-0" : "",
            ].join(" ")}
          >
            <p className="text-sm text-[var(--color-text-muted)]">{cell.label}</p>
            <p className="mt-1 text-base font-semibold tabular-nums text-[var(--color-text)]">{cell.value}</p>
            {cell.hint ? <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{cell.hint}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function BudgetCategoryBreakdown(props: {
  rows: { key: string; amount: number }[];
  showZeroToggle?: ReactNode;
}) {
  const total = props.rows.reduce((sum, row) => sum + (row.amount > 0 ? row.amount : 0), 0);

  return (
    <section className="space-y-3 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-[var(--color-text)]">Expense categories</h3>
        {props.showZeroToggle}
      </div>
      {props.rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No category spend yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {props.rows.map((row) => {
            const pct = total > 0 && row.amount > 0 ? (row.amount / total) * 100 : 0;
            return (
              <li className="py-3" key={row.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-sm text-[var(--color-text)]">{expenseCategoryLabel(row.key)}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--color-text)]">
                    {moneyDisplay(row.amount)}
                  </span>
                </div>
                {total > 0 ? (
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--color-border)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-btn-primary-bg)]/70"
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right text-xs tabular-nums text-[var(--color-text-muted)]">
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
