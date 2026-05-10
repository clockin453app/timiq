export function formatHoursFromSeconds(seconds: number): string {
  return (seconds / 3600).toFixed(2);
}

export function formatMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  const n = Number(value);
  if (Number.isNaN(n)) {
    return value;
  }
  return n.toFixed(2);
}
