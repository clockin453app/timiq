import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

export type PaymentMode = "net_payment" | "gross_payment" | null | undefined;

type PaymentBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  mode?: PaymentMode;
};

function normalizeMode(mode: PaymentMode): "net" | "gross" | "unknown" {
  const raw = (mode ?? "").trim().toLowerCase();
  if (raw === "gross_payment" || raw === "gross") {
    return "gross";
  }
  if (raw === "net_payment" || raw === "net") {
    return "net";
  }
  return "unknown";
}

const modeClasses = {
  net: "border-[var(--color-payment-net-border)] bg-[var(--color-payment-net-bg)] text-[var(--color-payment-net-fg)]",
  gross:
    "border-[var(--color-payment-gross-border)] bg-[var(--color-payment-gross-bg)] text-[var(--color-payment-gross-fg)]",
  unknown:
    "border-[var(--color-payment-unknown-border)] bg-[var(--color-payment-unknown-bg)] text-[var(--color-payment-unknown-fg)]",
} as const;

export function PaymentBadge({ children, className, mode, ...props }: PaymentBadgeProps) {
  const tone = normalizeMode(mode);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--radius-full)] border px-2 py-0.5 text-xs font-semibold",
        modeClasses[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
