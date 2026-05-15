"use client";

import { FormEvent, useEffect, useState } from "react";

import { Button } from "../../components/ui";
import {
  patchCompanyPayrollTax,
  type Company,
} from "../../features/companies/api";

export type CompanyPayrollTaxModalProps = {
  company: Company | null;
  onClose: () => void;
  onSaved: () => void;
};

export function CompanyPayrollTaxModal({
  company,
  onClose,
  onSaved,
}: CompanyPayrollTaxModalProps) {
  const [rate, setRate] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!company) {
      return;
    }
    setRate(company.default_tax_rate ?? "");
    setError("");
  }, [company]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!company) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const trimmed = rate.trim();
      await patchCompanyPayrollTax(company.id, {
        default_tax_rate: trimmed === "" ? null : trimmed,
      });
      await onSaved();
      onClose();
    } catch {
      setError("Could not save default CIS rate.");
    } finally {
      setSaving(false);
    }
  }

  if (!company) {
    return null;
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[2100] flex items-start justify-center overflow-x-hidden overflow-y-auto bg-black/45 p-3 md:p-6"
      role="dialog"
    >
      <div className="timiq-sheet mx-auto my-4 w-full min-w-0 max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 shadow-md sm:max-w-[min(28rem,calc(100vw-3rem))]">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-border-dark)] pb-3">
          <div>
            <p className="text-sm font-bold text-[var(--color-text)]">Default CIS tax %</p>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{company.name}</p>
          </div>
          <Button onClick={onClose} type="button">
            Close
          </Button>
        </div>
        {error ? (
          <div className="mt-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-xs text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}
        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          <label className="block text-xs font-bold text-[var(--color-text)]">
            Default tax rate (%)
            <input
              className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
              onChange={(event) => setRate(event.target.value)}
              placeholder="e.g. 20"
              type="text"
              value={rate}
            />
          </label>
          <p className="text-xs text-[var(--color-text-muted)]">
            Company default CIS deduction. Employee profile CIS % overrides this. Also editable under Site payroll rules.
          </p>
          <Button disabled={saving} type="submit">
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      </div>
    </div>
  );
}
