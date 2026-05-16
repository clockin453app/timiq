import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export type AttendanceNotificationSettings = {
  company_id: string;
  late_arrival_enabled: boolean;
  late_arrival_grace_minutes: number;
  late_arrival_notify_employee: boolean;
  late_arrival_notify_admins: boolean;
  forgot_clock_in_enabled: boolean;
  forgot_clock_in_check_time: string;
  forgot_clock_in_notify_employee: boolean;
  forgot_clock_in_notify_admins: boolean;
  forgot_clock_out_enabled: boolean;
  forgot_clock_out_threshold_hours: number;
  forgot_clock_out_repeat_hours: number | null;
  forgot_clock_out_notify_employee: boolean;
  forgot_clock_out_notify_admins: boolean;
  ignore_approved_leave: boolean;
  active_weekdays: number[];
  created_at: string;
  updated_at: string;
};

export type AttendanceNotificationSettingsPatch = Partial<
  Omit<AttendanceNotificationSettings, "company_id" | "created_at" | "updated_at">
>;

function companyQuery(companyId: string | null | undefined): string {
  if (!companyId) {
    return "";
  }
  return `?company_id=${encodeURIComponent(companyId)}`;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const detail = await res.json().catch(() => ({}));
  return fastApiDetailToMessage((detail as { detail?: unknown }).detail, fallback);
}

export async function getAttendanceNotificationSettings(
  companyId?: string | null,
): Promise<AttendanceNotificationSettings> {
  const res = await fetch(`${API_URL}/api/attendance-notification-settings${companyQuery(companyId)}`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Could not load attendance notification settings."));
  }
  return res.json() as Promise<AttendanceNotificationSettings>;
}

export async function patchAttendanceNotificationSettings(
  body: AttendanceNotificationSettingsPatch,
  companyId?: string | null,
): Promise<AttendanceNotificationSettings> {
  const res = await fetch(`${API_URL}/api/attendance-notification-settings${companyQuery(companyId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Could not save attendance notification settings."));
  }
  return res.json() as Promise<AttendanceNotificationSettings>;
}
