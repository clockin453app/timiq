"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { Button, PageHeader, Sheet, SheetBody } from "../../components/ui";
import {
  canAccessManagement,
  isAdministrator,
  LogoutButton,
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
      setMyMessage("Your preferences were saved.");
      const eff = await getSettingsEffective(platformAdmin ? adminCompanyId : null);
      setEffective(eff);
    } catch (err) {
      setMyMessage(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSavingMy(false);
    }
  }

  async function onSaveCompany(e: FormEvent) {
    e.preventDefault();
    if (platformAdmin && !adminCompanyId) {
      setCompanyMessage("Select a company first.");
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
      setCompanyMessage("Company settings were saved.");
      const eff = await getSettingsEffective(platformAdmin ? adminCompanyId : null);
      setEffective(eff);
    } catch (err) {
      setCompanyMessage(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSavingCompany(false);
    }
  }

  const brandPreview =
    coBrandColor && /^#[0-9A-Fa-f]{6}$/.test(coBrandColor) ? coBrandColor : "#64748b";

  return (
    <Sheet>
      <PageHeader
        action={<LogoutButton />}
        description="Personal display preferences, notification choices, and (for admins) company defaults. Delivery channels are not wired yet."
        title="Settings"
      />
      <SheetBody className="min-w-0 space-y-6 md:p-5">
        {loadError ? (
          <p className="text-sm text-red-700" role="alert">
            {loadError}
          </p>
        ) : null}

        {platformAdmin ? (
          <div className={cardClass()}>
            <h2 className="text-base font-semibold text-[var(--color-text)]">Company context</h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              As a platform administrator, choose which company&apos;s settings you are viewing or editing.
            </p>
            <div>
              <label className={labelClass()} htmlFor="settings-admin-company">
                Company
              </label>
              <select
                id="settings-admin-company"
                className={fieldClass()}
                value={adminCompanyId ?? ""}
                onChange={(ev) => setAdminCompanyId(ev.target.value || null)}
              >
                {companies.length === 0 ? <option value="">No companies</option> : null}
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
            <h2 className="text-base font-semibold text-[var(--color-text)]">Preview</h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              Sample formatting using your effective preferences (this page only).
            </p>
            <ul className="text-sm text-[var(--color-text)] space-y-1">
              <li>
                <span className="text-[var(--color-text-muted)]">Date:</span>{" "}
                {formatDateByPreference(previewDate, effective.date_format)}
              </li>
              <li>
                <span className="text-[var(--color-text-muted)]">Time:</span>{" "}
                {formatTimeByPreference(previewDate, effective.time_format, effective.locale)}
              </li>
              <li>
                <span className="text-[var(--color-text-muted)]">Amount:</span>{" "}
                {formatMoneyByPreference(1234.5, effective.currency_code, effective.locale)}
              </li>
            </ul>
          </div>
        ) : null}

        <form className={cardClass()} onSubmit={onSaveMy}>
          <h2 className="text-base font-semibold text-[var(--color-text)]">My preferences</h2>
          <div>
            <label className={labelClass()} htmlFor="pref-locale">
              Locale
            </label>
            <select
              id="pref-locale"
              className={fieldClass()}
              value={locale}
              onChange={(ev) => setLocale(ev.target.value)}
            >
              {supportedLocales.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass()} htmlFor="pref-tz">
              Timezone override
            </label>
            <input
              id="pref-tz"
              className={fieldClass()}
              placeholder="e.g. Europe/London (optional)"
              maxLength={64}
              value={myTimezone}
              onChange={(ev) => setMyTimezone(ev.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass()} htmlFor="pref-df">
                Date format
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
                Time format
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
            Compact mode
          </label>

          <div className="border-t border-[var(--color-border-dark)] pt-3 space-y-2">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Notifications</h3>
            <p className="text-sm text-[var(--color-text-muted)]">
              Delivery preferences only. Email and push are not configured yet; values are stored for future use.
            </p>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
              <input type="checkbox" checked={notifInApp} onChange={(ev) => setNotifInApp(ev.target.checked)} />
              In-app notifications
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
              <input type="checkbox" checked={notifEmail} onChange={(ev) => setNotifEmail(ev.target.checked)} />
              Email notifications (when delivery is available)
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
              <input
                type="checkbox"
                checked={notifPushUser}
                onChange={(ev) => setNotifPushUser(ev.target.checked)}
              />
              Push notifications (stored only; mobile push not available yet)
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={savingMy}>
              {savingMy ? "Saving…" : "Save my preferences"}
            </Button>
            {myMessage ? <span className="text-sm text-[var(--color-text-muted)]">{myMessage}</span> : null}
          </div>
        </form>

        {showCompany ? (
          <form className={cardClass()} onSubmit={onSaveCompany}>
            <h2 className="text-base font-semibold text-[var(--color-text)]">Company settings</h2>
            {platformAdmin && !adminCompanyId ? (
              <p className="text-sm text-[var(--color-text-muted)]">Create or select a company to edit defaults.</p>
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
                    {savingCompany ? "Saving…" : "Save company settings"}
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
