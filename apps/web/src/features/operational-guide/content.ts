export type GuideAudience = "employee" | "admin" | "administrator";

export type GuideCategory =
  | "getting_started"
  | "company"
  | "people"
  | "sites"
  | "attendance"
  | "payroll"
  | "leave"
  | "budgets"
  | "work_progress"
  | "forms"
  | "toolbox"
  | "rams"
  | "notifications"
  | "accounting"
  | "privacy"
  | "offline"
  | "operator";

export type GuideItem = {
  title: string;
  body?: string;
  bullets?: string[];
  warning?: string;
  linkHref?: string;
  linkLabel?: string;
};

export type GuideSection = {
  id: string;
  title: string;
  category: GuideCategory;
  audience: GuideAudience[];
  summary: string;
  items: GuideItem[];
};

export const GUIDE_CATEGORIES: GuideCategory[] = [
  "getting_started",
  "company",
  "people",
  "sites",
  "attendance",
  "payroll",
  "leave",
  "budgets",
  "work_progress",
  "forms",
  "toolbox",
  "rams",
  "notifications",
  "accounting",
  "privacy",
  "offline",
  "operator",
];

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    category: "getting_started",
    audience: ["employee", "admin", "administrator"],
    summary:
      "Recommended order to bring a company live in TimIQ, minimum configuration, and a safe end-to-end test loop.",
    items: [
      {
        title: "Recommended setup order",
        bullets: [
          "Confirm the first administrator account exists and can sign in.",
          "Create or select the company and open company settings (timezone, currency, formats, branding).",
          "Define payroll and time policy at company level, then refine per site using site payroll rules where needed.",
          "Create workplaces/locations (sites) with addresses and geofences where clocking validation applies.",
          "Add employees, assign roles, and configure site access so each person can only clock where allowed.",
          "Set hourly rates or payment mode per employee as your process requires.",
          "Run a controlled test: clock → review time records/timesheets/week report → payroll report → pay history / payslip views.",
        ],
        linkHref: "/settings",
        linkLabel: "Settings",
      },
      {
        title: "Minimum setup before daily use",
        body: "Before employees rely on TimIQ for attendance and pay, at least one active site, correct site access, and baseline payroll inputs should be in place. Skipping site access or rates usually produces review noise later.",
      },
      {
        title: "First admin account",
        body: "The global administrator can manage all companies. Company admins operate within their own company. Employees see only their own workforce pages.",
        linkHref: "/companies",
        linkLabel: "Companies (administrator)",
      },
      {
        title: "Test flow checklist",
        bullets: [
          "Employee clocks in and out at an allowed site (see Clocking and attendance).",
          "Reviewer checks time records, timesheets, and week report for the same period.",
          "Payroll report is reviewed while rows are pending; corrections happen before marking paid where possible.",
          "Employee confirms pay history / payslip-style summaries match expectations for that run.",
        ],
        linkHref: "/clock",
        linkLabel: "Clock",
      },
    ],
  },
  {
    id: "company-settings",
    title: "Company settings",
    category: "company",
    audience: ["employee", "admin", "administrator"],
    summary:
      "What company-level preferences control, how they interact with user preferences, and why consistency matters for payroll and reporting.",
    items: [
      {
        title: "Timezone and formats",
        bullets: [
          "Timezone anchors shift days, week boundaries, and payroll periods—set it to where payroll is legally operated if unsure.",
          "Date and time formats affect readability in PDFs, exports, and on-screen tables.",
        ],
        linkHref: "/settings",
        linkLabel: "Settings",
      },
      {
        title: "Currency and display",
        body: "Currency symbols and rounding display follow company defaults in most reports. Keep currency aligned with your statutory payroll currency.",
      },
      {
        title: "Branding and identity",
        bullets: [
          "Company display name appears across the workspace.",
          "Brand colour accents headers and printed/PDF outputs where supported.",
        ],
      },
      {
        title: "Notifications and email",
        bullets: [
          "Notification defaults decide how strongly TimIQ prompts users about approvals, RAMS, toolbox talks, forms, and pay artefacts.",
          "Email verification settings complement account security; users should complete verification when prompted.",
        ],
      },
      {
        title: "Company defaults vs user preferences",
        body: "Company defaults set the baseline (locale, formats, policy hints). Individual users may adjust language where offered; conflicting personal choices should be rare and documented internally.",
      },
    ],
  },
  {
    id: "employees-roles",
    title: "Employees and roles",
    category: "people",
    audience: ["employee", "admin", "administrator"],
    summary:
      "How TimIQ roles differ, what employees can edit, and how onboarding touches sensitive payroll or medical data.",
    items: [
      {
        title: "Role overview",
        bullets: [
          "Employee: personal workforce actions—clock, leave requests, assigned forms, RAMS/toolbox acknowledgements, pay history.",
          "Company admin: company-scoped configuration, approvals, payroll review, people management, and compliance workflows.",
          "Administrator: cross-company operations plus deployment-style diagnostics reserved for trusted operators.",
        ],
        linkHref: "/employees",
        linkLabel: "Employees",
      },
      {
        title: "Site access",
        body: "Even with correct employee records, clocking and site-tied workflows require explicit site access or assignments. Admins should review access after hiring transfers or project changes.",
        linkHref: "/site-access",
        linkLabel: "Site access",
      },
      {
        title: "Profiles and onboarding",
        bullets: [
          "Starter Form / onboarding captures structured data and files for HR review.",
          "Approved onboarding data should flow into profile fields where the product supports it; sensitive payroll fields remain admin-controlled.",
        ],
        linkHref: "/starter-form",
        linkLabel: "Starter Form",
      },
      {
        title: "Onboarding review queue",
        body: "Admins work the onboarding review list before employees are cleared for payroll.",
        linkHref: "/onboarding-review",
        linkLabel: "Onboarding review",
      },
      {
        title: "Password reset, invites, and verification",
        body: "Use the hosted invite and password reset flows rather than sharing passwords. Ask people to verify email so notifications and audit trails stay trustworthy.",
      },
      {
        title: "Sensitive fields",
        warning:
          "National Insurance numbers, UTRs, bank details, and medical disclosures are high-risk. Collect only what you need, restrict exports, and follow your company data-retention policy.",
        bullets: [
          "Employees typically cannot freely edit sensitive payroll or tax fields from the casual profile screen.",
          "Admins should audit who can download onboarding packets or payslip PDFs.",
        ],
      },
    ],
  },
  {
    id: "sites-locations",
    title: "Sites and locations",
    category: "sites",
    audience: ["employee", "admin", "administrator"],
    summary:
      "Creating sites, geofenced locations, assignments, and how per-site payroll rules layer on top of company defaults.",
    items: [
      {
        title: "Creating sites and addresses",
        body: "Workplaces/locations represent real job sites. Keep addresses accurate for maps, geofence radius decisions, and audit evidence.",
        linkHref: "/locations",
        linkLabel: "Locations",
      },
      {
        title: "GPS and geofence usage",
        bullets: [
          "Clocking may require fresh GPS readings inside the configured radius—train crews to wait for a fix before submitting.",
          "Poor device GPS or working at the edge of a fence can cause retries; admins investigate via attendance and selfie review tools.",
        ],
        linkHref: "/clock",
        linkLabel: "Clock",
      },
      {
        title: "Assigning employees",
        body: "Assignments connect people to the sites they may use. Removing access immediately when someone leaves a project reduces mis-clocks.",
        linkHref: "/site-access",
        linkLabel: "Site access",
      },
      {
        title: "Site payroll rules",
        body: "Per-site rules override or refine defaults for overtime, breaks, rounding, and similar parameters. Document which site supplied each shift via payroll review rows.",
        linkHref: "/site-payroll-rules",
        linkLabel: "Site payroll rules",
      },
      {
        title: "Location filters",
        body: "Many operational screens filter by company and site—set filters before bulk approvals to avoid cross-site mistakes.",
      },
    ],
  },
  {
    id: "clocking-attendance",
    title: "Clocking and attendance",
    category: "attendance",
    audience: ["employee", "admin", "administrator"],
    summary:
      "Daily clocking expectations, supporting artefacts (selfies, GPS), downstream reporting, and supervisory oversight.",
    items: [
      {
        title: "Clock in and out",
        bullets: [
          "Employees should clock only when present at the authorised site and shift.",
          "Admins may use live attendance and manual interventions only within your governance policy—TimIQ records the action.",
        ],
        linkHref: "/clock",
        linkLabel: "Clock",
      },
      {
        title: "Selfies, GPS, and breaks",
        body: "Selfies and GPS metadata evidence attendance; breaks adjust payable time depending on rules. Follow your company policy on when breaks must be punched.",
      },
      {
        title: "Open shifts and duplicates",
        bullets: [
          "One open shift at a time is the normal expectation—close shifts promptly.",
          "Duplicate completed shifts for the same day should be rare; if they appear, investigate training or device issues.",
        ],
      },
      {
        title: "Time records, timesheets, and week reports",
        body: "These views chain from raw punches to managerial summaries. Use them before payroll sign-off.",
        linkHref: "/time-records",
        linkLabel: "Time records",
      },
      {
        title: "Timesheets",
        body: "Use the timesheet grid to review daily totals and notes before approving payroll rows.",
        linkHref: "/timesheets",
        linkLabel: "Timesheets",
      },
      {
        title: "Week report",
        body: "Week reports summarise hours, leave, and adjustments for sign-off conversations.",
        linkHref: "/week-report",
        linkLabel: "Week report",
      },
      {
        title: "Live attendance and reviews",
        bullets: [
          "Live attendance shows who is currently on site according to recent clocks.",
          "Late or open shift review queues help admins clean exceptions before payroll locks.",
        ],
        linkHref: "/live-attendance",
        linkLabel: "Live attendance",
      },
    ],
  },
  {
    id: "payroll-workflow",
    title: "Payroll review and payslips",
    category: "payroll",
    audience: ["employee", "admin", "administrator"],
    summary:
      "Statuses from pending to paid, locking behaviour, adjustments, CIS display context, and employee pay history.",
    items: [
      {
        title: "Weekly payroll review rhythm",
        bullets: [
          "Import or accumulate approved time, then review totals and anomalies in the payroll report.",
          "Communicate cut-off times so field edits finish before approval.",
        ],
        linkHref: "/payroll-report",
        linkLabel: "Payroll report",
      },
      {
        title: "Pending, approved, and paid",
        body: "Rows move through workflow states reflecting review progress. Paid rows lock to preserve statutory and dispute evidence.",
      },
      {
        title: "Late shifts after paid",
        body: "If time arrives after a payroll run is marked paid, use adjustment rows or a follow-on run according to your finance policy—do not silently rewrite history.",
      },
      {
        title: "Adjustments and undo paid",
        bullets: [
          "Adjustment rows document deltas with reasons.",
          "Undo paid actions should include a reason and be rare; pair them with accountant guidance.",
        ],
      },
      {
        title: "Gross vs net and CIS display",
        body: "Gross amounts reflect contractual earnings before statutory deductions in typical configurations. Construction Industry Scheme (CIS) tax displays where enabled—interpretation remains with your payroll advisor.",
      },
      {
        title: "Payslips and pay history",
        body: "Employees review historical pay items and PDF-style artefacts from pay history. Admins should verify names, rates, and sites before publishing.",
        linkHref: "/pay-history",
        linkLabel: "Pay history",
      },
      {
        title: "Administrator checklist before marking paid",
        bullets: [
          "Spot-check high earners, leavers, and new starters.",
          "Confirm leave and adjustments are represented.",
          "Export accounting extracts if your close process requires them.",
        ],
        warning:
          "TimIQ records payroll calculations and workflow status, but your company remains responsible for checking payroll with your accountant or payroll process.",
      },
    ],
  },
  {
    id: "leave-management",
    title: "Leave",
    category: "leave",
    audience: ["employee", "admin", "administrator"],
    summary:
      "Requesting leave, approvals, policies, balances, and how leave intersects with week reports and payroll review.",
    items: [
      {
        title: "Leave types",
        bullets: [
          "Annual leave, sick leave, unpaid leave, and other authorised absence categories help reporting stay consistent.",
          "Configure naming to match your contracts and statutory schemes.",
        ],
        linkHref: "/leave",
        linkLabel: "Leave",
      },
      {
        title: "Employee requests",
        body: "Employees submit windows and reasons; attachments may be required for certain categories. Track status in the leave hub.",
      },
      {
        title: "Admin approval and rejection",
        body: "Managers see queues on the leave management screen. Rejections should include a reason employees can act on.",
        linkHref: "/leave/manage",
        linkLabel: "Leave management",
      },
      {
        title: "Policies, balances, and adjustments",
        bullets: [
          "Policies define accrual and entitlement baselines.",
          "Balance adjustments document manual corrections with audit value.",
        ],
      },
      {
        title: "Leave in week reports and payroll",
        body: "Authorised leave should appear consistently across week reports and payroll review so gross pay matches reality. Paid leave automation may still be evolving—treat review-only behaviour as a prompt to double-check with HR.",
      },
    ],
  },
  {
    id: "budgets",
    title: "Budgets",
    category: "budgets",
    audience: ["admin", "administrator"],
    summary:
      "Saved budgets, planned versus actual labour, materials, purchases, and how remaining budget signals risk.",
    items: [
      {
        title: "Saved budgets and planning",
        bullets: [
          "Create a saved budget per project or site phase with a planned envelope.",
          "Labour costs roll up from approved time and rates where integrated.",
        ],
        linkHref: "/budgets",
        linkLabel: "Budget calculator",
      },
      {
        title: "Cost categories",
        body: "Track materials, tools, equipment, subcontractor spend, and miscellaneous purchases separately for clearer forecasts.",
      },
      {
        title: "Remaining and over-budget signals",
        body: "Dashboard cards highlight remaining budget or overrun risk early—pair quantitative signals with site lead judgement.",
      },
      {
        title: "Reports and exports",
        body: "Export CSV slices for finance packs. Quote-vs-actual analytics may deepen over time—note any product gaps in your internal runbooks.",
      },
    ],
  },
  {
    id: "work-progress",
    title: "Work progress",
    category: "work_progress",
    audience: ["employee", "admin", "administrator"],
    summary:
      "Site progress uploads, photos, comments, review queues, attachments, and offline sync caveats.",
    items: [
      {
        title: "Field uploads",
        bullets: [
          "Employees attach progress photos, notes, and files tied to a site visit.",
          "Use descriptive comments so remote reviewers understand context.",
        ],
        linkHref: "/site-progress",
        linkLabel: "Site progress",
      },
      {
        title: "Work progress review",
        body: "Managers filter by company/site/state before approving or requesting rework.",
        linkHref: "/work-progress-review",
        linkLabel: "Work progress review",
      },
      {
        title: "Offline queue behaviour",
        warning:
          "Queued uploads stay on device until sync succeeds. Duplicate submissions are rare but possible if a device loses acknowledgement—ask crews to retry consciously.",
        bullets: [
          "Watch the offline banner for pending counts.",
          "Large media may need Wi-Fi before sync completes.",
        ],
      },
    ],
  },
  {
    id: "forms-checklists",
    title: "Forms and checklists",
    category: "forms",
    audience: ["employee", "admin", "administrator"],
    summary:
      "Template lifecycle, builder tools, employee submissions, signatures, reviews, PDFs, and retention expectations.",
    items: [
      {
        title: "Templates and presets",
        bullets: [
          "Start from professional presets for daily checks, inspections, and equipment walkthroughs.",
          "Clone presets before heavy customisation so you can roll back.",
        ],
        linkHref: "/forms",
        linkLabel: "Forms",
      },
      {
        title: "Template management",
        bullets: [
          "Open the template manager to edit schema, publish changes, and retire old versions.",
        ],
        linkHref: "/forms/manage",
        linkLabel: "Form templates",
      },
      {
        title: "Builder and advanced JSON",
        body: "The visual builder covers most cases. Advanced JSON remains for engineers—invalid schemas can break submissions.",
      },
      {
        title: "Submissions, signatures, and review",
        bullets: [
          "Employees launch forms from the forms hub after choosing a site where required.",
          "Drawn signatures and timestamps evidence completion.",
          "Reviewers approve or reject with comments; rejected forms return to the submitter.",
        ],
        linkHref: "/forms/review",
        linkLabel: "Form review",
      },
      {
        title: "PDF download",
        body: "PDF exports support site files and audits. Regenerate instead of editing PDFs manually.",
      },
      {
        title: "Delete vs archive policy",
        warning:
          "Draft templates without submissions can be deleted safely. Once submitted, especially for compliance topics, prefer archive and review rather than destroying records.",
      },
    ],
  },
  {
    id: "toolbox-talks",
    title: "Toolbox talks",
    category: "toolbox",
    audience: ["employee", "admin", "administrator"],
    summary:
      "Scheduling briefings, attendee assignments, signatures, PDF records, notifications, and retention.",
    items: [
      {
        title: "Authoring and templates",
        body: "Managers create topics, attach sites, and publish schedules. Reuse proven talk libraries for consistent messaging.",
        linkHref: "/toolbox-talks/manage",
        linkLabel: "Manage toolbox talks",
      },
      {
        title: "Employee sign-off",
        bullets: [
          "Assigned employees read content, acknowledge attendance, and apply drawn signatures when configured.",
          "Declined talks should capture reasons for follow-up.",
        ],
        linkHref: "/toolbox-talks",
        linkLabel: "Toolbox talks",
      },
      {
        title: "PDF records and notifications",
        body: "Exports back up what was delivered. Notification bells nudge pending signers—remind crews to sync if offline.",
      },
      {
        title: "Archive and deletion",
        body: "Treat signed PDFs like safety programme evidence—retain for the period your H&S advisor recommends.",
      },
    ],
  },
  {
    id: "rams-risk",
    title: "RAMS / risk assessments",
    category: "rams",
    audience: ["employee", "admin", "administrator"],
    summary:
      "Structured hazards, controls, PPE, risk scoring, acknowledgements, PDF packs, and professional review reminders.",
    items: [
      {
        title: "RAMS presets and structure",
        bullets: [
          "Start from RAMS presets covering typical construction activities.",
          "Document hazards, people at risk, controls, and PPE in structured blocks.",
        ],
        linkHref: "/rams/manage",
        linkLabel: "Manage RAMS",
      },
      {
        title: "Risk matrix and photos",
        body: "Initial and residual scores show whether controls actually reduce risk. Photo slots capture site-specific context.",
      },
      {
        title: "Employee acknowledgement",
        body: "Assigned workers read, acknowledge, or decline with reasons. Offline acknowledgement may be blocked—check connectivity before relying on field sign-off.",
        linkHref: "/rams",
        linkLabel: "RAMS",
      },
      {
        title: "PDF pack",
        body: "Export combined PDFs for site files or client portals after internal review.",
      },
      {
        title: "Archive and deletion",
        body: "Archive published RAMS instead of deleting whenever possible to preserve traceability.",
        warning:
          "RAMS templates help produce structured safety records. They do not replace competent health and safety review.",
      },
    ],
  },
  {
    id: "notifications-messages",
    title: "Notifications and messages",
    category: "notifications",
    audience: ["employee", "admin", "administrator"],
    summary:
      "In-app notification behaviour, messaging, announcements, and refresh expectations without third-party push dependencies.",
    items: [
      {
        title: "Notification bell",
        bullets: [
          "Unread indicators summarise pending approvals, RAMS, toolbox talks, forms, payslips, and week-report alerts.",
          "Marking items as read is per-user; clearing noise helps prioritise real risks.",
        ],
      },
      {
        title: "Messages and group chats",
        body: "Direct messaging keeps coordination inside TimIQ. Group chats may be available depending on rollout—treat them as operational, not legal evidence, unless your policy states otherwise.",
        linkHref: "/messages",
        linkLabel: "Messages",
      },
      {
        title: "Announcements and newsfeed",
        body: "Company announcements complement bell notifications for broadcast updates.",
      },
      {
        title: "Refresh behaviour",
        body: "Chat and notification lists refresh when you open panels or reload pages—there is no separate mobile push provider unless your tenant configures one later.",
      },
    ],
  },
  {
    id: "accounting-exports",
    title: "Accounting exports",
    category: "accounting",
    audience: ["admin", "administrator"],
    summary:
      "CSV foundations, mapped exports toward Xero/QuickBooks/Sage styles, audit expectations, and OAuth scope.",
    items: [
      {
        title: "Generic CSV",
        body: "Use CSV exports for ad-hoc analysis or interim loads into spreadsheets.",
        linkHref: "/accounting",
        linkLabel: "Accounting exports",
      },
      {
        title: "Mapped vendor formats",
        bullets: [
          "TimIQ provides mapping settings toward common ledger patterns.",
          "Validate totals against the payroll report before importing anywhere.",
        ],
      },
      {
        title: "No live OAuth sync yet",
        warning:
          "Foundation builds export files; continuous cloud sync and third-party OAuth tokens are not stored in this baseline.",
      },
      {
        title: "Export audit trail",
        body: "Record who exported what and when in your operational runbook; pair with the system audit log for investigations.",
        linkHref: "/system/audit-log",
        linkLabel: "Audit log",
      },
    ],
  },
  {
    id: "privacy-audit",
    title: "Privacy and audit",
    category: "privacy",
    audience: ["employee", "admin", "administrator"],
    summary:
      "Audit logs, privacy requests, data categories, and how admins should minimise unnecessary exports of personal data.",
    items: [
      {
        title: "Audit log",
        body: "Immutable-style audit entries support investigations. Filter by actor, company, and event type when troubleshooting.",
        linkHref: "/system/audit-log",
        linkLabel: "Audit log",
      },
      {
        title: "Privacy portal and requests",
        bullets: [
          "Employees can read policy acknowledgements and submit privacy requests.",
          "Admins track requests through the privacy requests queue.",
        ],
        linkHref: "/privacy",
        linkLabel: "Data & privacy",
      },
      {
        title: "Data categories and access",
        body: "Understand which modules hold personal, financial, health, and biometric-adjacent metadata (such as clock selfies) before granting broad export rights.",
      },
      {
        title: "Responsible handling",
        warning:
          "Admins should avoid exporting private employee data unless there is a documented business need, and should store exports securely outside TimIQ according to policy.",
      },
    ],
  },
  {
    id: "offline-mode",
    title: "Offline mode",
    category: "offline",
    audience: ["employee", "admin", "administrator"],
    summary:
      "What queues locally, what still requires a live session, and warnings for shared devices.",
    items: [
      {
        title: "What queues offline",
        bullets: [
          "Site progress uploads may queue with photos.",
          "Starter form drafts and some smart forms may keep local drafts depending on feature flags.",
        ],
      },
      {
        title: "What does not work offline",
        bullets: [
          "Clocking confirmation that depends on live validation.",
          "Payroll mutations and paid-state changes.",
          "Signing flows unless explicitly marked online-only (toolbox/RAMS acknowledgements typically require connectivity).",
        ],
      },
      {
        title: "Sync warnings",
        body: "If sync repeatedly fails, capture screenshots for IT and avoid deleting queued items until support confirms server state.",
      },
      {
        title: "Shared devices",
        warning:
          "Shared tablets should use individual logins—never reuse a personal session for an entire crew, or HR data may leak across users.",
      },
    ],
  },
  {
    id: "deployment-operator",
    title: "Deployment and operator notes",
    category: "operator",
    audience: ["administrator"],
    summary:
      "High-level checklist for hosting TimIQ: health, backups, storage, email, and Render deployment. No secret values are shown here.",
    items: [
      {
        title: "Health checks and backups",
        bullets: [
          "Monitor API readiness via the system health page after deployments.",
          "Automate Postgres backups and test restores quarterly.",
        ],
        linkHref: "/system/health",
        linkLabel: "System health",
      },
      {
        title: "Object storage and uploads",
        body: "Configure a supported storage backend for production—local disk is development-only. Never commit bucket secrets to source control.",
      },
      {
        title: "SMTP and outbound email",
        body: "Enable SMTP parameters so invites, password resets, and verification emails deliver. SPF/DKIM/DMARC remain your DNS team's responsibility.",
      },
      {
        title: "Render deployment",
        body: "Follow docs/render-deployment.md for ordered service creation, environment wiring, and smoke tests.",
      },
      {
        title: "Environment variable categories (names only)",
        bullets: [
          "DATABASE_URL — primary application database.",
          "SESSION_SECRET — cookie signing secret for the API tier.",
          "TIMIQ_STORAGE_BACKEND and TIMIQ_S3_BUCKET — object storage routing.",
          "TIMIQ_EMAIL_ENABLED plus SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD — mail delivery.",
          "API_PROXY_URL — server-side Next rewrite target for /api (recommended on Render); NEXT_PUBLIC_API_URL empty = same-origin /api in the browser.",
        ],
        warning:
          "Never paste real secrets into tickets or help articles. Rotate credentials if exposure is suspected.",
      },
    ],
  },
];
