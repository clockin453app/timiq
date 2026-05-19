export type AdminGuideSectionId =
  | "quick-start"
  | "roles"
  | "employee-setup"
  | "cis-payroll"
  | "paye-payroll"
  | "time-clocking"
  | "recalc-matrix"
  | "activate-checklist"
  | "common-problems"
  | "unsupported";

export type AdminGuideSection = {
  id: AdminGuideSectionId;
  title: string;
  summary: string;
};

export type QuickStartStep = {
  step: number;
  title: string;
  description: string;
  href?: string;
};

export type RoleGuideRow = {
  role: string;
  canDo: string;
  shouldNotSee: string;
};

export type ChecklistItem = {
  label: string;
  detail: string;
};

export type MatrixRow = {
  state: string;
  actions: string;
  locked: string;
  warning: string;
  fix: string;
};

export type ProblemRow = {
  symptom: string;
  likelyCause: string;
  fix: string;
};

export const ADMIN_GUIDE_SECTIONS: AdminGuideSection[] = [
  {
    id: "quick-start",
    title: "Quick start flow",
    summary: "Recommended order to set up a company and run payroll from scratch.",
  },
  {
    id: "roles",
    title: "Accounts and roles",
    summary: "What each role can do and what they should not see.",
  },
  {
    id: "employee-setup",
    title: "Employee setup",
    summary: "Create accounts, profiles, payroll type, and avoid common mistakes.",
  },
  {
    id: "cis-payroll",
    title: "CIS payroll (weekly)",
    summary: "CIS subcontractors on the Payroll Report — not PAYE employees.",
  },
  {
    id: "paye-payroll",
    title: "PAYE payroll (monthly)",
    summary: "PAYE employees on Monthly PAYE — fixed salary, hourly, and additional pay.",
  },
  {
    id: "time-clocking",
    title: "Time Records and clocking",
    summary: "How shifts are captured, validated, and fed into payroll.",
  },
  {
    id: "recalc-matrix",
    title: "Recalculate / approve / paid",
    summary: "What you can do in each payroll state and how to unlock when locked.",
  },
  {
    id: "activate-checklist",
    title: "Activate and configure checklist",
    summary: "Before expecting correct clocking and payroll, confirm these items.",
  },
  {
    id: "common-problems",
    title: "Common problems",
    summary: "Symptoms, likely causes, and practical fixes.",
  },
  {
    id: "unsupported",
    title: "Not yet implemented",
    summary: "Features TimIQ does not provide today — do not assume HMRC filing or statutory workflows.",
  },
];

export const QUICK_START_STEPS: QuickStartStep[] = [
  {
    step: 1,
    title: "Create company",
    description: "Add the company and set status to active when ready to use it.",
    href: "/companies",
  },
  {
    step: 2,
    title: "Create employee account",
    description: "Add the user, assign company, and set their system role (Employee or Admin).",
    href: "/employees",
  },
  {
    step: 3,
    title: "Set payroll type",
    description: "On the employee profile choose CIS subcontractor or PAYE employee. This controls which payroll screen they appear on.",
    href: "/employees",
  },
  {
    step: 4,
    title: "Add site / location",
    description: "Create locations with GPS and geofence radius where clocking applies.",
    href: "/locations",
  },
  {
    step: 5,
    title: "Assign site access",
    description: "Link employees to the sites they may clock at.",
    href: "/site-access",
  },
  {
    step: 6,
    title: "Configure workplaces (optional)",
    description: "Workplace settings and payroll rules affect CIS calculations where configured.",
    href: "/workplaces",
  },
  {
    step: 7,
    title: "Employee clocks in/out",
    description: "Employees use Clock In / Out with GPS and selfie when required.",
    href: "/clock",
  },
  {
    step: 8,
    title: "Review Time Records",
    description: "Admins correct shifts if needed. Only completed shifts feed payroll.",
    href: "/time-records",
  },
  {
    step: 9,
    title: "Review payroll",
    description: "CIS: weekly Payroll Report. PAYE: Monthly PAYE for the tax month.",
    href: "/payroll-report",
  },
  {
    step: 10,
    title: "Recalculate",
    description: "Run Recalculate after time, rate, or settings changes. CIS shows a warning when recalculation is required.",
  },
  {
    step: 11,
    title: "Approve",
    description: "Approve the week or month when figures are correct. Approval locks recalculation until unlock.",
  },
  {
    step: 12,
    title: "Mark paid & payslips",
    description: "Mark paid when payment is made. Employees view CIS pay history or PAYE payslips; admins use payment history on the payroll screens.",
    href: "/pay-history",
  },
];

export const ROLE_GUIDE_ROWS: RoleGuideRow[] = [
  {
    role: "Administrator",
    canDo:
      "Manage all companies, global settings, system health, live logs, privacy requests, and every management screen across tenants.",
    shouldNotSee:
      "Nothing by role — full platform access. Still follow company context when acting inside a specific company.",
  },
  {
    role: "Company Admin",
    canDo:
      "Manage their own company: employees, sites, time records, payroll (CIS weekly and PAYE monthly), onboarding review, live attendance, and company settings.",
    shouldNotSee:
      "Other companies, global company list (unless also elevated), system health, live logs, and administrator-only guide content.",
  },
  {
    role: "Employee",
    canDo:
      "Clock in/out, view own time records and timesheets, own pay history / PAYE payslips, starter form, site progress, profile, and help.",
    shouldNotSee:
      "Management overview, other employees’ data, payroll approval, company-wide reports, and admin correction tools.",
  },
];

export const EMPLOYEE_SETUP_STEPS: ChecklistItem[] = [
  {
    label: "Create user account",
    detail: "Add login, name, company, and role. Employee role limits data to their own records.",
  },
  {
    label: "Add profile details",
    detail: "Legal name, payroll type, hourly rate or PAYE salary settings, tax identifiers where used.",
  },
  {
    label: "Address and contact",
    detail: "Contact fields used on profile and onboarding; keep accurate for operational use.",
  },
  {
    label: "Choose payroll type",
    detail: "CIS subcontractor → weekly Payroll Report. PAYE employee → Monthly PAYE (not on CIS report).",
  },
  {
    label: "Set rates and payment settings",
    detail: "CIS: hourly rate, effective tax %, payment mode. PAYE: fixed monthly salary and/or hourly, tax code, NI category as configured.",
  },
  {
    label: "Activate employee",
    detail: "Inactive employees cannot clock and should not appear in live payroll rosters.",
  },
];

export const EMPLOYEE_SETUP_MISTAKES: string[] = [
  "Leaving payroll type as PAYE but expecting the employee on the CIS Payroll Report.",
  "Forgetting site access — employee cannot clock at a site they are not assigned to.",
  "Changing hourly rate or CIS tax after payroll was calculated without recalculating the week.",
  "Approving payroll before reviewing Time Records for that week.",
  "Deactivating an employee while they still have an open shift — resolve the shift first.",
];

export const CIS_PAYROLL_POINTS: ChecklistItem[] = [
  {
    label: "Who appears",
    detail: "Only employees with payroll type CIS subcontractor (or no profile yet, treated as CIS-eligible in roster logic). PAYE employees never appear on this report.",
  },
  {
    label: "Time source",
    detail: "Completed shifts in the selected week. Open (in-progress) shifts are excluded until clocked out.",
  },
  {
    label: "Rates and tax",
    detail: "Uses employee hourly rate, effective CIS tax %, and company payment mode (gross/net style) at recalculation time — values are snapshotted on payroll items.",
  },
  {
    label: "Recalculate",
    detail: "Required when time, rates, tax %, payment mode, or policy inputs change. Button may show as needing attention when payroll_needs_recalculation is set or inputs are stale vs stored snapshots.",
  },
  {
    label: "Approve",
    detail: "Locks the week against further recalculation until unlock. Review totals and Time Records first.",
  },
  {
    label: "Mark paid",
    detail: "Records payment for the week. Payment history filters by payroll week when viewing a specific week.",
  },
  {
    label: "Undo paid / unlock approved",
    detail: "Use unlock or undo paid actions on the report when you must change time or rates after approval or payment.",
  },
  {
    label: "After time or rate changes",
    detail: "Recalculate again before re-approving. Payslips and totals reflect the last successful recalculation.",
  },
];

export const PAYE_PAYROLL_POINTS: ChecklistItem[] = [
  {
    label: "Who appears",
    detail: "Employees with payroll type PAYE employee on Monthly PAYE for the selected tax month.",
  },
  {
    label: "Fixed salary vs hourly",
    detail: "Fixed monthly salary employees get predictable monthly gross. Hourly PAYE uses completed time converted for the month where configured.",
  },
  {
    label: "Bonus, commission, additional pay",
    detail: "Add via pay components on the monthly screen. Flags control whether amounts affect gross only or taxable pay.",
  },
  {
    label: "Gross vs taxable pay",
    detail: "Summary cards distinguish total gross from taxable pay when components are flagged accordingly.",
  },
  {
    label: "Tax month and YTD",
    detail: "Calculations are stored per tax month. Year-to-date figures accumulate within the tax year after each monthly recalculation.",
  },
  {
    label: "Recalculate before approve / pay / payslip",
    detail: "Always run Recalculate month after changing time, salary, components, or tax settings. PAYE does not use the same CIS stale flag but stored figures can be out of date until you recalc.",
  },
];

export const PAYE_NOT_IMPLEMENTED: string[] = [
  "HMRC RTI submissions (FPS, EPS, or similar)",
  "P45 / P60 generation or filing",
  "Statutory pay workflows (SSP, SMP, etc.)",
  "Auto-enrolment pension assessment, contributions, or opt-out refunds",
  "HMRC payroll software certification or legal tax guarantees",
];

export const TIME_CLOCKING_POINTS: ChecklistItem[] = [
  {
    label: "Employee clocks from /clock",
    detail: "Clock In / Out is the only place employees start or end shifts (dashboard shortcut opens this page).",
  },
  {
    label: "GPS, radius, selfie",
    detail: "When configured on a location, the app requires valid GPS inside the geofence and selfie metadata on clock events.",
  },
  {
    label: "Admin manual corrections",
    detail: "Time Records allows admins to edit or complete shifts. Edits can trigger payroll recalculation required for CIS weeks.",
  },
  {
    label: "Completed vs open shifts",
    detail: "Payroll uses completed shifts only. An open shift does not contribute hours until clocked out.",
  },
  {
    label: "Payroll impact of edits",
    detail: "Changing hours after payroll was calculated requires Recalculate (and unlock if already approved or paid).",
  },
];

export const RECALC_MATRIX_ROWS: MatrixRow[] = [
  {
    state: "Not calculated (CIS week)",
    actions: "Recalculate, edit time, change rates",
    locked: "Approve and Mark paid",
    warning: "No payroll items or calculated_at empty",
    fix: "Select company/week and press Recalculate",
  },
  {
    state: "Calculated, needs recalculation (CIS)",
    actions: "Recalculate, edit time (may set needs-recalc flag)",
    locked: "Approve until recalculated if policy requires fresh calc",
    warning: "Recalculate button highlighted; banner may show payroll needs recalculation",
    fix: "Press Recalculate after fixing time or rates",
  },
  {
    state: "Calculated, up to date (CIS)",
    actions: "Approve, review payslips, export if available",
    locked: "Recalculate still available until approved",
    warning: "None if inputs match snapshots",
    fix: "Proceed to Approve when satisfied",
  },
  {
    state: "Approved (CIS)",
    actions: "Mark paid, unlock to edit",
    locked: "Recalculate until unlock",
    warning: "Unlock required message on recalc",
    fix: "Unlock approved week, fix data, Recalculate, Approve again",
  },
  {
    state: "Paid (CIS)",
    actions: "Undo paid, then unlock if needed",
    locked: "Recalculate and edits until undo/unlock",
    warning: "Paid badge; history shows week_start for selected week",
    fix: "Undo paid → unlock → fix → Recalculate → Approve → Mark paid",
  },
  {
    state: "Monthly PAYE — draft / not recalculated",
    actions: "Edit components, Recalculate month",
    locked: "Approve / mark paid until figures stored",
    warning: "Totals may be empty or stale",
    fix: "Recalculate month for the tax month",
  },
  {
    state: "Monthly PAYE — calculated",
    actions: "Approve month, generate/view payslips after recalc",
    locked: "Depends on approval state",
    warning: "Component or time changes without recalc → wrong payslip",
    fix: "Recalculate month before approve or payslip",
  },
  {
    state: "Monthly PAYE — approved / paid",
    actions: "Use unlock/undo flows where exposed on Monthly PAYE",
    locked: "Recalculate blocked until unlocked",
    warning: "Same principle as CIS: locked until reversed",
    fix: "Unlock or undo, recalc, re-approve",
  },
];

export const ACTIVATE_CHECKLIST: ChecklistItem[] = [
  { label: "Employee active", detail: "Inactive users cannot clock and should be excluded from operational payroll." },
  { label: "Payroll type set", detail: "CIS vs PAYE determines report placement." },
  { label: "PAYE settings", detail: "Salary, tax code, NI, hourly flag, and monthly components as applicable." },
  { label: "CIS rates and payment mode", detail: "Hourly rate, effective tax %, and company CIS payment mode." },
  { label: "Workplaces and locations", detail: "Sites exist, geofences set, workplaces linked to rules if used." },
  { label: "Site access", detail: "Employee assigned to sites they will clock at." },
  { label: "Clocking requirements", detail: "GPS radius and selfie requirements understood by site staff." },
  { label: "Company settings", detail: "Company active, timezone and policies consistent with operations." },
  { label: "Time and payroll policies", detail: "Rounding, breaks, overtime rules aligned with how you expect payroll to behave." },
];

export const COMMON_PROBLEM_ROWS: ProblemRow[] = [
  {
    symptom: "Employee has time but not on CIS payroll",
    likelyCause: "Employee payroll type is PAYE employee, not CIS subcontractor.",
    fix: "Use Monthly PAYE for PAYE staff, or change profile to CIS only if they are genuinely a CIS subcontractor.",
  },
  {
    symptom: "Recalculate button red / warning banner",
    likelyCause: "Time edited, rate/tax/mode changed, or shift updates after last calculation.",
    fix: "Review Time Records and employee rates, then Recalculate. Unlock first if week is approved or paid.",
  },
  {
    symptom: "Payslip or total differs from expected",
    likelyCause: "Payroll not recalculated after last change, or pay component flags (PAYE) misunderstood.",
    fix: "Recalculate (week or month). Check gross vs taxable flags and completed shift hours.",
  },
  {
    symptom: "Payment history shows wrong week",
    likelyCause: "Viewing payment history without matching the payroll week context.",
    fix: "Select the payroll week on the report; history uses week_start for that week after recent behaviour.",
  },
  {
    symptom: "Edited time not reflected in payroll",
    likelyCause: "Recalculate not run, or payroll approved/paid without unlock.",
    fix: "Recalculate if pending. If approved/paid, unlock or undo paid, then Recalculate and re-approve.",
  },
  {
    symptom: "Employee cannot clock",
    likelyCause: "Inactive account, no site access, outside geofence, or missing GPS/selfie.",
    fix: "Check active status, site access, location settings, and device permissions.",
  },
];

export const UNSUPPORTED_ITEMS: string[] = [
  "HMRC RTI / FPS / EPS submission",
  "P45 / P60 production or filing",
  "Statutory pay (SSP, SMP, parental, etc.)",
  "Auto-enrolment assessment, contributions, or opt-out refunds",
  "HMRC payroll software certification",
  "Legal or tax advice — TimIQ is operational payroll tooling only",
];
