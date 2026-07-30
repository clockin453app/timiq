import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

type FormFieldProps = {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  className?: string;
  required?: boolean;
};

/**
 * Label + control + message stack. `min-w-0` throughout so native date/time
 * controls shrink instead of widening the document on narrow phones.
 */
export function FormField({
  children,
  className,
  error,
  hint,
  htmlFor,
  label,
  required,
}: FormFieldProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <label className="timiq-label mb-1 block" htmlFor={htmlFor}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>

      <div className="min-w-0">{children}</div>

      {hint && !error ? <p className="timiq-caption mt-1 break-words">{hint}</p> : null}

      {error ? (
        <p className="mt-1 break-words text-[length:var(--text-secondary)] text-[var(--color-danger-700)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Action row that stacks on narrow screens and keeps destructive actions apart. */
export function FormActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end",
        className,
      )}
    >
      {children}
    </div>
  );
}
