import type { InputHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
};

export function Input({ className, error, id, label, ...props }: InputProps) {
  const inputId = id ?? props.name;

  return (
    <div className="space-y-1">
      {label ? (
        <label className="timiq-label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}

      <input
        className={cn("timiq-input", error ? "border-[var(--color-danger-700)]" : "", className)}
        id={inputId}
        {...props}
      />

      {error ? (
        <p className="text-xs" style={{ color: "var(--color-danger-700)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}