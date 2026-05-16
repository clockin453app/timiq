"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { Button, PageHeader, Sheet, SheetBody } from "../../components/ui";
import {
  getAttendanceNotificationSettings,
  patchAttendanceNotificationSettings,
  type AttendanceNotificationSettings,
} from "../../features/attendance-notifications/api";
import {
  canAccessManagement,
  changeMyPassword,
  isAdministrator,
  useCurrentUser,
} from "../../features/auth";
import { listCompanies, type Company } from "../../features/companies/api";
import {
  fetchPushPublicKey,
  postPushSubscribe,
  postPushTest,
  postPushUnsubscribe,
} from "../../features/notifications/api";
import {
  createBrowserPushSubscription,
  getActivePushSubscription,
  isPushSupported,
  notificationPermission,
  unsubscribeBrowserPush,
} from "../../features/notifications/push";
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
  selectableLocales,
  supportedDateFormats,
  supportedTimeFormats,
} from "../../lib/preferences-format";
import { normalizeSelectableLocale, useI18n, useT } from "../../lib/i18n";
import {
  readSoundNotificationsEnabled,
  writeSoundNotificationsEnabled,
} from "../../lib/sound/sound-notifications-pref";
import { unlockNotificationAudioFromGesture } from "../../lib/sound/notification-sound";

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
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [myMessage, setMyMessage] = useState("");
  const [companyMessage, setCompanyMessage] = useState("");
  const [attendanceMessage, setAttendanceMessage] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState("");
  const [pushPublicKey, setPushPublicKey] = useState("");
  const [pushServerEnabled, setPushServerEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [pushSubscribed, setPushSubscribed] = useState(false);

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
  const [soundNotif, setSoundNotif] = useState(false);

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

  const [attLateEnabled, setAttLateEnabled] = useState(false);
  const [attLateGrace, setAttLateGrace] = useState(15);
  const [attLateNotifyEmployee, setAttLateNotifyEmployee] = useState(false);
  const [attLateNotifyAdmins, setAttLateNotifyAdmins] = useState(true);
  const [attForgotInEnabled, setAttForgotInEnabled] = useState(false);
  const [attForgotInTime, setAttForgotInTime] = useState("09:30");
  const [attForgotInNotifyEmployee, setAttForgotInNotifyEmployee] = useState(true);
  const [attForgotInNotifyAdmins, setAttForgotInNotifyAdmins] = useState(true);
  const [attForgotOutEnabled, setAttForgotOutEnabled] = useState(false);
  const [attForgotOutThreshold, setAttForgotOutThreshold] = useState(12);
  const [attForgotOutRepeat, setAttForgotOutRepeat] = useState("");
  const [attForgotOutNotifyEmployee, setAttForgotOutNotifyEmployee] = useState(true);
  const [attForgotOutNotifyAdmins, setAttForgotOutNotifyAdmins] = useState(true);
  const [attIgnoreLeave, setAttIgnoreLeave] = useState(true);
  const [attActiveWeekdays, setAttActiveWeekdays] = useState<number[]>([0, 1, 2, 3, 4]);

  const previewDate = new Date(2026, 4, 11, 14, 30, 0);

  useEffect(() => {
    setSoundNotif(readSoundNotificationsEnabled());
    const onPref = (event: Event) => {
      const enabled = (event as CustomEvent<{ enabled: boolean }>).detail?.enabled;
      if (typeof enabled === "boolean") {
        setSoundNotif(enabled);
      }
    };
    window.addEventListener("timiq:sound-notifications-pref", onPref);
    return () => window.removeEventListener("timiq:sound-notifications-pref", onPref);
  }, []);

  const refreshPushStatus = useCallback(async () => {
    const supported = isPushSupported();
    setPushSupported(supported);
    setPushPermission(notificationPermission());
    try {
      const config = await fetchPushPublicKey();
      setPushServerEnabled(config.enabled);
      setPushPublicKey(config.public_key);
      if (supported) {
        setPushSubscribed(Boolean(await getActivePushSubscription()));
        setPushPermission(notificationPermission());
      }
    } catch (err) {
      setPushMessage(err instanceof Error ? err.message : "Could not load push notification status.");
    }
  }, []);

  useEffect(() => {
    void refreshPushStatus();
  }, [refreshPushStatus]);

  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMessage, setPwMessage] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    setMyMessage("");
    setCompanyMessage("");
    setAttendanceMessage("");
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
          const attendance = await getAttendanceNotificationSettings(companyIdForCompanyApi);
          applyAttendance(attendance);
        }
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("settings.load_error", "Could not load settings."));
    }
  }, [adminCompanyId, platformAdmin, showCompany]);

  function applyMe(me: UserPreferences) {
    setLocale(normalizeSelectableLocale(me.locale));
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

  function applyAttendance(settings: AttendanceNotificationSettings) {
    setAttLateEnabled(settings.late_arrival_enabled);
    setAttLateGrace(settings.late_arrival_grace_minutes);
    setAttLateNotifyEmployee(settings.late_arrival_notify_employee);
    setAttLateNotifyAdmins(settings.late_arrival_notify_admins);
    setAttForgotInEnabled(settings.forgot_clock_in_enabled);
    setAttForgotInTime(settings.forgot_clock_in_check_time.slice(0, 5));
    setAttForgotInNotifyEmployee(settings.forgot_clock_in_notify_employee);
    setAttForgotInNotifyAdmins(settings.forgot_clock_in_notify_admins);
    setAttForgotOutEnabled(settings.forgot_clock_out_enabled);
    setAttForgotOutThreshold(settings.forgot_clock_out_threshold_hours);
    setAttForgotOutRepeat(settings.forgot_clock_out_repeat_hours ? String(settings.forgot_clock_out_repeat_hours) : "");
    setAttForgotOutNotifyEmployee(settings.forgot_clock_out_notify_employee);
    setAttForgotOutNotifyAdmins(settings.forgot_clock_out_notify_admins);
    setAttIgnoreLeave(settings.ignore_approved_leave);
    setAttActiveWeekdays(settings.active_weekdays);
  }

  useEffect(() => {
    void load();
  }, [load]);

  async function onSaveMy(e: FormEvent) {
    e.preventDefault();
    setSavingMy(true);
    setMyMessage("");
    try {
      const localeToSave = normalizeSelectableLocale(locale);
      await patchSettingsMe({
        locale: localeToSave,
        timezone_name: myTimezone.trim() || null,
        date_format: myDateFormat,
        time_format: myTimeFormat,
        compact_mode: compactMode,
        notification_email_enabled: notifEmail,
        notification_in_app_enabled: notifInApp,
        push_notifications_enabled: notifPushUser,
      });
      setMyMessage(t("settings.prefs_saved", "Your preferences were saved."));
      setLocale(localeToSave);
      setAppLocale(localeToSave);
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

  async function onSaveAttendance(e: FormEvent) {
    e.preventDefault();
    if (platformAdmin && !adminCompanyId) {
      setAttendanceMessage(t("settings.select_company_first", "Select a company first."));
      return;
    }
    setSavingAttendance(true);
    setAttendanceMessage("");
    try {
      const repeat = attForgotOutRepeat.trim();
      const saved = await patchAttendanceNotificationSettings(
        {
          late_arrival_enabled: attLateEnabled,
          late_arrival_grace_minutes: attLateGrace,
          late_arrival_notify_employee: attLateNotifyEmployee,
          late_arrival_notify_admins: attLateNotifyAdmins,
          forgot_clock_in_enabled: attForgotInEnabled,
          forgot_clock_in_check_time: attForgotInTime,
          forgot_clock_in_notify_employee: attForgotInNotifyEmployee,
          forgot_clock_in_notify_admins: attForgotInNotifyAdmins,
          forgot_clock_out_enabled: attForgotOutEnabled,
          forgot_clock_out_threshold_hours: attForgotOutThreshold,
          forgot_clock_out_repeat_hours: repeat ? Number(repeat) : null,
          forgot_clock_out_notify_employee: attForgotOutNotifyEmployee,
          forgot_clock_out_notify_admins: attForgotOutNotifyAdmins,
          ignore_approved_leave: attIgnoreLeave,
          active_weekdays: attActiveWeekdays,
        },
        platformAdmin ? adminCompanyId : null,
      );
      applyAttendance(saved);
      setAttendanceMessage(t("settings.attendance_notifications_saved", "Attendance notification settings were saved."));
    } catch (err) {
      setAttendanceMessage(err instanceof Error ? err.message : t("settings.save_failed", "Save failed."));
    } finally {
      setSavingAttendance(false);
    }
  }

  const brandPreview =
    coBrandColor && /^#[0-9A-Fa-f]{6}$/.test(coBrandColor) ? coBrandColor : "#64748b";
  const weekdays = [
    { id: 0, label: "Mon" },
    { id: 1, label: "Tue" },
    { id: 2, label: "Wed" },
    { id: 3, label: "Thu" },
    { id: 4, label: "Fri" },
    { id: 5, label: "Sat" },
    { id: 6, label: "Sun" },
  ];

  function toggleAttendanceWeekday(day: number, checked: boolean) {
    setAttActiveWeekdays((prev) => {
      const next = checked ? [...prev, day] : prev.filter((item) => item !== day);
      const unique = Array.from(new Set(next)).sort((a, b) => a - b);
      return unique.length > 0 ? unique : prev;
    });
  }

  async function onEnablePush() {
    setPushBusy(true);
    setPushMessage("");
    try {
      if (!pushServerEnabled || !pushPublicKey) {
        setPushMessage("Push notifications are not enabled on the server yet.");
        return;
      }
      const subscription = await createBrowserPushSubscription(pushPublicKey);
      await postPushSubscribe(subscription);
      setPushSubscribed(true);
      setPushPermission(notificationPermission());
      setPushMessage("Push notifications are enabled for this browser/device.");
    } catch (err) {
      setPushMessage(err instanceof Error ? err.message : "Could not enable push notifications.");
      setPushPermission(notificationPermission());
    } finally {
      setPushBusy(false);
    }
  }

  async function onDisablePush() {
    setPushBusy(true);
    setPushMessage("");
    try {
      const endpoint = await unsubscribeBrowserPush();
      if (endpoint) {
        await postPushUnsubscribe(endpoint);
      }
      setPushSubscribed(false);
      setPushPermission(notificationPermission());
      setPushMessage("Push notifications are disabled for this browser/device.");
    } catch (err) {
      setPushMessage(err instanceof Error ? err.message : "Could not disable push notifications.");
    } finally {
      setPushBusy(false);
    }
  }

  async function onSendTestPush() {
    setPushBusy(true);
    setPushMessage("");
    try {
      const result = await postPushTest();
      if (!result.enabled) {
        setPushMessage("Push notifications are not enabled on the server yet.");
      } else if (result.sent > 0) {
        setPushMessage("Test push sent. Delivery can still be blocked by browser or device settings.");
      } else {
        setPushMessage("No active push subscription was found for this account/device.");
      }
    } catch (err) {
      setPushMessage(err instanceof Error ? err.message : "Could not send a test push notification.");
    } finally {
      setPushBusy(false);
    }
  }

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
              {selectableLocales.map((loc) => (
                <option key={loc} value={loc}>
                  {t("settings.locale_en_GB", "English (United Kingdom)")}
                </option>
              ))}
            </select>
            <p className="mt-2 max-w-md text-xs text-[var(--color-text-muted)]">
              {t(
                "settings.locale_preparing",
                "Additional languages are being prepared and will be enabled after full review.",
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
            <label className="flex items-start gap-2 text-sm text-[var(--color-text)]">
              <input
                className="mt-0.5"
                type="checkbox"
                checked={soundNotif}
                onChange={(ev) => {
                  const enabled = ev.target.checked;
                  setSoundNotif(enabled);
                  writeSoundNotificationsEnabled(enabled);
                  if (enabled) {
                    unlockNotificationAudioFromGesture();
                  }
                }}
              />
              <span>
                {t("settings.notif_sound", "Sound notifications on this device")}
                <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                  {t(
                    "settings.notif_sound_help",
                    "Play a short sound for new messages and important notifications while TimIQ is open.",
                  )}
                </span>
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={savingMy}>
              {savingMy ? t("settings.saving", "Saving…") : t("settings.save_my_prefs", "Save my preferences")}
            </Button>
            {myMessage ? <span className="text-sm text-[var(--color-text-muted)]">{myMessage}</span> : null}
          </div>
        </form>

        <section className={cardClass()}>
          <h2 className="text-base font-semibold text-[var(--color-text)]">
            {t("settings.push_title", "Push notifications")}
          </h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            {t(
              "settings.push_closed_help",
              "Push notifications can appear even when TimIQ is closed, if your browser/device allows them.",
            )}
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            {t(
              "settings.push_ios_help",
              "On iPhone/iPad, install TimIQ to the Home Screen first, then enable push notifications.",
            )}
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {pushSupported
              ? `Status: ${pushSubscribed ? "enabled on this device" : "not enabled on this device"}; permission ${pushPermission}.`
              : "Status: push notifications are not supported in this browser context."}
          </p>
          {!pushServerEnabled ? (
            <p className="text-xs text-amber-700">
              Push delivery is currently disabled on the server. A Render environment update is required before sends work.
            </p>
          ) : null}
          <p className="text-xs text-[var(--color-text-muted)]">
            Push delivery is not guaranteed. OS/browser focus modes, muted devices, and denied permissions can block it.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={onEnablePush} disabled={pushBusy || !pushSupported || pushSubscribed}>
              {pushBusy ? "Working..." : "Enable push notifications"}
            </Button>
            <Button type="button" variant="secondary" onClick={onDisablePush} disabled={pushBusy || !pushSubscribed}>
              Disable push notifications
            </Button>
            <Button type="button" variant="secondary" onClick={onSendTestPush} disabled={pushBusy || !pushSubscribed}>
              Send test push
            </Button>
          </div>
          {pushMessage ? <p className="text-sm text-[var(--color-text-muted)]">{pushMessage}</p> : null}
        </section>

        <form
          className={cardClass()}
          onSubmit={async (e) => {
            e.preventDefault();
            setPwMessage("");
            if (pwNew !== pwConfirm) {
              setPwMessage(t("settings.pw_mismatch", "New password and confirmation do not match."));
              return;
            }
            if (pwNew.length < 12) {
              setPwMessage("New password must be at least 12 characters.");
              return;
            }
            setPwSaving(true);
            try {
              await changeMyPassword(pwCurrent, pwNew);
              setPwMessage(t("settings.pw_updated", "Password updated."));
              setPwCurrent("");
              setPwNew("");
              setPwConfirm("");
            } catch (err) {
              setPwMessage(
                err instanceof Error ? err.message : t("settings.pw_change_failed", "Could not change password."),
              );
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
                    {t("settings.co_display_name", "Company display name")}
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
                    {t("settings.co_timezone", "Default timezone")}
                  </label>
                  <input
                    id="co-tz"
                    className={fieldClass()}
                    placeholder={t("settings.co_timezone_placeholder", "Europe/London")}
                    maxLength={64}
                    value={coTimezone}
                    onChange={(ev) => setCoTimezone(ev.target.value)}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass()} htmlFor="co-week">
                      {t("settings.co_week_starts", "Week starts on")}
                    </label>
                    <select
                      id="co-week"
                      className={fieldClass()}
                      value={coWeekStart}
                      onChange={(ev) => setCoWeekStart(ev.target.value)}
                    >
                      <option value="monday">{t("settings.co_week_monday", "Monday")}</option>
                      <option value="sunday">{t("settings.co_week_sunday", "Sunday")}</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass()} htmlFor="co-cur">
                      {t("settings.co_currency", "Currency")}
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
                      {t("settings.co_date_format", "Default date format")}
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
                      {t("settings.co_time_format", "Default time format")}
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
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">
                    {t("settings.co_notif_title", "Company notification defaults")}
                  </h3>
                  <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                    <input
                      type="checkbox"
                      checked={coNotifMaster}
                      onChange={(ev) => setCoNotifMaster(ev.target.checked)}
                    />
                    {t("settings.co_notif_master", "Notifications enabled (master)")}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                    <input
                      type="checkbox"
                      checked={coNotifEmail}
                      onChange={(ev) => setCoNotifEmail(ev.target.checked)}
                    />
                    {t("settings.co_notif_email", "Allow email channel at company level")}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                    <input
                      type="checkbox"
                      checked={coNotifPush}
                      onChange={(ev) => setCoNotifPush(ev.target.checked)}
                    />
                    {t("settings.co_notif_push", "Allow push channel at company level (not implemented)")}
                  </label>
                </div>

                <div className="border-t border-[var(--color-border-dark)] pt-3 space-y-2">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">
                    {t("settings.co_branding_title", "Branding")}
                  </h3>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    {t(
                      "settings.co_branding_hint",
                      "Logo upload is not available in this release. Only a primary brand colour is stored.",
                    )}
                  </p>
                  <div>
                    <label className={labelClass()} htmlFor="co-color">
                      {t("settings.co_brand_color", "Brand primary colour (#RRGGBB)")}
                    </label>
                    <input
                      id="co-color"
                      className={fieldClass()}
                      placeholder={t("settings.co_brand_placeholder", "#1e40af")}
                      maxLength={9}
                      value={coBrandColor}
                      onChange={(ev) => setCoBrandColor(ev.target.value)}
                    />
                  </div>
                  <div
                    className="max-w-md rounded-[var(--radius-md)] border border-[var(--color-border-dark)] p-4 text-white shadow-sm"
                    style={{ backgroundColor: brandPreview }}
                  >
                    <p className="text-sm font-medium">{t("settings.co_preview_card", "Preview card")}</p>
                    <p className="text-xs opacity-90">
                      {t("settings.co_preview_company", "Company display: {{name}}", {
                        name: coDisplayName || t("settings.co_preview_fallback", "Your company"),
                      })}
                    </p>
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

        {showCompany ? (
          <form className={cardClass()} onSubmit={onSaveAttendance}>
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              {t("settings.attendance_notifications_title", "Attendance notifications")}
            </h2>
            {platformAdmin && !adminCompanyId ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                {t("settings.create_select_company", "Create or select a company to edit defaults.")}
              </p>
            ) : (
              <>
                <p className="max-w-3xl text-sm text-[var(--color-text-muted)]">
                  {t(
                    "settings.attendance_notifications_hint",
                    "Late arrival and forgot clock-in use company/site default start time until rota scheduling is available. Sound alerts play only when TimIQ is open; in-app notifications are created in the background.",
                  )}
                </p>

                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 space-y-3">
                    <label className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                      <input type="checkbox" checked={attLateEnabled} onChange={(ev) => setAttLateEnabled(ev.target.checked)} />
                      {t("settings.att_late_enabled", "Late arrival")}
                    </label>
                    <label className={labelClass()} htmlFor="att-late-grace">
                      {t("settings.att_late_grace", "Grace period minutes")}
                      <input
                        id="att-late-grace"
                        className={fieldClass()}
                        min={0}
                        max={240}
                        type="number"
                        value={attLateGrace}
                        onChange={(ev) => setAttLateGrace(Number(ev.target.value))}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                      <input type="checkbox" checked={attLateNotifyEmployee} onChange={(ev) => setAttLateNotifyEmployee(ev.target.checked)} />
                      {t("settings.att_notify_employee", "Notify employee")}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                      <input type="checkbox" checked={attLateNotifyAdmins} onChange={(ev) => setAttLateNotifyAdmins(ev.target.checked)} />
                      {t("settings.att_notify_admins", "Notify company admins")}
                    </label>
                  </div>

                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 space-y-3">
                    <label className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                      <input type="checkbox" checked={attForgotInEnabled} onChange={(ev) => setAttForgotInEnabled(ev.target.checked)} />
                      {t("settings.att_forgot_in_enabled", "Forgot clock-in")}
                    </label>
                    <label className={labelClass()} htmlFor="att-forgot-in-time">
                      {t("settings.att_forgot_in_time", "Check time")}
                      <input
                        id="att-forgot-in-time"
                        className={fieldClass()}
                        type="time"
                        value={attForgotInTime}
                        onChange={(ev) => setAttForgotInTime(ev.target.value)}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                      <input type="checkbox" checked={attForgotInNotifyEmployee} onChange={(ev) => setAttForgotInNotifyEmployee(ev.target.checked)} />
                      {t("settings.att_notify_employee", "Notify employee")}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                      <input type="checkbox" checked={attForgotInNotifyAdmins} onChange={(ev) => setAttForgotInNotifyAdmins(ev.target.checked)} />
                      {t("settings.att_notify_admins", "Notify company admins")}
                    </label>
                  </div>

                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 space-y-3">
                    <label className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                      <input type="checkbox" checked={attForgotOutEnabled} onChange={(ev) => setAttForgotOutEnabled(ev.target.checked)} />
                      {t("settings.att_forgot_out_enabled", "Forgot clock-out")}
                    </label>
                    <label className={labelClass()} htmlFor="att-forgot-out-threshold">
                      {t("settings.att_forgot_out_threshold", "Open shift threshold hours")}
                      <input
                        id="att-forgot-out-threshold"
                        className={fieldClass()}
                        min={1}
                        max={48}
                        type="number"
                        value={attForgotOutThreshold}
                        onChange={(ev) => setAttForgotOutThreshold(Number(ev.target.value))}
                      />
                    </label>
                    <label className={labelClass()} htmlFor="att-forgot-out-repeat">
                      {t("settings.att_forgot_out_repeat", "Repeat reminder hours (optional)")}
                      <input
                        id="att-forgot-out-repeat"
                        className={fieldClass()}
                        min={1}
                        max={48}
                        type="number"
                        value={attForgotOutRepeat}
                        onChange={(ev) => setAttForgotOutRepeat(ev.target.value)}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                      <input type="checkbox" checked={attForgotOutNotifyEmployee} onChange={(ev) => setAttForgotOutNotifyEmployee(ev.target.checked)} />
                      {t("settings.att_notify_employee", "Notify employee")}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                      <input type="checkbox" checked={attForgotOutNotifyAdmins} onChange={(ev) => setAttForgotOutNotifyAdmins(ev.target.checked)} />
                      {t("settings.att_notify_admins", "Notify company admins")}
                    </label>
                  </div>
                </div>

                <div className="border-t border-[var(--color-border-dark)] pt-3 space-y-2">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">
                    {t("settings.att_general_rules", "General rules")}
                  </h3>
                  <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                    <input type="checkbox" checked={attIgnoreLeave} onChange={(ev) => setAttIgnoreLeave(ev.target.checked)} />
                    {t("settings.att_ignore_leave", "Ignore employees on approved leave")}
                  </label>
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-muted)]">
                      {t("settings.att_active_weekdays", "Active weekdays")}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-3">
                      {weekdays.map((day) => (
                        <label key={day.id} className="flex items-center gap-1.5 text-sm text-[var(--color-text)]">
                          <input
                            type="checkbox"
                            checked={attActiveWeekdays.includes(day.id)}
                            onChange={(ev) => toggleAttendanceWeekday(day.id, ev.target.checked)}
                          />
                          {day.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" disabled={savingAttendance || (platformAdmin && !adminCompanyId)}>
                    {savingAttendance
                      ? t("settings.saving", "Saving…")
                      : t("settings.save_attendance_notifications", "Save attendance notifications")}
                  </Button>
                  {attendanceMessage ? (
                    <span className="text-sm text-[var(--color-text-muted)]">{attendanceMessage}</span>
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
