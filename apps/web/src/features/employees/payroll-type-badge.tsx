"use client";

import { payrollTypeLabel, type PayrollTypeDisplay } from "./employee-identity";

const STYLES: Record<PayrollTypeDisplay, string> = {
  cis: "border-[#fcd34d] bg-[#fef3c7] text-[#92400e]",
  paye: "border-[#86efac] bg-[#dcfce7] text-[#166534]",
  none: "border-[var(--color-border-dark)] bg-[var(--color-muted)] text-[var(--color-text-muted)]",
};

export function PayrollTypeBadge({
  kind,
  className = "",
}: {
  kind: PayrollTypeDisplay;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded border px-2 py-0.5 text-[11px] font-semibold leading-tight ${STYLES[kind]} ${className}`}
    >
      {payrollTypeLabel(kind)}
    </span>
  );
}
