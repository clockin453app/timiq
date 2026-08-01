import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export type ExtraHoursReason =
  | "shift_correction"
  | "saturday_bonus_hour"
  | "training"
  | "travel"
  | "goodwill_adjustment"
  | "other";

export const EXTRA_HOURS_REASON_OPTIONS: { value: ExtraHoursReason; label: string }[] = [
  { value: "shift_correction", label: "Shift correction" },
  { value: "saturday_bonus_hour", label: "Saturday bonus hour" },
  { value: "training", label: "Training" },
  { value: "travel", label: "Travel" },
  { value: "goodwill_adjustment", label: "Goodwill adjustment" },
  { value: "other", label: "Other" },
];

export type TimesheetExtraHoursRow = {
  id: string;
  company_id: string;
  user_id: string;
  work_date: string;
  duration_minutes: number;
  reason: ExtraHoursReason;
  note: string | null;
  location_id: string | null;
  affects_payroll: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  employee_name: string | null;
  employee_email: string | null;
  location_name: string | null;
  created_by_name: string | null;
  created_by_email: string | null;
};

export type TimesheetExtraHoursCreateBody = {
  company_id?: string;
  user_id: string;
  work_date: string;
  duration_minutes: number;
  reason: ExtraHoursReason;
  note?: string | null;
  location_id?: string | null;
};

export type TimesheetExtraHoursPatchBody = {
  work_date?: string;
  duration_minutes?: number;
  reason?: ExtraHoursReason;
  note?: string | null;
  location_id?: string | null;
};

export type ListExtraHoursParams = {
  company_id?: string;
  user_id?: string;
  start_date?: string;
  end_date?: string;
  location_id?: string;
};

function buildQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, value);
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as { detail?: unknown };
    return fastApiDetailToMessage(data.detail, fallback);
  } catch {
    return fallback;
  }
}

export function formatExtraHoursDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) {
    return `${total}m`;
  }
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (m === 0) {
    return `${h}h`;
  }
  return `${h}h ${m}m`;
}

export function parseDurationToMinutes(hoursText: string, minutesText: string): number | null {
  const hRaw = hoursText.trim() === "" ? 0 : Number(hoursText);
  const mRaw = minutesText.trim() === "" ? 0 : Number(minutesText);
  if (!Number.isFinite(hRaw) || !Number.isFinite(mRaw)) {
    return null;
  }
  if (!Number.isInteger(hRaw) || !Number.isInteger(mRaw)) {
    return null;
  }
  if (hRaw < 0 || mRaw < 0 || mRaw > 59) {
    return null;
  }
  const total = hRaw * 60 + mRaw;
  return total > 0 ? total : null;
}

export function reasonLabel(reason: ExtraHoursReason): string {
  return EXTRA_HOURS_REASON_OPTIONS.find((o) => o.value === reason)?.label ?? reason;
}

export async function listAdminExtraHours(
  params: ListExtraHoursParams = {},
): Promise<TimesheetExtraHoursRow[]> {
  const response = await fetch(
    `${API_URL}/api/timesheet-extra-hours${buildQuery({
      company_id: params.company_id,
      user_id: params.user_id,
      start_date: params.start_date,
      end_date: params.end_date,
      location_id: params.location_id,
    })}`,
    { method: "GET", credentials: "include" },
  );
  if (!response.ok) {
    throw new Error(await readError(response, "Could not load extra hours."));
  }
  return response.json() as Promise<TimesheetExtraHoursRow[]>;
}

export async function listMyExtraHours(params: {
  start_date?: string;
  end_date?: string;
} = {}): Promise<TimesheetExtraHoursRow[]> {
  const response = await fetch(
    `${API_URL}/api/timesheet-extra-hours/me${buildQuery({
      start_date: params.start_date,
      end_date: params.end_date,
    })}`,
    { method: "GET", credentials: "include" },
  );
  if (!response.ok) {
    throw new Error(await readError(response, "Could not load extra hours."));
  }
  return response.json() as Promise<TimesheetExtraHoursRow[]>;
}

export async function createExtraHours(
  body: TimesheetExtraHoursCreateBody,
): Promise<TimesheetExtraHoursRow> {
  const response = await fetch(`${API_URL}/api/timesheet-extra-hours`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Could not add extra hours."));
  }
  return response.json() as Promise<TimesheetExtraHoursRow>;
}

export async function patchExtraHours(
  id: string,
  body: TimesheetExtraHoursPatchBody,
): Promise<TimesheetExtraHoursRow> {
  const response = await fetch(`${API_URL}/api/timesheet-extra-hours/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Could not update extra hours."));
  }
  return response.json() as Promise<TimesheetExtraHoursRow>;
}

export async function deleteExtraHours(id: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/timesheet-extra-hours/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Could not delete extra hours."));
  }
}
