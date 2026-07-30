import type {
  HTMLAttributes,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";

import { cn } from "../../lib/cn";

export function Table({
  className,
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="max-w-full min-w-0 w-full overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] shadow-[var(--shadow-xs)] [-webkit-overflow-scrolling:touch]">
      <table
        className={cn("w-full border-collapse text-[length:var(--text-table-cell)]", className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn("bg-[var(--color-table-header)]", className)}
      {...props}
    />
  );
}

export function TableBody({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export function TableRow({
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-header)]/45", className)}
      {...props}
    />
  );
}

export function TableHead({
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "border-r border-[var(--color-border)] px-[var(--space-table-cell-x)] py-[var(--space-table-cell-y)] text-left text-[length:var(--text-table-head)] font-bold uppercase tracking-wide text-[var(--color-text)] last:border-r-0",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        "border-r border-[var(--color-border)] bg-[var(--color-cell)] px-[var(--space-table-cell-x)] py-[var(--space-table-cell-y)] text-[length:var(--text-table-cell)] text-[var(--color-text)] last:border-r-0",
        className,
      )}
      {...props}
    />
  );
}