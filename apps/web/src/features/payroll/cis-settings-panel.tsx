"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "../../components/ui";
import { isAdministrator, useCurrentUser } from "../auth";
import { CompanySelector } from "../companies/company-selector";
import { listCompanies, patchCompanyPayrollTax, type Company } from "../companies/api";
import { useAdministratorCompanyScope } from "../companies/selected-company";
import { listWorkplaces, type Workplace } from "../workplaces/api";
import { useT } from "../../lib/i18n";

type CisSettingsPanelProps = {
  id?: string;
  /** When set (e.g. from Site payroll rules), uses this company and skips duplicate selector. */
  companyId?: string | null;
  hideCompanySelector?: boolean;
};

export function CisSettingsPanel({
  id = "cis-settings",
  companyId: companyIdProp,
  hideCompanySelector = false,
}: CisSettingsPanelProps) {
  const t = useT();
  const user = useCurrentUser();
  const platformAdmin = isAdministrator(user);
  const [companies, setCompanies] = useState<Company[]>([]);
  const companyScope = useAdministratorCompanyScope(user, companies);
  const [rate, setRate] = useState("");
  const [legacyWorkplaces, setLegacyWorkplaces] = useState<Workplace[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const scopedCompanyId = companyIdProp ?? (platformAdmin ? companyScope.companyId : user.company_id);

  const company = useMemo(
    () => companies.find((c) => c.id === scopedCompanyId) ?? null,
    [companies, scopedCompanyId],
  );

  useEffect(() => {
    if (!platformAdmin || hideCompanySelector) {
      return;
    }
    let cancelled = false;
    void listCompanies()
      .then((list) => {
        if (!cancelled) {
          setCompanies(list.filter((c) => c.is_active));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCompanies([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hideCompanySelector, platformAdmin]);

  const load = useCallback(async () => {
    if (!scopedCompanyId) {
      setLoading(false);
      setRate("");
      setLegacyWorkplaces([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const coList = hideCompanySelector && companies.length > 0 ? companies : await listCompanies();
      if (!hideCompanySelector) {
        setCompanies(coList.filter((c) => c.is_active));
      }
      const wpList = await listWorkplaces(platformAdmin ? scopedCompanyId : undefined);
      const co = coList.find((c) => c.id === scopedCompanyId);
      setRate(co?.default_tax_rate ?? "");
      setLegacyWorkplaces(wpList);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("cis.settings.load_error", "Could not load CIS settings."));
    } finally {
      setLoading(false);
    }
  }, [companies, hideCompanySelector, platformAdmin, scopedCompanyId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const legacyRate = useMemo(() => {
    const withRate = legacyWorkplaces
      .filter((w) => w.tax_rate != null && String(w.tax_rate).trim() !== "")
      .sort((a, b) => a.name.localeCompare(b.name));
    return withRate[0] ?? null;
  }, [legacyWorkplaces]);

  const showLegacyHint =
    legacyRate != null &&
    rate.trim() === "" &&
    (company?.default_tax_rate == null || String(company.default_tax_rate).trim() === "");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!scopedCompanyId) {
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const trimmed = rate.trim();
      await patchCompanyPayrollTax(scopedCompanyId, {
        default_tax_rate: trimmed === "" ? null : trimmed,
      });
      setMessage(t("cis.settings.saved", "CIS settings saved."));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cis.settings.save_error", "Could not save CIS settings."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-surface)] p-4 space-y-3"
      id={id}
    >
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text)]">
          {t("cis.settings.title", "CIS settings")}
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {t(
            "cis.settings.sites_note",
            "Sites control clocking, GPS, access, payroll rules, and budget labour. CIS settings only affect payroll deduction calculations.",
          )}
        </p>
      </div>

      {platformAdmin && !hideCompanySelector ? (
        <CompanySelector
          companies={companyScope.companies}
          label={t("cis.settings.company", "Company")}
          onChange={companyScope.setCompanyId}
          value={companyScope.companyId ?? ""}
        />
      ) : null}

      {!scopedCompanyId ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          {t("cis.settings.select_company", "Select a company to manage CIS settings.")}
        </p>
      ) : loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">{t("cis.settings.loading", "Loading…")}</p>
      ) : (
        <form className="max-w-md space-y-3" onSubmit={onSubmit}>
          <label className="block text-sm font-medium text-[var(--color-text)]" htmlFor="cis-default-rate">
            {t("cis.settings.default_rate", "Default CIS deduction %")}
            <input
              className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-white px-3 py-2 text-sm"
              id="cis-default-rate"
              inputMode="decimal"
              onChange={(ev) => setRate(ev.target.value)}
              placeholder={t("cis.settings.rate_placeholder", "e.g. 20")}
              type="text"
              value={rate}
            />
          </label>
          <p className="text-xs text-[var(--color-text-muted)]">
            {t(
              "cis.settings.employee_override_note",
              "Employee profile CIS % overrides the company default.",
            )}
          </p>
          {showLegacyHint ? (
            <div className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
              {t(
                "cis.settings.legacy_hint",
                "A legacy CIS workplace record has {rate}% set ({name}). You can copy this to the company default above.",
              )
                .replace("{rate}", String(legacyRate.tax_rate))
                .replace("{name}", legacyRate.name)}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={saving} type="submit">
              {saving ? t("cis.settings.saving", "Saving…") : t("cis.settings.save", "Save CIS settings")}
            </Button>
            {message ? <span className="text-sm text-[var(--color-text-muted)]">{message}</span> : null}
          </div>
          {error ? <p className="text-sm text-[var(--color-danger-700)]">{error}</p> : null}
        </form>
      )}
    </section>
  );
}
