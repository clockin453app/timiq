"use client";

import {
  useId,
  useRef,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Calendar } from "lucide-react";

import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";

const fieldShell = "flex w-full min-w-0 max-w-full flex-col gap-0.5";
const fieldLabel =
  "timiq-label block text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]";
/** Mobile ≥44px; desktop may stay compact. */
const nativeDateControl = cn(
  "timiq-input w-full min-w-0 max-w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)]",
  "min-h-11 px-2.5 py-2 pr-10 text-sm text-[var(--color-text)] md:min-h-9 md:py-1.5",
);

export type DateFieldProps = {
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  id?: string;
  disabled?: boolean;
  error?: string;
  className?: string;
  labelClassName?: string;
  inputClassName?: string;
  /** ISO min/max forwarded to the native date input. */
  min?: string;
  max?: string;
  name?: string;
  required?: boolean;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "id" | "disabled" | "min" | "max" | "name" | "required" | "className"
>;

/**
 * Native `type="date"` field with TimIQ label shell.
 * Presentational only — callers own values and handlers.
 */
export function DateField({
  label,
  value,
  onChange,
  id,
  disabled = false,
  error,
  className,
  labelClassName,
  inputClassName,
  min,
  max,
  name,
  required,
  ...rest
}: DateFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cn(fieldShell, className)}>
      <label className={cn(fieldLabel, labelClassName)} htmlFor={inputId}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        className={cn(nativeDateControl, error ? "border-[var(--color-danger-700)]" : "", inputClassName)}
        disabled={disabled}
        id={inputId}
        max={max}
        min={min}
        name={name}
        onChange={onChange}
        required={required}
        type="date"
        value={value}
        {...rest}
      />
      {error ? (
        <p className="text-xs text-[var(--color-danger-700)]">{error}</p>
      ) : null}
    </div>
  );
}

function formatIsoDateDisplay(value: string): string {
  if (!value) {
    return "";
  }
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) {
    return value;
  }
  return `${day}/${month}/${year}`;
}

export type ReadableDateFieldProps = {
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  pickerAriaLabel: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
};

/**
 * Readable UK date display + hidden native picker (showPicker).
 * Keeps ISO `value` / `onChange` identical to a native date input.
 */
export function ReadableDateField({
  label,
  value,
  onChange,
  pickerAriaLabel,
  id,
  disabled = false,
  className,
  labelClassName,
}: ReadableDateFieldProps) {
  const autoId = useId();
  const displayId = id ?? autoId;
  const hiddenDateRef = useRef<HTMLInputElement | null>(null);

  function openPicker() {
    const input = hiddenDateRef.current;
    if (!input || input.disabled) {
      return;
    }
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
        return;
      } catch {
        // showPicker may throw when not allowed; fall through to focus/click.
      }
    }
    input.focus();
    input.click();
  }

  return (
    <div className={cn(fieldShell, className)}>
      <label className={cn(fieldLabel, labelClassName)} htmlFor={displayId}>
        {label}
      </label>
      <div className="relative w-full min-w-0 max-w-full">
        <input
          aria-hidden
          className="timiq-date-input-native"
          disabled={disabled}
          onChange={onChange}
          ref={hiddenDateRef}
          tabIndex={-1}
          type="date"
          value={value}
        />
        <input
          className={cn(
            "timiq-input timiq-date-input w-full min-w-0 max-w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)]",
            "min-h-11 px-2.5 py-2 pr-12 text-sm text-[var(--color-text)] md:min-h-9 md:py-1.5",
          )}
          disabled={disabled}
          id={displayId}
          readOnly
          tabIndex={0}
          type="text"
          value={formatIsoDateDisplay(value)}
        />
        <button
          aria-label={pickerAriaLabel}
          className={cn(
            "absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center md:h-6 md:w-6",
            "rounded-[var(--radius-md)] border border-[var(--color-brand)] bg-[var(--color-brand)]",
            "text-[var(--color-brand-foreground)] hover:border-[var(--color-brand-hover)] hover:bg-[var(--color-brand-hover)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
            uiClasses.focusRing,
          )}
          disabled={disabled}
          onClick={openPicker}
          type="button"
        >
          <Calendar aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export type DateRangeFieldsProps = {
  fromLabel: string;
  toLabel: string;
  fromValue: string;
  toValue: string;
  onFromChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onToChange: (event: ChangeEvent<HTMLInputElement>) => void;
  fromId?: string;
  toId?: string;
  disabled?: boolean;
  className?: string;
  /** Native date inputs (default) or readable UK display with showPicker. */
  variant?: "native" | "readable";
  fromPickerAriaLabel?: string;
  toPickerAriaLabel?: string;
  fromMin?: string;
  fromMax?: string;
  toMin?: string;
  toMax?: string;
};

/**
 * Date From / Date To pair.
 * Below 360px: one column; 360px and above: two equal columns.
 * Tab order: From then To.
 */
export function DateRangeFields({
  fromLabel,
  toLabel,
  fromValue,
  toValue,
  onFromChange,
  onToChange,
  fromId,
  toId,
  disabled = false,
  className,
  variant = "native",
  fromPickerAriaLabel = "Open Date From picker",
  toPickerAriaLabel = "Open Date To picker",
  fromMin,
  fromMax,
  toMin,
  toMax,
}: DateRangeFieldsProps) {
  let fromControl: ReactNode;
  let toControl: ReactNode;
  if (variant === "readable") {
    fromControl = (
      <ReadableDateField
        disabled={disabled}
        id={fromId}
        label={fromLabel}
        onChange={onFromChange}
        pickerAriaLabel={fromPickerAriaLabel}
        value={fromValue}
      />
    );
    toControl = (
      <ReadableDateField
        disabled={disabled}
        id={toId}
        label={toLabel}
        onChange={onToChange}
        pickerAriaLabel={toPickerAriaLabel}
        value={toValue}
      />
    );
  } else {
    fromControl = (
      <DateField
        disabled={disabled}
        id={fromId}
        label={fromLabel}
        max={fromMax}
        min={fromMin}
        onChange={onFromChange}
        value={fromValue}
      />
    );
    toControl = (
      <DateField
        disabled={disabled}
        id={toId}
        label={toLabel}
        max={toMax}
        min={toMin}
        onChange={onToChange}
        value={toValue}
      />
    );
  }

  return (
    <div
      className={cn(
        "grid w-full min-w-0 max-w-full grid-cols-1 gap-3 min-[360px]:grid-cols-2 min-[360px]:gap-2",
        className,
      )}
      data-testid="date-range-fields"
    >
      <div className="min-w-0">{fromControl}</div>
      <div className="min-w-0">{toControl}</div>
    </div>
  );
}
