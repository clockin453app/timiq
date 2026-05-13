import { formatMoneyGBP } from "../../features/payroll/format";

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

export function segmentBtnClass(active: boolean) {
  return [
    "rounded-[var(--radius-sm)] px-3 py-1.5 text-sm",
    active
      ? "border border-[var(--color-btn-active-border)] bg-[var(--color-btn-active-bg)] font-bold text-[var(--color-text)]"
      : "border border-transparent font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-header)] hover:text-[var(--color-text)]",
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

export function BudgetCompactStat(props: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: "default" | "danger";
}) {
  const danger = props.emphasis === "danger";
  return (
    <div
      className={
        danger
          ? "rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2.5"
          : "rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2.5"
      }
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">{props.label}</p>
      <p
        className={
          danger
            ? "mt-0.5 text-base font-semibold tabular-nums text-[var(--color-danger-700)]"
            : "mt-0.5 text-base font-semibold tabular-nums text-[var(--color-text)]"
        }
      >
        {props.value}
      </p>
      {props.hint ? <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{props.hint}</p> : null}
    </div>
  );
}

export function BudgetHealthBar(props: {
  plannedDisplay: string;
  spentDisplay: string;
  remainingOrOverDisplay: string;
  isOverBudget: boolean;
  percentUsedDisplay: string;
  /** 0–100+ from API; bar fill caps at 100, full red when over budget */
  percentUsedNumeric: number;
}) {
  const fill = props.isOverBudget ? 100 : Math.min(100, Math.max(0, props.percentUsedNumeric));
  const trackClass = props.isOverBudget
    ? "border border-[var(--color-danger-700)] bg-[var(--color-danger-50)]"
    : "bg-[var(--color-border)]";

  return (
    <div
      className={
        props.isOverBudget
          ? "rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)]/40 p-4"
          : "rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-4"
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">Budget health</p>
          <p
            className={
              props.isOverBudget
                ? "mt-1 text-lg font-semibold tabular-nums text-[var(--color-danger-700)]"
                : "mt-1 text-lg font-semibold tabular-nums text-[var(--color-text)]"
            }
          >
            {props.percentUsedDisplay} used
          </p>
        </div>
        <div className="text-right text-sm text-[var(--color-text-muted)]">
          <span className="tabular-nums font-medium text-[var(--color-text)]">{props.spentDisplay}</span>
          <span> of </span>
          <span className="tabular-nums">{props.plannedDisplay}</span>
        </div>
      </div>
      <div className={`mt-3 h-2.5 w-full overflow-hidden rounded-full ${trackClass}`}>
        <div
          className={
            props.isOverBudget
              ? "h-full rounded-full bg-[var(--color-danger-700)]"
              : "h-full rounded-full bg-[var(--color-primary)]"
          }
          style={{ width: `${fill}%` }}
        />
      </div>
      <div className="mt-3 text-sm text-[var(--color-text-muted)]">
        {props.isOverBudget ? "Over budget" : "Remaining"}:{" "}
        <span
          className={
            props.isOverBudget
              ? "font-semibold tabular-nums text-[var(--color-danger-700)]"
              : "font-semibold tabular-nums text-[var(--color-text)]"
          }
        >
          {props.remainingOrOverDisplay}
        </span>
      </div>
    </div>
  );
}
