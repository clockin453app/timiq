export type SystemRole = "administrator" | "admin" | "employee";

export type NavigationItem = {
  label: string;
  href: string;
  allowedRoles: SystemRole[];
};

export const employeeNavigation: NavigationItem[] = [
  { label: "Dashboard", href: "/dashboard", allowedRoles: ["administrator", "admin", "employee"] },
  { label: "Clock In / Out", href: "/clock", allowedRoles: ["administrator", "admin", "employee"] },
  { label: "Time Records", href: "/time-records", allowedRoles: ["administrator", "admin", "employee"] },
  { label: "Timesheets", href: "/timesheets", allowedRoles: ["administrator", "admin", "employee"] },
  { label: "Week Report", href: "/week-report", allowedRoles: ["administrator", "admin", "employee"] },
  { label: "Pay History", href: "/pay-history", allowedRoles: ["employee"] },
  { label: "Starter Form", href: "/starter-form", allowedRoles: ["administrator", "admin", "employee"] },
  { label: "Site Progress", href: "/site-progress", allowedRoles: ["administrator", "admin", "employee"] },
  { label: "Profile", href: "/profile", allowedRoles: ["administrator", "admin", "employee"] },
];

export const managementNavigation: NavigationItem[] = [
  { label: "Overview", href: "/management", allowedRoles: ["administrator", "admin"] },
  { label: "Employees", href: "/employees", allowedRoles: ["administrator", "admin"] },
  { label: "Clock Selfies", href: "/clock-selfie-review", allowedRoles: ["administrator", "admin"] },
  { label: "Companies", href: "/companies", allowedRoles: ["administrator"] },
  { label: "Workplaces", href: "/workplaces", allowedRoles: ["administrator", "admin"] },
  { label: "Locations", href: "/locations", allowedRoles: ["administrator", "admin"] },
  { label: "Site Access", href: "/site-access", allowedRoles: ["administrator", "admin"] },
  { label: "Payroll Report", href: "/payroll-report", allowedRoles: ["administrator", "admin"] },
  { label: "Live Attendance", href: "/live-attendance", allowedRoles: ["administrator", "admin"] },
  { label: "Onboarding Review", href: "/onboarding-review", allowedRoles: ["administrator", "admin"] },
  { label: "Audit Log", href: "/audit-log", allowedRoles: ["administrator"] },
  { label: "System Health", href: "/system-health", allowedRoles: ["administrator"] },
];

export function getNavigationForRole(items: NavigationItem[], role: SystemRole) {
  return items.filter((item) => item.allowedRoles.includes(role));
}