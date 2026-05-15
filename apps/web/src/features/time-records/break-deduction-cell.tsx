import { cn } from "../../lib/cn";
import { formatBreakDeducted } from "./format-duration";

type BreakDeductionCellProps = {
  seconds: number;
  className?: string;
};

export function BreakDeductionCell({ seconds, className }: BreakDeductionCellProps) {
  if (seconds <= 0) {
    return <span className={cn("tabular-nums text-[var(--color-text-muted)]", className)}>—</span>;
  }
  return (
    <span
      className={cn(
        "tabular-nums text-xs font-semibold text-[var(--color-warning-700)]",
        className,
      )}
      title="Automatic break deduction from payable time"
    >
      {formatBreakDeducted(seconds)}
    </span>
  );
}
