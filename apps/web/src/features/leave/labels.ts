import { genericStatusLabel } from "../../lib/i18n";

type TranslateFn = (key: string, fallback?: string, vars?: Record<string, string | number>) => string;

const LEAVE_TYPE_KEYS: Record<string, string> = {
  annual_leave: "leave.type_annual_leave",
  sick_leave: "leave.type_sick_leave",
  unpaid_leave: "leave.type_unpaid_leave",
  other: "leave.type_other",
};

const LEAVE_TYPE_FALLBACK: Record<string, string> = {
  annual_leave: "Annual leave",
  sick_leave: "Sick leave",
  unpaid_leave: "Unpaid leave",
  other: "Other authorised absence",
};

/** Display labels for API leave_type codes (no PHI). */
export function leaveTypeLabel(code: string, t?: TranslateFn): string {
  const key = LEAVE_TYPE_KEYS[code];
  const fb = LEAVE_TYPE_FALLBACK[code] ?? code.replace(/_/g, " ");
  if (t && key) {
    return t(key, fb);
  }
  return fb;
}

export function leaveStatusLabel(status: string, t?: TranslateFn): string {
  if (t) {
    return genericStatusLabel(t, status);
  }
  switch (status) {
    case "pending":
      return "Pending";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}
