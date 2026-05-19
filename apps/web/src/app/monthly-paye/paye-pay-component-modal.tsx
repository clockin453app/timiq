"use client";

import { FormEvent, useEffect, useState } from "react";

import { AlertBanner, Button } from "../../components/ui";
import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";
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
      className="fixed inset-0 z-[2100] flex items-start justify-center overflow-y-auto bg-black/40 p-3 md:p-6"
      role="dialog"
    >
      <div
        className={cn(
          uiClasses.card,
          "mx-auto my-4 w-full max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto sm:max-w-lg",
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <div className="min-w-0">
            <p className="timiq-title-md">{component ? "Edit PAYE component" : "Add PAYE component"}</p>
            <p className="timiq-caption mt-1">
              {employeeName} · {taxYear} tax month {taxMonth}
            </p>
          </div>
          <Button onClick={onClose} size="sm" type="button" variant="secondary">
            Close
          </Button>
        </div>

        <div className="space-y-3 px-4 py-4">
          {locked ? (
            <AlertBanner tone="warning">
              Components are locked once a PAYE period is approved or paid.
            </AlertBanner>
          ) : null}
          {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}

          <form className="space-y-3" onSubmit={submit}>
            <label className={uiClasses.payeFilterLabel}>
              Type
              <select
                className={uiClasses.payeFilterSelect}
                disabled={saving || locked || Boolean(component)}
                onChange={(event) => setComponentType(event.target.value as PayePayComponentType)}
                value={componentType}
              >
                <option value="bonus">Bonus</option>
                <option value="commission">Commission</option>
              </select>
            </label>
            <label className={uiClasses.payeFilterLabel}>
              Description
              <input
                className={uiClasses.payeFilterInput}
                disabled={saving || locked}
                onChange={(event) => setDescription(event.target.value)}
                value={description}
              />
            </label>
            <label className={uiClasses.payeFilterLabel}>
              Amount
              <input
                className={uiClasses.payeFilterInput}
                disabled={saving || locked}
                min="0"
                onChange={(event) => setAmount(event.target.value)}
                step="0.01"
                type="number"
                value={amount}
              />
            </label>
            <div className="grid gap-2 text-xs font-semibold text-[var(--color-text)] sm:grid-cols-3">
              <label className="flex items-center gap-2">
                <input
                  checked={taxable}
                  disabled={saving || locked}
                  onChange={(event) => setTaxable(event.target.checked)}
                  type="checkbox"
                />
                Taxable
              </label>
              <label className="flex items-center gap-2">
                <input
                  checked={niable}
                  disabled={saving || locked}
                  onChange={(event) => setNiable(event.target.checked)}
                  type="checkbox"
                />
                NIable
              </label>
              <label className="flex items-center gap-2">
                <input
                  checked={pensionable}
                  disabled={saving || locked}
                  onChange={(event) => setPensionable(event.target.checked)}
                  type="checkbox"
                />
                Pensionable
              </label>
            </div>
            <div className={cn(uiClasses.payeActionToolbar, "pt-1")}>
              <Button disabled={saving || locked || !amount || !companyId} size="sm" type="submit">
                {saving ? "Saving..." : component ? "Save component" : "Add component"}
              </Button>
              <Button disabled={saving} onClick={onClose} size="sm" type="button" variant="secondary">
                Cancel
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
