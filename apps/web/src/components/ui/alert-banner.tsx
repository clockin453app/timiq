import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

type AlertTone = "info" | "success" | "warning" | "danger";

type AlertBannerProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  tone?: AlertTone;
  title?: string;
};

const toneClasses: Record<AlertTone, string> = {
  info: "border-[var(--color-info-700)]/25 bg-[var(--color-info-50)] text-[var(--color-info-700)]",
  success:
    "border-[var(--color-success-700)]/25 bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  warning:
    "border-[var(--color-warning-700)]/25 bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  danger:
    "border-[var(--color-danger-700)]/25 bg-[var(--color-danger-50)] text-[var(--color-danger-700)]",
};

export function AlertBanner({
  children,
  className,
  title,
  tone = "info",
  ...props
}: AlertBannerProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border px-3 py-2 text-sm",
        toneClasses[tone],
        className,
      )}
      role="status"
      {...props}
    >
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}
