"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { Button, PageHeader, Sheet, SheetBody } from "../../components/ui";
import {
  ACCOUNTING_PROVIDER_OPTIONS,
  EXPORT_CSV_PROVIDERS,
  type AccountingExportRun,
  type ExportCsvProvider,
  type ExportMappingPatchBody,
  fetchAccountingProviders,
  fetchAccountingSettings,
  fetchExportMapping,
  listAccountingExportRuns,
  downloadBudgetAccountingCsv,
  downloadPayrollAccountingCsv,
  patchExportMapping,
  saveAccountingSettings,
  type AccountingSettings,
  type AccountingSettingsUpsert,
} from "../../features/accounting/api";
import { isAdministrator, LogoutButton, useCurrentUser, type AuthUser } from "../../features/auth";
import { listBudgetProjects, type BudgetProjectSummary } from "../../features/budgets/api";
import { listCompanies, type Company } from "../../features/companies/api";

type TabId = "payroll" | "budget" | "mapping";

function resolveCompanyId(user: AuthUser, override: string | null): string | null {
  if (isAdministrator(user)) {
    return override;
  }
  return user.company_id;
}

function fieldLabelClass() {
  return "block text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]";
}

function selectClass() {
  return "mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]";
}

function inputClass() {
  return "mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]";
}

function textareaClass() {
  return "mt-1.5 min-h-[96px] w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 py-2 text-sm text-[var(--color-text)]";
}

function formatUpdated(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 42);
  return { from: isoDate(from), to: isoDate(to) };
}

const TAB_BTN =
  "rounded-[var(--radius-md)] border border-[var(--color-border-dark)] px-3 py-1.5 text-sm font-medium transition-colors";
const TAB_ACTIVE = "bg-[var(--color-text)] text-[var(--color-bg)]";
const TAB_IDLE = "bg-[var(--color-cell)] text-[var(--color-text)] hover:bg-[var(--color-border-light)]";

export function AccountingClient() {
  const user = useCurrentUser();
  const [tab, setTab] = useState<TabId>("payroll");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyOverride, setCompanyOverride] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState<string>("");

  const [settings, setSettings] = useState<AccountingSettings | null>(null);
  const [providerKey, setProviderKey] = useState("none");
  const [notes, setNotes] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const dr = useMemo(() => defaultDateRange(), []);
  const [payrollProvider, setPayrollProvider] = useState<ExportCsvProvider>("generic_csv");
  const [dateFrom, setDateFrom] = useState(dr.from);
  const [dateTo, setDateTo] = useState(dr.to);
  const [exportType, setExportType] = useState<"payroll_items" | "payroll_summary">("payroll_items");
  const [includeApproved, setIncludeApproved] = useState(true);
  const [includePaid, setIncludePaid] = useState(true);
  const [includePending, setIncludePending] = useState(false);
  const [includeEmail, setIncludeEmail] = useState(true);
  const [payrollBusy, setPayrollBusy] = useState(false);
  const [payrollErr, setPayrollErr] = useState<string | null>(null);

  const [exportRuns, setExportRuns] = useState<AccountingExportRun[]>([]);
  const [runsErr, setRunsErr] = useState<string | null>(null);

  const [budgets, setBudgets] = useState<BudgetProjectSummary[]>([]);
  const [budgetId, setBudgetId] = useState<string>("");
  const [budgetProvider, setBudgetProvider] = useState<ExportCsvProvider>("generic_csv");
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [budgetErr, setBudgetErr] = useState<string | null>(null);

  const [mappingProvider, setMappingProvider] = useState<ExportCsvProvider>("generic_csv");
  const [nominalWages, setNominalWages] = useState("");
  const [nominalCis, setNominalCis] = useState("");
  const [nominalMaterials, setNominalMaterials] = useState("");
  const [nominalTools, setNominalTools] = useState("");
  const [nominalEquipment, setNominalEquipment] = useState("");
  const [nominalSub, setNominalSub] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [mappingLoadErr, setMappingLoadErr] = useState<string | null>(null);
  const [mappingSaveErr, setMappingSaveErr] = useState<string | null>(null);
  const [mappingSaving, setMappingSaving] = useState(false);

  const effectiveCompanyId = useMemo(() => resolveCompanyId(user, companyOverride), [user, companyOverride]);

  useEffect(() => {
    if (!isAdministrator(user)) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listCompanies();
        if (!cancelled) {
          setCompanies(rows);
        }
      } catch {
        if (!cancelled) {
          setCompanies([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const p = await fetchAccountingProviders();
        if (!cancelled) {
          setDisclaimer(p.disclaimer);
        }
      } catch {
        if (!cancelled) {
          setDisclaimer(
            "CSV export foundation only. Direct OAuth sync with Xero, QuickBooks, or Sage is not implemented in this version.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSettings = useCallback(async () => {
    if (!effectiveCompanyId) {
      setSettings(null);
      setProviderKey("none");
      setNotes("");
      setLoading(false);
      setLoadError(isAdministrator(user) ? "Select a company to continue." : null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const s = await fetchAccountingSettings(isAdministrator(user) ? effectiveCompanyId : null);
      setSettings(s);
      setProviderKey(s.provider_key);
      setNotes(s.notes ?? "");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load settings.");
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [effectiveCompanyId, user]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const loadRuns = useCallback(async () => {
    if (!effectiveCompanyId) {
      setExportRuns([]);
      return;
    }
    setRunsErr(null);
    try {
      const rows = await listAccountingExportRuns(isAdministrator(user) ? effectiveCompanyId : null, 50);
      setExportRuns(rows);
    } catch (e) {
      setRunsErr(e instanceof Error ? e.message : "Could not load export history.");
    }
  }, [effectiveCompanyId, user]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns, tab]);

  const loadBudgets = useCallback(async () => {
    if (!effectiveCompanyId) {
      setBudgets([]);
      setBudgetId("");
      return;
    }
    try {
      const rows = await listBudgetProjects({ companyId: effectiveCompanyId, limit: 200 });
      setBudgets(rows);
      setBudgetId((prev) => {
        if (rows.length === 0) {
          return "";
        }
        if (prev && rows.some((b) => b.id === prev)) {
          return prev;
        }
        return rows[0]?.id ?? "";
      });
    } catch {
      setBudgets([]);
    }
  }, [effectiveCompanyId]);

  useEffect(() => {
    if (tab === "budget") {
      void loadBudgets();
    }
  }, [tab, loadBudgets]);

  const loadMapping = useCallback(async () => {
    if (!effectiveCompanyId) {
      return;
    }
    setMappingLoadErr(null);
    try {
      const m = await fetchExportMapping(isAdministrator(user) ? effectiveCompanyId : null, mappingProvider);
      setNominalWages(m.nominal_code_wages ?? "");
      setNominalCis(m.nominal_code_cis ?? "");
      setNominalMaterials(m.nominal_code_materials ?? "");
      setNominalTools(m.nominal_code_tools ?? "");
      setNominalEquipment(m.nominal_code_equipment ?? "");
      setNominalSub(m.nominal_code_subcontractor ?? "");
      setTaxCode(m.tax_code ?? "");
    } catch (e) {
      setMappingLoadErr(e instanceof Error ? e.message : "Could not load mapping.");
    }
  }, [effectiveCompanyId, user, mappingProvider]);

  useEffect(() => {
    if (tab === "mapping" && effectiveCompanyId) {
      void loadMapping();
    }
  }, [tab, effectiveCompanyId, loadMapping]);

  async function onSubmitNotes(e: FormEvent) {
    e.preventDefault();
    if (!effectiveCompanyId) {
      return;
    }
    setSaveError(null);
    setSaving(true);
    try {
      const payload: AccountingSettingsUpsert = {
        company_id: isAdministrator(user) ? effectiveCompanyId : null,
        provider_key: providerKey,
        notes: notes.trim() === "" ? null : notes,
      };
      const s = await saveAccountingSettings(payload);
      setSettings(s);
      setProviderKey(s.provider_key);
      setNotes(s.notes ?? "");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function onPayrollDownload() {
    if (!effectiveCompanyId) {
      return;
    }
    if (!includeApproved && !includePaid && !includePending) {
      setPayrollErr("Select at least one of approved, paid, or pending.");
      return;
    }
    setPayrollErr(null);
    setPayrollBusy(true);
    try {
      await downloadPayrollAccountingCsv(
        {
          provider: payrollProvider,
          company_id: isAdministrator(user) ? effectiveCompanyId : null,
          date_from: dateFrom,
          date_to: dateTo,
          export_type: exportType,
          include_approved: includeApproved,
          include_paid: includePaid,
          include_pending: includePending,
          include_email: includeEmail,
        },
        `timiq-payroll-${payrollProvider}.csv`,
      );
      await loadRuns();
    } catch (e) {
      setPayrollErr(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setPayrollBusy(false);
    }
  }

  async function onBudgetDownload() {
    if (!budgetId) {
      setBudgetErr("Select a budget.");
      return;
    }
    setBudgetErr(null);
    setBudgetBusy(true);
    try {
      await downloadBudgetAccountingCsv(budgetId, budgetProvider, `timiq-budget-${budgetId}.csv`);
      await loadRuns();
    } catch (e) {
      setBudgetErr(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBudgetBusy(false);
    }
  }

  async function onMappingSave(e: FormEvent) {
    e.preventDefault();
    if (!effectiveCompanyId) {
      return;
    }
    setMappingSaveErr(null);
    setMappingSaving(true);
    try {
      const body: ExportMappingPatchBody = {
        company_id: isAdministrator(user) ? effectiveCompanyId : null,
        provider: mappingProvider,
        nominal_code_wages: nominalWages.trim() || null,
        nominal_code_cis: nominalCis.trim() || null,
        nominal_code_materials: nominalMaterials.trim() || null,
        nominal_code_tools: nominalTools.trim() || null,
        nominal_code_equipment: nominalEquipment.trim() || null,
        nominal_code_subcontractor: nominalSub.trim() || null,
        tax_code: taxCode.trim() || null,
      };
      await patchExportMapping(body);
      await loadMapping();
    } catch (e) {
      setMappingSaveErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setMappingSaving(false);
    }
  }

  return (
    <Sheet>
      <PageHeader
        action={<LogoutButton />}
        description="Export-ready CSV for payroll and saved budget costs. No live OAuth sync yet — files are generated on demand and export activity is logged."
        title="Accounting exports"
      />
      <SheetBody className="min-w-0 space-y-4 md:p-5">
        <div className="rounded-[var(--radius-md)] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-semibold">Foundation only</p>
          <p className="mt-1 text-amber-900">{disclaimer}</p>
          <p className="mt-1 text-amber-900">
            Direct OAuth sync is not implemented yet. TimIQ does not send data to Xero, QuickBooks, or Sage
            automatically and does not store third-party tokens.
          </p>
        </div>

        {isAdministrator(user) ? (
          <div>
            <label className={fieldLabelClass()} htmlFor="acct-company">
              Company
            </label>
            <select
              className={selectClass()}
              id="acct-company"
              value={companyOverride ?? ""}
              onChange={(ev) => setCompanyOverride(ev.target.value || null)}
            >
              <option value="">Select company…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`${TAB_BTN} ${tab === "payroll" ? TAB_ACTIVE : TAB_IDLE}`}
            onClick={() => setTab("payroll")}
          >
            Payroll exports
          </button>
          <button
            type="button"
            className={`${TAB_BTN} ${tab === "budget" ? TAB_ACTIVE : TAB_IDLE}`}
            onClick={() => setTab("budget")}
          >
            Budget exports
          </button>
          <button
            type="button"
            className={`${TAB_BTN} ${tab === "mapping" ? TAB_ACTIVE : TAB_IDLE}`}
            onClick={() => setTab("mapping")}
          >
            Mapping &amp; notes
          </button>
        </div>

        {loadError ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm text-red-700">
            {loadError}
          </div>
        ) : null}

        {tab === "payroll" && effectiveCompanyId ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={fieldLabelClass()} htmlFor="pay-prov">
                  Export format (provider style)
                </label>
                <select
                  className={selectClass()}
                  id="pay-prov"
                  value={payrollProvider}
                  onChange={(ev) => setPayrollProvider(ev.target.value as ExportCsvProvider)}
                >
                  {EXPORT_CSV_PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {p === "generic_csv" ? "Generic CSV (TimIQ)" : p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={fieldLabelClass()} htmlFor="pay-ex-type">
                  Export type
                </label>
                <select
                  className={selectClass()}
                  id="pay-ex-type"
                  value={exportType}
                  onChange={(ev) => setExportType(ev.target.value as "payroll_items" | "payroll_summary")}
                >
                  <option value="payroll_items">Payroll line items</option>
                  <option value="payroll_summary">Payroll week summary</option>
                </select>
              </div>
              <div>
                <label className={fieldLabelClass()} htmlFor="df">
                  Date from
                </label>
                <input className={inputClass()} id="df" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label className={fieldLabelClass()} htmlFor="dt">
                  Date to
                </label>
                <input className={inputClass()} id="dt" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={includeApproved} onChange={(e) => setIncludeApproved(e.target.checked)} />
                Include approved rows
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={includePaid} onChange={(e) => setIncludePaid(e.target.checked)} />
                Include paid rows
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={includeEmail} onChange={(e) => setIncludeEmail(e.target.checked)} />
                Include employee email (internal reference)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={includePending} onChange={(e) => setIncludePending(e.target.checked)} />
                Include pending rows (labelled in CSV)
              </label>
              {includePending ? (
                <div className="rounded-[var(--radius-md)] border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950">
                  Pending rows are not final payroll. Only enable this when you intentionally need a draft view.
                </div>
              ) : null}
            </div>
            {payrollErr ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm text-red-700">
                {payrollErr}
              </div>
            ) : null}
            <Button disabled={payrollBusy} type="button" onClick={() => void onPayrollDownload()}>
              {payrollBusy ? "Preparing…" : "Download payroll CSV"}
            </Button>

            <div>
              <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--color-text-soft)]">Recent exports</h3>
              {runsErr ? <p className="mt-1 text-sm text-red-700">{runsErr}</p> : null}
              <div className="mt-2 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border-dark)]">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-[var(--color-cell)] text-xs uppercase text-[var(--color-text-soft)]">
                    <tr>
                      <th className="px-2 py-2">When</th>
                      <th className="px-2 py-2">Type</th>
                      <th className="px-2 py-2">Provider</th>
                      <th className="px-2 py-2">Rows</th>
                      <th className="px-2 py-2">Total gross</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exportRuns.map((r) => (
                      <tr key={r.id} className="border-t border-[var(--color-border-dark)]">
                        <td className="px-2 py-1.5 whitespace-nowrap">{formatUpdated(r.created_at)}</td>
                        <td className="px-2 py-1.5">{r.export_type}</td>
                        <td className="px-2 py-1.5">{r.provider}</td>
                        <td className="px-2 py-1.5">{r.row_count}</td>
                        <td className="px-2 py-1.5">{r.total_amount ?? "—"}</td>
                      </tr>
                    ))}
                    {exportRuns.length === 0 ? (
                      <tr>
                        <td className="px-2 py-3 text-[var(--color-text-soft)]" colSpan={5}>
                          No exports logged yet for this company.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "budget" && effectiveCompanyId ? (
          <div className="max-w-xl space-y-4">
            <div>
              <label className={fieldLabelClass()} htmlFor="bud-id">
                Budget / project
              </label>
              <select
                className={selectClass()}
                id="bud-id"
                value={budgetId}
                onChange={(ev) => setBudgetId(ev.target.value)}
              >
                <option value="">Select budget…</option>
                {budgets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={fieldLabelClass()} htmlFor="bud-prov">
                Export format
              </label>
              <select
                className={selectClass()}
                id="bud-prov"
                value={budgetProvider}
                onChange={(ev) => setBudgetProvider(ev.target.value as ExportCsvProvider)}
              >
                {EXPORT_CSV_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p === "generic_csv" ? "Generic CSV (TimIQ)" : p}
                  </option>
                ))}
              </select>
            </div>
            {budgetErr ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm text-red-700">
                {budgetErr}
              </div>
            ) : null}
            <Button disabled={budgetBusy || !budgetId} type="button" onClick={() => void onBudgetDownload()}>
              {budgetBusy ? "Preparing…" : "Download budget costs CSV"}
            </Button>
            <p className="text-xs text-[var(--color-text-soft)]">
              Uses saved budget expenses only. Labour appears as aggregate summary columns — not per-employee identifiers.
            </p>
          </div>
        ) : null}

        {tab === "mapping" && effectiveCompanyId ? (
          <div className="space-y-6">
            <div>
              <label className={fieldLabelClass()} htmlFor="map-prov">
                Mapping profile (per provider)
              </label>
              <select
                className={selectClass()}
                id="map-prov"
                value={mappingProvider}
                onChange={(ev) => setMappingProvider(ev.target.value as ExportCsvProvider)}
              >
                {EXPORT_CSV_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p === "generic_csv" ? "Generic CSV (TimIQ)" : p}
                  </option>
                ))}
              </select>
              {mappingLoadErr ? (
                <p className="mt-2 text-sm text-red-700">{mappingLoadErr}</p>
              ) : (
                <p className="mt-1 text-xs text-[var(--color-text-soft)]">
                  Nominal / tax hints are embedded into export-ready CSV columns where applicable. They are not sent to
                  any external system from this screen.
                </p>
              )}
            </div>
            <form className="grid max-w-2xl gap-3 md:grid-cols-2" onSubmit={onMappingSave}>
              <div>
                <label className={fieldLabelClass()} htmlFor="n-w">
                  Nominal — wages
                </label>
                <input className={inputClass()} id="n-w" value={nominalWages} onChange={(e) => setNominalWages(e.target.value)} />
              </div>
              <div>
                <label className={fieldLabelClass()} htmlFor="n-c">
                  Nominal — CIS
                </label>
                <input className={inputClass()} id="n-c" value={nominalCis} onChange={(e) => setNominalCis(e.target.value)} />
              </div>
              <div>
                <label className={fieldLabelClass()} htmlFor="n-m">
                  Nominal — materials
                </label>
                <input
                  className={inputClass()}
                  id="n-m"
                  value={nominalMaterials}
                  onChange={(e) => setNominalMaterials(e.target.value)}
                />
              </div>
              <div>
                <label className={fieldLabelClass()} htmlFor="n-tl">
                  Nominal — tools
                </label>
                <input className={inputClass()} id="n-tl" value={nominalTools} onChange={(e) => setNominalTools(e.target.value)} />
              </div>
              <div>
                <label className={fieldLabelClass()} htmlFor="n-eq">
                  Nominal — equipment
                </label>
                <input
                  className={inputClass()}
                  id="n-eq"
                  value={nominalEquipment}
                  onChange={(e) => setNominalEquipment(e.target.value)}
                />
              </div>
              <div>
                <label className={fieldLabelClass()} htmlFor="n-sc">
                  Nominal — subcontractor
                </label>
                <input className={inputClass()} id="n-sc" value={nominalSub} onChange={(e) => setNominalSub(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <label className={fieldLabelClass()} htmlFor="tax-c">
                  Tax / VAT code hint (optional)
                </label>
                <input className={inputClass()} id="tax-c" value={taxCode} onChange={(e) => setTaxCode(e.target.value)} />
              </div>
              {mappingSaveErr ? (
                <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm text-red-700">
                  {mappingSaveErr}
                </div>
              ) : null}
              <div className="md:col-span-2">
                <Button disabled={mappingSaving} type="submit">
                  {mappingSaving ? "Saving…" : "Save mapping"}
                </Button>
              </div>
            </form>

            <div className="border-t border-[var(--color-border-dark)] pt-4">
              <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                Internal link &amp; notes
              </h3>
              <p className="mt-1 text-xs text-[var(--color-text-soft)]">
                Record which accounting system you target and internal notes. Never store passwords or bank details here.
              </p>
              {loading ? <p className="mt-2 text-sm text-[var(--color-text-soft)]">Loading…</p> : null}
              {!loading ? (
                <form className="mt-3 max-w-xl space-y-4" onSubmit={onSubmitNotes}>
                  <div>
                    <label className={fieldLabelClass()} htmlFor="acct-provider">
                      Target system (internal)
                    </label>
                    <select
                      className={selectClass()}
                      id="acct-provider"
                      value={providerKey}
                      onChange={(ev) => setProviderKey(ev.target.value)}
                    >
                      {ACCOUNTING_PROVIDER_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={fieldLabelClass()} htmlFor="acct-notes">
                      Notes (optional)
                    </label>
                    <textarea
                      className={textareaClass()}
                      id="acct-notes"
                      maxLength={4000}
                      placeholder="e.g. finance contact, export cadence — never passwords or account numbers"
                      value={notes}
                      onChange={(ev) => setNotes(ev.target.value)}
                    />
                  </div>
                  {settings?.updated_at ? (
                    <p className="text-xs text-[var(--color-text-soft)]">
                      Last updated {formatUpdated(settings.updated_at) ?? settings.updated_at}
                    </p>
                  ) : (
                    <p className="text-xs text-[var(--color-text-soft)]">No notes saved yet for this company.</p>
                  )}
                  {saveError ? (
                    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm text-red-700">
                      {saveError}
                    </div>
                  ) : null}
                  <Button disabled={saving} type="submit">
                    {saving ? "Saving…" : "Save notes"}
                  </Button>
                </form>
              ) : null}
            </div>
          </div>
        ) : null}

        {!effectiveCompanyId && !loadError ? (
          <p className="text-sm text-[var(--color-text-soft)]">Select a company to use accounting exports.</p>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
