export function formatDurationSeconds(seconds: number): string {
  const sign = seconds < 0 ? "−" : "";
  const total = Math.abs(Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${sign}${h}h ${String(m).padStart(2, "0")}m`;
}

/** Human label for policy break deduction (display only; calculation unchanged). */
export function formatBreakDeducted(seconds: number): string {
  if (seconds <= 0) {
    return "—";
  }
  return `−${formatDurationSeconds(seconds)} deducted`;
}
