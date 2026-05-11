import { API_URL } from "../../config/api";

export type TimesheetDayTotals = {
  date: string;
  actual_seconds: number;
  counted_seconds: number;
  rounded_seconds: number;
  break_seconds: number;
};

export type TimesheetOpenShiftSummary = {
  shift_id: string;
  clock_in_at: string;
  location_id: string;
  location_name: string;
  running_actual_seconds: number | null;
  break_seconds: number;
};

export type TimesheetWeekResponse = {
  week_start: string;
  company_timezone: string;
  days: TimesheetDayTotals[];
  week_actual_seconds: number;
  week_counted_seconds: number;
  week_rounded_seconds: number;
  week_break_seconds: number;
  open_shift_in_week: boolean;
  shift_count: number;
  completed_shift_count: number;
  open_shifts: TimesheetOpenShiftSummary[];
  locations_worked: string[];
};

export async function fetchMyTimesheetWeek(
  weekStartIsoYmd: string,
): Promise<TimesheetWeekResponse> {
  const search = new URLSearchParams({ week_start: weekStartIsoYmd });
  const response = await fetch(
    `${API_URL}/api/timesheets/me/week?${search.toString()}`,
    {
      method: "GET",
      credentials: "include",
    },
  );

  if (!response.ok) {
    throw new Error("Could not load timesheet.");
  }

  return response.json() as Promise<TimesheetWeekResponse>;
}

export async function fetchAdminTimesheetWeek(
  userId: string,
  weekStartIsoYmd: string,
): Promise<TimesheetWeekResponse> {
  const search = new URLSearchParams({
    week_start: weekStartIsoYmd,
    user_id: userId,
  });
  const response = await fetch(
    `${API_URL}/api/timesheets/admin/week?${search.toString()}`,
    {
      method: "GET",
      credentials: "include",
    },
  );

  if (!response.ok) {
    throw new Error("Could not load timesheet.");
  }

  return response.json() as Promise<TimesheetWeekResponse>;
}
