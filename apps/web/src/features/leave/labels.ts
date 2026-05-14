/** Display labels for API leave_type codes (no PHI). */
export function leaveTypeLabel(code: string): string {
  switch (code) {
    case "annual_leave":
      return "Annual leave";
    case "sick_leave":
      return "Sick leave";
    case "unpaid_leave":
      return "Unpaid leave";
    case "other":
      return "Other absence";
    default:
      return code.replace(/_/g, " ");
  }
}

export function leaveStatusLabel(status: string): string {
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
