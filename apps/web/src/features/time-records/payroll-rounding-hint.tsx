import { formatDurationSeconds } from "./format-duration";

/** Explains when payroll rounded time exceeds payable after break deduction. */
export function payrollRoundingHintText(
  clockedSeconds: number,
  payableSeconds: number,
  payrollSeconds: number,
): string | null {
  if (payrollSeconds <= payableSeconds || payableSeconds <= 0) {
    return null;
  }
  if (clockedSeconds <= payableSeconds) {
    return null;
  }
  return `Clocked ${formatDurationSeconds(clockedSeconds)} → Payable ${formatDurationSeconds(payableSeconds)} after break → Payroll ${formatDurationSeconds(payrollSeconds)} after nearest-interval rounding.`;
}

export function PayrollRoundingHint(props: {
  clockedSeconds: number;
  payableSeconds: number;
  payrollSeconds: number;
  className?: string;
}) {
  const text = payrollRoundingHintText(
    props.clockedSeconds,
    props.payableSeconds,
    props.payrollSeconds,
  );
  if (!text) {
    return null;
  }
  return (
    <p
      className={
        props.className ??
        "text-[11px] leading-relaxed text-[var(--color-text-muted)]"
      }
    >
      {text}
    </p>
  );
}
