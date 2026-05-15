import type { AuditEventListItem } from "./api";

const FIELD_LABELS: Record<string, string> = {
  compact_mode: "Compact mode",
  date_format: "Date format",
  locale: "Locale",
  notification_email_enabled: "Email notifications",
  notification_in_app_enabled: "In-app notifications",
  push_notifications_enabled: "Push notifications",
  time_format: "Time format",
  timezone_name: "Timezone",
  timezone: "Timezone",
  user_id: "User",
  company_id: "Company",
  location_id: "Site",
  workplace_id: "CIS workplace",
  hourly_rate: "Hourly rate",
  tax_rate: "CIS tax rate",
  default_tax_rate: "Default tax rate",
  is_active: "Active status",
  role: "Role",
  system_role: "System role",
  changed_fields: "Changed fields",
  company_display_name: "Display name",
  week_start_day: "Week start day",
  currency_code: "Currency",
  brand_color: "Brand colour",
  name: "Name",
  address: "Address",
  status: "Status",
  configured: "Configured",
  budget_id: "Budget",
  expense_id: "Expense",
  entity_id: "Record",
};

const ACTION_LABELS: Record<string, string> = {
  "settings.user_preferences_updated": "User preferences updated",
  "settings.company_updated": "Company settings updated",
  "face_reference.enrolled": "Face reference enrolled",
  "face_reference.updated": "Face reference updated",
  "face_reference.removed": "Face reference removed",
  "face_match.checked": "Face match checked",
  "auth.password_reset_requested": "Password reset requested",
  "auth.password_reset_completed": "Password reset completed",
  "auth.password_changed": "Password changed",
  "auth.user_invited": "User invited",
  "auth.invite_accepted": "Invite accepted",
  "auth.email_verification_sent": "Email verification sent",
  "auth.email_verified": "Email verified",
  "payroll_item_approved": "Payroll item approved",
  "payroll.item_approved": "Payroll item approved",
  "payroll_item_marked_paid": "Payroll item marked as paid",
  "payroll.item_marked_paid": "Payroll item marked as paid",
  "payroll_item_unlocked": "Payroll item unlocked",
  "payroll.item_unlocked": "Payroll item unlocked",
  "payroll_item_edited": "Payroll item edited",
  "payroll.payslip_viewed": "Payslip viewed",
  "payroll_recalculated": "Payroll recalculated",
  "payroll.report_exported": "Payroll report exported",
  "time_clock.clock_in": "Clock in",
  "time_clock.clock_out": "Clock out",
  "time_clock.break_start": "Break started",
  "time_clock.break_end": "Break ended",
  "live_attendance.manual_clock_in": "Manual clock in",
  "live_attendance.manual_clock_out": "Manual clock out",
  "clock_selfie_viewed": "Clock selfie viewed",
  "onboarding.submitted": "Onboarding submitted",
  "onboarding.approved": "Onboarding approved",
  "onboarding.rejected": "Onboarding rejected",
  "budget.created": "Budget created",
  "budget.updated": "Budget updated",
  "budget.archived": "Budget archived",
  "leave.request_created": "Leave request created",
  "leave.request_approved": "Leave request approved",
  "leave.request_rejected": "Leave request rejected",
  "messaging.message_sent": "Message sent",
  "messaging.announcement_created": "Announcement created",
  "user_hard_deleted": "User deleted",
  "user_history_cleared": "User history cleared",
};

const ID_FIELD_KEYS = new Set([
  "user_id",
  "actor_user_id",
  "owner_user_id",
  "subject_user_id",
  "company_id",
  "location_id",
  "workplace_id",
  "budget_id",
  "expense_id",
  "entity_id",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatAuditFieldLabel(key: string): string {
  const k = key.trim();
  if (!k) {
    return key;
  }
  return FIELD_LABELS[k] ?? k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatAuditActionLabel(action: string): string {
  const a = action.trim();
  if (!a) {
    return "Audit event";
  }
  if (ACTION_LABELS[a]) {
    return ACTION_LABELS[a];
  }
  return a
    .replace(/\./g, " ")
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function shortId(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const s = value.trim();
  if (UUID_RE.test(s)) {
    return s.slice(0, 8);
  }
  return s.length > 12 ? `${s.slice(0, 8)}…` : s;
}

export function formatAuditActor(ev: AuditEventListItem): string {
  return ev.actor_display || ev.actor_email || (ev.actor_user_id ? `User ${shortId(ev.actor_user_id)}` : "System");
}

export function formatAuditSubject(ev: AuditEventListItem): string {
  return (
    ev.subject_display ||
    ev.subject_email ||
    (ev.subject_user_id ? `User ${shortId(ev.subject_user_id)}` : "—")
  );
}

export function formatAuditTarget(ev: AuditEventListItem): string {
  const type = formatAuditFieldLabel(ev.entity_type);
  if (ev.entity_id) {
    return `${type} (${shortId(ev.entity_id)})`;
  }
  return type || "—";
}

export function formatAuditEventSummary(ev: AuditEventListItem): string {
  const summary = (ev.details_summary || "").trim();
  if (summary && !summary.startsWith("{")) {
    return summary;
  }
  return formatSummaryFromDetails(ev.action, ev.details);
}

function formatSummaryFromDetails(action: string, details: Record<string, unknown>): string {
  const changed = details.changed_fields;
  if (Array.isArray(changed) && changed.length > 0) {
    const labels = changed.map((f) => formatAuditFieldLabel(String(f)));
    const base = formatAuditActionLabel(action);
    return `${base}: ${labels.join(", ")}`;
  }
  return formatAuditActionLabel(action);
}

export type AuditDetailRow = {
  key: string;
  label: string;
  value: string;
  muted: boolean;
};

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (Array.isArray(value)) {
    return value.map((v) => formatAuditFieldLabel(String(v))).join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

export function auditDetailRows(details: Record<string, unknown>): AuditDetailRow[] {
  return Object.entries(details).map(([key, value]) => {
    const isId = ID_FIELD_KEYS.has(key) || (typeof value === "string" && UUID_RE.test(value.trim()));
    return {
      key,
      label: formatAuditFieldLabel(key),
      value: formatDetailValue(value),
      muted: isId,
    };
  });
}

export function formatAuditDetailsJson(details: Record<string, unknown>): string {
  return JSON.stringify(details, null, 2);
}
