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

export type WeekLeaveRow = {
  request_id: string;
  user_id: string;
  leave_type: string;
  status: string;
  date_from: string;
  date_to: string;
  total_days: string;
  start_half_day?: string | null;
  end_half_day?: string | null;
};

export type TimesheetWeekResponse = {
  week_start: string;
  week_end: string;
  company_timezone: string;
  company_name: string | null;
  days: TimesheetDayTotals[];
  week_actual_seconds: number;
  week_counted_seconds: number;
  week_rounded_seconds: number;
  week_break_seconds: number;
  gross_amount: string | null;
  paid_at: string | null;
  approved_at: string | null;
  status: string | null;
  hourly_rate_snapshot: string | null;
  regular_seconds: number | null;
  overtime_seconds: number | null;
  open_shift_in_week: boolean;
  shift_count: number;
  completed_shift_count: number;
  open_shifts: TimesheetOpenShiftSummary[];
  locations_worked: string[];
  week_leave: WeekLeaveRow[];
};

export type TimesheetWeekSummaryRow = {
  week_start: string;
  week_end: string;
  company_name: string | null;
  clocked_seconds: number;
  payable_seconds: number;
  payroll_seconds: number;
  gross_amount: string | null;
  cis_tax_amount: string | null;
  net_amount: string | null;
  paid_at: string | null;
  approved_at: string | null;
  hourly_rate_snapshot: string | null;
  regular_seconds: number | null;
  overtime_seconds: number | null;
  status: string;
  has_completed_shifts: boolean;
};

export type TimesheetWeeksResponse = {
  weeks: TimesheetWeekSummaryRow[];
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

export async function fetchMyTimesheetWeeks(limit = 12): Promise<TimesheetWeeksResponse> {
  const search = new URLSearchParams({ limit: String(limit) });
  const response = await fetch(
    `${API_URL}/api/timesheets/me/weeks?${search.toString()}`,
    {
      method: "GET",
      credentials: "include",
    },
  );

  if (!response.ok) {
    throw new Error("Could not load timesheet weeks.");
  }

  return response.json() as Promise<TimesheetWeeksResponse>;
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

export type AdminTimesheetEmployeeDayRow = {
  user_id: string;
  employee_name: string | null;
  employee_email: string;
  employee_job_title: string | null;
  date: string;
  clocked_seconds: number;
  payable_seconds: number;
  payroll_seconds: number;
  break_seconds: number;
  locations: string[];
  completed_shifts_count: number;
};

export type AdminTimesheetOpenShiftRow = {
  user_id: string;
  employee_name: string | null;
  employee_email: string;
  employee_job_title: string | null;
  shift_id: string;
  clock_in_at: string;
  location_id: string;
  location_name: string;
  running_actual_seconds: number | null;
  break_seconds: number;
};

export type AdminTimesheetWeekAllEmployeesResponse = {
  week_start: string;
  company_id: string;
  company_timezone: string;
  day_rows: AdminTimesheetEmployeeDayRow[];
  open_shifts: AdminTimesheetOpenShiftRow[];
  week_clocked_seconds: number;
  week_payable_seconds: number;
  week_payroll_seconds: number;
  week_break_seconds: number;
  completed_shift_count: number;
};

export type AdminWeekReportEmployeeSummary = {
  user_id: string;
  employee_name: string | null;
  employee_email: string;
  employee_job_title: string | null;
  completed_shifts_count: number;
  clocked_seconds: number;
  payable_seconds: number;
  payroll_seconds: number;
  break_seconds: number;
  locations_worked: string[];
  open_shift_in_week: boolean;
  week_leave: WeekLeaveRow[];
};

export type AdminWeekReportCompanyTotals = {
  completed_shifts_count: number;
  clocked_seconds: number;
  payable_seconds: number;
  payroll_seconds: number;
  break_seconds: number;
  employees_with_open_shift: number;
};

export type AdminWeekReportAllEmployeesResponse = {
  week_start: string;
  company_id: string;
  company_timezone: string;
  employees: AdminWeekReportEmployeeSummary[];
  totals: AdminWeekReportCompanyTotals;
};

export async function fetchAdminCompanyTimesheetWeek(
  weekStartIsoYmd: string,
  companyIdForAdministrator: string | null,
): Promise<AdminTimesheetWeekAllEmployeesResponse> {
  const search = new URLSearchParams({ week_start: weekStartIsoYmd });
  if (companyIdForAdministrator) {
    search.set("company_id", companyIdForAdministrator);
  }
  const response = await fetch(
    `${API_URL}/api/timesheets/admin/company/timesheet-week?${search.toString()}`,
    {
      method: "GET",
      credentials: "include",
    },
  );

  if (!response.ok) {
    throw new Error("Could not load timesheet.");
  }

  return response.json() as Promise<AdminTimesheetWeekAllEmployeesResponse>;
}

async function downloadCsvFromUrl(url: string, downloadName: string): Promise<void> {
  const response = await fetch(url, { method: "GET", credentials: "include" });
  if (!response.ok) {
    throw new Error("Could not export CSV.");
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = downloadName;
  anchor.click();
  URL.revokeObjectURL(href);
}

export async function downloadMyTimesheetWeekCsv(weekStartIsoYmd: string): Promise<void> {
  const search = new URLSearchParams({ week_start: weekStartIsoYmd });
  await downloadCsvFromUrl(
    `${API_URL}/api/timesheets/me/week/export.csv?${search.toString()}`,
    `timesheet-me-${weekStartIsoYmd}.csv`,
  );
}

export async function downloadAdminTimesheetWeekCsv(
  userId: string,
  weekStartIsoYmd: string,
): Promise<void> {
  const search = new URLSearchParams({ week_start: weekStartIsoYmd, user_id: userId });
  await downloadCsvFromUrl(
    `${API_URL}/api/timesheets/admin/week/export.csv?${search.toString()}`,
    `timesheet-${userId}-${weekStartIsoYmd}.csv`,
  );
}

export async function downloadAdminCompanyTimesheetWeekCsv(
  weekStartIsoYmd: string,
  companyIdForAdministrator: string | null,
): Promise<void> {
  const search = new URLSearchParams({ week_start: weekStartIsoYmd });
  if (companyIdForAdministrator) {
    search.set("company_id", companyIdForAdministrator);
  }
  const suffix = companyIdForAdministrator ?? "company";
  await downloadCsvFromUrl(
    `${API_URL}/api/timesheets/admin/company/timesheet-week/export.csv?${search.toString()}`,
    `timesheet-company-${suffix}-${weekStartIsoYmd}.csv`,
  );
}

export async function downloadAdminEmployeeWeekReportCsv(
  userId: string,
  weekStartIsoYmd: string,
  companyIdForAdministrator: string | null,
): Promise<void> {
  const search = new URLSearchParams({ week_start: weekStartIsoYmd });
  if (companyIdForAdministrator) {
    search.set("company_id", companyIdForAdministrator);
  }
  await downloadCsvFromUrl(
    `${API_URL}/api/timesheets/admin/week-report/users/${encodeURIComponent(userId)}/export.csv?${search.toString()}`,
    `week-report-${userId}-${weekStartIsoYmd}.csv`,
  );
}

export async function downloadAdminCompanyWeekReportCsv(
  weekStartIsoYmd: string,
  companyIdForAdministrator: string | null,
): Promise<void> {
  const search = new URLSearchParams({ week_start: weekStartIsoYmd });
  if (companyIdForAdministrator) {
    search.set("company_id", companyIdForAdministrator);
  }
  const suffix = companyIdForAdministrator ?? "company";
  await downloadCsvFromUrl(
    `${API_URL}/api/timesheets/admin/company/week-report/export.csv?${search.toString()}`,
    `week-report-${suffix}-${weekStartIsoYmd}.csv`,
  );
}

export async function fetchAdminCompanyWeekReport(
  weekStartIsoYmd: string,
  companyIdForAdministrator: string | null,
): Promise<AdminWeekReportAllEmployeesResponse> {
  const search = new URLSearchParams({ week_start: weekStartIsoYmd });
  if (companyIdForAdministrator) {
    search.set("company_id", companyIdForAdministrator);
  }
  const response = await fetch(
    `${API_URL}/api/timesheets/admin/company/week-report?${search.toString()}`,
    {
      method: "GET",
      credentials: "include",
    },
  );

  if (!response.ok) {
    throw new Error("Could not load week report.");
  }

  return response.json() as Promise<AdminWeekReportAllEmployeesResponse>;
}
