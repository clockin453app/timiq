import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

type BadgeTone = "default" | "success" | "warning" | "danger" | "info";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: BadgeTone;
};

const toneClasses: Record<BadgeTone, string> = {
  default:
    "border-[var(--color-border-dark)] bg-[var(--color-header)] text-[var(--color-text-muted)]",
  success:
    "border-[var(--color-success-700)]/25 bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  warning:
    "border-[var(--color-warning-700)]/25 bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  danger:
    "border-[var(--color-danger-700)]/25 bg-[var(--color-danger-50)] text-[var(--color-danger-700)]",
  info: "border-[var(--color-info-700)]/25 bg-[var(--color-info-50)] text-[var(--color-info-700)]",
};

export function Badge({ children, className, tone = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--radius-full)] border px-2.5 py-0.5 text-xs font-semibold",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
