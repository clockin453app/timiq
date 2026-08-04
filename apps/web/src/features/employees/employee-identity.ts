import type { AuthUser } from "@/features/auth";

export type PayrollTypeDisplay = "cis" | "paye" | "none";

export function employeeDisplayName(user: Pick<AuthUser, "profile_first_name" | "profile_last_name" | "email">): string {
  const first = user.profile_first_name?.trim();
  const last = user.profile_last_name?.trim();
  if (first || last) {
    return [first, last].filter(Boolean).join(" ");
  }
  return (user.email || "").trim() || "Employee";
}

export function employeeInitials(user: Pick<AuthUser, "profile_first_name" | "profile_last_name" | "email">): string {
  const first = user.profile_first_name?.trim();
  const last = user.profile_last_name?.trim();
  if (first || last) {
    const parts = [first, last].filter(Boolean) as string[];
    if (parts.length > 1) {
      return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
    }
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  const email = (user.email || "").trim();
  return email ? email.slice(0, 1).toUpperCase() : "E";
}

export function resolvePayrollTypeDisplay(payrollType: string | null | undefined): PayrollTypeDisplay {
  const cleaned = (payrollType || "").trim().toLowerCase();
  if (cleaned === "paye_employee") {
    return "paye";
  }
  if (cleaned === "cis_subcontractor") {
    return "cis";
  }
  return "none";
}

export function payrollTypeLabel(kind: PayrollTypeDisplay): string {
  if (kind === "cis") {
    return "CIS subcontractor";
  }
  if (kind === "paye") {
    return "PAYE employee";
  }
  return "Not configured";
}
