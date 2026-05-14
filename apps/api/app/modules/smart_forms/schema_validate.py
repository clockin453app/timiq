"""Validate smart form template JSON and answers (no HTML, bounded size)."""

from __future__ import annotations

import re
from datetime import date
from typing import Any

_SLUG = re.compile(r"^[a-z][a-z0-9_]{0,63}$")

ALLOWED_CATEGORIES = frozenset(
    {
        "daily_checklist",
        "hs_inspection",
        "equipment_check",
        "general",
        "scaffold_inspection",
        "ppe_compliance",
        "housekeeping_inspection",
        "fire_point_inspection",
        "delivery_visitor",
        "site_close_checklist",
    },
)
ALLOWED_TEMPLATE_STATUSES = frozenset({"draft", "active", "archived"})
ALLOWED_SUBMISSION_STATUSES = frozenset({"draft", "submitted", "reviewed", "rejected"})
FIELD_TYPES = frozenset({"text", "textarea", "yes_no", "number", "date", "select", "checkbox"})

MAX_SECTIONS = 40
MAX_FIELDS_PER_SECTION = 80
MAX_LABEL_LEN = 500
MAX_TEXT_ANSWER = 8000
MAX_SELECT_OPTIONS = 50


class SchemaValidationError(ValueError):
    pass


def _require_str(d: dict[str, Any], key: str, *, max_len: int | None = None) -> str:
    v = d.get(key)
    if not isinstance(v, str) or not v.strip():
        raise SchemaValidationError(f"{key} must be a non-empty string.")
    s = v.strip()
    if max_len is not None and len(s) > max_len:
        raise SchemaValidationError(f"{key} is too long.")
    return s


def _optional_str(d: dict[str, Any], key: str, *, max_len: int) -> str | None:
    v = d.get(key)
    if v is None:
        return None
    if not isinstance(v, str):
        raise SchemaValidationError(f"{key} must be a string or null.")
    s = v.strip()
    if len(s) > max_len:
        raise SchemaValidationError(f"{key} is too long.")
    return s or None


def validate_template_schema(schema: dict[str, Any]) -> None:
    if not isinstance(schema, dict):
        raise SchemaValidationError("schema_json must be an object.")
    sections = schema.get("sections")
    if not isinstance(sections, list) or len(sections) == 0:
        raise SchemaValidationError("schema_json.sections must be a non-empty array.")
    if len(sections) > MAX_SECTIONS:
        raise SchemaValidationError("Too many sections.")
    seen_field_ids: set[str] = set()
    for si, sec in enumerate(sections):
        if not isinstance(sec, dict):
            raise SchemaValidationError(f"sections[{si}] must be an object.")
        sid = _require_str(sec, "id", max_len=64)
        if not _SLUG.match(sid):
            raise SchemaValidationError(f"Invalid section id: {sid!r}.")
        _require_str(sec, "title", max_len=200)
        fields = sec.get("fields")
        if not isinstance(fields, list) or len(fields) == 0:
            raise SchemaValidationError(f"sections[{si}].fields must be a non-empty array.")
        if len(fields) > MAX_FIELDS_PER_SECTION:
            raise SchemaValidationError("Too many fields in a section.")
        for fi, field in enumerate(fields):
            if not isinstance(field, dict):
                raise SchemaValidationError(f"sections[{si}].fields[{fi}] must be an object.")
            fid = _require_str(field, "id", max_len=64)
            if not _SLUG.match(fid):
                raise SchemaValidationError(f"Invalid field id: {fid!r}.")
            if fid in seen_field_ids:
                raise SchemaValidationError(f"Duplicate field id: {fid!r}.")
            seen_field_ids.add(fid)
            _require_str(field, "label", max_len=MAX_LABEL_LEN)
            ftype = _require_str(field, "type", max_len=32)
            if ftype not in FIELD_TYPES:
                raise SchemaValidationError(f"Unsupported field type: {ftype!r}.")
            req = field.get("required")
            if not isinstance(req, bool):
                raise SchemaValidationError("field.required must be a boolean.")
            if ftype == "select":
                opts = field.get("options")
                if not isinstance(opts, list) or len(opts) == 0:
                    raise SchemaValidationError("select fields must have a non-empty options array.")
                if len(opts) > MAX_SELECT_OPTIONS:
                    raise SchemaValidationError("Too many select options.")
                for oi, opt in enumerate(opts):
                    if not isinstance(opt, str) or not opt.strip():
                        raise SchemaValidationError("Each select option must be a non-empty string.")
                    if len(opt) > 200:
                        raise SchemaValidationError("Select option too long.")
    extra = set(schema.keys()) - {"sections"}
    if extra:
        raise SchemaValidationError(f"Unknown top-level keys: {sorted(extra)}.")


def iter_field_defs(schema: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for sec in schema.get("sections", []):
        if not isinstance(sec, dict):
            continue
        for field in sec.get("fields", []):
            if isinstance(field, dict):
                out.append(field)
    return out


def validate_answers_against_schema(
    schema: dict[str, Any],
    answers: dict[str, Any],
    *,
    require_all_required: bool,
) -> None:
    if not isinstance(answers, dict):
        raise SchemaValidationError("answers_json must be an object.")
    if any(not isinstance(k, str) for k in answers):
        raise SchemaValidationError("answers_json keys must be strings.")
    allowed_ids = {f["id"] for f in iter_field_defs(schema) if isinstance(f.get("id"), str)}
    for k in answers:
        if k not in allowed_ids:
            raise SchemaValidationError(f"Unknown answer field: {k!r}.")
    for field in iter_field_defs(schema):
        fid = str(field["id"])
        ftype = str(field["type"])
        required = bool(field.get("required"))
        val = answers.get(fid, None)
        if val is None or val == "":
            if required and require_all_required:
                raise SchemaValidationError(f"Missing required field: {fid}.")
            continue
        _validate_single_answer(field, val)


def _validate_single_answer(field: dict[str, Any], val: Any) -> None:
    ftype = field["type"]
    if ftype == "text":
        if not isinstance(val, str) or len(val) > MAX_TEXT_ANSWER:
            raise SchemaValidationError(f"Invalid text value for {field['id']!r}.")
    elif ftype == "textarea":
        if not isinstance(val, str) or len(val) > MAX_TEXT_ANSWER:
            raise SchemaValidationError(f"Invalid textarea value for {field['id']!r}.")
    elif ftype == "yes_no":
        if val not in ("yes", "no"):
            raise SchemaValidationError(f"yes_no field {field['id']!r} must be 'yes' or 'no'.")
    elif ftype == "number":
        if isinstance(val, bool) or not isinstance(val, (int, float)):
            raise SchemaValidationError(f"number field {field['id']!r} must be a number.")
    elif ftype == "date":
        if not isinstance(val, str):
            raise SchemaValidationError(f"date field {field['id']!r} must be an ISO date string.")
        try:
            date.fromisoformat(val.strip()[:10])
        except ValueError as exc:
            raise SchemaValidationError(f"Invalid date for {field['id']!r}.") from exc
    elif ftype == "select":
        opts = [str(o).strip() for o in field.get("options", []) if isinstance(o, str) and o.strip()]
        if not isinstance(val, str) or val not in opts:
            raise SchemaValidationError(f"select field {field['id']!r} must be one of the defined options.")
    elif ftype == "checkbox":
        if not isinstance(val, bool):
            raise SchemaValidationError(f"checkbox field {field['id']!r} must be a boolean.")


def assert_known_category(category: str) -> None:
    if category not in ALLOWED_CATEGORIES:
        raise SchemaValidationError("Invalid category.")


def assert_known_template_status(status: str) -> None:
    if status not in ALLOWED_TEMPLATE_STATUSES:
        raise SchemaValidationError("Invalid template status.")


def assert_known_submission_status(status: str) -> None:
    if status not in ALLOWED_SUBMISSION_STATUSES:
        raise SchemaValidationError("Invalid submission status.")
