"""ZIP export presentation helpers for Work Progress gallery downloads.

Builds internal archive member paths only. Does not rename object storage.
Does not invent classification for legacy rows.
Does not mutate database objects.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import UUID

from app.modules.work_progress.classification import (
    CLASSIFIED_PROGRESS_STATUS,
    ELEVATION_CUSTOM,
    ELEVATION_CUSTOM_MAX_LEN,
    ELEVATION_LABELS,
    ELEVATION_VALUES,
    LEVEL_MAX,
    LEVEL_MIN,
    WORK_CATEGORY_LABELS,
    WORK_CATEGORY_VALUES,
)

_UNSAFE_COMPONENT = re.compile(r'[/\\:*?"<>|\x00-\x1f]')
_MULTI_SPACE = re.compile(r"\s+")
_MULTI_DASH = re.compile(r"-{2,}")

_COMPONENT_MAX = 80
_FOLDER_NAME_MAX = 180


@dataclass(frozen=True)
class ZipFolderClassification:
    """Read-only presentation labels for one ZIP submission folder. Never written to ORM."""

    work_category: str | None
    elevation: str | None
    elevation_custom: str | None
    level: int | None
    source: str


def parse_submit_audit_classification(details: object) -> tuple[str, str, str | None, int] | None:
    """Return validated audit classification, or None if any field is invalid."""
    if not isinstance(details, dict):
        return None
    category = details.get("work_category")
    elevation = details.get("elevation")
    if not isinstance(category, str) or category not in WORK_CATEGORY_VALUES:
        return None
    if not isinstance(elevation, str) or elevation not in ELEVATION_VALUES:
        return None
    raw_level = details.get("level")
    if isinstance(raw_level, bool) or not isinstance(raw_level, int):
        return None
    if raw_level < LEVEL_MIN or raw_level > LEVEL_MAX:
        return None
    custom: str | None = None
    raw_custom = details.get("elevation_custom")
    if elevation == ELEVATION_CUSTOM:
        if not isinstance(raw_custom, str):
            return None
        custom = raw_custom.strip()
        if not custom or len(custom) > ELEVATION_CUSTOM_MAX_LEN:
            return None
    elif raw_custom and str(raw_custom).strip():
        return None
    return category, elevation, custom, raw_level


def resolve_zip_folder_classification(
    *,
    progress_status: str | None,
    work_category: str | None,
    elevation: str | None,
    elevation_custom: str | None,
    level: int | None,
    submit_audit_payloads: list[object] | None,
) -> ZipFolderClassification:
    """Choose DB classification, a single valid submit-audit payload, or unclassified.

    Does not mutate callers. Does not persist.
    """
    db_category = (work_category or "").strip() or None
    if db_category:
        return ZipFolderClassification(
            work_category=db_category,
            elevation=elevation,
            elevation_custom=elevation_custom,
            level=level,
            source="db",
        )
    if (progress_status or "") != CLASSIFIED_PROGRESS_STATUS:
        return ZipFolderClassification(None, None, None, None, "unclassified")
    payloads = submit_audit_payloads or []
    if len(payloads) != 1:
        return ZipFolderClassification(None, None, None, None, "unclassified")
    parsed = parse_submit_audit_classification(payloads[0])
    if parsed is None:
        return ZipFolderClassification(None, None, None, None, "unclassified")
    category, elev, custom, lvl = parsed
    return ZipFolderClassification(category, elev, custom, lvl, "audit")


def sanitize_zip_path_component(
    value: str | None,
    *,
    fallback: str = "Unknown",
    max_len: int = _COMPONENT_MAX,
) -> str:
    """Sanitize one ZIP folder/file segment against ZIP-slip and OS-unsafe chars."""
    raw = (value or "").strip()
    if not raw:
        return fallback
    # Neutralize drive-like prefixes (C:, D:).
    if len(raw) >= 2 and raw[1] == ":":
        raw = raw[2:].lstrip(" \\/") or fallback
    # Replace path separators instead of taking basename so labels like
    # "Elevation A / Courtyard" remain readable as one folder component.
    raw = raw.replace("\\", "/").replace("/", "-")
    # Collapse traversal tokens.
    raw = raw.replace("..", "-")
    if raw in {".", "-"} or not raw.strip("-. "):
        return fallback
    cleaned = _UNSAFE_COMPONENT.sub("-", raw)
    cleaned = _MULTI_SPACE.sub(" ", cleaned)
    cleaned = _MULTI_DASH.sub("-", cleaned)
    cleaned = cleaned.strip(" .-") or fallback
    if "/" in cleaned or "\\" in cleaned or ".." in cleaned or cleaned in {".", ".."}:
        return fallback
    limit = max(8, max_len)
    return cleaned[:limit].rstrip(" .-") or fallback


def sanitize_zip_filename(original_filename: str | None) -> str:
    """Prefer the original basename, sanitized for safe ZIP membership."""
    name = Path(original_filename or "picture.jpg").name
    name = name.replace("\\", "/").split("/")[-1]
    if not name or name in {".", ".."}:
        name = "picture.jpg"
    if len(name) >= 2 and name[1] == ":":
        name = name[2:].lstrip("\\/") or "picture.jpg"
    stem_ext = Path(name)
    stem = sanitize_zip_path_component(stem_ext.stem, fallback="picture")
    suffix = stem_ext.suffix.lower()
    if not suffix or len(suffix) > 12 or _UNSAFE_COMPONENT.search(suffix):
        suffix = ".jpg"
    else:
        suffix = "." + sanitize_zip_path_component(suffix.lstrip("."), fallback="jpg")
    return f"{stem}{suffix}"


def _unique_arcname(used: set[str], directory: str, filename: str) -> str:
    stem_path = Path(filename)
    stem = stem_path.stem
    suffix = stem_path.suffix
    candidate = f"{directory}/{filename}" if directory else filename
    if candidate not in used:
        used.add(candidate)
        return candidate
    n = 2
    while True:
        alt = f"{stem}-{n}{suffix}"
        candidate = f"{directory}/{alt}" if directory else alt
        if candidate not in used:
            used.add(candidate)
            return candidate
        n += 1


def format_work_date_folder(work_date: date | str | None) -> str:
    if work_date is None:
        return "Unknown-date"
    if isinstance(work_date, str):
        try:
            work_date = date.fromisoformat(work_date[:10])
        except ValueError:
            return sanitize_zip_path_component(work_date, fallback="Unknown-date")
    # Example: 12 Aug 2026
    return work_date.strftime("%d %b %Y")


def _folder_employee(employee_name: str | None, employee_email: str | None) -> str:
    return sanitize_zip_path_component(
        (employee_name or "").strip() or (employee_email or "").strip() or "Unknown-employee",
        fallback="Unknown-employee",
    )


def _folder_level(level: int | None) -> str:
    if level is None:
        return "Unknown level"
    return f"Level {level:02d}"


def _classified_folder_parts(
    *,
    work_category: str,
    elevation: str | None,
    elevation_custom: str | None,
    level: int | None,
    folder_employee: str,
    folder_date: str,
) -> list[str]:
    folder_category = sanitize_zip_path_component(
        WORK_CATEGORY_LABELS.get(work_category, work_category),
        fallback="Category",
    )
    if elevation == ELEVATION_CUSTOM:
        elev_label = (elevation_custom or "").strip() or "Custom elevation"
    elif elevation:
        elev_label = ELEVATION_LABELS.get(elevation, elevation)
    else:
        elev_label = "Unknown elevation"
    folder_elevation = sanitize_zip_path_component(elev_label, fallback="Elevation")
    folder_level = sanitize_zip_path_component(_folder_level(level), fallback="Level")
    return [folder_category, folder_elevation, folder_level, folder_employee, folder_date]


def _legacy_folder_parts(
    *,
    legacy_title: str | None,
    folder_employee: str,
    folder_date: str,
) -> list[str]:
    title = (legacy_title or "").strip() or "Unclassified"
    folder_title = sanitize_zip_path_component(title, fallback="Unclassified")
    return [folder_title, folder_employee, folder_date]


def _unique_submission_folder(base: str, used_folder_by_entry: dict[str, str]) -> str:
    existing = set(used_folder_by_entry.values())
    folder = base
    n = 2
    while folder in existing:
        suffix = f" ({n})"
        trimmed = base[: max(8, _FOLDER_NAME_MAX - len(suffix))].rstrip(" .-") or "Submission"
        folder = f"{trimmed}{suffix}"
        n += 1
    return folder


def build_submission_zip_folder(
    *,
    entry_id: UUID | str | None,
    site_name: str | None,
    include_site: bool,
    work_category: str | None,
    elevation: str | None,
    elevation_custom: str | None,
    level: int | None,
    legacy_title: str | None,
    employee_name: str | None,
    employee_email: str | None,
    work_date: date | str | None,
    used_folder_by_entry: dict[str, str],
) -> str:
    """One descriptive folder per Work Progress submission (entry_id grouping only)."""
    key = str(entry_id) if entry_id is not None else ""
    if key and key in used_folder_by_entry:
        return used_folder_by_entry[key]

    folder_employee = _folder_employee(employee_name, employee_email)
    folder_date = sanitize_zip_path_component(
        format_work_date_folder(work_date),
        fallback="Unknown-date",
    )
    parts: list[str] = []
    if include_site:
        parts.append(sanitize_zip_path_component(site_name, fallback="Unknown-site"))
    if work_category:
        parts.extend(
            _classified_folder_parts(
                work_category=work_category,
                elevation=elevation,
                elevation_custom=elevation_custom,
                level=level,
                folder_employee=folder_employee,
                folder_date=folder_date,
            ),
        )
    else:
        parts.extend(
            _legacy_folder_parts(
                legacy_title=legacy_title,
                folder_employee=folder_employee,
                folder_date=folder_date,
            ),
        )

    joined = " - ".join(part for part in parts if part)
    base = sanitize_zip_path_component(joined, fallback="Submission", max_len=_FOLDER_NAME_MAX)
    folder = _unique_submission_folder(base, used_folder_by_entry)
    if key:
        used_folder_by_entry[key] = folder
    return folder


def build_work_progress_zip_arcname(
    *,
    site_name: str | None,
    work_category: str | None,
    elevation: str | None,
    elevation_custom: str | None,
    level: int | None,
    legacy_title: str | None,
    employee_name: str | None,
    employee_email: str | None,
    work_date: date | str | None,
    original_filename: str | None,
    used_arcnames: set[str],
    entry_id: UUID | str | None = None,
    include_site: bool = False,
    used_folder_by_entry: dict[str, str] | None = None,
) -> str:
    """Build a flat, sanitized ZIP member path for one attachment.

    Presentation only. Callers must pass copies of field values, never mutate ORM rows.
    """
    folder_map = used_folder_by_entry if used_folder_by_entry is not None else {}
    directory = build_submission_zip_folder(
        entry_id=entry_id,
        site_name=site_name,
        include_site=include_site,
        work_category=work_category,
        elevation=elevation,
        elevation_custom=elevation_custom,
        level=level,
        legacy_title=legacy_title,
        employee_name=employee_name,
        employee_email=employee_email,
        work_date=work_date,
        used_folder_by_entry=folder_map,
    )
    filename = sanitize_zip_filename(original_filename)

    posix = PurePosixPath(directory)
    if posix.is_absolute() or ".." in posix.parts:
        directory = sanitize_zip_path_component(
            "-".join(part for part in posix.parts if part not in {"", ".", ".."}),
            fallback="Submission",
            max_len=_FOLDER_NAME_MAX,
        )

    return _unique_arcname(used_arcnames, directory, filename)


def orm_instance_is_modified(obj: Any) -> bool:
    """True when a mapped SQLAlchemy instance has pending attribute changes."""
    try:
        from sqlalchemy import inspect as sa_inspect

        state = sa_inspect(obj, raiseerr=False)
    except Exception:
        return False
    if state is None:
        return False
    return bool(getattr(state, "modified", False))
