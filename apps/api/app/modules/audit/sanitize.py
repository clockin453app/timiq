"""Sanitize audit event details for API responses (never mutate persisted rows here)."""

from __future__ import annotations

import json
import re
from typing import Any

_REDACT_SUBSTRINGS = (
    "password",
    "token",
    "secret",
    "storage_path",
    "file_path",
    "signature_image_path",
    "profile_photo_storage_path",
    "authorization",
    "cookie",
    "db_url",
    "database_url",
    "bank",
    "sort_code",
    "account_number",
    "national_insurance",
    "ni_number",
    "utr",
    "medical",
    "iban",
    "bic",
    "credential",
    "api_key",
    "private_key",
    "client_secret",
    "session_secret",
    "oauth",
    "selfie",
    "base64",
    "smtp_password",
)

_FIELD_LABELS: dict[str, str] = {
    "compact_mode": "Compact mode",
    "date_format": "Date format",
    "locale": "Locale",
    "notification_email_enabled": "Email notifications",
    "notification_in_app_enabled": "In-app notifications",
    "push_notifications_enabled": "Push notifications",
    "time_format": "Time format",
    "timezone_name": "Timezone",
    "timezone": "Timezone",
    "user_id": "User",
    "company_id": "Company",
    "location_id": "Site",
    "workplace_id": "CIS workplace",
    "hourly_rate": "Hourly rate",
    "tax_rate": "CIS tax rate",
    "default_tax_rate": "Default tax rate",
    "is_active": "Active status",
    "role": "Role",
    "system_role": "System role",
    "changed_fields": "Changed fields",
    "company_display_name": "Display name",
    "week_start_day": "Week start day",
    "currency_code": "Currency",
    "brand_color": "Brand colour",
    "name": "Name",
    "address": "Address",
    "status": "Status",
}

_ACTION_SUMMARY_ONLY: dict[str, str] = {
    "face_reference.enrolled": "Face reference was enrolled.",
    "face_reference.updated": "Face reference was updated.",
    "face_reference.removed": "Face reference was removed.",
    "face_match.checked": "Face match was checked.",
    "auth.password_reset_requested": "Password reset request recorded.",
    "auth.password_reset_completed": "Password reset completed.",
    "auth.password_changed": "Password was changed.",
    "auth.user_invited": "User invitation sent.",
    "auth.invite_accepted": "User accepted invitation.",
    "auth.email_verification_sent": "Email verification sent.",
    "auth.email_verified": "Email address verified.",
    "payroll_item_approved": "Payroll item approved.",
    "payroll.item_approved": "Payroll item approved.",
    "payroll_item_marked_paid": "Payroll item marked as paid.",
    "payroll.item_marked_paid": "Payroll item marked as paid.",
    "payroll_item_unlocked": "Payroll item unlocked.",
    "payroll.item_unlocked": "Payroll item unlocked.",
    "paye_monthly_recalculated": "PAYE month recalculated.",
    "paye_period_approved": "PAYE period approved.",
    "paye_period_marked_paid": "PAYE period marked paid.",
    "paye_period_undo_paid": "PAYE period moved back from paid.",
    "paye_period_unlocked_to_pending": "PAYE period unlocked to pending.",
    "paye_component_created": "PAYE pay component created.",
    "paye_component_updated": "PAYE pay component updated.",
    "paye_component_deleted": "PAYE pay component deleted.",
    "paye_employee_settings_updated": "Employee PAYE settings updated.",
    "paye_company_settings_updated": "Company PAYE settings updated.",
    "settings.user_preferences_updated": "User preferences updated.",
    "settings.company_updated": "Company settings updated.",
    "onboarding.submitted": "Onboarding form submitted.",
    "onboarding.approved": "Onboarding approved.",
    "onboarding.rejected": "Onboarding rejected.",
    "time_clock.clock_in": "Clock in recorded.",
    "time_clock.clock_out": "Clock out recorded.",
    "time_clock.break_start": "Break started.",
    "time_clock.break_end": "Break ended.",
    "live_attendance.manual_clock_in": "Manual clock in recorded.",
    "live_attendance.manual_clock_out": "Manual clock out recorded.",
    "clock_selfie_viewed": "Clock selfie viewed.",
    "user_hard_deleted": "User permanently deleted.",
    "user_history_cleared": "User history cleared.",
}

_WIN_ABS_PATH = re.compile(r"^[A-Za-z]:\\")
_UNIX_SENSITIVE_PREFIX = (
    "/home/",
    "/Users/",
    "/var/",
    "/usr/",
    "/etc/",
    "/opt/",
    "/tmp/",
    "/private/",
)
_URL_CREDS = re.compile(r"\b(postgresql|postgres|mysql|mariadb|redis|mongodb)://[^\s]+", re.IGNORECASE)
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _key_should_redact(key: str) -> bool:
    lk = key.lower()
    if any(s in lk for s in _REDACT_SUBSTRINGS):
        return True
    if lk == "path" or lk.endswith("_path") or "filepath" in lk or "dirpath" in lk:
        return True
    return False


def _string_value_should_redact(value: str) -> bool:
    s = value.strip()
    if len(s) > 4000:
        return True
    if _WIN_ABS_PATH.search(s):
        return True
    if s.startswith("/") and any(s.startswith(p) for p in _UNIX_SENSITIVE_PREFIX):
        return True
    if _URL_CREDS.search(s):
        return True
    return False


def sanitize_audit_details(details: Any) -> Any:
    if isinstance(details, dict):
        out: dict[str, Any] = {}
        for k, v in details.items():
            ks = str(k)
            if _key_should_redact(ks):
                out[ks] = "[redacted]"
            else:
                out[ks] = sanitize_audit_details(v)
        return out
    if isinstance(details, list):
        return [sanitize_audit_details(x) for x in details]
    if isinstance(details, str):
        if len(details) > 2000:
            return details[:2000] + "…"
        if _string_value_should_redact(details):
            return "[redacted]"
        return details
    return details


def _friendly_field(name: str) -> str:
    key = name.strip()
    if not key:
        return name
    if key in _FIELD_LABELS:
        return _FIELD_LABELS[key]
    return key.replace("_", " ").strip().title()


def _format_action_fallback(action: str) -> str:
    a = (action or "").strip()
    if not a:
        return "Audit event"
    if a in _ACTION_SUMMARY_ONLY:
        return _ACTION_SUMMARY_ONLY[a]
    parts = a.replace(".", " ").replace("_", " ").split()
    if not parts:
        return a
    return " ".join(p[:1].upper() + p[1:].lower() if p else p for p in parts)


def _format_changed_fields(fields: Any) -> str | None:
    if not isinstance(fields, list) or not fields:
        return None
    labels = [_friendly_field(str(f)) for f in fields if str(f).strip()]
    if not labels:
        return None
    return f"Changed fields: {', '.join(labels)}"


def _format_updated_fields(details: dict[str, Any]) -> str | None:
    """Build 'Updated: A, B' from dict keys excluding ids and changed_fields."""
    skip = {
        "changed_fields",
        "actor_user_id",
        "user_id",
        "owner_user_id",
        "subject_user_id",
        "company_id",
        "location_id",
        "workplace_id",
        "entity_id",
        "budget_id",
        "expense_id",
    }
    keys = sorted(k for k in details if k not in skip and not _key_should_redact(k))
    if not keys:
        return None
    labels = [_friendly_field(k) for k in keys]
    return f"Updated: {', '.join(labels)}"


def build_audit_details_summary(action: str, details: Any, *, max_len: int = 320) -> str:
    """Human-readable one-line summary for list views (not raw JSON)."""
    safe = sanitize_audit_details(details)
    action_key = (action or "").strip()

    if action_key in _ACTION_SUMMARY_ONLY and not isinstance(safe, dict):
        text = _ACTION_SUMMARY_ONLY[action_key]
    elif isinstance(safe, dict):
        changed = _format_changed_fields(safe.get("changed_fields"))
        if changed:
            base = _ACTION_SUMMARY_ONLY.get(action_key, _format_action_fallback(action_key))
            if base.endswith("."):
                text = f"{base[:-1]} — {changed}."
            else:
                text = f"{base} — {changed}" if base else changed
        elif action_key in _ACTION_SUMMARY_ONLY:
            text = _ACTION_SUMMARY_ONLY[action_key]
        else:
            updated = _format_updated_fields(safe)
            if updated:
                base = _format_action_fallback(action_key)
                text = f"{base} — {updated}." if base else updated
            elif len(safe) == 1:
                only_key = next(iter(safe))
                val = safe[only_key]
                if isinstance(val, (str, int, float, bool)) and not (
                    isinstance(val, str) and _UUID_RE.match(val.strip())
                ):
                    text = f"{_friendly_field(only_key)}: {val}"
                else:
                    text = _format_action_fallback(action_key)
            elif safe:
                text = _format_action_fallback(action_key)
            else:
                text = _format_action_fallback(action_key)
    else:
        text = _ACTION_SUMMARY_ONLY.get(action_key, _format_action_fallback(action_key))

    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


def audit_details_summary(details: Any, *, max_len: int = 320, action: str = "") -> str:
    """Backward-compatible wrapper; prefer build_audit_details_summary with action."""
    if action:
        return build_audit_details_summary(action, details, max_len=max_len)
    try:
        safe = sanitize_audit_details(details)
        if isinstance(safe, dict):
            changed = _format_changed_fields(safe.get("changed_fields"))
            if changed:
                return changed if len(changed) <= max_len else changed[: max_len - 1] + "…"
        raw = json.dumps(safe, default=str, separators=(",", ":"))
    except (TypeError, ValueError):
        return "[unserializable details]"
    if len(raw) <= max_len:
        return raw
    return raw[: max_len - 1] + "…"
