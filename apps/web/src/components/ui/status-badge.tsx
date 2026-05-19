import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

/** Payroll-friendly status values; unknown values fall back to muted styling. */
export type StatusBadgeValue =
  | "pending"
  | "approved"
  | "paid"
  | "not_calculated"
  | "draft"
  | "muted"
  | string;

type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  status?: StatusBadgeValue;
};

function statusClasses(status: StatusBadgeValue): string {
  const normalized = status.trim().toLowerCase();

  if (normalized === "pending") {
    return "border-[var(--color-status-pending-border)] bg-[var(--color-status-pending-bg)] text-[var(--color-status-pending-fg)]";
  }
  if (normalized === "approved") {
    return "border-[var(--color-status-approved-border)] bg-[var(--color-status-approved-bg)] text-[var(--color-status-approved-fg)]";
  }
  if (normalized === "paid") {
    return "border-[var(--color-status-paid-border)] bg-[var(--color-status-paid-bg)] text-[var(--color-status-paid-fg)]";
  }
  if (normalized === "not_calculated" || normalized === "draft") {
    return "border-[var(--color-status-muted-border)] bg-[var(--color-status-muted-bg)] text-[var(--color-status-muted-fg)]";
  }
  if (normalized === "muted") {
    return "border-[var(--color-status-muted-border)] bg-[var(--color-status-muted-bg)] text-[var(--color-status-muted-fg)]";
  }

  return "border-[var(--color-border-dark)] bg-[var(--color-header)] text-[var(--color-text-muted)]";
}

export function StatusBadge({ children, className, status = "muted", ...props }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "timiq-status-label inline-flex items-center rounded-[var(--radius-full)] border px-2.5 py-0.5",
        statusClasses(status),
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
