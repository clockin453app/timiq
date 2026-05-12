"use client";

import { FormEvent, useEffect, useState } from "react";

import { Button } from "../../components/ui";
import {
  getCompanyTimePolicy,
  patchCompanyTimePolicy,
  type Company,
  type CompanyTimePolicy,
} from "../../features/companies/api";

function isoToDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type CompanyTimePolicyModalProps = {
  company: Company | null;
  onClose: () => void;
  onSaved: () => void;
};

export function CompanyTimePolicyModal({
  company,
  onClose,
  onSaved,
}: CompanyTimePolicyModalProps) {
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [standardStart, setStandardStart] = useState("08:00");
  const [overtimeAfter, setOvertimeAfter] = useState(8.5);
  const [overtimeMult, setOvertimeMult] = useState(1.5);
  const [roundingInc, setRoundingInc] = useState(30);
  const [roundingMode, setRoundingMode] = useState("nearest");
  const [breakDeduction, setBreakDeduction] = useState(30);
  const [breakDeductionAfterMinutes, setBreakDeductionAfterMinutes] = useState(360);
  const [ruleEffectiveLocal, setRuleEffectiveLocal] = useState("");
  const [ruleNote, setRuleNote] = useState("");
  const [timezone, setTimezone] = useState("Europe/London");

  useEffect(() => {
    if (!company) {
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setLoadError("");
      setSuccessMessage("");
      try {
        const policy = await getCompanyTimePolicy(company.id);
        if (cancelled) {
          return;
        }
        applyPolicyToForm(policy);
      } catch {
        if (!cancelled) {
          setLoadError("Could not load time policy.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [company]);

  function applyPolicyToForm(policy: CompanyTimePolicy) {
    setStandardStart(policy.standard_start_time);
    setOvertimeAfter(policy.overtime_after_hours);
    setOvertimeMult(policy.overtime_multiplier);
    setRoundingInc(policy.rounding_increment_minutes);
    setRoundingMode(policy.rounding_mode);
    setBreakDeduction(policy.break_deduction_minutes);
    setBreakDeductionAfterMinutes(policy.break_deduction_after_minutes ?? 360);
    setRuleEffectiveLocal(isoToDatetimeLocalValue(policy.rule_effective_from));
    setRuleNote(policy.rule_note);
    setTimezone(policy.timezone);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!company) {
      return;
    }
    setSaveError("");
    setSuccessMessage("");
    setIsSaving(true);
    try {
      const effectiveDate = new Date(ruleEffectiveLocal);
      if (Number.isNaN(effectiveDate.getTime())) {
        setSaveError("Rule effective from must be a valid date and time.");
        setIsSaving(false);
        return;
      }
      const startNorm =
        standardStart.trim().length >= 5 ? standardStart.trim().slice(0, 5) : standardStart.trim();

      await patchCompanyTimePolicy(company.id, {
        standard_start_time: startNorm,
        overtime_after_hours: overtimeAfter,
        overtime_multiplier: overtimeMult,
        rounding_increment_minutes: roundingInc,
        rounding_mode: roundingMode,
        break_deduction_minutes: breakDeduction,
        break_deduction_after_minutes: breakDeductionAfterMinutes,
        rule_effective_from: effectiveDate.toISOString(),
        rule_note: ruleNote,
        timezone,
      });
      setSuccessMessage("Time policy saved.");
      await onSaved();
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Could not save time policy.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (!company) {
    return null;
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-start justify-center overflow-x-hidden overflow-y-auto bg-black/45 p-3 md:p-6"
      role="dialog"
    >
      <div className="timiq-sheet mx-auto my-4 w-full min-w-0 max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 shadow-md sm:max-w-[min(42rem,calc(100vw-3rem))]">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-border-dark)] pb-3">
          <div>
            <p className="text-sm font-bold text-[var(--color-text)]">Time policy</p>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{company.name}</p>
          </div>
          <Button onClick={onClose} type="button">
            Close
          </Button>
        </div>

        {loadError ? (
          <div className="mt-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {loadError}
          </div>
        ) : null}

        {saveError ? (
          <div className="mt-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {saveError}
          </div>
        ) : null}

        {successMessage ? (
          <div className="mt-3 border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm">
            {successMessage}
          </div>
        ) : null}

        {isLoading ? (
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">Loading policy…</p>
        ) : (
          <form className="mt-4 space-y-3" onSubmit={handleSave}>
            <label className="block text-xs font-bold text-[var(--color-text)]">
              Standard start time
              <input
                className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                onChange={(event) => setStandardStart(event.target.value)}
                required
                type="time"
                value={standardStart}
              />
            </label>

            <label className="block text-xs font-bold text-[var(--color-text)]">
              Timezone (IANA)
              <input
                className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 font-mono text-sm"
                onChange={(event) => setTimezone(event.target.value)}
                required
                type="text"
                value={timezone}
              />
            </label>

            <label className="block text-xs font-bold text-[var(--color-text)]">
              Overtime after (hours)
              <input
                className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                min={0}
                max={24}
                onChange={(event) => setOvertimeAfter(Number(event.target.value))}
                required
                step={0.25}
                type="number"
                value={overtimeAfter}
              />
            </label>

            <label className="block text-xs font-bold text-[var(--color-text)]">
              Overtime multiplier
              <input
                className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                min={0}
                max={10}
                onChange={(event) => setOvertimeMult(Number(event.target.value))}
                required
                step={0.1}
                type="number"
                value={overtimeMult}
              />
            </label>

            <label className="block text-xs font-bold text-[var(--color-text)]">
              Time rounding (minutes)
              <input
                className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                max={480}
                min={0}
                onChange={(event) => setRoundingInc(Number(event.target.value))}
                required
                type="number"
                value={roundingInc}
              />
            </label>

            <label className="block text-xs font-bold text-[var(--color-text)]">
              Rounding mode
              <select
                className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                onChange={(event) => setRoundingMode(event.target.value)}
                value={roundingMode}
              >
                <option value="nearest">Nearest</option>
                <option value="up">Up</option>
                <option value="down">Down</option>
                <option value="none">None</option>
              </select>
            </label>

            <label className="block text-xs font-bold text-[var(--color-text)]">
              Break deduction (minutes)
              <input
                className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                max={480}
                min={0}
                onChange={(event) => setBreakDeduction(Number(event.target.value))}
                required
                type="number"
                value={breakDeduction}
              />
            </label>

            <label className="block text-xs font-bold text-[var(--color-text)]">
              Apply break deduction after (minutes)
              <input
                className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                max={10080}
                min={0}
                onChange={(event) => setBreakDeductionAfterMinutes(Number(event.target.value))}
                required
                type="number"
                value={breakDeductionAfterMinutes}
              />
              <span className="mt-1 block text-xs font-normal leading-snug text-[var(--color-text-muted)]">
                Example: 360 minutes means the automatic break deduction applies only after 6 hours worked. Uses the
                payable span (counted clock-in to clock-out, or now for an open shift). If tracked breaks exceed the
                automatic deduction, the larger value still applies, including on shorter shifts.
              </span>
            </label>

            <label className="block text-xs font-bold text-[var(--color-text)]">
              Rule effective from
              <input
                className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                onChange={(event) => setRuleEffectiveLocal(event.target.value)}
                required
                type="datetime-local"
                value={ruleEffectiveLocal}
              />
            </label>

            <label className="block text-xs font-bold text-[var(--color-text)]">
              Rule note
              <textarea
                className="mt-1 min-h-[4rem] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-1 text-sm"
                maxLength={4000}
                onChange={(event) => setRuleNote(event.target.value)}
                value={ruleNote}
              />
            </label>

            <Button disabled={isSaving} type="submit">
              {isSaving ? "Saving…" : "Save policy"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
