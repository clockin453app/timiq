type TranslateFn = (key: string, fallback?: string, vars?: Record<string, string | number>) => string;

const PAYROLL_STATUS_KEYS: Record<string, string> = {
  not_calculated: "payroll.report.status_not_calculated",
  pending: "payroll.report.status_pending",
  pending_approval: "dashboard.payroll_pending_approval",
  approved: "payroll.report.status_approved",
  paid: "payroll.report.status_paid",
  mixed: "dashboard.payroll_mixed",
};

const PAYROLL_STATUS_FALLBACK: Record<string, string> = {
  not_calculated: "Not calculated",
  pending: "Pending",
  pending_approval: "Pending approval",
  approved: "Approved",
  paid: "Paid",
  mixed: "Mixed",
};

const ROLE_KEYS: Record<string, string> = {
  administrator: "employees.role_administrator",
  admin: "employees.role_admin",
  employee: "employees.role_employee",
};

const ROLE_FALLBACK: Record<string, string> = {
  administrator: "Administrator",
  admin: "Admin",
  employee: "Employee",
};

export function payrollStatusLabel(t: TranslateFn, status: string): string {
  const key = PAYROLL_STATUS_KEYS[status];
  const fallback = PAYROLL_STATUS_FALLBACK[status] ?? status.replace(/_/g, " ");
  return key ? t(key, fallback) : fallback;
}

export function employeeRoleLabel(t: TranslateFn, role: string): string {
  const key = ROLE_KEYS[role];
  const fallback = ROLE_FALLBACK[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
  return key ? t(key, fallback) : fallback;
}

export function genericStatusLabel(t: TranslateFn, status: string): string {
  const key = `status.${status}`;
  const fallback = status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
  return t(key, fallback);
}

export function shiftStatusLabel(t: TranslateFn, status: string): string {
  return genericStatusLabel(t, status);
}
