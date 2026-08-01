"use client";

import { useId, useState } from "react";

import { Button, FormField, Modal } from "@/components/ui";
import {
  EXTRA_HOURS_REASON_OPTIONS,
  type ExtraHoursReason,
  type TimesheetExtraHoursRow,
  createExtraHours,
  parseDurationToMinutes,
  patchExtraHours,
} from "@/features/timesheet-extra-hours/api";
import { cn } from "@/lib/cn";

type SiteOption = { id: string; name: string };

type ExtraHoursModalProps = {
  mode: "create" | "edit";
  companyId: string;
  employeeUserId: string;
  employeeLabel: string;
  defaultWorkDate: string;
  weekStart: string;
  weekEndInclusive: string;
  sites: SiteOption[];
  initial?: TimesheetExtraHoursRow | null;
  onClose: () => void;
  onSaved: (row: TimesheetExtraHoursRow) => void;
};

export function ExtraHoursModal({
  companyId,
  defaultWorkDate,
  employeeLabel,
  employeeUserId,
  initial,
  mode,
  onClose,
  onSaved,
  sites,
  weekEndInclusive,
  weekStart,
}: ExtraHoursModalProps) {
  const titleId = useId();
  const [workDate, setWorkDate] = useState(initial?.work_date ?? defaultWorkDate);
  const [hours, setHours] = useState(() =>
    initial ? String(Math.floor(initial.duration_minutes / 60)) : "1",
  );
  const [minutes, setMinutes] = useState(() =>
    initial ? String(initial.duration_minutes % 60) : "0",
  );
  const [reason, setReason] = useState<ExtraHoursReason>(
    initial?.reason ?? "saturday_bonus_hour",
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [locationId, setLocationId] = useState(initial?.location_id ?? "");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!workDate) {
      nextErrors.work_date = "Date is required.";
    } else if (workDate < weekStart || workDate > weekEndInclusive) {
      nextErrors.work_date = "Date must fall within the displayed timesheet week.";
    }
    const durationMinutes = parseDurationToMinutes(hours, minutes);
    if (durationMinutes === null) {
      nextErrors.duration = "Enter a valid duration greater than zero (hours and minutes).";
    }
    if (!reason) {
      nextErrors.reason = "Reason is required.";
    }
    if (note.length > 500) {
      nextErrors.note = "Note must be 500 characters or fewer.";
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || durationMinutes === null) {
      setError("Please correct the highlighted fields.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const payload = {
        work_date: workDate,
        duration_minutes: durationMinutes,
        reason,
        note: note.trim() || null,
        location_id: locationId || null,
      };
      const row =
        mode === "edit" && initial
          ? await patchExtraHours(initial.id, payload)
          : await createExtraHours({
              company_id: companyId,
              user_id: employeeUserId,
              ...payload,
            });
      onSaved(row);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save extra hours.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      closeEnabled={!submitting}
      labelledById={titleId}
      onClose={onClose}
      subtitle={employeeLabel}
      title={mode === "edit" ? "Edit extra hours" : "Add extra hours"}
      widthClassName="max-w-[calc(100vw-24px)] sm:max-w-[min(28rem,calc(100vw-3rem))]"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled={submitting} onClick={onClose} type="button" variant="secondary">
            Cancel
          </Button>
          <Button disabled={submitting} form="extra-hours-form" type="submit">
            {mode === "edit" ? "Save changes" : "Add extra hours"}
          </Button>
        </div>
      }
    >
      <form className="space-y-3" id="extra-hours-form" noValidate onSubmit={handleSubmit}>
        <p
          className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-[12px] text-[var(--color-text-muted)]"
          role="note"
        >
          This entry will appear on the employee timesheet but will not affect payroll calculations.
        </p>

        <FormField label="Employee">
          <input
            aria-readonly="true"
            className={cn("timiq-input w-full bg-[var(--color-header)]")}
            readOnly
            value={employeeLabel}
          />
        </FormField>

        <FormField
          error={fieldErrors.work_date}
          htmlFor="extra-hours-date"
          label="Date"
          required
        >
          <input
            className="timiq-input w-full"
            id="extra-hours-date"
            max={weekEndInclusive}
            min={weekStart}
            onChange={(e) => setWorkDate(e.target.value)}
            required
            type="date"
            value={workDate}
          />
        </FormField>

        <fieldset className="min-w-0">
          <legend className="mb-1 text-sm font-medium text-[var(--color-text)]">
            Duration <span className="text-[var(--color-danger-700)]">*</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="extra-hours-h">
              Hours
            </label>
            <input
              aria-invalid={Boolean(fieldErrors.duration)}
              className="timiq-input w-20"
              id="extra-hours-h"
              inputMode="numeric"
              min={0}
              onChange={(e) => setHours(e.target.value)}
              value={hours}
            />
            <span className="self-center text-sm text-[var(--color-text-muted)]">h</span>
            <label className="sr-only" htmlFor="extra-hours-m">
              Minutes
            </label>
            <input
              aria-invalid={Boolean(fieldErrors.duration)}
              className="timiq-input w-20"
              id="extra-hours-m"
              inputMode="numeric"
              max={59}
              min={0}
              onChange={(e) => setMinutes(e.target.value)}
              value={minutes}
            />
            <span className="self-center text-sm text-[var(--color-text-muted)]">m</span>
          </div>
          {fieldErrors.duration ? (
            <p className="mt-1 text-xs text-[var(--color-danger-700)]" id="extra-hours-duration-error">
              {fieldErrors.duration}
            </p>
          ) : null}
        </fieldset>

        <FormField error={fieldErrors.reason} htmlFor="extra-hours-reason" label="Reason" required>
          <select
            className="timiq-input w-full"
            id="extra-hours-reason"
            onChange={(e) => setReason(e.target.value as ExtraHoursReason)}
            required
            value={reason}
          >
            {EXTRA_HOURS_REASON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </FormField>

        {reason === "shift_correction" ? (
          <p className="text-[12px] leading-relaxed text-[var(--color-text-muted)]" role="note">
            Use Edit shift when the original clock-in or clock-out time is wrong. Use extra hours only
            when an additional non-payroll record is required.
          </p>
        ) : null}

        <FormField error={fieldErrors.note} htmlFor="extra-hours-note" label="Note">
          <textarea
            className="timiq-input min-h-[4.5rem] w-full"
            id="extra-hours-note"
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            value={note}
          />
        </FormField>

        <FormField htmlFor="extra-hours-site" label="Site">
          <select
            className="timiq-input w-full"
            id="extra-hours-site"
            onChange={(e) => setLocationId(e.target.value)}
            value={locationId}
          >
            <option value="">No site</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </FormField>

        {error ? (
          <p className="text-sm text-[var(--color-danger-700)]" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
