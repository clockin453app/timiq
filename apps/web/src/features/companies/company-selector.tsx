"use client";

import { cn } from "../../lib/cn";

type CompanySelectorProps = {
  companies: { id: string; name: string }[];
  value: string | null;
  onChange: (companyId: string) => void;
  className?: string;
  label?: string;
  /** When true, label stays visible on mobile (default). */
  showLabelOnMobile?: boolean;
  selectClassName?: string;
  id?: string;
};

/**
 * Company scope select. Full width on mobile; desktop may use a modest max width.
 * Presentational — callers own company list and selection state.
 */
export function CompanySelector(props: CompanySelectorProps) {
  const label = props.label ?? "Company";
  const showLabelOnMobile = props.showLabelOnMobile !== false;
  const selectId = props.id ?? "timiq-company-selector";
  return (
    <label
      className={
        props.className ??
        cn(
          "flex w-full min-w-0 max-w-full flex-col gap-0.5 text-xs text-[var(--color-text-muted)]",
          "sm:max-w-md",
        )
      }
      htmlFor={selectId}
    >
      <span
        className={cn(
          "timiq-label text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]",
          showLabelOnMobile ? "inline" : "hidden sm:inline",
        )}
      >
        {label}
      </span>
      <select
        className={cn(
          "timiq-select h-11 w-full min-w-0 max-w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)]",
          "bg-[var(--color-sheet)] px-2 text-sm text-[var(--color-text)] md:h-9",
          "sm:max-w-md",
          props.selectClassName,
        )}
        id={selectId}
        onChange={(e) => props.onChange(e.target.value)}
        value={props.value ?? ""}
      >
        <option value="">Select a company…</option>
        {props.companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
