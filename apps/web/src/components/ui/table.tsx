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
    <div className="max-w-full min-w-0 w-full overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border-dark)] [-webkit-overflow-scrolling:touch]">
      <table
        className={cn("w-full border-collapse text-sm", className)}
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
      className={cn("border-b border-[var(--color-border)]", className)}
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
        "border-r border-[var(--color-border)] px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text)] last:border-r-0",
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
        "border-r border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2.5 text-sm text-[var(--color-text)] last:border-r-0",
        className,
      )}
      {...props}
    />
  );
}