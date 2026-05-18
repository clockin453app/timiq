"use client";

import { FormEvent, useEffect, useState } from "react";

import { Button } from "../../components/ui";
import type { Company } from "../../features/companies/api";
import {
  getCompanyPayeSettings,
  patchCompanyPayeSettings,
  type CompanyPayeSettings,
  type PensionSchemeBasis,
} from "../../features/paye-payroll/api";

type CompanyPayeSettingsModalProps = {
  company: Company | null;
  onClose: () => void;
  onSaved: () => void;
};

function valueOrBlank(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export function CompanyPayeSettingsModal({ company, onClose, onSaved }: CompanyPayeSettingsModalProps) {
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [payeReference, setPayeReference] = useState("");
  const [accountsOfficeReference, setAccountsOfficeReference] = useState("");
  const [defaultTaxYear, setDefaultTaxYear] = useState("");
  const [rtiStatus, setRtiStatus] = useState("not_ready");
  const [pensionProviderName, setPensionProviderName] = useState("");
  const [defaultEmployeePensionPercent, setDefaultEmployeePensionPercent] = useState("");
  const [defaultEmployerPensionPercent, setDefaultEmployerPensionPercent] = useState("");
  const [defaultPensionBasis, setDefaultPensionBasis] = useState<PensionSchemeBasis>("qualifying_earnings");
  const [monthlyPaydayRule, setMonthlyPaydayRule] = useState("");
  const [payPeriodClosingDay, setPayPeriodClosingDay] = useState("");
  const [payeOvertimeEnabled, setPayeOvertimeEnabled] = useState(false);
  const [payeOvertimeThresholdHours, setPayeOvertimeThresholdHours] = useState("");
  const [payeOvertimeMultiplier, setPayeOvertimeMultiplier] = useState("");

  useEffect(() => {
    if (!company) {
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setLoadError("");
      setSaveError("");
      setSuccessMessage("");
      try {
        const settings = await getCompanyPayeSettings(company.id);
        if (!cancelled) {
          applySettings(settings);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Could not load PAYE settings.");
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

  function applySettings(settings: CompanyPayeSettings) {
    setPayeReference(settings.paye_reference ?? "");
    setAccountsOfficeReference(settings.accounts_office_reference ?? "");
    setDefaultTaxYear(settings.default_tax_year ?? "");
    setRtiStatus(settings.rti_status || "not_ready");
    setPensionProviderName(settings.pension_provider_name ?? "");
    setDefaultEmployeePensionPercent(valueOrBlank(settings.default_employee_pension_percent));
    setDefaultEmployerPensionPercent(valueOrBlank(settings.default_employer_pension_percent));
    setDefaultPensionBasis(settings.default_pension_basis);
    setMonthlyPaydayRule(settings.monthly_payday_rule ?? "");
    setPayPeriodClosingDay(valueOrBlank(settings.pay_period_closing_day));
    setPayeOvertimeEnabled(settings.paye_overtime_enabled);
    setPayeOvertimeThresholdHours(valueOrBlank(settings.paye_overtime_threshold_hours));
    setPayeOvertimeMultiplier(valueOrBlank(settings.paye_overtime_multiplier));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!company) {
      return;
    }
    setIsSaving(true);
    setSaveError("");
    setSuccessMessage("");
    try {
      await patchCompanyPayeSettings({
        company_id: company.id,
        paye_reference: payeReference.trim() || null,
        accounts_office_reference: accountsOfficeReference.trim() || null,
        default_tax_year: defaultTaxYear.trim() || null,
        rti_status: rtiStatus,
        pension_provider_name: pensionProviderName.trim() || null,
        default_employee_pension_percent: defaultEmployeePensionPercent.trim() || null,
        default_employer_pension_percent: defaultEmployerPensionPercent.trim() || null,
        default_pension_basis: defaultPensionBasis,
        monthly_payday_rule: monthlyPaydayRule.trim() || null,
        pay_period_closing_day: payPeriodClosingDay.trim() === "" ? null : Number(payPeriodClosingDay),
        paye_overtime_enabled: payeOvertimeEnabled,
        paye_overtime_threshold_hours: payeOvertimeThresholdHours.trim() || null,
        paye_overtime_multiplier: payeOvertimeMultiplier.trim() || null,
      });
      setSuccessMessage("PAYE employer settings saved.");
      await onSaved();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save PAYE settings.");
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
      className="fixed inset-0 z-[2100] flex items-start justify-center overflow-x-hidden overflow-y-auto bg-black/45 p-3 md:p-6"
      role="dialog"
    >
      <div className="timiq-sheet mx-auto my-4 w-full min-w-0 max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 shadow-md sm:max-w-[min(44rem,calc(100vw-3rem))]">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-border-dark)] pb-3">
          <div>
            <p className="text-sm font-bold text-[var(--color-text)]">PAYE employer settings</p>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{company.name}</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Monthly PAYE employer details and pension defaults. Current calculation support is limited to fixed
              monthly salary, numeric L tax codes, NI category A, basic pensions, and student/postgraduate loans.
              RTI/HMRC submission is not enabled.
            </p>
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
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">Loading PAYE settings…</p>
        ) : (
          <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
            <section className="space-y-3 border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">Employer PAYE</p>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                PAYE reference
                <input className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setPayeReference(e.target.value)} value={payeReference} />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                Accounts Office reference
                <input className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setAccountsOfficeReference(e.target.value)} value={accountsOfficeReference} />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                Default tax year
                <input className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setDefaultTaxYear(e.target.value)} placeholder="e.g. 2026-2027" value={defaultTaxYear} />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                RTI status
                <select className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setRtiStatus(e.target.value)} value={rtiStatus}>
                  <option value="not_ready">Not ready</option>
                  <option value="ready">Ready</option>
                  <option value="exported">Exported</option>
                  <option value="submitted">Submitted</option>
                  <option value="accepted">Accepted</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>
              <p className="text-xs text-[var(--color-text-muted)]">RTI status is stored for future workflow only. HMRC submission is not implemented.</p>
            </section>

            <section className="space-y-3 border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">Pension defaults</p>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                Pension provider / scheme name
                <input className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setPensionProviderName(e.target.value)} value={pensionProviderName} />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                Default employee pension %
                <input className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setDefaultEmployeePensionPercent(e.target.value)} value={defaultEmployeePensionPercent} />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                Default employer pension %
                <input className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setDefaultEmployerPensionPercent(e.target.value)} value={defaultEmployerPensionPercent} />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                Default pension basis
                <select className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setDefaultPensionBasis(e.target.value as PensionSchemeBasis)} value={defaultPensionBasis}>
                  <option value="qualifying_earnings">Qualifying earnings</option>
                  <option value="total_earnings">Total earnings</option>
                </select>
              </label>
            </section>

            <section className="space-y-3 border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">Pay schedule</p>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                Monthly payday rule
                <input className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setMonthlyPaydayRule(e.target.value)} placeholder="e.g. last working day" value={monthlyPaydayRule} />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                Pay period closing day
                <input className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" max={31} min={1} onChange={(e) => setPayPeriodClosingDay(e.target.value)} type="number" value={payPeriodClosingDay} />
              </label>
            </section>

            <section className="space-y-3 border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">PAYE overtime foundation</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                PAYE overtime settings are stored for future use. PAYE overtime calculation is not enabled yet.
              </p>
              <label className="flex items-center gap-2 text-xs font-bold text-[var(--color-text)]">
                <input checked={payeOvertimeEnabled} disabled={isSaving} onChange={(e) => setPayeOvertimeEnabled(e.target.checked)} type="checkbox" />
                PAYE overtime enabled
              </label>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                PAYE overtime threshold hours
                <input className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" min={0} onChange={(e) => setPayeOvertimeThresholdHours(e.target.value)} type="number" value={payeOvertimeThresholdHours} />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                PAYE overtime multiplier
                <input className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" min={0} onChange={(e) => setPayeOvertimeMultiplier(e.target.value)} step="0.01" type="number" value={payeOvertimeMultiplier} />
              </label>
            </section>

            <div className="flex flex-wrap gap-2">
              <Button disabled={isSaving} type="submit">
                {isSaving ? "Saving…" : "Save PAYE settings"}
              </Button>
              <Button disabled={isSaving} onClick={onClose} type="button" variant="secondary">
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
