import type { NavigationItem } from "@/types/navigation";

export const primaryNavigation: NavigationItem[] = [
  { label: "Dashboard", href: "/dashboard", roles: ["administrator", "admin", "employee"] },
  { label: "Clock In / Out", href: "/clock", roles: ["administrator", "admin", "employee"] },
  { label: "Time Records", href: "/time-records", roles: ["administrator", "admin", "employee"] },
  { label: "Timesheets", href: "/timesheets", roles: ["administrator", "admin", "employee"] },
  { label: "Pay History", href: "/pay-history", roles: ["administrator", "admin", "employee"] },
  { label: "Starter Form", href: "/starter-form", roles: ["administrator", "admin", "employee"] },
  { label: "Site Progress", href: "/site-progress", roles: ["administrator", "admin", "employee"] },
  { label: "Profile", href: "/profile", roles: ["administrator", "admin", "employee"] }
];

export const managementNavigation: NavigationItem[] = [
  { label: "Overview", href: "/management", roles: ["administrator", "admin"] },
  { label: "Employees", href: "/employees", roles: ["administrator", "admin"] },
  { label: "Companies", href: "/companies", roles: ["administrator"] },
  { label: "Locations", href: "/locations", roles: ["administrator", "admin"] },
  { label: "Site Access", href: "/site-access", roles: ["administrator", "admin"] },
  { label: "Payroll Report", href: "/payroll-report", roles: ["administrator", "admin"] },
  { label: "Live Attendance", href: "/live-attendance", roles: ["administrator", "admin"] },
  { label: "Onboarding Review", href: "/onboarding-review", roles: ["administrator", "admin"] },
  { label: "Audit Log", href: "/audit-log", roles: ["administrator"] },
  { label: "System Health", href: "/system-health", roles: ["administrator"] }
];
