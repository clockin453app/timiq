import { cn } from "../../lib/cn";

export type ToolboxTalkStatus = "draft" | "published" | "completed" | "archived" | "voided" | string;

export function toolboxTalkStatusLabel(status: ToolboxTalkStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "published":
      return "Published";
    case "completed":
      return "Completed";
    case "archived":
      return "Archived";
    case "voided":
      return "VOIDED";
    default:
      return status;
  }
}

export function ToolboxTalkStatusBadge({ status, className }: { status: ToolboxTalkStatus; className?: string }) {
  const label = toolboxTalkStatusLabel(status);
  const styles =
    status === "voided"
      ? "border-red-300 bg-red-50 text-red-900"
      : status === "published"
        ? "border-emerald-300 bg-emerald-50 text-emerald-900"
        : status === "completed"
          ? "border-sky-300 bg-sky-50 text-sky-900"
          : status === "archived"
            ? "border-[var(--color-border-dark)] bg-[var(--color-header)] text-[var(--color-text-muted)]"
            : status === "draft"
              ? "border-amber-300 bg-amber-50 text-amber-950"
              : "border-[var(--color-border)] bg-[var(--color-cell)] text-[var(--color-text)]";

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded border px-2 py-0.5 text-xs font-bold uppercase tracking-wide",
        styles,
        className,
      )}
    >
      {label}
    </span>
  );
}
