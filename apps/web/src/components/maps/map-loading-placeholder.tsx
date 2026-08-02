/** Compact placeholder while a Leaflet map chunk loads on the client. */
export function MapLoadingPlaceholder({
  className = "timiq-leaflet-shell flex min-h-[220px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-6 text-center text-sm text-[var(--color-text-muted)]",
  label = "Loading map…",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div aria-busy="true" className={className} role="status">
      {label}
    </div>
  );
}
