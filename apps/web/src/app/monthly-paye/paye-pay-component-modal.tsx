"use client";

import { FormEvent, useEffect, useState } from "react";

import { Button } from "../../components/ui";
import {
  createPayePayComponent,
  patchPayePayComponent,
  type PayePayComponent,
  type PayePayComponentType,
} from "../../features/paye-payroll/api";

type PayePayComponentModalProps = {
  companyId: string | null | undefined;
  taxYear: string;
  taxMonth: number;
  employeeUserId: string;
  employeeName: string;
  component: PayePayComponent | null;
  locked: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export function PayePayComponentModal({
  companyId,
  taxYear,
  taxMonth,
  employeeUserId,
  employeeName,
  component,
  locked,
  onClose,
  onSaved,
}: PayePayComponentModalProps) {
  const [componentType, setComponentType] = useState<PayePayComponentType>("bonus");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [taxable, setTaxable] = useState(true);
  const [niable, setNiable] = useState(true);
  const [pensionable, setPensionable] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!component) {
      setComponentType("bonus");
      setDescription("");
      setAmount("");
      setTaxable(true);
      setNiable(true);
      setPensionable(true);
      return;
    }
    setComponentType(component.component_type);
    setDescription(component.description ?? "");
    setAmount(component.amount);
    setTaxable(component.taxable);
    setNiable(component.niable);
    setPensionable(component.pensionable);
  }, [component]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || !companyId) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (component) {
        await patchPayePayComponent(component.id, {
          amount,
          description: description.trim() || null,
          taxable,
          niable,
          pensionable,
        });
      } else {
        await createPayePayComponent({
          company_id: companyId,
          user_id: employeeUserId,
          tax_year: taxYear,
          tax_month: taxMonth,
          component_type: componentType,
          description: description.trim() || null,
          amount,
          taxable,
          niable,
          pensionable,
        });
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save PAYE component.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[2100] flex items-start justify-center overflow-y-auto bg-black/45 p-3 md:p-6"
      role="dialog"
    >
      <div className="timiq-sheet mx-auto my-4 w-full max-w-[calc(100vw-1.5rem)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 shadow-md sm:max-w-lg">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border-dark)] pb-3">
          <div>
            <p className="text-sm font-bold text-[var(--color-text)]">
              {component ? "Edit PAYE component" : "Add PAYE component"}
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {employeeName} · {taxYear} tax month {taxMonth}
            </p>
          </div>
          <Button onClick={onClose} type="button" variant="secondary">
            Close
          </Button>
        </div>

        {locked ? (
          <div className="mt-3 rounded border border-amber-800/25 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Components are locked once a PAYE period is approved or paid.
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        <form className="mt-4 space-y-3" onSubmit={submit}>
          <label className="block text-xs font-bold text-[var(--color-text)]">
            Type
            <select
              className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
              disabled={saving || locked || Boolean(component)}
              onChange={(event) => setComponentType(event.target.value as PayePayComponentType)}
              value={componentType}
            >
              <option value="bonus">Bonus</option>
              <option value="commission">Commission</option>
            </select>
          </label>
          <label className="block text-xs font-bold text-[var(--color-text)]">
            Description
            <input
              className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
              disabled={saving || locked}
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </label>
          <label className="block text-xs font-bold text-[var(--color-text)]">
            Amount
            <input
              className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
              disabled={saving || locked}
              min="0"
              onChange={(event) => setAmount(event.target.value)}
              step="0.01"
              type="number"
              value={amount}
            />
          </label>
          <div className="grid gap-2 text-xs font-bold text-[var(--color-text)] sm:grid-cols-3">
            <label className="flex items-center gap-2">
              <input checked={taxable} disabled={saving || locked} onChange={(event) => setTaxable(event.target.checked)} type="checkbox" />
              Taxable
            </label>
            <label className="flex items-center gap-2">
              <input checked={niable} disabled={saving || locked} onChange={(event) => setNiable(event.target.checked)} type="checkbox" />
              NIable
            </label>
            <label className="flex items-center gap-2">
              <input checked={pensionable} disabled={saving || locked} onChange={(event) => setPensionable(event.target.checked)} type="checkbox" />
              Pensionable
            </label>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button disabled={saving || locked || !amount || !companyId} type="submit">
              {saving ? "Saving..." : component ? "Save component" : "Add component"}
            </Button>
            <Button disabled={saving} onClick={onClose} type="button" variant="secondary">
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
