export default function AuthenticatedAppLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-[12rem] flex-col gap-3"
      data-timiq-main-loading
    >
      <div className="h-7 w-48 max-w-full animate-pulse rounded-sm bg-[var(--color-border)]" />
      <div className="h-4 w-72 max-w-full animate-pulse rounded-sm bg-[var(--color-border)]" />
      <div className="mt-2 min-h-[10rem] flex-1 animate-pulse rounded-sm border border-[var(--color-border)] bg-[var(--color-cell)]" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
