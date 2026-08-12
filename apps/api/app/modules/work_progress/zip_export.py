"""ZIP export presentation helpers for Work Progress gallery downloads.

Builds internal archive member paths only. Does not rename object storage.
Does not invent classification for legacy rows.
"""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path, PurePosixPath

from app.modules.work_progress.classification import (
    ELEVATION_CUSTOM,
    ELEVATION_LABELS,
    WORK_CATEGORY_LABELS,
)

_UNSAFE_COMPONENT = re.compile(r'[/\\:*?"<>|\x00-\x1f]')
_MULTI_SPACE = re.compile(r"\s+")
_MULTI_DASH = re.compile(r"-{2,}")


def sanitize_zip_path_component(value: str | None, *, fallback: str = "Unknown") -> str:
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
    return cleaned[:120]


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
) -> str:
    """Build a hierarchical, sanitized ZIP member path for one attachment."""
    site = sanitize_zip_path_component(site_name, fallback="Unknown-site")
    employee = sanitize_zip_path_component(
        (employee_name or "").strip() or (employee_email or "").strip() or "Unknown-employee",
        fallback="Unknown-employee",
    )
    day = sanitize_zip_path_component(format_work_date_folder(work_date), fallback="Unknown-date")
    filename = sanitize_zip_filename(original_filename)

    if work_category:
        category = sanitize_zip_path_component(
            WORK_CATEGORY_LABELS.get(work_category, work_category),
            fallback="Category",
        )
        if elevation == ELEVATION_CUSTOM:
            elev_label = (elevation_custom or "").strip() or "Custom elevation"
        elif elevation:
            elev_label = ELEVATION_LABELS.get(elevation, elevation)
        else:
            elev_label = "Unknown elevation"
        elev = sanitize_zip_path_component(elev_label, fallback="Elevation")
        if level is None:
            level_label = "Unknown level"
        else:
            level_label = f"Level {level:02d}"
        level_folder = sanitize_zip_path_component(level_label, fallback="Level")
        directory = "/".join([site, category, elev, level_folder, employee, day])
    else:
        title = (legacy_title or "").strip() or "Unclassified"
        legacy_folder = sanitize_zip_path_component(title, fallback="Unclassified")
        directory = "/".join([site, "Legacy", legacy_folder, employee, day])

    # Absolute / traversal hardening on the joined path.
    posix = PurePosixPath(directory)
    if posix.is_absolute() or ".." in posix.parts:
        directory = "/".join(
            sanitize_zip_path_component(part, fallback="Unknown") for part in posix.parts if part not in {"", ".", ".."}
        )

    return _unique_arcname(used_arcnames, directory, filename)
