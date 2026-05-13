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
