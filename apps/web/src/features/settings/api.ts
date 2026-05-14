import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export type CompanySettings = {
  company_id: string;
  timezone_name: string | null;
  date_format: string | null;
  time_format: string | null;
  currency_code: string | null;
  week_start_day: string | null;
  company_display_name: string | null;
  brand_primary_color: string | null;
  brand_logo_configured: boolean;
  notifications_enabled: boolean;
  email_notifications_enabled: boolean;
  push_notifications_enabled: boolean;
};

export type UserPreferences = {
  user_id: string;
  locale: string | null;
  timezone_name: string | null;
  date_format: string | null;
  time_format: string | null;
  compact_mode: boolean;
  notification_email_enabled: boolean;
  notification_in_app_enabled: boolean;
  push_notifications_enabled: boolean;
};

export type EffectiveSettings = {
  company_id: string | null;
  locale: string;
  timezone_name: string;
  date_format: string;
  time_format: string;
  currency_code: string;
  week_start_day: string;
  company_display_name: string | null;
  brand_primary_color: string | null;
  compact_mode: boolean;
  notification_in_app_effective: boolean;
  notification_email_effective: boolean;
  notification_push_effective: boolean;
};

export type CompanySettingsPatch = {
  timezone_name?: string | null;
  date_format?: string | null;
  time_format?: string | null;
  currency_code?: string | null;
  week_start_day?: string | null;
  company_display_name?: string | null;
  brand_primary_color?: string | null;
  notifications_enabled?: boolean;
  email_notifications_enabled?: boolean;
  push_notifications_enabled?: boolean;
};

export type UserPreferencesPatch = {
  locale?: string | null;
  timezone_name?: string | null;
  date_format?: string | null;
  time_format?: string | null;
  compact_mode?: boolean;
  notification_email_enabled?: boolean;
  notification_in_app_enabled?: boolean;
  push_notifications_enabled?: boolean;
};

function companyQuery(companyId: string | null | undefined): string {
  if (!companyId) {
    return "";
  }
  return `?company_id=${encodeURIComponent(companyId)}`;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  try {
    const detail = JSON.parse(text) as { detail?: unknown };
    return fastApiDetailToMessage(detail.detail, fallback);
  } catch {
    return fastApiDetailToMessage(text, fallback);
  }
}

export async function getSettingsMe(): Promise<UserPreferences> {
  const res = await fetch(`${API_URL}/api/settings/me`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(await readError(res, "Could not load your preferences."));
  }
  return res.json() as Promise<UserPreferences>;
}

export async function patchSettingsMe(body: UserPreferencesPatch): Promise<UserPreferences> {
  const res = await fetch(`${API_URL}/api/settings/me`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Could not save preferences."));
  }
  return res.json() as Promise<UserPreferences>;
}

export async function getSettingsEffective(companyId?: string | null): Promise<EffectiveSettings> {
  const q = companyQuery(companyId ?? null);
  const res = await fetch(`${API_URL}/api/settings/effective${q}`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(await readError(res, "Could not load effective settings."));
  }
  return res.json() as Promise<EffectiveSettings>;
}

export async function getSettingsCompany(companyId?: string | null): Promise<CompanySettings> {
  const q = companyQuery(companyId ?? null);
  const res = await fetch(`${API_URL}/api/settings/company${q}`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(await readError(res, "Could not load company settings."));
  }
  return res.json() as Promise<CompanySettings>;
}

export async function patchSettingsCompany(
  body: CompanySettingsPatch,
  companyId?: string | null,
): Promise<CompanySettings> {
  const q = companyQuery(companyId ?? null);
  const res = await fetch(`${API_URL}/api/settings/company${q}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Could not save company settings."));
  }
  return res.json() as Promise<CompanySettings>;
}
