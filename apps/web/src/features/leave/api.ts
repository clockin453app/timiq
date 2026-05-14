import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

async function parseError(response: Response, fallback: string): Promise<never> {
  const detail = await response.json().catch(() => ({}));
  throw new Error(fastApiDetailToMessage((detail as { detail?: unknown }).detail, fallback));
}

function qs(params: Record<string, string | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") {
      s.set(k, v);
    }
  }
  const out = s.toString();
  return out ? `?${out}` : "";
}

export type LeaveType = "annual_leave" | "sick_leave" | "unpaid_leave" | "other";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
export type HalfDay = "morning" | "afternoon";

export type LeavePolicyResponse = {
  company_id: string;
  annual_leave_year_start_month: number;
  annual_leave_year_start_day: number;
  default_annual_allowance_days: string | null;
  allow_half_days: boolean;
  paid_annual_leave: boolean;
  paid_sick_leave: boolean;
  sick_leave_requires_note: boolean;
};

export type LeavePolicyPatchRequest = {
  annual_leave_year_start_month?: number;
  annual_leave_year_start_day?: number;
  default_annual_allowance_days?: string | null;
  allow_half_days?: boolean;
  paid_annual_leave?: boolean;
  paid_sick_leave?: boolean;
  sick_leave_requires_note?: boolean;
};

export type LeaveRequestResponse = {
  id: string;
  company_id: string;
  user_id: string;
  leave_type: string;
  status: string;
  date_from: string;
  date_to: string;
  start_half_day: string | null;
  end_half_day: string | null;
  total_days: string;
  reason: string | null;
  employee_note: string | null;
  admin_note: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  rejected_by_user_id: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  warnings: string[];
  balance_warning: string | null;
};

export type LeaveRequestCreate = {
  user_id?: string;
  leave_type: LeaveType;
  date_from: string;
  date_to: string;
  start_half_day?: HalfDay | null;
  end_half_day?: HalfDay | null;
  reason?: string | null;
  employee_note?: string | null;
  force_overlap?: boolean;
};

export type LeaveMeSummaryResponse = {
  leave_year: string;
  allowance_days: string | null;
  used_annual_days: string;
  pending_annual_days: string;
  remaining_days: string | null;
  adjustment_sum_days: string;
  allow_half_days: boolean;
  sick_leave_requires_note: boolean;
};

export type LeaveAdminSummaryResponse = {
  company_id: string;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
};

export type LeaveBalanceAdjustmentResponse = {
  id: string;
  company_id: string;
  user_id: string;
  leave_year: string;
  adjustment_days: string;
  reason: string;
  created_by_user_id: string | null;
  created_at: string;
};

export type LeaveBalanceAdjustmentCreate = {
  user_id: string;
  leave_year: string;
  adjustment_days: string;
  reason: string;
};

export async function fetchLeavePolicy(companyId: string): Promise<LeavePolicyResponse> {
  const response = await fetch(`${API_URL}/api/leave/policy${qs({ company_id: companyId })}`, {
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not load leave policy.");
  }
  return response.json() as Promise<LeavePolicyResponse>;
}

export async function patchLeavePolicy(
  companyId: string,
  body: LeavePolicyPatchRequest,
): Promise<LeavePolicyResponse> {
  const response = await fetch(`${API_URL}/api/leave/policy${qs({ company_id: companyId })}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response, "Could not update leave policy.");
  }
  return response.json() as Promise<LeavePolicyResponse>;
}

export async function fetchMyLeaveRequests(): Promise<LeaveRequestResponse[]> {
  const response = await fetch(`${API_URL}/api/leave/me`, { credentials: "include" });
  if (!response.ok) {
    await parseError(response, "Could not load your leave requests.");
  }
  return response.json() as Promise<LeaveRequestResponse[]>;
}

export async function fetchMyLeaveSummary(): Promise<LeaveMeSummaryResponse> {
  const response = await fetch(`${API_URL}/api/leave/me/summary`, { credentials: "include" });
  if (!response.ok) {
    await parseError(response, "Could not load leave summary.");
  }
  return response.json() as Promise<LeaveMeSummaryResponse>;
}

export async function createMyLeaveRequest(body: LeaveRequestCreate): Promise<LeaveRequestResponse> {
  const response = await fetch(`${API_URL}/api/leave/me`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response, "Could not submit leave request.");
  }
  return response.json() as Promise<LeaveRequestResponse>;
}

export async function cancelMyLeaveRequest(requestId: string): Promise<LeaveRequestResponse> {
  const response = await fetch(`${API_URL}/api/leave/me/${requestId}/cancel`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not cancel request.");
  }
  return response.json() as Promise<LeaveRequestResponse>;
}

export async function fetchLeaveAdminSummary(companyId: string): Promise<LeaveAdminSummaryResponse> {
  const response = await fetch(`${API_URL}/api/leave/admin/summary${qs({ company_id: companyId })}`, {
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not load leave summary.");
  }
  return response.json() as Promise<LeaveAdminSummaryResponse>;
}

export type ListLeaveRequestsParams = {
  company_id: string;
  status?: string;
  user_id?: string;
  leave_type?: string;
  date_from?: string;
  date_to?: string;
};

export async function fetchCompanyLeaveRequests(params: ListLeaveRequestsParams): Promise<LeaveRequestResponse[]> {
  const response = await fetch(`${API_URL}/api/leave/requests${qs(params)}`, { credentials: "include" });
  if (!response.ok) {
    await parseError(response, "Could not load leave requests.");
  }
  return response.json() as Promise<LeaveRequestResponse[]>;
}

export async function adminCreateLeaveRequest(
  companyId: string,
  body: LeaveRequestCreate,
): Promise<LeaveRequestResponse> {
  const response = await fetch(`${API_URL}/api/leave/requests${qs({ company_id: companyId })}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response, "Could not create leave request.");
  }
  return response.json() as Promise<LeaveRequestResponse>;
}

export async function approveLeaveRequest(requestId: string): Promise<LeaveRequestResponse> {
  const response = await fetch(`${API_URL}/api/leave/requests/${requestId}/approve`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not approve request.");
  }
  return response.json() as Promise<LeaveRequestResponse>;
}

export async function rejectLeaveRequest(
  requestId: string,
  body: { admin_note?: string | null },
): Promise<LeaveRequestResponse> {
  const response = await fetch(`${API_URL}/api/leave/requests/${requestId}/reject`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response, "Could not reject request.");
  }
  return response.json() as Promise<LeaveRequestResponse>;
}

export async function adminCancelLeaveRequest(requestId: string): Promise<LeaveRequestResponse> {
  const response = await fetch(`${API_URL}/api/leave/requests/${requestId}/cancel`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not cancel request.");
  }
  return response.json() as Promise<LeaveRequestResponse>;
}

export async function fetchLeaveBalanceAdjustments(
  companyId: string,
  userId?: string,
  leaveYear?: string,
): Promise<LeaveBalanceAdjustmentResponse[]> {
  const response = await fetch(
    `${API_URL}/api/leave/balances${qs({
      company_id: companyId,
      user_id: userId,
      leave_year: leaveYear,
    })}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    await parseError(response, "Could not load balance adjustments.");
  }
  return response.json() as Promise<LeaveBalanceAdjustmentResponse[]>;
}

export async function postLeaveBalanceAdjustment(
  companyId: string,
  body: LeaveBalanceAdjustmentCreate,
): Promise<LeaveBalanceAdjustmentResponse> {
  const response = await fetch(`${API_URL}/api/leave/balance-adjustments${qs({ company_id: companyId })}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response, "Could not save adjustment.");
  }
  return response.json() as Promise<LeaveBalanceAdjustmentResponse>;
}
