import { API_URL } from "../../config/api";

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
  actual_seconds: number | null;
  running_actual_seconds: number | null;
  counted_clock_in_at: string;
  counted_clock_out_at: string | null;
  counted_seconds: number | null;
  rounded_seconds: number | null;
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
