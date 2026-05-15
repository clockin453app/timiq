"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { Button, PageHeader, Sheet, SheetBody } from "../../components/ui";
import {
  canAccessManagement,
  changeMyPassword,
  isAdministrator,
  useCurrentUser,
} from "../../features/auth";
import { listCompanies, type Company } from "../../features/companies/api";
import {
  getSettingsCompany,
  getSettingsEffective,
  getSettingsMe,
  patchSettingsCompany,
  patchSettingsMe,
  type CompanySettings,
  type EffectiveSettings,
  type UserPreferences,
} from "../../features/settings/api";
import {
  formatDateByPreference,
  formatMoneyByPreference,
  formatTimeByPreference,
  supportedDateFormats,
  supportedLocales,
  supportedTimeFormats,
} from "../../lib/preferences-format";
import { normalizeAppLocale, useI18n, useT } from "../../lib/i18n";

function fieldClass(): string {
  return "mt-1 w-full max-w-md rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]";
}

function labelClass(): string {
  return "block text-sm font-medium text-[var(--color-text-muted)]";
}

function cardClass(): string {
  return "rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-surface)] p-4 space-y-3";
}

export function SettingsClient() {
  const user = useCurrentUser();
  const t = useT();
  const { setLocale: setAppLocale } = useI18n();
  const showCompany = canAccessManagement(user);
  const platformAdmin = isAdministrator(user);

  const [loadError, setLoadError] = useState("");
  const [savingMy, setSavingMy] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  const [myMessage, setMyMessage] = useState("");
  const [companyMessage, setCompanyMessage] = useState("");

  const [companies, setCompanies] = useState<Company[]>([]);
  const [adminCompanyId, setAdminCompanyId] = useState<string | null>(null);

  const [effective, setEffective] = useState<EffectiveSettings | null>(null);

  const [locale, setLocale] = useState("en-GB");
  const [myTimezone, setMyTimezone] = useState("");
  const [myDateFormat, setMyDateFormat] = useState("DD/MM/YYYY");
  const [myTimeFormat, setMyTimeFormat] = useState("24h");
  const [compactMode, setCompactMode] = useState(false);
  const [notifEmail, setNotifEmail] = useState(true);
  const [notifInApp, setNotifInApp] = useState(true);
  const [notifPushUser, setNotifPushUser] = useState(false);

  const [coDisplayName, setCoDisplayName] = useState("");
  const [coTimezone, setCoTimezone] = useState("");
  const [coWeekStart, setCoWeekStart] = useState("monday");
  const [coCurrency, setCoCurrency] = useState("GBP");
  const [coDateFormat, setCoDateFormat] = useState("DD/MM/YYYY");
  const [coTimeFormat, setCoTimeFormat] = useState("24h");
  const [coNotifMaster, setCoNotifMaster] = useState(true);
  const [coNotifEmail, setCoNotifEmail] = useState(false);
  const [coNotifPush, setCoNotifPush] = useState(false);
  const [coBrandColor, setCoBrandColor] = useState("");

  const previewDate = new Date(2026, 4, 11, 14, 30, 0);

  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMessage, setPwMessage] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    setMyMessage("");
    setCompanyMessage("");
    try {
      let companyIdForEffective: string | null = null;
      let companyIdForCompanyApi: string | null = null;

      if (platformAdmin) {
        const list = await listCompanies();
        setCompanies(list);
        const chosen =
          adminCompanyId && list.some((c) => c.id === adminCompanyId)
            ? adminCompanyId
            : list[0]?.id ?? null;
        if (chosen !== adminCompanyId) {
          setAdminCompanyId(chosen);
        }
        companyIdForEffective = chosen;
        companyIdForCompanyApi = chosen;
      }

      const [me, eff] = await Promise.all([
        getSettingsMe(),
        getSettingsEffective(companyIdForEffective),
      ]);
      applyMe(me);
      setEffective(eff);

      if (showCompany) {
        if (platformAdmin && !companyIdForCompanyApi) {
          /* no companies */
        } else {
          const co = await getSettingsCompany(companyIdForCompanyApi);
          applyCompany(co);
        }
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load settings.");
    }
  }, [adminCompanyId, platformAdmin, showCompany]);

  function applyMe(me: UserPreferences) {
    setLocale(me.locale ?? "en-GB");
    setMyTimezone(me.timezone_name ?? "");
    setMyDateFormat(me.date_format ?? "DD/MM/YYYY");
    setMyTimeFormat(me.time_format ?? "24h");
    setCompactMode(me.compact_mode);
    setNotifEmail(me.notification_email_enabled);
    setNotifInApp(me.notification_in_app_enabled);
    setNotifPushUser(me.push_notifications_enabled);
  }

  function applyCompany(co: CompanySettings) {
    setCoDisplayName(co.company_display_name ?? "");
    setCoTimezone(co.timezone_name ?? "");
    setCoWeekStart(co.week_start_day ?? "monday");
    setCoCurrency(co.currency_code ?? "GBP");
    setCoDateFormat(co.date_format ?? "DD/MM/YYYY");
    setCoTimeFormat(co.time_format ?? "24h");
    setCoNotifMaster(co.notifications_enabled);
    setCoNotifEmail(co.email_notifications_enabled);
    setCoNotifPush(co.push_notifications_enabled);
    setCoBrandColor(co.brand_primary_color ?? "");
  }

  useEffect(() => {
    void load();
  }, [load]);

  async function onSaveMy(e: FormEvent) {
    e.preventDefault();
    setSavingMy(true);
    setMyMessage("");
    try {
      await patchSettingsMe({
        locale,
        timezone_name: myTimezone.trim() || null,
        date_format: myDateFormat,
        time_format: myTimeFormat,
        compact_mode: compactMode,
        notification_email_enabled: notifEmail,
        notification_in_app_enabled: notifInApp,
        push_notifications_enabled: notifPushUser,
      });
      setMyMessage(t("settings.prefs_saved", "Your preferences were saved."));
      setAppLocale(normalizeAppLocale(locale));
      const eff = await getSettingsEffective(platformAdmin ? adminCompanyId : null);
      setEffective(eff);
    } catch (err) {
      setMyMessage(err instanceof Error ? err.message : t("settings.save_failed", "Save failed."));
    } finally {
      setSavingMy(false);
    }
  }

  async function onSaveCompany(e: FormEvent) {
    e.preventDefault();
    if (platformAdmin && !adminCompanyId) {
      setCompanyMessage(t("settings.select_company_first", "Select a company first."));
      return;
    }
    setSavingCompany(true);
    setCompanyMessage("");
    try {
      await patchSettingsCompany(
        {
          company_display_name: coDisplayName.trim() || null,
          timezone_name: coTimezone.trim() || null,
          week_start_day: coWeekStart,
          currency_code: coCurrency,
          date_format: coDateFormat,
          time_format: coTimeFormat,
          notifications_enabled: coNotifMaster,
          email_notifications_enabled: coNotifEmail,
          push_notifications_enabled: coNotifPush,
          brand_primary_color: coBrandColor.trim() || null,
        },
        platformAdmin ? adminCompanyId : null,
      );
      setCompanyMessage(t("settings.company_saved", "Company settings were saved."));
      const eff = await getSettingsEffective(platformAdmin ? adminCompanyId : null);
      setEffective(eff);
    } catch (err) {
      setCompanyMessage(err instanceof Error ? err.message : t("settings.save_failed", "Save failed."));
    } finally {
      setSavingCompany(false);
    }
  }

  const brandPreview =
    coBrandColor && /^#[0-9A-Fa-f]{6}$/.test(coBrandColor) ? coBrandColor : "#64748b";

  return (
    <Sheet>
      <PageHeader
        description={t(
          "settings.page_description",
          "Personal display preferences, notification choices, and (for admins) company defaults. Delivery channels are not wired yet.",
        )}
        title={t("settings.page_title", "Settings")}
      />
      <SheetBody className="min-w-0 space-y-6 md:p-5">
        {loadError ? (
          <p className="text-sm text-red-700" role="alert">
            {loadError}
          </p>
        ) : null}

        {platformAdmin ? (
          <div className={cardClass()}>
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              {t("settings.company_context_title", "Company context")}
            </h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              {t(
                "settings.admin_company_intro",
                "As a platform administrator, choose which company's settings you are viewing or editing.",
              )}
            </p>
            <div>
              <label className={labelClass()} htmlFor="settings-admin-company">
                {t("settings.company_label", "Company")}
              </label>
              <select
                id="settings-admin-company"
                className={fieldClass()}
                value={adminCompanyId ?? ""}
                onChange={(ev) => setAdminCompanyId(ev.target.value || null)}
              >
                {companies.length === 0 ? (
                  <option value="">{t("settings.no_companies", "No companies")}</option>
                ) : null}
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}

        {effective ? (
          <div className={cardClass()}>
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              {t("settings.preview_title", "Preview")}
            </h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              {t(
                "settings.preview_hint",
                "Sample formatting using your effective preferences (this page only).",
              )}
            </p>
            <ul className="text-sm text-[var(--color-text)] space-y-1">
              <li>
                <span className="text-[var(--color-text-muted)]">{t("settings.date_label", "Date")}:</span>{" "}
                {formatDateByPreference(previewDate, effective.date_format)}
              </li>
              <li>
                <span className="text-[var(--color-text-muted)]">{t("settings.time_label", "Time")}:</span>{" "}
                {formatTimeByPreference(previewDate, effective.time_format, locale)}
              </li>
              <li>
                <span className="text-[var(--color-text-muted)]">{t("settings.amount_label", "Amount")}:</span>{" "}
                {formatMoneyByPreference(1234.5, effective.currency_code, locale)}
              </li>
            </ul>
          </div>
        ) : null}

        <form className={cardClass()} onSubmit={onSaveMy}>
          <h2 className="text-base font-semibold text-[var(--color-text)]">
            {t("settings.my_prefs_title", "My preferences")}
          </h2>
          <div>
            <label className={labelClass()} htmlFor="pref-locale">
              {t("settings.locale_label", "Locale")}
            </label>
            <select
              id="pref-locale"
              className={fieldClass()}
              value={locale}
              onChange={(ev) => setLocale(ev.target.value)}
            >
              {supportedLocales.map((loc) => (
                <option key={loc} value={loc}>
                  {loc === "en-GB"
                    ? t("settings.locale_en_GB", "English (United Kingdom)")
                    : loc === "ro-RO"
                      ? t("settings.locale_ro_RO", "Română")
                      : loc === "pl-PL"
                        ? t("settings.locale_pl_PL", "Polski")
                        : loc === "es-ES"
                          ? t("settings.locale_es_ES", "Español")
                          : t("settings.locale_ru_RU", "Русский")}
                </option>
              ))}
            </select>
            <p className="mt-2 max-w-md text-xs text-[var(--color-text-muted)]">
              {t(
                "settings.locale_note",
                "Some legal, payroll, and compliance text may remain in English until professionally reviewed.",
              )}
            </p>
          </div>
          <div>
            <label className={labelClass()} htmlFor="pref-tz">
              {t("settings.timezone_label", "Timezone override")}
            </label>
            <input
              id="pref-tz"
              className={fieldClass()}
              placeholder={t("settings.timezone_placeholder", "e.g. Europe/London (optional)")}
              maxLength={64}
              value={myTimezone}
              onChange={(ev) => setMyTimezone(ev.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass()} htmlFor="pref-df">
                {t("settings.date_format_label", "Date format")}
              </label>
              <select
                id="pref-df"
                className={fieldClass()}
                value={myDateFormat}
                onChange={(ev) => setMyDateFormat(ev.target.value)}
              >
                {supportedDateFormats.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass()} htmlFor="pref-tf">
                {t("settings.time_format_label", "Time format")}
              </label>
              <select
                id="pref-tf"
                className={fieldClass()}
                value={myTimeFormat}
                onChange={(ev) => setMyTimeFormat(ev.target.value)}
              >
                {supportedTimeFormats.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
            <input
              type="checkbox"
              checked={compactMode}
              onChange={(ev) => setCompactMode(ev.target.checked)}
            />
            {t("settings.compact_mode", "Compact mode")}
          </label>

          <div className="border-t border-[var(--color-border-dark)] pt-3 space-y-2">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              {t("settings.notifications_title", "Notifications")}
            </h3>
            <p className="text-sm text-[var(--color-text-muted)]">{t("settings.delivery_note")}</p>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
              <input type="checkbox" checked={notifInApp} onChange={(ev) => setNotifInApp(ev.target.checked)} />
              {t("settings.notif_in_app", "In-app notifications")}
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
              <input type="checkbox" checked={notifEmail} onChange={(ev) => setNotifEmail(ev.target.checked)} />
              {t("settings.notif_email", "Email notifications (when delivery is available)")}
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
              <input
                type="checkbox"
                checked={notifPushUser}
                onChange={(ev) => setNotifPushUser(ev.target.checked)}
              />
              {t("settings.notif_push", "Push notifications (stored only; mobile push not available yet)")}
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={savingMy}>
              {savingMy ? t("settings.saving", "Saving…") : t("settings.save_my_prefs", "Save my preferences")}
            </Button>
            {myMessage ? <span className="text-sm text-[var(--color-text-muted)]">{myMessage}</span> : null}
          </div>
        </form>

        <form
          className={cardClass()}
          onSubmit={async (e) => {
            e.preventDefault();
            setPwMessage("");
            if (pwNew !== pwConfirm) {
              setPwMessage("New password and confirmation do not match.");
              return;
            }
            if (pwNew.length < 12) {
              setPwMessage("New password must be at least 12 characters.");
              return;
            }
            setPwSaving(true);
            try {
              await changeMyPassword(pwCurrent, pwNew);
              setPwMessage("Password updated.");
              setPwCurrent("");
              setPwNew("");
              setPwConfirm("");
            } catch (err) {
              setPwMessage(err instanceof Error ? err.message : "Could not change password.");
            } finally {
              setPwSaving(false);
            }
          }}
        >
          <h2 className="text-base font-semibold text-[var(--color-text)]">
            {t("settings.change_password_title", "Change password")}
          </h2>
          <p className="text-sm text-[var(--color-text-muted)]">{t("settings.pw_hint")}</p>
          <div>
            <label className={labelClass()} htmlFor="pw-current">
              {t("settings.pw_current", "Current password")}
            </label>
            <input
              id="pw-current"
              className={fieldClass()}
              type="password"
              autoComplete="current-password"
              value={pwCurrent}
              onChange={(ev) => setPwCurrent(ev.target.value)}
            />
          </div>
          <div>
            <label className={labelClass()} htmlFor="pw-new">
              {t("settings.pw_new", "New password")}
            </label>
            <input
              id="pw-new"
              className={fieldClass()}
              type="password"
              autoComplete="new-password"
              value={pwNew}
              onChange={(ev) => setPwNew(ev.target.value)}
            />
          </div>
          <div>
            <label className={labelClass()} htmlFor="pw-confirm">
              {t("settings.pw_confirm", "Confirm new password")}
            </label>
            <input
              id="pw-confirm"
              className={fieldClass()}
              type="password"
              autoComplete="new-password"
              value={pwConfirm}
              onChange={(ev) => setPwConfirm(ev.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pwSaving}>
              {pwSaving ? t("settings.updating_password", "Updating…") : t("settings.update_password", "Update password")}
            </Button>
            {pwMessage ? <span className="text-sm text-[var(--color-text-muted)]">{pwMessage}</span> : null}
          </div>
        </form>

        {showCompany ? (
          <form className={cardClass()} onSubmit={onSaveCompany}>
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              {t("settings.company_settings_title", "Company settings")}
            </h2>
            {platformAdmin && !adminCompanyId ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                {t("settings.create_select_company", "Create or select a company to edit defaults.")}
              </p>
            ) : (
              <>
                <div>
                  <label className={labelClass()} htmlFor="co-name">
                    Company display name
                  </label>
                  <input
                    id="co-name"
                    className={fieldClass()}
                    maxLength={200}
                    value={coDisplayName}
                    onChange={(ev) => setCoDisplayName(ev.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass()} htmlFor="co-tz">
                    Default timezone
                  </label>
                  <input
                    id="co-tz"
                    className={fieldClass()}
                    placeholder="Europe/London"
                    maxLength={64}
                    value={coTimezone}
                    onChange={(ev) => setCoTimezone(ev.target.value)}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass()} htmlFor="co-week">
                      Week starts on
                    </label>
                    <select
                      id="co-week"
                      className={fieldClass()}
                      value={coWeekStart}
                      onChange={(ev) => setCoWeekStart(ev.target.value)}
                    >
                      <option value="monday">Monday</option>
                      <option value="sunday">Sunday</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass()} htmlFor="co-cur">
                      Currency
                    </label>
                    <select
                      id="co-cur"
                      className={fieldClass()}
                      value={coCurrency}
                      onChange={(ev) => setCoCurrency(ev.target.value)}
                    >
                      <option value="GBP">GBP</option>
                      <option value="EUR">EUR</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass()} htmlFor="co-df">
                      Default date format
                    </label>
                    <select
                      id="co-df"
                      className={fieldClass()}
                      value={coDateFormat}
                      onChange={(ev) => setCoDateFormat(ev.target.value)}
                    >
                      {supportedDateFormats.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass()} htmlFor="co-tf">
                      Default time format
                    </label>
                    <select
                      id="co-tf"
                      className={fieldClass()}
                      value={coTimeFormat}
                      onChange={(ev) => setCoTimeFormat(ev.target.value)}
                    >
                      {supportedTimeFormats.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="border-t border-[var(--color-border-dark)] pt-3 space-y-2">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">Company notification defaults</h3>
                  <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                    <input
                      type="checkbox"
                      checked={coNotifMaster}
                      onChange={(ev) => setCoNotifMaster(ev.target.checked)}
                    />
                    Notifications enabled (master)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                    <input
                      type="checkbox"
                      checked={coNotifEmail}
                      onChange={(ev) => setCoNotifEmail(ev.target.checked)}
                    />
                    Allow email channel at company level
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                    <input
                      type="checkbox"
                      checked={coNotifPush}
                      onChange={(ev) => setCoNotifPush(ev.target.checked)}
                    />
                    Allow push channel at company level (not implemented)
                  </label>
                </div>

                <div className="border-t border-[var(--color-border-dark)] pt-3 space-y-2">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">Branding</h3>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Logo upload is not available in this release. Only a primary brand colour is stored.
                  </p>
                  <div>
                    <label className={labelClass()} htmlFor="co-color">
                      Brand primary colour (#RRGGBB)
                    </label>
                    <input
                      id="co-color"
                      className={fieldClass()}
                      placeholder="#1e40af"
                      maxLength={9}
                      value={coBrandColor}
                      onChange={(ev) => setCoBrandColor(ev.target.value)}
                    />
                  </div>
                  <div
                    className="max-w-md rounded-[var(--radius-md)] border border-[var(--color-border-dark)] p-4 text-white shadow-sm"
                    style={{ backgroundColor: brandPreview }}
                  >
                    <p className="text-sm font-medium">Preview card</p>
                    <p className="text-xs opacity-90">Company display: {coDisplayName || "Your company"}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" disabled={savingCompany || (platformAdmin && !adminCompanyId)}>
                    {savingCompany ? t("settings.saving", "Saving…") : t("settings.save_company", "Save company settings")}
                  </Button>
                  {companyMessage ? (
                    <span className="text-sm text-[var(--color-text-muted)]">{companyMessage}</span>
                  ) : null}
                </div>
              </>
            )}
          </form>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
