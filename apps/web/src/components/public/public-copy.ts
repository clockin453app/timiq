/** Compliant marketing copy for public pages (no HMRC/RTI/P45/P60 false claims). */

export const PUBLIC_BRAND = {
  name: "TimIQ",
  tagline: "Payroll & workforce",
} as const;

export const PUBLIC_HERO = {
  headline: "Payroll and workforce management for modern site teams.",
  subheadline:
    "TimIQ brings time tracking, CIS payroll, PAYE workflows, onboarding, sites, approvals, and employee self-service into one operational workspace.",
} as const;

export const PUBLIC_PAYE_DISCLAIMER =
  "Monthly PAYE supports fixed salary, hourly from completed shifts, monthly-threshold overtime, and bonus/commission components. RTI/HMRC submission, P45/P60, statutory pay, auto-enrolment assessment, and pension opt-out refunds are not enabled yet.";

export const PUBLIC_TRUST_ITEMS = [
  "Built for UK workforce operations",
  "Role-based access",
  "Audit-friendly payroll workflows",
  "Mobile-ready for site teams",
] as const;

export const PUBLIC_LOGIN_BENEFITS = [
  {
    title: "Clock in/out and attendance",
    description: "GPS-aware time clock, live attendance, and shift records for site teams.",
    icon: "clock" as const,
  },
  {
    title: "CIS payroll reporting",
    description: "Supports CIS payroll workflows with reporting built for operational review.",
    icon: "cis" as const,
  },
  {
    title: "Monthly PAYE workflows",
    description: "Monthly PAYE payroll tools are being expanded for UK pay runs.",
    icon: "paye" as const,
  },
  {
    title: "Employee onboarding",
    description: "Starter forms, document uploads, and admin review in one place.",
    icon: "onboarding" as const,
  },
  {
    title: "Pay history and payslips",
    description: "PAYE payslips and employee pay history for your workforce.",
    icon: "wallet" as const,
  },
  {
    title: "Company and site management",
    description: "Companies, workplaces, locations, and site access for multi-site operations.",
    icon: "sites" as const,
  },
] as const;

export const PUBLIC_PRODUCT_SECTIONS = [
  {
    title: "Workforce operations in one place",
    body: "TimIQ is built for UK payroll and workforce operations. Administrators, company admins, and employees each get a focused workspace for day-to-day work.",
  },
  {
    title: "CIS and PAYE payroll",
    body: "Supports CIS payroll workflows alongside monthly PAYE payroll tools. Use CIS payroll reporting for subcontractor pay runs and monthly PAYE for employed staff.",
  },
  {
    title: "Time, attendance, and sites",
    body: "Time and attendance tracking with clock events, timesheets, and live attendance visibility. Company and site management keeps people assigned to the right locations.",
  },
  {
    title: "Onboarding and documents",
    body: "Employee onboarding with starter forms, file uploads, and review queues. Forms, leave, RAMS, and toolbox talks support site compliance workflows.",
  },
  {
    title: "Audit-friendly by design",
    body: "Role-based access and company-scoped data help teams work safely. Audit logs support operational review without overstating compliance certifications.",
  },
] as const;

export const PUBLIC_FEATURE_GROUPS = [
  {
    title: "Time & attendance",
    items: [
      "Clock in and out with site validation",
      "Time records, timesheets, and week reports",
      "Live attendance for managers",
      "Clock selfie review where enabled",
    ],
    icon: "clock" as const,
  },
  {
    title: "CIS payroll",
    items: [
      "CIS payroll report and pay workflows",
      "Workplace and site payroll rules",
      "Payment history and operational exports",
    ],
    icon: "cis" as const,
  },
  {
    title: "Monthly PAYE payroll",
    items: [
      "Monthly PAYE periods and components",
      "PAYE payslips and employee pay history",
      "Fixed salary, hourly, overtime, and bonus components",
    ],
    icon: "paye" as const,
  },
  {
    title: "Employee self-service",
    items: [
      "Dashboard, profile, and pay history",
      "Starter form / onboarding submissions",
      "Site progress and assigned workflows",
    ],
    icon: "employee" as const,
  },
  {
    title: "Company & site management",
    items: [
      "Companies, workplaces, and locations",
      "Employee and site access assignment",
      "Management overview for admins",
    ],
    icon: "sites" as const,
  },
  {
    title: "Audit & reporting",
    items: [
      "Audit log for operational events",
      "Accounting exports where configured",
      "System health visibility for administrators",
    ],
    icon: "audit" as const,
  },
] as const;

export const PUBLIC_SECURITY_POINTS = [
  {
    title: "Role-based access",
    body: "Administrator, company admin, and employee roles control which pages and actions each user can access.",
  },
  {
    title: "Company-scoped data",
    body: "Company admins work within their organisation. Employees see their own records and assigned site workflows.",
  },
  {
    title: "Secure sign-in",
    body: "Email and password authentication with session handling designed for operational teams—not a consumer social login.",
  },
  {
    title: "Audit-friendly workflows",
    body: "Audit logs help teams review important actions. This supports operational accountability without claiming legal compliance guarantees.",
  },
  {
    title: "Operational privacy controls",
    body: "Privacy and data-request workflows exist for in-app governance. TimIQ does not claim SOC 2 or ISO certification unless separately documented by your organisation.",
  },
] as const;

export const PUBLIC_NAV = [
  { href: "/product", label: "Product" },
  { href: "/features", label: "Features" },
  { href: "/security", label: "Security" },
] as const;

/** Demo / contact CTA — update mailto here when sales inbox changes. */
export const PUBLIC_DEMO_CTA = {
  title: "Book a free demo",
  subtitle:
    "Want to see how TimIQ could fit your workforce and payroll workflow? Get in touch and we'll walk you through the platform.",
  primaryLabel: "Get in touch",
  secondaryLabel: "Sign in",
  mailto: "mailto:p2333762@gmail.com?subject=TimIQ%20demo%20request",
} as const;
