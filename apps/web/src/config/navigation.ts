export type SystemRole = "administrator" | "admin" | "employee";

export type NavigationItem = {
  label: string;
  href: string;
  allowedRoles: SystemRole[];
};

/** Collapsible sidebar / drawer section */
export type NavigationGroupDefinition = {
  id: string;
  label: string;
  items: NavigationItem[];
};

const DASHBOARD: NavigationItem = {
  label: "Dashboard",
  href: "/dashboard",
  allowedRoles: ["administrator", "admin", "employee"],
};

const MESSAGES: NavigationItem = {
  label: "Messages",
  href: "/messages",
  allowedRoles: ["administrator", "admin", "employee"],
};

const CLOCK: NavigationItem = {
  label: "Clock In / Out",
  href: "/clock",
  allowedRoles: ["administrator", "admin", "employee"],
};

const TIME_RECORDS: NavigationItem = {
  label: "Time Records",
  href: "/time-records",
  allowedRoles: ["administrator", "admin", "employee"],
};

const TIMESHEETS: NavigationItem = {
  label: "Timesheets",
  href: "/timesheets",
  allowedRoles: ["administrator", "admin", "employee"],
};

const WEEK_REPORT: NavigationItem = {
  label: "Week Report",
  href: "/week-report",
  allowedRoles: ["administrator", "admin", "employee"],
};

const PAY_HISTORY: NavigationItem = {
  label: "Pay History",
  href: "/pay-history",
  allowedRoles: ["employee"],
};

const SITE_PROGRESS: NavigationItem = {
  label: "Site Progress",
  href: "/site-progress",
  allowedRoles: ["administrator", "admin", "employee"],
};

const STARTER_FORM: NavigationItem = {
  label: "Starter Form",
  href: "/starter-form",
  allowedRoles: ["administrator", "admin", "employee"],
};

const PROFILE: NavigationItem = {
  label: "Profile",
  href: "/profile",
  allowedRoles: ["administrator", "admin", "employee"],
};

const SETTINGS: NavigationItem = {
  label: "Settings",
  href: "/settings",
  allowedRoles: ["administrator", "admin", "employee"],
};

const PRIVACY_PORTAL: NavigationItem = {
  label: "Data & privacy",
  href: "/privacy",
  allowedRoles: ["administrator", "admin", "employee"],
};

const OVERVIEW: NavigationItem = {
  label: "Overview",
  href: "/overview",
  allowedRoles: ["administrator", "admin"],
};

const EMPLOYEES: NavigationItem = {
  label: "Employees",
  href: "/employees",
  allowedRoles: ["administrator", "admin"],
};

const PRIVACY_REQUESTS: NavigationItem = {
  label: "Privacy requests",
  href: "/privacy/requests",
  allowedRoles: ["administrator", "admin"],
};

const ONBOARDING_REVIEW: NavigationItem = {
  label: "Onboarding Review",
  href: "/onboarding-review",
  allowedRoles: ["administrator", "admin"],
};

const CLOCK_SELFIES: NavigationItem = {
  label: "Clock Selfies",
  href: "/clock-selfie-review",
  allowedRoles: ["administrator", "admin"],
};

const COMPANIES: NavigationItem = {
  label: "Companies",
  href: "/companies",
  allowedRoles: ["administrator"],
};

const WORKPLACES: NavigationItem = {
  label: "Workplaces",
  href: "/workplaces",
  allowedRoles: ["administrator", "admin"],
};

const LOCATIONS: NavigationItem = {
  label: "Locations",
  href: "/locations",
  allowedRoles: ["administrator", "admin"],
};

const SITE_ACCESS: NavigationItem = {
  label: "Site Access",
  href: "/site-access",
  allowedRoles: ["administrator", "admin"],
};

const LIVE_ATTENDANCE: NavigationItem = {
  label: "Live Attendance",
  href: "/live-attendance",
  allowedRoles: ["administrator", "admin"],
};

const PAYROLL_REPORT: NavigationItem = {
  label: "Payroll Report",
  href: "/payroll-report",
  allowedRoles: ["administrator", "admin"],
};

const SITE_PAYROLL_RULES: NavigationItem = {
  label: "Site payroll rules",
  href: "/site-payroll-rules",
  allowedRoles: ["administrator", "admin"],
};

const BUDGET_CALCULATOR: NavigationItem = {
  label: "Budget calculator",
  href: "/budgets",
  allowedRoles: ["administrator", "admin"],
};

const ACCOUNTING_LINK: NavigationItem = {
  label: "Accounting exports",
  href: "/accounting",
  allowedRoles: ["administrator", "admin"],
};

const WORK_PROGRESS_REVIEW: NavigationItem = {
  label: "Work Progress Review",
  href: "/work-progress-review",
  allowedRoles: ["administrator", "admin"],
};

const AUDIT_LOG: NavigationItem = {
  label: "Audit Log",
  href: "/system/audit-log",
  allowedRoles: ["administrator", "admin"],
};

const SYSTEM_HEALTH: NavigationItem = {
  label: "System Health",
  href: "/system/health",
  allowedRoles: ["administrator"],
};

const EMPLOYEE_NAV_GROUP_DEFS: NavigationGroupDefinition[] = [
  { id: "emp-home", label: "Home", items: [DASHBOARD, MESSAGES] },
  {
    id: "emp-time",
    label: "Time",
    items: [CLOCK, TIME_RECORDS, TIMESHEETS, WEEK_REPORT],
  },
  { id: "emp-pay", label: "Pay", items: [PAY_HISTORY] },
  { id: "emp-work", label: "Work", items: [SITE_PROGRESS] },
  { id: "emp-profile", label: "Profile", items: [STARTER_FORM, PROFILE, SETTINGS, PRIVACY_PORTAL] },
];

const MANAGEMENT_NAV_GROUP_DEFS: NavigationGroupDefinition[] = [
  { id: "mgmt-overview", label: "Overview", items: [OVERVIEW] },
  {
    id: "mgmt-people",
    label: "People",
    items: [EMPLOYEES, ONBOARDING_REVIEW, CLOCK_SELFIES, PRIVACY_REQUESTS],
  },
  {
    id: "mgmt-sites",
    label: "Sites",
    items: [COMPANIES, WORKPLACES, LOCATIONS, SITE_ACCESS],
  },
  {
    id: "mgmt-attendance",
    label: "Attendance",
    items: [LIVE_ATTENDANCE, TIME_RECORDS, TIMESHEETS, WEEK_REPORT],
  },
  { id: "mgmt-payroll", label: "Payroll", items: [PAYROLL_REPORT, SITE_PAYROLL_RULES, BUDGET_CALCULATOR, ACCOUNTING_LINK] },
  { id: "mgmt-work", label: "Work", items: [WORK_PROGRESS_REVIEW] },
  { id: "mgmt-system", label: "System", items: [AUDIT_LOG, SYSTEM_HEALTH, SETTINGS] },
];

function itemVisibleForRole(item: NavigationItem, role: SystemRole): boolean {
  return item.allowedRoles.includes(role);
}

function filterGroup(role: SystemRole, group: NavigationGroupDefinition): NavigationGroupDefinition | null {
  const items = group.items.filter((item) => itemVisibleForRole(item, role));
  if (items.length === 0) {
    return null;
  }
  return { ...group, items };
}

/**
 * Primary (workforce) nav groups. For admin/administrator, "Time" only shows Clock here;
 * time records / timesheets / week report appear under Management → Attendance to avoid duplicate links.
 * Employees never receive management groups (see getManagementNavigationGroups).
 */
export function getEmployeeNavigationGroups(role: SystemRole): NavigationGroupDefinition[] {
  const isMgmt = role === "admin" || role === "administrator";
  return EMPLOYEE_NAV_GROUP_DEFS.map((group) => {
    if (group.id === "emp-time" && isMgmt) {
      return filterGroup(role, { ...group, items: [CLOCK] });
    }
    return filterGroup(role, group);
  }).filter((g): g is NavigationGroupDefinition => g !== null);
}

export function getManagementNavigationGroups(role: SystemRole): NavigationGroupDefinition[] {
  if (role === "employee") {
    return [];
  }
  return MANAGEMENT_NAV_GROUP_DEFS.map((group) => filterGroup(role, group)).filter(
    (g): g is NavigationGroupDefinition => g !== null,
  );
}

export function getNavigationForRole(items: NavigationItem[], role: SystemRole) {
  return items.filter((item) => item.allowedRoles.includes(role));
}

/** Flat list (unique by href) for legacy callers. */
export function getAllNavLinksForRole(role: SystemRole): NavigationItem[] {
  const seen = new Set<string>();
  const out: NavigationItem[] = [];
  for (const g of getEmployeeNavigationGroups(role)) {
    for (const item of g.items) {
      if (!seen.has(item.href)) {
        seen.add(item.href);
        out.push(item);
      }
    }
  }
  for (const g of getManagementNavigationGroups(role)) {
    for (const item of g.items) {
      if (!seen.has(item.href)) {
        seen.add(item.href);
        out.push(item);
      }
    }
  }
  return out;
}

/** Matches mobile bottom navigation — hide from drawer to avoid duplicate links. */
const MOBILE_QUICK_NAV_HREFS = new Set<string>([
  "/dashboard",
  "/clock",
  "/timesheets",
  "/week-report",
  "/profile",
]);

export function filterNavGroupsForMobileQuickNav(
  groups: NavigationGroupDefinition[],
): NavigationGroupDefinition[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !MOBILE_QUICK_NAV_HREFS.has(item.href)),
    }))
    .filter((group) => group.items.length > 0);
}
