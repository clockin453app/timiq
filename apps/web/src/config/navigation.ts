export type SystemRole = "administrator" | "admin" | "employee";

export type NavigationItem = {
  /** English fallback when a translation key is missing */
  label: string;
  labelKey: string;
  href: string;
  allowedRoles: SystemRole[];
};

/** Collapsible sidebar / drawer section (legacy one-level groups for top nav). */
export type NavigationGroupDefinition = {
  id: string;
  label: string;
  groupLabelKey: string;
  items: NavigationItem[];
};

/**
 * Recursive sidebar / drawer tree node.
 * Folders have children and no href. Leaves have href and no children.
 */
export type NavigationNode = {
  id: string;
  label: string;
  labelKey: string;
  /** Maps to NavItemIcon / NavGroupIcon registries. */
  iconKey: string;
  href?: string;
  children?: NavigationNode[];
  allowedRoles: SystemRole[];
  /** Optional badge lookup key; defaults to href for leaves. */
  badgeId?: string;
};

const MGMT: SystemRole[] = ["administrator", "admin"];
const ALL: SystemRole[] = ["administrator", "admin", "employee"];
const EMP: SystemRole[] = ["employee"];
const ADMIN_ONLY: SystemRole[] = ["administrator"];

function leaf(
  id: string,
  label: string,
  labelKey: string,
  href: string,
  allowedRoles: SystemRole[],
  iconKey = labelKey,
): NavigationNode {
  return { id, label, labelKey, iconKey, href, allowedRoles };
}

function folder(
  id: string,
  label: string,
  labelKey: string,
  allowedRoles: SystemRole[],
  children: NavigationNode[],
  iconKey = id,
): NavigationNode {
  return { id, label, labelKey, iconKey, allowedRoles, children };
}

const DASHBOARD: NavigationItem = {
  label: "Dashboard",
  labelKey: "nav.dashboard",
  href: "/dashboard",
  allowedRoles: ALL,
};

const MESSAGES: NavigationItem = {
  label: "Messages",
  labelKey: "nav.messages",
  href: "/messages",
  allowedRoles: ALL,
};

const CLOCK: NavigationItem = {
  label: "Clock In / Out",
  labelKey: "nav.clock",
  href: "/clock",
  allowedRoles: ALL,
};

const TIME_RECORDS: NavigationItem = {
  label: "Time Records",
  labelKey: "nav.time_records",
  href: "/time-records",
  allowedRoles: ALL,
};

const TIMESHEETS: NavigationItem = {
  label: "Timesheets",
  labelKey: "nav.timesheets",
  href: "/timesheets",
  allowedRoles: ALL,
};

const WEEK_REPORT: NavigationItem = {
  label: "Week Report",
  labelKey: "nav.week_report",
  href: "/week-report",
  allowedRoles: MGMT,
};

const PAY_HISTORY: NavigationItem = {
  label: "CIS Pay History",
  labelKey: "nav.cis_pay_history",
  href: "/pay-history",
  allowedRoles: EMP,
};

const PAYE_PAY_HISTORY: NavigationItem = {
  label: "PAYE Pay History",
  labelKey: "nav.paye_pay_history",
  href: "/paye-pay-history",
  allowedRoles: EMP,
};

const SITE_PROGRESS: NavigationItem = {
  label: "Site Progress",
  labelKey: "nav.site_progress",
  href: "/site-progress",
  allowedRoles: ALL,
};

const TOOLBOX_TALKS: NavigationItem = {
  label: "Toolbox Talks",
  labelKey: "nav.toolbox_talks",
  href: "/toolbox-talks",
  allowedRoles: ALL,
};

const TOOLBOX_TALKS_MANAGE: NavigationItem = {
  label: "Toolbox Talks",
  labelKey: "nav.toolbox_talks_manage",
  href: "/toolbox-talks/manage",
  allowedRoles: MGMT,
};

const RAMS: NavigationItem = {
  label: "RAMS",
  labelKey: "nav.rams",
  href: "/rams",
  allowedRoles: ALL,
};

const RAMS_MANAGE: NavigationItem = {
  label: "RAMS",
  labelKey: "nav.rams_manage",
  href: "/rams/manage",
  allowedRoles: MGMT,
};

const FORMS: NavigationItem = {
  label: "Forms",
  labelKey: "nav.forms",
  href: "/forms",
  allowedRoles: ALL,
};

const FORMS_MANAGE: NavigationItem = {
  label: "Form templates",
  labelKey: "nav.forms_manage",
  href: "/forms/manage",
  allowedRoles: MGMT,
};

const FORMS_REVIEW: NavigationItem = {
  label: "Form review",
  labelKey: "nav.forms_review",
  href: "/forms/review",
  allowedRoles: MGMT,
};

const STARTER_FORM: NavigationItem = {
  label: "Starter Form",
  labelKey: "nav.starter_form",
  href: "/starter-form",
  allowedRoles: ALL,
};

const LEAVE: NavigationItem = {
  label: "Leave",
  labelKey: "nav.leave",
  href: "/leave",
  allowedRoles: ALL,
};

const LEAVE_MANAGE: NavigationItem = {
  label: "Leave management",
  labelKey: "nav.leave_manage",
  href: "/leave/manage",
  allowedRoles: MGMT,
};

const PROFILE: NavigationItem = {
  label: "Profile",
  labelKey: "nav.profile",
  href: "/profile",
  allowedRoles: ALL,
};

const SETTINGS: NavigationItem = {
  label: "Settings",
  labelKey: "nav.settings",
  href: "/settings",
  allowedRoles: ALL,
};

const HELP_CENTRE: NavigationItem = {
  label: "Help centre",
  labelKey: "nav.help",
  href: "/help",
  allowedRoles: ALL,
};

const PRIVACY_PORTAL: NavigationItem = {
  label: "Data & privacy",
  labelKey: "nav.privacy",
  href: "/privacy",
  allowedRoles: ALL,
};

const OVERVIEW: NavigationItem = {
  label: "Overview",
  labelKey: "nav.overview",
  href: "/overview",
  allowedRoles: MGMT,
};

const EMPLOYEES: NavigationItem = {
  label: "Employees",
  labelKey: "nav.employees",
  href: "/employees",
  allowedRoles: MGMT,
};

const PRIVACY_REQUESTS: NavigationItem = {
  label: "Privacy requests",
  labelKey: "nav.privacy_requests",
  href: "/privacy/requests",
  allowedRoles: MGMT,
};

const ONBOARDING_REVIEW: NavigationItem = {
  label: "Onboarding Review",
  labelKey: "nav.onboarding_review",
  href: "/onboarding-review",
  allowedRoles: MGMT,
};

const CLOCK_SELFIES: NavigationItem = {
  label: "Clock Selfies",
  labelKey: "nav.clock_selfies",
  href: "/clock-selfie-review",
  allowedRoles: MGMT,
};

const COMPANIES: NavigationItem = {
  label: "Companies",
  labelKey: "nav.companies",
  href: "/companies",
  allowedRoles: MGMT,
};

/** Kept for reference only — intentionally excluded from sidebar trees. */
const CIS_WORKPLACES: NavigationItem = {
  label: "CIS Workplaces",
  labelKey: "nav.cis_workplaces",
  href: "/workplaces",
  allowedRoles: MGMT,
};

void CIS_WORKPLACES;

const LOCATIONS: NavigationItem = {
  label: "Sites",
  labelKey: "nav.locations",
  href: "/locations",
  allowedRoles: MGMT,
};

const SITE_ACCESS: NavigationItem = {
  label: "Site Access",
  labelKey: "nav.site_access",
  href: "/site-access",
  allowedRoles: MGMT,
};

const LIVE_ATTENDANCE: NavigationItem = {
  label: "Live Attendance",
  labelKey: "nav.live_attendance",
  href: "/live-attendance",
  allowedRoles: MGMT,
};

const PAYROLL_REPORT: NavigationItem = {
  label: "CIS Payroll Report",
  labelKey: "nav.cis_payroll_report",
  href: "/payroll-report",
  allowedRoles: MGMT,
};

const MONTHLY_PAYE_REPORT: NavigationItem = {
  label: "Monthly PAYE Report",
  labelKey: "nav.monthly_paye_report",
  href: "/monthly-paye",
  allowedRoles: MGMT,
};

const SITE_PAYROLL_RULES: NavigationItem = {
  label: "Site payroll rules",
  labelKey: "nav.site_payroll_rules",
  href: "/site-payroll-rules",
  allowedRoles: MGMT,
};

const BUDGET_CALCULATOR: NavigationItem = {
  label: "Budget calculator",
  labelKey: "nav.budget_calculator",
  href: "/budgets",
  allowedRoles: MGMT,
};

const ACCOUNTING_LINK: NavigationItem = {
  label: "Accounting exports",
  labelKey: "nav.accounting_exports",
  href: "/accounting",
  allowedRoles: MGMT,
};

const WORK_PROGRESS_REVIEW: NavigationItem = {
  label: "Work Progress Pictures",
  labelKey: "nav.work_progress_review",
  href: "/work-progress-review",
  allowedRoles: MGMT,
};

const AUDIT_LOG: NavigationItem = {
  label: "Audit Log",
  labelKey: "nav.audit_log",
  href: "/system/audit-log",
  allowedRoles: MGMT,
};

const LIVE_LOGS: NavigationItem = {
  label: "Live Logs",
  labelKey: "nav.live_logs",
  href: "/system/live-logs",
  allowedRoles: ADMIN_ONLY,
};

const SYSTEM_HEALTH: NavigationItem = {
  label: "System Health",
  labelKey: "nav.system_health",
  href: "/system/health",
  allowedRoles: ADMIN_ONLY,
};

const ADMIN_GUIDE: NavigationItem = {
  label: "Administrator Guide",
  labelKey: "nav.admin_guide",
  href: "/admin-guide",
  allowedRoles: ADMIN_ONLY,
};

function itemToLeaf(item: NavigationItem, id?: string): NavigationNode {
  return leaf(
    id ?? item.href.replace(/^\//, "").replace(/\//g, "-"),
    item.label,
    item.labelKey,
    item.href,
    item.allowedRoles,
    item.labelKey,
  );
}

/** Management + My workspace tree (Admin / Administrator). Overview is a flat root leaf. */
const MANAGEMENT_NAV_TREE: NavigationNode[] = [
  itemToLeaf(OVERVIEW, "overview"),
  folder("mgmt-people", "People", "nav.group.mgmt_people", MGMT, [
    folder("mgmt-people-employees", "Employees", "nav.folder.employees", MGMT, [
      itemToLeaf(EMPLOYEES, "employees"),
      itemToLeaf(ONBOARDING_REVIEW, "onboarding-review"),
      itemToLeaf(CLOCK_SELFIES, "clock-selfie-review"),
    ]),
    folder("mgmt-people-leave", "Leave", "nav.folder.leave", MGMT, [
      itemToLeaf(LEAVE_MANAGE, "leave-manage"),
    ]),
    folder("mgmt-people-privacy", "Privacy", "nav.folder.privacy", MGMT, [
      itemToLeaf(PRIVACY_REQUESTS, "privacy-requests"),
    ]),
  ]),
  folder("mgmt-attendance", "Time & Attendance", "nav.group.mgmt_attendance", MGMT, [
    folder("mgmt-attendance-clocking", "Clocking", "nav.folder.clocking", MGMT, [
      itemToLeaf(CLOCK, "clock"),
      itemToLeaf(LIVE_ATTENDANCE, "live-attendance"),
      itemToLeaf(TIME_RECORDS, "time-records"),
    ]),
    folder("mgmt-attendance-reports", "Timesheets & Reports", "nav.folder.timesheets_reports", MGMT, [
      itemToLeaf(TIMESHEETS, "timesheets"),
      itemToLeaf(WEEK_REPORT, "week-report"),
    ]),
  ]),
  folder("mgmt-sites", "Sites", "nav.group.mgmt_sites", MGMT, [
    folder("mgmt-sites-management", "Site management", "nav.folder.site_management", MGMT, [
      itemToLeaf(LOCATIONS, "locations"),
      itemToLeaf(SITE_ACCESS, "site-access"),
    ]),
    folder("mgmt-sites-progress", "Progress", "nav.folder.progress", MGMT, [
      itemToLeaf(SITE_PROGRESS, "site-progress"),
      itemToLeaf(WORK_PROGRESS_REVIEW, "work-progress-review"),
    ]),
  ]),
  folder("mgmt-payroll", "Payroll", "nav.group.mgmt_payroll", MGMT, [
    folder("mgmt-payroll-cis", "CIS Payroll", "nav.folder.cis_payroll", MGMT, [
      itemToLeaf(PAYROLL_REPORT, "payroll-report"),
      itemToLeaf(SITE_PAYROLL_RULES, "site-payroll-rules"),
    ]),
    folder("mgmt-payroll-paye", "PAYE Payroll", "nav.folder.paye_payroll", MGMT, [
      itemToLeaf(MONTHLY_PAYE_REPORT, "monthly-paye"),
    ]),
    folder("mgmt-payroll-finance", "Finance", "nav.folder.finance", MGMT, [
      itemToLeaf(BUDGET_CALCULATOR, "budgets"),
      itemToLeaf(ACCOUNTING_LINK, "accounting"),
    ]),
  ]),
  folder("mgmt-work", "Work & Safety", "nav.group.mgmt_work", MGMT, [
    folder("mgmt-work-forms", "Forms", "nav.folder.forms", MGMT, [
      itemToLeaf(FORMS_MANAGE, "forms-manage"),
      itemToLeaf(FORMS_REVIEW, "forms-review"),
    ]),
    itemToLeaf(TOOLBOX_TALKS_MANAGE, "toolbox-talks-manage"),
    itemToLeaf(RAMS_MANAGE, "rams-manage"),
  ]),
  folder("mgmt-system", "System", "nav.group.mgmt_system", MGMT, [
    folder("mgmt-system-org", "Organisation", "nav.folder.organisation", MGMT, [
      itemToLeaf(COMPANIES, "companies"),
      itemToLeaf(SETTINGS, "settings"),
    ]),
    folder("mgmt-system-monitoring", "Monitoring", "nav.folder.monitoring", MGMT, [
      itemToLeaf(AUDIT_LOG, "audit-log"),
      itemToLeaf(LIVE_LOGS, "live-logs"),
      itemToLeaf(SYSTEM_HEALTH, "system-health"),
    ]),
    folder("mgmt-system-support", "Support", "nav.folder.support", MGMT, [
      itemToLeaf(ADMIN_GUIDE, "admin-guide"),
      itemToLeaf(HELP_CENTRE, "help"),
    ]),
  ]),
  folder("mgmt-workspace", "My workspace", "nav.group.my_workspace", MGMT, [
    itemToLeaf(MESSAGES, "ws-messages"),
    leaf("ws-forms", "My Forms", "nav.my_forms", "/forms", MGMT, "nav.forms"),
    leaf("ws-toolbox", "My Toolbox Talks", "nav.my_toolbox_talks", "/toolbox-talks", MGMT, "nav.toolbox_talks"),
    leaf("ws-rams", "My RAMS", "nav.my_rams", "/rams", MGMT, "nav.rams"),
    leaf("ws-leave", "My Leave", "nav.my_leave", "/leave", MGMT, "nav.leave"),
    itemToLeaf(STARTER_FORM, "ws-starter-form"),
    itemToLeaf(PROFILE, "ws-profile"),
    itemToLeaf(PRIVACY_PORTAL, "ws-privacy"),
  ]),
];

const EMPLOYEE_NAV_TREE: NavigationNode[] = [
  folder("emp-home", "Home", "nav.group.emp_home", EMP, [
    itemToLeaf(DASHBOARD, "dashboard"),
    itemToLeaf(MESSAGES, "messages"),
  ]),
  folder("emp-time", "Time", "nav.group.emp_time", EMP, [
    itemToLeaf(CLOCK, "clock"),
    itemToLeaf(TIME_RECORDS, "time-records"),
    itemToLeaf(TIMESHEETS, "timesheets"),
  ]),
  folder("emp-pay", "Pay", "nav.group.emp_pay", EMP, [
    itemToLeaf(PAY_HISTORY, "pay-history"),
    itemToLeaf(PAYE_PAY_HISTORY, "paye-pay-history"),
  ]),
  folder("emp-work", "Work", "nav.group.emp_work", EMP, [
    itemToLeaf(SITE_PROGRESS, "site-progress"),
    itemToLeaf(FORMS, "forms"),
    itemToLeaf(TOOLBOX_TALKS, "toolbox-talks"),
    itemToLeaf(RAMS, "rams"),
  ]),
  folder("emp-account", "Account", "nav.group.emp_account", EMP, [
    itemToLeaf(STARTER_FORM, "starter-form"),
    itemToLeaf(LEAVE, "leave"),
    itemToLeaf(PROFILE, "profile"),
    itemToLeaf(SETTINGS, "settings"),
    itemToLeaf(HELP_CENTRE, "help"),
    itemToLeaf(PRIVACY_PORTAL, "privacy"),
  ]),
];

/** Limited-access employees: permitted routes only (no PAYE history in tree). */
const LIMITED_ACCESS_NAV_TREE: NavigationNode[] = [
  folder("limited-records", "Records", "nav.group.limited_records", EMP, [
    itemToLeaf(TIMESHEETS, "timesheets"),
    itemToLeaf(PAY_HISTORY, "pay-history"),
  ]),
  folder("limited-profile", "Account", "nav.group.limited_profile", EMP, [
    itemToLeaf(PROFILE, "profile"),
  ]),
];

/** Legacy flat groups kept for desktop top-nav / breadcrumbs helpers. */
const LIMITED_ACCESS_NAV_GROUP_DEFS: NavigationGroupDefinition[] = [
  {
    id: "limited-records",
    label: "Records",
    groupLabelKey: "nav.group.limited_records",
    items: [TIMESHEETS, PAY_HISTORY],
  },
  {
    id: "limited-profile",
    label: "Account",
    groupLabelKey: "nav.group.limited_profile",
    items: [PROFILE],
  },
];

const EMPLOYEE_NAV_GROUP_DEFS: NavigationGroupDefinition[] = [
  { id: "emp-home", label: "Home", groupLabelKey: "nav.group.emp_home", items: [DASHBOARD, MESSAGES] },
  {
    id: "emp-time",
    label: "Time",
    groupLabelKey: "nav.group.emp_time",
    items: [CLOCK, TIME_RECORDS, TIMESHEETS],
  },
  { id: "emp-pay", label: "Pay", groupLabelKey: "nav.group.emp_pay", items: [PAY_HISTORY, PAYE_PAY_HISTORY] },
  { id: "emp-work", label: "Work", groupLabelKey: "nav.group.emp_work", items: [SITE_PROGRESS, FORMS, TOOLBOX_TALKS, RAMS] },
  {
    id: "emp-profile",
    label: "Account",
    groupLabelKey: "nav.group.emp_account",
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
    id: "mgmt-attendance",
    label: "Time & Attendance",
    groupLabelKey: "nav.group.mgmt_attendance",
    items: [CLOCK, LIVE_ATTENDANCE, TIME_RECORDS, TIMESHEETS, WEEK_REPORT],
  },
  {
    id: "mgmt-sites",
    label: "Sites",
    groupLabelKey: "nav.group.mgmt_sites",
    items: [LOCATIONS, SITE_ACCESS, SITE_PROGRESS, WORK_PROGRESS_REVIEW],
  },
  {
    id: "mgmt-payroll",
    label: "Payroll",
    groupLabelKey: "nav.group.mgmt_payroll",
    items: [PAYROLL_REPORT, MONTHLY_PAYE_REPORT, SITE_PAYROLL_RULES, BUDGET_CALCULATOR, ACCOUNTING_LINK],
  },
  {
    id: "mgmt-work",
    label: "Work & Safety",
    groupLabelKey: "nav.group.mgmt_work",
    items: [FORMS_MANAGE, FORMS_REVIEW, TOOLBOX_TALKS_MANAGE, RAMS_MANAGE],
  },
  {
    id: "mgmt-system",
    label: "System",
    groupLabelKey: "nav.group.mgmt_system",
    items: [COMPANIES, AUDIT_LOG, LIVE_LOGS, SYSTEM_HEALTH, ADMIN_GUIDE, SETTINGS, HELP_CENTRE],
  },
  {
    id: "mgmt-workspace",
    label: "My workspace",
    groupLabelKey: "nav.group.my_workspace",
    items: [
      MESSAGES,
      { ...FORMS, label: "My Forms", labelKey: "nav.my_forms" },
      { ...TOOLBOX_TALKS, label: "My Toolbox Talks", labelKey: "nav.my_toolbox_talks" },
      { ...RAMS, label: "My RAMS", labelKey: "nav.my_rams" },
      { ...LEAVE, label: "My Leave", labelKey: "nav.my_leave" },
      STARTER_FORM,
      PROFILE,
      PRIVACY_PORTAL,
    ],
  },
];

export function pathnameMatchesNavHref(itemHref: string, pathname: string): boolean {
  if (itemHref === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === itemHref || pathname.startsWith(`${itemHref}/`);
}

function nodeVisibleForRole(node: NavigationNode, role: SystemRole): boolean {
  return node.allowedRoles.includes(role);
}

/** Recursively filter by role and drop empty folders. */
export function filterNavigationTree(nodes: NavigationNode[], role: SystemRole): NavigationNode[] {
  const out: NavigationNode[] = [];
  for (const node of nodes) {
    if (!nodeVisibleForRole(node, role)) {
      continue;
    }
    if (node.children && node.children.length > 0) {
      const children = filterNavigationTree(node.children, role);
      if (children.length === 0) {
        continue;
      }
      out.push({ ...node, children, href: undefined });
      continue;
    }
    if (node.href) {
      out.push({ ...node, children: undefined });
    }
  }
  return out;
}

export function collectNavigationLeaves(nodes: NavigationNode[]): NavigationItem[] {
  const out: NavigationItem[] = [];
  const walk = (list: NavigationNode[]) => {
    for (const node of list) {
      if (node.href) {
        out.push({
          label: node.label,
          labelKey: node.labelKey,
          href: node.href,
          allowedRoles: node.allowedRoles,
        });
      }
      if (node.children?.length) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return out;
}

export function collectFolderIds(nodes: NavigationNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: NavigationNode[]) => {
    for (const node of list) {
      if (node.children?.length) {
        ids.push(node.id);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return ids;
}

export function nodeContainsActiveRoute(node: NavigationNode, activeHref: string): boolean {
  if (node.href && pathnameMatchesNavHref(node.href, activeHref)) {
    return true;
  }
  return Boolean(node.children?.some((child) => nodeContainsActiveRoute(child, activeHref)));
}

/** Ancestor folder ids from root to the folder that contains the active leaf (inclusive). */
export function findActiveAncestorIds(nodes: NavigationNode[], activeHref: string): string[] {
  const path: string[] = [];
  const walk = (list: NavigationNode[], trail: string[]): boolean => {
    for (const node of list) {
      if (node.href && pathnameMatchesNavHref(node.href, activeHref)) {
        path.push(...trail);
        return true;
      }
      if (node.children?.length) {
        if (walk(node.children, [...trail, node.id])) {
          return true;
        }
      }
    }
    return false;
  };
  walk(nodes, []);
  return path;
}

export function findBestMatchingLeaf(
  nodes: NavigationNode[],
  pathname: string,
): { node: NavigationNode; ancestors: NavigationNode[] } | null {
  let best: { node: NavigationNode; ancestors: NavigationNode[] } | null = null;
  let bestLen = -1;
  const walk = (list: NavigationNode[], ancestors: NavigationNode[]) => {
    for (const node of list) {
      if (node.href && pathnameMatchesNavHref(node.href, pathname) && node.href.length > bestLen) {
        best = { node, ancestors };
        bestLen = node.href.length;
      }
      if (node.children?.length) {
        walk(node.children, [...ancestors, node]);
      }
    }
  };
  walk(nodes, []);
  return best;
}

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
 * Primary (workforce) nav groups — legacy flat shape for helpers / top nav.
 * Employees never receive management groups (see getManagementNavigationGroups).
 */
export function getEmployeeNavigationGroups(
  role: SystemRole,
  options?: { limitedAccess?: boolean },
): NavigationGroupDefinition[] {
  if (options?.limitedAccess && role === "employee") {
    return LIMITED_ACCESS_NAV_GROUP_DEFS;
  }
  if (role === "admin" || role === "administrator") {
    return [];
  }
  return EMPLOYEE_NAV_GROUP_DEFS.map((group) => filterGroup(role, group)).filter(
    (g): g is NavigationGroupDefinition => g !== null,
  );
}

export function getManagementNavigationGroups(role: SystemRole): NavigationGroupDefinition[] {
  if (role === "employee") {
    return [];
  }
  return MANAGEMENT_NAV_GROUP_DEFS.map((group) => filterGroup(role, group)).filter(
    (g): g is NavigationGroupDefinition => g !== null,
  );
}

/** Recursive desktop / mobile sidebar tree for the current role. */
export function getDesktopSidebarNavigationTree(
  role: SystemRole,
  options?: { limitedAccess?: boolean },
): NavigationNode[] {
  if (options?.limitedAccess && role === "employee") {
    return filterNavigationTree(LIMITED_ACCESS_NAV_TREE, role);
  }
  if (role === "admin" || role === "administrator") {
    return filterNavigationTree(MANAGEMENT_NAV_TREE, role);
  }
  return filterNavigationTree(EMPLOYEE_NAV_TREE, role);
}

/**
 * @deprecated Prefer getDesktopSidebarNavigationTree. Flat one-level projection of root folders.
 */
export function getDesktopSidebarNavigationGroups(
  role: SystemRole,
  options?: { limitedAccess?: boolean },
): NavigationGroupDefinition[] {
  const tree = getDesktopSidebarNavigationTree(role, options);
  return tree.map((node) => {
    if (node.href && !node.children?.length) {
      return {
        id: node.id,
        label: node.label,
        groupLabelKey: node.labelKey,
        items: [
          {
            label: node.label,
            labelKey: node.labelKey,
            href: node.href,
            allowedRoles: node.allowedRoles,
          },
        ],
      };
    }
    return {
      id: node.id,
      label: node.label,
      groupLabelKey: node.labelKey,
      items: collectNavigationLeaves(node.children ?? []),
    };
  });
}

export function getNavigationForRole(items: NavigationItem[], role: SystemRole) {
  return items.filter((item) => item.allowedRoles.includes(role));
}

/** Flat list (unique by href) for legacy callers. */
export function getAllNavLinksForRole(role: SystemRole): NavigationItem[] {
  const seen = new Set<string>();
  const out: NavigationItem[] = [];
  for (const item of collectNavigationLeaves(getDesktopSidebarNavigationTree(role))) {
    if (!seen.has(item.href)) {
      seen.add(item.href);
      out.push(item);
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

export type MobileDrawerNavigation = {
  shortcuts: NavigationItem[];
  groups: NavigationGroupDefinition[];
  tree: NavigationNode[];
};

export function getMobileDrawerNavigationTree(
  role: SystemRole,
  options?: { limitedAccess?: boolean },
): NavigationNode[] {
  return getDesktopSidebarNavigationTree(role, options);
}

export function getMobileDrawerNavigationGroups(
  role: SystemRole,
  options?: { limitedAccess?: boolean },
): MobileDrawerNavigation {
  const tree = getMobileDrawerNavigationTree(role, options);
  return {
    shortcuts: [],
    groups: getDesktopSidebarNavigationGroups(role, options),
    tree,
  };
}

/** Flat “More” drawer links — legacy compact shortlist; prefer getMobileDrawerNavigationTree. */
const MOBILE_MORE_LIMITED: NavigationItem[] = [TIMESHEETS, PAY_HISTORY];

const MOBILE_MORE_EMPLOYEE: NavigationItem[] = [MESSAGES, TIME_RECORDS];

const MOBILE_MORE_ADMIN: NavigationItem[] = [
  MESSAGES,
  OVERVIEW,
  TIME_RECORDS,
  LIVE_ATTENDANCE,
  EMPLOYEES,
  LOCATIONS,
  PAYROLL_REPORT,
  MONTHLY_PAYE_REPORT,
];

/**
 * Mobile header drawer: compact flat list. Excludes items already on the bottom bar.
 * Profile, Settings, and Logout stay in the drawer footer.
 */
export function getMobileMoreMenuItems(
  role: SystemRole,
  options?: { limitedAccess?: boolean },
): NavigationItem[] {
  let items: NavigationItem[];
  if (options?.limitedAccess && role === "employee") {
    items = MOBILE_MORE_LIMITED;
  } else if (role === "administrator" || role === "admin") {
    items = MOBILE_MORE_ADMIN;
  } else {
    items = MOBILE_MORE_EMPLOYEE;
  }
  return items
    .filter((item) => itemVisibleForRole(item, role))
    .filter((item) => !MOBILE_QUICK_NAV_HREFS.has(item.href));
}

/** Desktop top bar: single-item groups render as direct links; multi-item groups use dropdowns. */
const DESKTOP_TOP_NAV_LIMITED: NavigationGroupDefinition[] = [
  { id: "desk-timesheets", label: "Timesheets", groupLabelKey: "nav.timesheets", items: [TIMESHEETS] },
  { id: "desk-pay-history", label: "Pay", groupLabelKey: "nav.group.emp_pay", items: [PAY_HISTORY] },
];

const DESKTOP_TOP_NAV_EMPLOYEE: NavigationGroupDefinition[] = [
  { id: "desk-dashboard", label: "Dashboard", groupLabelKey: "nav.dashboard", items: [DASHBOARD] },
  { id: "desk-clock", label: "Clock", groupLabelKey: "nav.clock", items: [CLOCK] },
  { id: "desk-timesheets", label: "Timesheets", groupLabelKey: "nav.timesheets", items: [TIMESHEETS] },
  { id: "desk-pay-history", label: "Pay", groupLabelKey: "nav.group.emp_pay", items: [PAY_HISTORY, PAYE_PAY_HISTORY] },
  {
    id: "desk-work",
    label: "Work",
    groupLabelKey: "nav.group.emp_work",
    items: [SITE_PROGRESS, FORMS, TOOLBOX_TALKS, RAMS],
  },
  {
    id: "desk-more",
    label: "More",
    groupLabelKey: "nav.group.desk_more",
    items: [TIME_RECORDS, STARTER_FORM, LEAVE, HELP_CENTRE, PRIVACY_PORTAL],
  },
];

const DESKTOP_TOP_NAV_MANAGEMENT: NavigationGroupDefinition[] = [
  { id: "desk-overview", label: "Overview", groupLabelKey: "nav.overview", items: [OVERVIEW] },
  { id: "desk-clock", label: "Clock", groupLabelKey: "nav.clock", items: [CLOCK] },
  {
    id: "desk-people",
    label: "People",
    groupLabelKey: "nav.group.mgmt_people",
    items: [EMPLOYEES, LEAVE_MANAGE, ONBOARDING_REVIEW, CLOCK_SELFIES, PRIVACY_REQUESTS],
  },
  {
    id: "desk-sites",
    label: "Sites",
    groupLabelKey: "nav.group.mgmt_sites",
    items: [COMPANIES, LOCATIONS, SITE_ACCESS],
  },
  {
    id: "desk-attendance",
    label: "Attendance",
    groupLabelKey: "nav.group.desk_attendance",
    items: [LIVE_ATTENDANCE, TIME_RECORDS, TIMESHEETS, WEEK_REPORT],
  },
  {
    id: "desk-payroll",
    label: "Payroll",
    groupLabelKey: "nav.group.desk_payroll",
    items: [PAYROLL_REPORT, MONTHLY_PAYE_REPORT, SITE_PAYROLL_RULES, BUDGET_CALCULATOR, ACCOUNTING_LINK],
  },
  {
    id: "desk-work",
    label: "Work",
    groupLabelKey: "nav.group.mgmt_work",
    items: [
      SITE_PROGRESS,
      WORK_PROGRESS_REVIEW,
      FORMS_MANAGE,
      FORMS_REVIEW,
      TOOLBOX_TALKS_MANAGE,
      RAMS_MANAGE,
    ],
  },
  {
    id: "desk-system",
    label: "System",
    groupLabelKey: "nav.group.desk_system",
    items: [AUDIT_LOG, SYSTEM_HEALTH, ADMIN_GUIDE, SETTINGS, HELP_CENTRE],
  },
];

/** Post-login and brand-link default route by role. */
export function getDefaultLandingPath(
  role: SystemRole,
  options?: { limitedAccess?: boolean },
): string {
  if (options?.limitedAccess && role === "employee") {
    return "/pay-history";
  }
  if (role === "administrator" || role === "admin") {
    return "/overview";
  }
  return "/dashboard";
}

export type ResolvedNavigationLocation = {
  groupLabelKey: string;
  groupLabel: string;
  pageLabelKey: string;
  pageLabel: string;
  showGroup: boolean;
};

function pathnameMatchesNavItem(itemHref: string, pathname: string): boolean {
  return pathnameMatchesNavHref(itemHref, pathname);
}

/** Breadcrumb labels for the current route from nav config. */
export function resolveNavigationLocation(
  role: SystemRole,
  pathname: string,
  options?: { limitedAccess?: boolean },
): ResolvedNavigationLocation | null {
  const tree = getDesktopSidebarNavigationTree(role, options);
  const match = findBestMatchingLeaf(tree, pathname);
  if (match) {
    const parent = match.ancestors[match.ancestors.length - 1];
    const root = match.ancestors[0];
    const group = parent ?? root;
    return {
      groupLabelKey: group?.labelKey ?? match.node.labelKey,
      groupLabel: group?.label ?? match.node.label,
      pageLabelKey: match.node.labelKey,
      pageLabel: match.node.label,
      showGroup: Boolean(group && group.id !== match.node.id),
    };
  }

  const seenGroups = new Set<string>();
  const groups: NavigationGroupDefinition[] = [];

  for (const g of getEmployeeNavigationGroups(role, options)) {
    if (!seenGroups.has(g.id)) {
      seenGroups.add(g.id);
      groups.push(g);
    }
  }
  for (const g of getManagementNavigationGroups(role)) {
    if (!seenGroups.has(g.id)) {
      seenGroups.add(g.id);
      groups.push(g);
    }
  }
  for (const g of getDesktopTopNavigationGroups(role, options)) {
    if (!seenGroups.has(g.id)) {
      seenGroups.add(g.id);
      groups.push(g);
    }
  }

  let best: { group: NavigationGroupDefinition; item: NavigationItem } | null = null;
  let bestHrefLen = -1;

  for (const group of groups) {
    for (const item of group.items) {
      if (!pathnameMatchesNavItem(item.href, pathname)) {
        continue;
      }
      if (item.href.length > bestHrefLen) {
        best = { group, item };
        bestHrefLen = item.href.length;
      }
    }
  }

  if (!best) {
    return null;
  }

  const showGroup = best.group.items.length > 1;
  return {
    groupLabelKey: best.group.groupLabelKey,
    groupLabel: best.group.label,
    pageLabelKey: best.item.labelKey,
    pageLabel: best.item.label,
    showGroup,
  };
}

export function getDesktopTopNavigationGroups(
  role: SystemRole,
  options?: { limitedAccess?: boolean },
): NavigationGroupDefinition[] {
  if (options?.limitedAccess && role === "employee") {
    return DESKTOP_TOP_NAV_LIMITED.map((group) => filterGroup(role, group)).filter(
      (g): g is NavigationGroupDefinition => g !== null,
    );
  }
  if (role === "employee") {
    return DESKTOP_TOP_NAV_EMPLOYEE.map((group) => filterGroup(role, group)).filter(
      (g): g is NavigationGroupDefinition => g !== null,
    );
  }
  if (role === "admin" || role === "administrator") {
    return DESKTOP_TOP_NAV_MANAGEMENT.map((group) => filterGroup(role, group)).filter(
      (g): g is NavigationGroupDefinition => g !== null,
    );
  }
  return [];
}
