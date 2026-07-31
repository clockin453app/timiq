import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export type LiveAttendanceSummary = {
  total_employees: number;
  present_today: number;
  open_shifts: number;
  absent_count: number;
  attendance_rate: number | null;
  late_arrivals: number | null;
};

export type LiveAttendanceEmployeeRow = {
  user_id: string;
  display_name: string;
  email: string | null;
  job_title: string | null;
  company_id: string | null;
  company_name: string | null;
  location_name: string | null;
  location_id: string | null;
  status: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  running_seconds: number | null;
  today_completed_worked_seconds: number | null;
  open_shift_id: string | null;
  clock_source: string | null;
  face_check_status?: string | null;
  face_match_confidence?: number | null;
  face_check_reason?: string | null;
};

export type LiveAttendanceResponse = {
  generated_at: string;
  summary: LiveAttendanceSummary;
  employees: LiveAttendanceEmployeeRow[];
};

export type ManualClockActionResponse = {
  shift_id: string;
  status: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  worked_seconds: number | null;
};

function statusFallback(status: number): string {
  switch (status) {
    case 400:
      return "Invalid request.";
    case 403:
      return "You do not have permission for this attendance action.";
    case 404:
      return "Employee or open shift was not found.";
    case 409:
      return "This conflicts with existing attendance for this employee.";
    case 422:
      return "The selected date and time is not valid for this shift.";
    case 500:
      return "Unexpected server failure. Try again.";
    default:
      return `Request failed (${status}).`;
  }
}

async function readApiError(response: Response): Promise<string> {
  const fallback = statusFallback(response.status);
  try {
    const data = (await response.json()) as { detail?: unknown };
    return fastApiDetailToMessage(data.detail, fallback);
  } catch {
    // ignore
  }
  return fallback;
}

export type FetchLiveAttendanceParams = {
  companyId?: string;
  locationId?: string;
  search?: string;
};

export async function fetchLiveAttendance(
  params: FetchLiveAttendanceParams = {},
): Promise<LiveAttendanceResponse> {
  const qs = new URLSearchParams();
  if (params.companyId) {
    qs.set("company_id", params.companyId);
  }
  if (params.locationId) {
    qs.set("location_id", params.locationId);
  }
  if (params.search && params.search.trim()) {
    qs.set("search", params.search.trim());
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const response = await fetch(`${API_URL}/api/live-attendance${suffix}`, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return response.json() as Promise<LiveAttendanceResponse>;
}

export type ManualClockInBody = {
  user_id: string;
  location_id: string;
  reason: string;
  /** UTC ISO 8601 attendance time. Omit to let the server stamp the current time. */
  effective_at?: string;
};

export async function postManualClockIn(body: ManualClockInBody): Promise<ManualClockActionResponse> {
  const response = await fetch(`${API_URL}/api/live-attendance/manual-clock-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return response.json() as Promise<ManualClockActionResponse>;
}

export type ManualClockOutBody = {
  user_id?: string;
  shift_id?: string;
  reason: string;
  /** UTC ISO 8601 attendance time. Omit to let the server stamp the current time. */
  effective_at?: string;
};

export async function postManualClockOut(body: ManualClockOutBody): Promise<ManualClockActionResponse> {
  const response = await fetch(`${API_URL}/api/live-attendance/manual-clock-out`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return response.json() as Promise<ManualClockActionResponse>;
}
