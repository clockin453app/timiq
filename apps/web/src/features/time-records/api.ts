import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export type TimeRecordShiftRow = {
  shift_id: string;
  user_id: string;
  status: string;
  location_id: string;
  location_name: string;
  company_id: string | null;
  company_name: string | null;
  employee_email: string | null;
  employee_name: string | null;
  employee_job_title?: string | null;
  clock_in_at: string;
  clock_out_at: string | null;
  break_seconds: number;
  break_deducted_seconds?: number;
  actual_seconds: number | null;
  running_actual_seconds: number | null;
  counted_clock_in_at: string;
  counted_clock_out_at: string | null;
  counted_seconds: number | null;
  rounded_seconds: number | null;
  time_policy_source?: string;
  face_check_status?: string | null;
  face_match_confidence?: number | null;
  face_check_reason?: string | null;
};

export type ListTimeRecordsParams = {
  start_date?: string;
  end_date?: string;
  location_id?: string;
  status?: "open" | "completed";
  limit?: number;
  offset?: number;
};

export type ListAdminTimeRecordsParams = ListTimeRecordsParams & {
  user_id?: string;
  company_id?: string;
};

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export async function listMyTimeRecords(
  params: ListTimeRecordsParams = {},
): Promise<TimeRecordShiftRow[]> {
  const response = await fetch(
    `${API_URL}/api/time-records/me${buildQuery(params)}`,
    {
      method: "GET",
      credentials: "include",
    },
  );

  if (!response.ok) {
    throw new Error("Could not load time records.");
  }

  return response.json() as Promise<TimeRecordShiftRow[]>;
}

export async function listAdminTimeRecords(
  params: ListAdminTimeRecordsParams = {},
): Promise<TimeRecordShiftRow[]> {
  const response = await fetch(
    `${API_URL}/api/time-records/admin${buildQuery(params)}`,
    {
      method: "GET",
      credentials: "include",
    },
  );

  if (!response.ok) {
    throw new Error("Could not load time records.");
  }

  return response.json() as Promise<TimeRecordShiftRow[]>;
}

export type AdminManualShiftMutationResponse = {
  shift: TimeRecordShiftRow;
  payroll_recalculation_required: boolean;
  affected_week_start: string | null;
  affected_company_id: string;
};

async function readAdminMutationError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    return fastApiDetailToMessage(body.detail, fallback);
  } catch {
    return fallback;
  }
}

export type AdminCreateCompletedShiftBody = {
  user_id: string;
  location_id: string;
  clock_in_at: string;
  clock_out_at: string;
  break_seconds?: number;
  break_minutes?: number;
  reason: string;
};

export type AdminPatchCompletedShiftBody = {
  clock_in_at?: string;
  clock_out_at?: string;
  location_id?: string;
  break_seconds?: number;
  break_minutes?: number;
  reason: string;
};

export type AdminForceClockOutBody = {
  clock_out_at: string;
  break_seconds?: number;
  break_minutes?: number;
  reason: string;
};

export async function adminCreateCompletedShift(
  body: AdminCreateCompletedShiftBody,
): Promise<AdminManualShiftMutationResponse> {
  const response = await fetch(`${API_URL}/api/time-records/admin/shifts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readAdminMutationError(response, "Could not create shift."));
  }
  return response.json() as Promise<AdminManualShiftMutationResponse>;
}

export async function adminPatchCompletedShift(
  shiftId: string,
  body: AdminPatchCompletedShiftBody,
): Promise<AdminManualShiftMutationResponse> {
  const response = await fetch(`${API_URL}/api/time-records/admin/shifts/${encodeURIComponent(shiftId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readAdminMutationError(response, "Could not update shift."));
  }
  return response.json() as Promise<AdminManualShiftMutationResponse>;
}

export async function adminForceClockOut(
  shiftId: string,
  body: AdminForceClockOutBody,
): Promise<AdminManualShiftMutationResponse> {
  const response = await fetch(
    `${API_URL}/api/time-records/admin/shifts/${encodeURIComponent(shiftId)}/force-clock-out`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new Error(await readAdminMutationError(response, "Could not force clock-out."));
  }
  return response.json() as Promise<AdminManualShiftMutationResponse>;
}
