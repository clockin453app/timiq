export type SystemRole = "administrator" | "admin" | "employee";

export type NavigationItem = {
  /** English fallback when a translation key is missing */
  label: string;
  labelKey: string;
  href: string;
  allowedRoles: SystemRole[];
};

/** Collapsible sidebar / drawer section */
export type NavigationGroupDefinition = {
  id: string;
  label: string;
  groupLabelKey: string;
  items: NavigationItem[];
};

const DASHBOARD: NavigationItem = {
  label: "Dashboard",
  labelKey: "nav.dashboard",
  href: "/dashboard",
  allowedRoles: ["administrator", "admin", "employee"],
};

const MESSAGES: NavigationItem = {
  label: "Messages",
  labelKey: "nav.messages",
  href: "/messages",
  allowedRoles: ["administrator", "admin", "employee"],
};

const CLOCK: NavigationItem = {
  label: "Clock In / Out",
  labelKey: "nav.clock",
  href: "/clock",
  allowedRoles: ["administrator", "admin", "employee"],
};

const TIME_RECORDS: NavigationItem = {
  label: "Time Records",
  labelKey: "nav.time_records",
  href: "/time-records",
  allowedRoles: ["administrator", "admin", "employee"],
};

const TIMESHEETS: NavigationItem = {
  label: "Timesheets",
  labelKey: "nav.timesheets",
  href: "/timesheets",
  allowedRoles: ["administrator", "admin", "employee"],
};

const WEEK_REPORT: NavigationItem = {
  label: "Week Report",
  labelKey: "nav.week_report",
  href: "/week-report",
  allowedRoles: ["administrator", "admin"],
};

const PAY_HISTORY: NavigationItem = {
  label: "Pay History",
  labelKey: "nav.pay_history",
  href: "/pay-history",
  allowedRoles: ["employee"],
};

const SITE_PROGRESS: NavigationItem = {
  label: "Site Progress",
  labelKey: "nav.site_progress",
  href: "/site-progress",
  allowedRoles: ["administrator", "admin", "employee"],
};

const TOOLBOX_TALKS: NavigationItem = {
  label: "Toolbox Talks",
  labelKey: "nav.toolbox_talks",
  href: "/toolbox-talks",
  allowedRoles: ["administrator", "admin", "employee"],
};

const TOOLBOX_TALKS_MANAGE: NavigationItem = {
  label: "Manage toolbox talks",
  labelKey: "nav.toolbox_talks_manage",
  href: "/toolbox-talks/manage",
  allowedRoles: ["administrator", "admin"],
};

const RAMS: NavigationItem = {
  label: "RAMS / Risk assessments",
  labelKey: "nav.rams",
  href: "/rams",
  allowedRoles: ["administrator", "admin", "employee"],
};

const RAMS_MANAGE: NavigationItem = {
  label: "Manage RAMS",
  labelKey: "nav.rams_manage",
  href: "/rams/manage",
  allowedRoles: ["administrator", "admin"],
};

const FORMS: NavigationItem = {
  label: "Forms",
  labelKey: "nav.forms",
  href: "/forms",
  allowedRoles: ["administrator", "admin", "employee"],
};

const FORMS_MANAGE: NavigationItem = {
  label: "Form templates",
  labelKey: "nav.forms_manage",
  href: "/forms/manage",
  allowedRoles: ["administrator", "admin"],
};

const FORMS_REVIEW: NavigationItem = {
  label: "Form review",
  labelKey: "nav.forms_review",
  href: "/forms/review",
  allowedRoles: ["administrator", "admin"],
};

const STARTER_FORM: NavigationItem = {
  label: "Starter Form",
  labelKey: "nav.starter_form",
  href: "/starter-form",
  allowedRoles: ["administrator", "admin", "employee"],
};

const LEAVE: NavigationItem = {
  label: "Leave",
  labelKey: "nav.leave",
  href: "/leave",
  allowedRoles: ["administrator", "admin", "employee"],
};

const LEAVE_MANAGE: NavigationItem = {
  label: "Leave management",
  labelKey: "nav.leave_manage",
  href: "/leave/manage",
  allowedRoles: ["administrator", "admin"],
};

const PROFILE: NavigationItem = {
  label: "Profile",
  labelKey: "nav.profile",
  href: "/profile",
  allowedRoles: ["administrator", "admin", "employee"],
};

const SETTINGS: NavigationItem = {
  label: "Settings",
  labelKey: "nav.settings",
  href: "/settings",
  allowedRoles: ["administrator", "admin", "employee"],
};

const HELP_CENTRE: NavigationItem = {
  label: "Help centre",
  labelKey: "nav.help",
  href: "/help",
  allowedRoles: ["administrator", "admin", "employee"],
};

const PRIVACY_PORTAL: NavigationItem = {
  label: "Data & privacy",
  labelKey: "nav.privacy",
  href: "/privacy",
  allowedRoles: ["administrator", "admin", "employee"],
};

const OVERVIEW: NavigationItem = {
  label: "Overview",
  labelKey: "nav.overview",
  href: "/overview",
  allowedRoles: ["administrator", "admin"],
};

const EMPLOYEES: NavigationItem = {
  label: "Employees",
  labelKey: "nav.employees",
  href: "/employees",
  allowedRoles: ["administrator", "admin"],
};

const PRIVACY_REQUESTS: NavigationItem = {
  label: "Privacy requests",
  labelKey: "nav.privacy_requests",
  href: "/privacy/requests",
  allowedRoles: ["administrator", "admin"],
};

const ONBOARDING_REVIEW: NavigationItem = {
  label: "Onboarding Review",
  labelKey: "nav.onboarding_review",
  href: "/onboarding-review",
  allowedRoles: ["administrator", "admin"],
};

const CLOCK_SELFIES: NavigationItem = {
  label: "Clock Selfies",
  labelKey: "nav.clock_selfies",
  href: "/clock-selfie-review",
  allowedRoles: ["administrator", "admin"],
};

const COMPANIES: NavigationItem = {
  label: "Companies",
  labelKey: "nav.companies",
  href: "/companies",
  allowedRoles: ["administrator"],
};

const CIS_WORKPLACES: NavigationItem = {
  label: "CIS Workplaces",
  labelKey: "nav.cis_workplaces",
  href: "/workplaces",
  allowedRoles: ["administrator", "admin"],
};

const LOCATIONS: NavigationItem = {
  label: "Sites",
  labelKey: "nav.locations",
  href: "/locations",
  allowedRoles: ["administrator", "admin"],
};

const SITE_ACCESS: NavigationItem = {
  label: "Site Access",
  labelKey: "nav.site_access",
  href: "/site-access",
  allowedRoles: ["administrator", "admin"],
};

const LIVE_ATTENDANCE: NavigationItem = {
  label: "Live Attendance",
  labelKey: "nav.live_attendance",
  href: "/live-attendance",
  allowedRoles: ["administrator", "admin"],
};

const PAYROLL_REPORT: NavigationItem = {
  label: "Payroll Report",
  labelKey: "nav.payroll_report",
  href: "/payroll-report",
  allowedRoles: ["administrator", "admin"],
};

const SITE_PAYROLL_RULES: NavigationItem = {
  label: "Site payroll rules",
  labelKey: "nav.site_payroll_rules",
  href: "/site-payroll-rules",
  allowedRoles: ["administrator", "admin"],
};

const BUDGET_CALCULATOR: NavigationItem = {
  label: "Budget calculator",
  labelKey: "nav.budget_calculator",
  href: "/budgets",
  allowedRoles: ["administrator", "admin"],
};

const ACCOUNTING_LINK: NavigationItem = {
  label: "Accounting exports",
  labelKey: "nav.accounting_exports",
  href: "/accounting",
  allowedRoles: ["administrator", "admin"],
};

const WORK_PROGRESS_REVIEW: NavigationItem = {
  label: "Work Progress Review",
  labelKey: "nav.work_progress_review",
  href: "/work-progress-review",
  allowedRoles: ["administrator", "admin"],
};

const AUDIT_LOG: NavigationItem = {
  label: "Audit Log",
  labelKey: "nav.audit_log",
  href: "/system/audit-log",
  allowedRoles: ["administrator", "admin"],
};

const SYSTEM_HEALTH: NavigationItem = {
  label: "System Health",
  labelKey: "nav.system_health",
  href: "/system/health",
  allowedRoles: ["administrator"],
};

const EMPLOYEE_NAV_GROUP_DEFS: NavigationGroupDefinition[] = [
  { id: "emp-home", label: "Home", groupLabelKey: "nav.group.emp_home", items: [DASHBOARD, MESSAGES] },
  {
    id: "emp-time",
    label: "Time",
    groupLabelKey: "nav.group.emp_time",
    items: [CLOCK, TIME_RECORDS, TIMESHEETS],
  },
  { id: "emp-pay", label: "Pay", groupLabelKey: "nav.group.emp_pay", items: [PAY_HISTORY] },
  { id: "emp-work", label: "Work", groupLabelKey: "nav.group.emp_work", items: [SITE_PROGRESS, FORMS, TOOLBOX_TALKS, RAMS] },
  {
    id: "emp-profile",
    label: "Profile",
    groupLabelKey: "nav.group.emp_profile",
    items: [STARTER_FORM, LEAVE, PROFILE, SETTINGS, HELP_CENTRE, PRIVACY_PORTAL],
  },
];

const MANAGEMENT_NAV_GROUP_DEFS: NavigationGroupDefinition[] = [
  { id: "mgmt-overview", label: "Overview", groupLabelKey: "nav.group.mgmt_overview", items: [OVERVIEW] },
  {
    id: "mgmt-people",
    label: "People",
    groupLabelKey: "nav.group.mgmt_people",
    items: [EMPLOYEES, LEAVE_MANAGE, ONBOARDING_REVIEW, CLOCK_SELFIES, PRIVACY_REQUESTS],
  },
  {
    id: "mgmt-sites",
    label: "Sites",
    groupLabelKey: "nav.group.mgmt_sites",
    items: [COMPANIES, LOCATIONS, SITE_ACCESS],
  },
  {
    id: "mgmt-attendance",
    label: "Attendance",
    groupLabelKey: "nav.group.mgmt_attendance",
    items: [LIVE_ATTENDANCE, TIME_RECORDS, TIMESHEETS, WEEK_REPORT],
  },
  {
    id: "mgmt-payroll",
    label: "Payroll",
    groupLabelKey: "nav.group.mgmt_payroll",
    items: [PAYROLL_REPORT, CIS_WORKPLACES, SITE_PAYROLL_RULES, BUDGET_CALCULATOR, ACCOUNTING_LINK],
  },
  {
    id: "mgmt-work",
    label: "Work",
    groupLabelKey: "nav.group.mgmt_work",
    items: [WORK_PROGRESS_REVIEW, FORMS_MANAGE, FORMS_REVIEW, TOOLBOX_TALKS_MANAGE, RAMS_MANAGE],
  },
  {
    id: "mgmt-system",
    label: "System",
    groupLabelKey: "nav.group.mgmt_system",
    items: [AUDIT_LOG, SYSTEM_HEALTH, SETTINGS],
  },
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
