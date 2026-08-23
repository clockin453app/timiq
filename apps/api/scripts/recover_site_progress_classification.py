"""Recover Site Progress classification from submit audit_events.

Source of truth:
  audit_events.action = 'work_progress.submitted'
  details.work_category / elevation / level / elevation_custom

Architecture (transaction-safe):
  DRY-RUN — read-only Session; emit immutable RecoveryCandidate dataclasses;
            write an immutable allowlist manifest; close Session
  APPLY   — load that exact manifest; re-check live eligibility for those IDs only;
            CLEAN Session (no ORM WorkProgressEntry from scan); guarded UPDATE … RETURNING;
            recovery audit from RETURNING values; single commit; close Session
  VERIFY  — NEW independent Session, then a second independent Session

APPLY never scans for "whatever is currently NULL". It updates only manifest IDs.

Usage:
  python -m scripts.recover_site_progress_classification --dry-run --write-manifest PATH
  python -m scripts.recover_site_progress_classification --apply --manifest PATH --snapshot PATH --confirm-count N
  python -m scripts.recover_site_progress_classification --rollback --snapshot PATH

Do not commit production manifests or snapshots to git.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import uuid
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, func, select, text, update
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import require_database_url
from app.db import models as _models  # noqa: F401 — register full metadata for FK resolution
from app.modules.audit.models import AuditEvent
from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.work_progress.classification import (
    CLASSIFIED_PROGRESS_STATUS,
    ELEVATION_CUSTOM,
    ELEVATION_VALUES,
    LEVEL_MAX,
    LEVEL_MIN,
    WORK_CATEGORY_VALUES,
)
from app.modules.work_progress.models import WorkProgressAttachment, WorkProgressEntry

SUBMIT_ACTION = "work_progress.submitted"
RECOVERY_ACTION = "work_progress.classification_recovered_from_audit"
ROLLBACK_ACTION = "work_progress.classification_recovery_rolled_back"
RECOVERY_SCRIPT_VERSION = "manifest-allowlist-v1"
RECOVERY_REASON = "classification-persistence-final-recovery"
MANIFEST_SCHEMA = "site-progress-classification-recovery-manifest-v1"

# Reporting partition only. Not an APPLY count gate.
GROUP_A_START = datetime(2026, 8, 13, tzinfo=timezone.utc)


@dataclass(frozen=True)
class RecoveryCandidate:
    entry_id: str
    company_id: str
    company_name: str
    employee: str
    site: str
    work_date: str
    title: str
    progress_status: str
    percent_complete: int | None
    attachment_count: int
    audit_id: str
    before_work_category: str | None
    before_elevation: str | None
    before_elevation_custom: str | None
    before_level: int | None
    after_work_category: str
    after_elevation: str
    after_elevation_custom: str | None
    after_level: int
    status: str
    updated_at: str | None = None
    user_id: str = ""
    location_id: str = ""
    created_at: str | None = None
    entry_status: str = ""
    xmin: str | None = None
    group: str = ""


@dataclass
class DryRunReport:
    recoverable: list[RecoveryCandidate]
    already_restored: list[RecoveryCandidate]
    ambiguous: list[RecoveryCandidate]
    conflicts: list[RecoveryCandidate]
    invalid: list[RecoveryCandidate]
    legacy_skipped: list[RecoveryCandidate]
    generated_at: str


@dataclass(frozen=True)
class AppliedRow:
    entry_id: str
    work_category: str
    elevation: str
    elevation_custom: str | None
    level: int
    source_audit_id: str
    company_id: str
    updated_at: str | None


def _display_name(profile: EmployeeProfile | None, email: str) -> str:
    if profile is None:
        return email
    name = f"{(profile.first_name or '').strip()} {(profile.last_name or '').strip()}".strip()
    return name or email


def _parse_level(raw: Any) -> int | None:
    """Parse level; never treat integer 0 as missing."""
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str) and raw.strip().lstrip("-").isdigit():
        return int(raw.strip())
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _entry_xmin(session: Session, entry_id: uuid.UUID) -> str | None:
    bind = session.get_bind()
    if bind is None or bind.dialect.name != "postgresql":
        return None
    return session.execute(
        text("SELECT xmin::text FROM work_progress_entries WHERE id = CAST(:id AS uuid)"),
        {"id": str(entry_id)},
    ).scalar()


def _created_at_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _reporting_group(entry: WorkProgressEntry, previously_recovered_ids: set[str]) -> str:
    if str(entry.id) in previously_recovered_ids:
        return "B"
    created = _created_at_aware(entry.created_at)
    if created is not None and created >= GROUP_A_START:
        return "A"
    return "C"


def _previously_recovered_ids(session: Session) -> set[str]:
    rows = session.scalars(select(AuditEvent.entity_id).where(AuditEvent.action == RECOVERY_ACTION)).all()
    return {str(value) for value in rows if value}


def _classify_row(
    session: Session,
    entry: WorkProgressEntry,
    previously_recovered_ids: set[str],
) -> RecoveryCandidate:
    company = session.get(Company, entry.company_id)
    location = session.get(Location, entry.location_id)
    owner = session.get(User, entry.user_id)
    profile = session.scalar(select(EmployeeProfile).where(EmployeeProfile.user_id == entry.user_id))
    attachment_count = int(
        session.scalar(
            select(func.count())
            .select_from(WorkProgressAttachment)
            .where(WorkProgressAttachment.entry_id == entry.id)
        )
        or 0
    )

    base: dict[str, Any] = {
        "entry_id": str(entry.id),
        "company_id": str(entry.company_id),
        "company_name": company.name if company else "",
        "employee": _display_name(profile, owner.email if owner else ""),
        "site": location.name if location else "",
        "work_date": str(entry.work_date),
        "title": entry.title or "",
        "progress_status": entry.progress_status,
        "percent_complete": entry.percent_complete,
        "attachment_count": attachment_count,
        "audit_id": "",
        "before_work_category": entry.work_category,
        "before_elevation": entry.elevation,
        "before_elevation_custom": entry.elevation_custom,
        "before_level": entry.level,
        "after_work_category": "",
        "after_elevation": "",
        "after_elevation_custom": None,
        "after_level": -1,
        "updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
        "user_id": str(entry.user_id),
        "location_id": str(entry.location_id),
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
        "entry_status": entry.status or "",
        "xmin": _entry_xmin(session, entry.id),
        "group": "",
    }

    if entry.progress_status != CLASSIFIED_PROGRESS_STATUS:
        return RecoveryCandidate(**base, status="skipped_legacy")

    if company is None:
        return RecoveryCandidate(**base, status="invalid")

    audits = list(
        session.scalars(
            select(AuditEvent)
            .where(
                AuditEvent.action == SUBMIT_ACTION,
                AuditEvent.entity_type == "work_progress_entry",
                AuditEvent.entity_id == str(entry.id),
            )
            .order_by(AuditEvent.created_at.asc())
        ).all()
    )
    if len(audits) != 1:
        return RecoveryCandidate(**base, status="ambiguous")

    audit = audits[0]
    details = audit.details or {}
    category = details.get("work_category")
    elevation = details.get("elevation")
    level = _parse_level(details.get("level"))
    custom_raw = details.get("elevation_custom")
    custom = custom_raw.strip() if isinstance(custom_raw, str) and custom_raw.strip() else None
    base["audit_id"] = str(audit.id)

    if (
        not isinstance(category, str)
        or category not in WORK_CATEGORY_VALUES
        or not isinstance(elevation, str)
        or elevation not in ELEVATION_VALUES
        or level is None
        or level < LEVEL_MIN
        or level > LEVEL_MAX
    ):
        return RecoveryCandidate(**base, status="invalid")

    if elevation == ELEVATION_CUSTOM:
        if not custom:
            return RecoveryCandidate(**base, status="invalid")
    elif custom is not None:
        return RecoveryCandidate(**base, status="invalid")

    after = {
        "after_work_category": category,
        "after_elevation": elevation,
        "after_elevation_custom": custom,
        "after_level": level,
    }
    target_null = (
        entry.work_category is None
        and entry.elevation is None
        and entry.elevation_custom is None
        and entry.level is None
    )
    if not target_null:
        if (
            entry.work_category == category
            and entry.elevation == elevation
            and (entry.elevation_custom or None) == custom
            and entry.level == level
        ):
            return RecoveryCandidate(**{**base, **after}, status="already_restored")
        return RecoveryCandidate(**{**base, **after}, status="conflict")

    group = _reporting_group(entry, previously_recovered_ids)
    return RecoveryCandidate(**{**base, **after, "group": group}, status="recoverable")


def scan_candidates(session: Session) -> DryRunReport:
    """Read-only scan. Caller must not reuse loaded ORM entries for APPLY."""
    previously_recovered_ids = _previously_recovered_ids(session)
    entries = list(session.scalars(select(WorkProgressEntry)).all())
    recoverable: list[RecoveryCandidate] = []
    already_restored: list[RecoveryCandidate] = []
    ambiguous: list[RecoveryCandidate] = []
    conflicts: list[RecoveryCandidate] = []
    invalid: list[RecoveryCandidate] = []
    legacy_skipped: list[RecoveryCandidate] = []

    for entry in entries:
        candidate = _classify_row(session, entry, previously_recovered_ids)
        if candidate.status == "recoverable":
            recoverable.append(candidate)
        elif candidate.status == "already_restored":
            already_restored.append(candidate)
        elif candidate.status == "ambiguous":
            ambiguous.append(candidate)
        elif candidate.status == "conflict":
            conflicts.append(candidate)
        elif candidate.status == "invalid":
            invalid.append(candidate)
        else:
            legacy_skipped.append(candidate)

    recoverable.sort(key=lambda row: row.entry_id)
    return DryRunReport(
        recoverable=recoverable,
        already_restored=already_restored,
        ambiguous=ambiguous,
        conflicts=conflicts,
        invalid=invalid,
        legacy_skipped=legacy_skipped,
        generated_at=_utc_now().isoformat(),
    )


def dry_run_is_safe(report: DryRunReport) -> bool:
    return (
        len(report.ambiguous) == 0
        and len(report.conflicts) == 0
        and len(report.invalid) == 0
        and len(report.recoverable) > 0
    )


def print_dry_run(report: DryRunReport) -> None:
    groups = Counter(row.group for row in report.recoverable)
    print("=== SITE PROGRESS CLASSIFICATION RECOVERY DRY-RUN ===")
    print(f"generated_at={report.generated_at}")
    print(f"recovery_script_version={RECOVERY_SCRIPT_VERSION}")
    print(f"recoverable={len(report.recoverable)}")
    print(f"already_restored={len(report.already_restored)}")
    print(f"ambiguous={len(report.ambiguous)}")
    print(f"conflicts={len(report.conflicts)}")
    print(f"invalid={len(report.invalid)}")
    print(f"legacy_skipped={len(report.legacy_skipped)}")
    print(f"group_a={groups.get('A', 0)}")
    print(f"group_b={groups.get('B', 0)}")
    print(f"group_c={groups.get('C', 0)}")
    print(f"expected_count={len(report.recoverable)}")
    print()
    for row in report.recoverable:
        print(
            json.dumps(
                {
                    "submission_id": row.entry_id,
                    "group": row.group,
                    "employee": row.employee,
                    "company": row.company_name,
                    "site": row.site,
                    "work_date": row.work_date,
                    "source_audit_id": row.audit_id,
                    "BEFORE": {
                        "work_category": row.before_work_category,
                        "elevation": row.before_elevation,
                        "elevation_custom": row.before_elevation_custom,
                        "level": row.before_level,
                    },
                    "AFTER": {
                        "work_category": row.after_work_category,
                        "elevation": row.after_elevation,
                        "elevation_custom": row.after_elevation_custom,
                        "level": row.after_level,
                    },
                },
                sort_keys=False,
            )
        )
    if report.ambiguous or report.conflicts or report.invalid:
        print("--- non-recoverable ---")
        for bucket in (report.ambiguous, report.conflicts, report.invalid):
            for row in bucket:
                print(json.dumps(asdict(row), default=str))


def _fingerprint_items(allowlist: list[dict[str, Any]]) -> str:
    payload = []
    for item in sorted(allowlist, key=lambda row: str(row["entry_id"])):
        payload.append(
            {
                "entry_id": item["entry_id"],
                "company_id": item["company_id"],
                "audit_id": item["audit_id"],
                "after_work_category": item["after_work_category"],
                "after_elevation": item["after_elevation"],
                "after_elevation_custom": item.get("after_elevation_custom"),
                "after_level": item["after_level"],
            }
        )
    blob = json.dumps(payload, separators=(",", ":"), sort_keys=True, ensure_ascii=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def build_manifest(report: DryRunReport) -> dict[str, Any]:
    allowlist = [asdict(row) for row in report.recoverable]
    groups = Counter(row.group for row in report.recoverable)
    return {
        "schema": MANIFEST_SCHEMA,
        "recovery_script_version": RECOVERY_SCRIPT_VERSION,
        "recovery_reason": RECOVERY_REASON,
        "generated_at": report.generated_at,
        "manifest_hash": _fingerprint_items(allowlist),
        "allowlist_count": len(allowlist),
        "counts": {
            "recoverable": len(report.recoverable),
            "already_restored": len(report.already_restored),
            "ambiguous": len(report.ambiguous),
            "conflicts": len(report.conflicts),
            "invalid": len(report.invalid),
            "legacy_skipped": len(report.legacy_skipped),
            "group_a": groups.get("A", 0),
            "group_b": groups.get("B", 0),
            "group_c": groups.get("C", 0),
        },
        "legacy_skipped_ids": [row.entry_id for row in report.legacy_skipped],
        "allowlist": allowlist,
    }


def write_manifest(report: DryRunReport, path: Path) -> dict[str, Any]:
    payload = build_manifest(report)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    print(f"manifest_written={path}")
    print(f"manifest_hash={payload['manifest_hash']}")
    print(f"manifest_count={payload['allowlist_count']}")
    return payload


def load_manifest(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema") != MANIFEST_SCHEMA:
        raise SystemExit(f"Unsupported manifest schema: {payload.get('schema')}")
    allowlist = payload.get("allowlist") or []
    if not allowlist:
        raise SystemExit("Manifest allowlist is empty")
    expected_hash = _fingerprint_items(allowlist)
    if payload.get("manifest_hash") != expected_hash:
        raise SystemExit("Manifest hash mismatch — refuse APPLY")
    if payload.get("allowlist_count") != len(allowlist):
        raise SystemExit("Manifest allowlist_count does not match allowlist length")
    ids = [item["entry_id"] for item in allowlist]
    if len(ids) != len(set(ids)):
        raise SystemExit("Manifest contains duplicate entry IDs")
    return payload


def assert_scan_matches_manifest(report: DryRunReport, manifest: dict[str, Any]) -> list[RecoveryCandidate]:
    if not dry_run_is_safe(report):
        raise SystemExit(
            "SAFETY GATE FAILED — live scan has ambiguous/conflict/invalid rows or empty recoverable set"
        )
    live_by_id = {row.entry_id: row for row in report.recoverable}
    manifest_items = list(manifest["allowlist"])
    manifest_ids = [item["entry_id"] for item in manifest_items]
    live_ids = [row.entry_id for row in report.recoverable]
    if set(live_ids) != set(manifest_ids):
        extra = sorted(set(live_ids) - set(manifest_ids))
        missing = sorted(set(manifest_ids) - set(live_ids))
        raise SystemExit(
            "SAFETY GATE FAILED — live recoverable IDs differ from manifest "
            f"extra={extra} missing={missing}"
        )
    matched: list[RecoveryCandidate] = []
    for item in manifest_items:
        live = live_by_id[item["entry_id"]]
        if (
            live.audit_id != item["audit_id"]
            or live.after_work_category != item["after_work_category"]
            or live.after_elevation != item["after_elevation"]
            or (live.after_elevation_custom or None) != (item.get("after_elevation_custom") or None)
            or live.after_level != item["after_level"]
            or live.company_id != item["company_id"]
        ):
            raise SystemExit(
                f"SAFETY GATE FAILED — live values differ from manifest for {item['entry_id']}"
            )
        matched.append(live)
    return matched


def collect_global_counts(session: Session) -> dict[str, int]:
    total = int(session.scalar(select(func.count()).select_from(WorkProgressEntry)) or 0)
    archived = int(
        session.scalar(
            select(func.count())
            .select_from(WorkProgressEntry)
            .where(WorkProgressEntry.status == "archived")
        )
        or 0
    )
    attachments = int(session.scalar(select(func.count()).select_from(WorkProgressAttachment)) or 0)
    return {
        "total_submissions": total,
        "active_submissions": total - archived,
        "archived_submissions": archived,
        "total_attachments": attachments,
    }


def write_pre_apply_snapshot(
    session: Session,
    candidates: list[RecoveryCandidate],
    path: Path,
    *,
    manifest_hash: str,
) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    for candidate in candidates:
        entry_id = uuid.UUID(candidate.entry_id)
        attachments = list(
            session.scalars(
                select(WorkProgressAttachment).where(WorkProgressAttachment.entry_id == entry_id)
            ).all()
        )
        entries.append(
            {
                **asdict(candidate),
                "xmin": _entry_xmin(session, entry_id),
                "attachments": [
                    {
                        "id": str(att.id),
                        "entry_id": str(att.entry_id),
                        "original_filename": att.original_filename,
                        "storage_path": att.storage_path,
                    }
                    for att in attachments
                ],
            }
        )
    payload = {
        "generated_at": _utc_now().isoformat(),
        "recovery_script_version": RECOVERY_SCRIPT_VERSION,
        "recovery_reason": RECOVERY_REASON,
        "manifest_hash": manifest_hash,
        "counts": collect_global_counts(session),
        "allowlist": [asdict(row) for row in candidates],
        "entries": entries,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    print(f"snapshot_written={path}")
    return payload


def write_snapshot(report: DryRunReport, path: Path) -> None:
    """Persist recoverable allowlist from a dry-run report (test helper / dry-run artifact)."""
    payload = build_manifest(report)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    print(f"snapshot_written={path}")


def _make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=True)


def apply_recovery_clean(
    session: Session,
    candidates: list[RecoveryCandidate],
    actor: User,
    *,
    expected_count: int | None = None,
) -> list[AppliedRow]:
    """APPLY using a clean Session that must NOT hold scan ORM WorkProgressEntry instances.

    Uses guarded UPDATE … RETURNING. Audits use persisted RETURNING values.
    Commits once. On any failure rolls back the entire batch.
    expected_count is derived from the caller (len(manifest)), never a baked-in product size.
    """
    if expected_count is None:
        expected_count = len(candidates)
    if expected_count < 1:
        raise SystemExit("SAFETY GATE FAILED: expected_count must be derived from a non-empty manifest")
    if len(candidates) != expected_count:
        raise SystemExit(
            f"SAFETY GATE FAILED: candidate count {len(candidates)} != expected_count {expected_count}"
        )
    if any(c.status != "recoverable" for c in candidates):
        raise SystemExit("SAFETY GATE FAILED: APPLY requires only recoverable candidates")
    if len({c.entry_id for c in candidates}) != len(candidates):
        raise SystemExit("SAFETY GATE FAILED: duplicate candidate IDs")

    for obj in session.identity_map.values():
        if isinstance(obj, WorkProgressEntry):
            raise SystemExit(
                "SAFETY GATE FAILED: APPLY Session already holds WorkProgressEntry ORM "
                "instances — refuse mixed scan/apply Session"
            )

    applied: list[AppliedRow] = []
    now = _utc_now()

    try:
        for candidate in candidates:
            entry_id = uuid.UUID(candidate.entry_id)
            if candidate.after_level is None or candidate.after_level < LEVEL_MIN or candidate.after_level > LEVEL_MAX:
                raise SystemExit(f"Invalid level for {candidate.entry_id}")

            result = session.execute(
                update(WorkProgressEntry)
                .where(WorkProgressEntry.id == entry_id)
                .where(WorkProgressEntry.company_id == uuid.UUID(candidate.company_id))
                .where(WorkProgressEntry.work_category.is_(None))
                .where(WorkProgressEntry.elevation.is_(None))
                .where(WorkProgressEntry.elevation_custom.is_(None))
                .where(WorkProgressEntry.level.is_(None))
                .where(WorkProgressEntry.progress_status == CLASSIFIED_PROGRESS_STATUS)
                .values(
                    work_category=candidate.after_work_category,
                    elevation=candidate.after_elevation,
                    elevation_custom=candidate.after_elevation_custom,
                    level=candidate.after_level,
                    updated_at=now,
                )
                .returning(
                    WorkProgressEntry.id,
                    WorkProgressEntry.work_category,
                    WorkProgressEntry.elevation,
                    WorkProgressEntry.elevation_custom,
                    WorkProgressEntry.level,
                    WorkProgressEntry.updated_at,
                ),
                execution_options={"synchronize_session": False},
            )
            row = result.mappings().first()
            if row is None:
                session.rollback()
                raise SystemExit(
                    f"Conflict during apply for {candidate.entry_id} — guarded UPDATE matched 0 rows; aborting"
                )

            persisted_cat = row["work_category"]
            persisted_elev = row["elevation"]
            persisted_custom = row["elevation_custom"]
            persisted_level = row["level"]
            if (
                persisted_cat != candidate.after_work_category
                or persisted_elev != candidate.after_elevation
                or (persisted_custom or None) != (candidate.after_elevation_custom or None)
                or persisted_level != candidate.after_level
            ):
                session.rollback()
                raise SystemExit(
                    f"RETURNING mismatch for {candidate.entry_id}: "
                    f"got ({persisted_cat},{persisted_elev},{persisted_custom},{persisted_level})"
                )

            create_internal_audit_event(
                db_session=session,
                actor=actor,
                action=RECOVERY_ACTION,
                entity_type="work_progress_entry",
                entity_id=str(entry_id),
                company_id=uuid.UUID(candidate.company_id),
                details={
                    "source_audit_id": candidate.audit_id,
                    "recovery_script_version": RECOVERY_SCRIPT_VERSION,
                    "recovery_reason": RECOVERY_REASON,
                    "work_category": persisted_cat,
                    "elevation": persisted_elev,
                    "elevation_custom": persisted_custom,
                    "level": persisted_level,
                    "before": {
                        "work_category": candidate.before_work_category,
                        "elevation": candidate.before_elevation,
                        "elevation_custom": candidate.before_elevation_custom,
                        "level": candidate.before_level,
                    },
                },
                commit=False,
            )
            applied.append(
                AppliedRow(
                    entry_id=str(entry_id),
                    work_category=persisted_cat,
                    elevation=persisted_elev,
                    elevation_custom=persisted_custom,
                    level=persisted_level,
                    source_audit_id=candidate.audit_id,
                    company_id=candidate.company_id,
                    updated_at=row["updated_at"].isoformat() if row["updated_at"] else None,
                )
            )

        if len(applied) != expected_count:
            session.rollback()
            raise SystemExit(
                f"SAFETY GATE FAILED: RETURNING count {len(applied)} != expected_count {expected_count}"
            )
        session.commit()
    except Exception:
        session.rollback()
        raise

    return applied


def verify_recovered_independent(
    session: Session,
    candidates: list[RecoveryCandidate],
) -> tuple[int, list[str]]:
    """Fresh-session verification against source audit proposed values."""
    mismatches: list[str] = []
    exact = 0
    for candidate in candidates:
        entry = session.get(WorkProgressEntry, uuid.UUID(candidate.entry_id))
        if entry is None:
            mismatches.append(f"{candidate.entry_id}: missing")
            continue
        ok = (
            entry.work_category == candidate.after_work_category
            and entry.elevation == candidate.after_elevation
            and (entry.elevation_custom or None) == (candidate.after_elevation_custom or None)
            and entry.level == candidate.after_level
            and entry.title == candidate.title
            and entry.progress_status == candidate.progress_status
            and entry.percent_complete == candidate.percent_complete
            and entry.status == (candidate.entry_status or entry.status)
            and str(entry.user_id) == (candidate.user_id or str(entry.user_id))
            and str(entry.company_id) == candidate.company_id
            and str(entry.location_id) == (candidate.location_id or str(entry.location_id))
            and str(entry.work_date) == candidate.work_date
        )
        if ok:
            exact += 1
        else:
            mismatches.append(
                f"{candidate.entry_id}: db=({entry.work_category},{entry.elevation},{entry.level}) "
                f"expected=({candidate.after_work_category},{candidate.after_elevation},{candidate.after_level})"
            )
    return exact, mismatches


def rollback_recovery(session: Session, snapshot_path: Path, actor: User) -> int:
    """Conflict-safe rollback: only clear if current values still exactly match recovery write."""
    payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
    allowlist = payload.get("allowlist") or []
    reverted = 0
    now = _utc_now()
    for item in allowlist:
        entry_id = uuid.UUID(item["entry_id"])
        expected_cat = item["after_work_category"]
        expected_elev = item["after_elevation"]
        expected_custom = item.get("after_elevation_custom")
        expected_level = item["after_level"]
        result = session.execute(
            text(
                """
                UPDATE work_progress_entries
                SET work_category = NULL,
                    elevation = NULL,
                    elevation_custom = NULL,
                    level = NULL,
                    updated_at = :updated_at
                WHERE id = :id
                  AND work_category IS NOT DISTINCT FROM :work_category
                  AND elevation IS NOT DISTINCT FROM :elevation
                  AND elevation_custom IS NOT DISTINCT FROM :elevation_custom
                  AND level IS NOT DISTINCT FROM :level
                RETURNING id
                """
            ),
            {
                "id": str(entry_id),
                "work_category": expected_cat,
                "elevation": expected_elev,
                "elevation_custom": expected_custom,
                "level": expected_level,
                "updated_at": now,
            },
        )
        if result.mappings().first() is None:
            session.rollback()
            raise SystemExit(
                f"Rollback refused for {entry_id}: current values differ from recovery snapshot"
            )
        create_internal_audit_event(
            db_session=session,
            actor=actor,
            action=ROLLBACK_ACTION,
            entity_type="work_progress_entry",
            entity_id=str(entry_id),
            company_id=uuid.UUID(item["company_id"]),
            details={
                "source_audit_id": item.get("audit_id"),
                "recovery_script_version": RECOVERY_SCRIPT_VERSION,
                "reverted_from": {
                    "work_category": expected_cat,
                    "elevation": expected_elev,
                    "elevation_custom": expected_custom,
                    "level": expected_level,
                },
            },
            commit=False,
        )
        reverted += 1
    session.commit()
    return reverted


def _system_actor(session: Session) -> User:
    admin = session.scalar(select(User).where(User.system_role == SystemRole.ADMINISTRATOR).limit(1))
    if admin is None:
        raise SystemExit("No Administrator user available to attribute recovery audit events")
    return admin


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--rollback", action="store_true")
    parser.add_argument("--manifest", type=Path, help="Immutable allowlist produced by --dry-run")
    parser.add_argument("--write-manifest", type=Path, help="Dry-run: write the immutable allowlist")
    parser.add_argument("--snapshot", type=Path, help="Snapshot path for apply/rollback")
    parser.add_argument(
        "--confirm-count",
        type=int,
        help="APPLY only: operator-supplied expected allowlist length (must equal len(manifest))",
    )
    args = parser.parse_args(argv)

    engine = create_engine(require_database_url())
    SessionLocal = _make_session_factory(engine)

    if args.dry_run:
        with SessionLocal() as session:
            try:
                session.execute(text("SET TRANSACTION READ ONLY"))
            except Exception:
                pass
            report = scan_candidates(session)
            print_dry_run(report)
            if args.write_manifest:
                if not dry_run_is_safe(report):
                    print("SAFETY GATE FAILED — refusing to write APPLY manifest")
                    return 2
                write_manifest(report, args.write_manifest)
            if args.snapshot:
                write_snapshot(report, args.snapshot)
            if not dry_run_is_safe(report):
                return 2
            return 0

    if args.apply:
        if args.manifest is None:
            raise SystemExit("--manifest is required for --apply")
        if args.snapshot is None:
            raise SystemExit("--snapshot is required for --apply")
        if args.confirm_count is None:
            raise SystemExit("--confirm-count is required for --apply")

        manifest = load_manifest(args.manifest)
        expected_count = len(manifest["allowlist"])
        if args.confirm_count != expected_count:
            raise SystemExit(
                f"SAFETY GATE FAILED: --confirm-count {args.confirm_count} != manifest allowlist {expected_count}"
            )

        with SessionLocal() as scan_session:
            try:
                scan_session.execute(text("SET TRANSACTION READ ONLY"))
            except Exception:
                pass
            report = scan_candidates(scan_session)
            print_dry_run(report)
            candidates = assert_scan_matches_manifest(report, manifest)
            write_pre_apply_snapshot(
                scan_session,
                candidates,
                args.snapshot,
                manifest_hash=manifest["manifest_hash"],
            )

        with SessionLocal() as apply_session:
            actor = _system_actor(apply_session)
            actor_id = actor.id
            actor = apply_session.get(User, actor_id)
            if actor is None:
                raise SystemExit("Actor vanished")
            applied = apply_recovery_clean(
                apply_session,
                candidates,
                actor,
                expected_count=expected_count,
            )
            print(f"applied={len(applied)}")
            print(f"expected_count={expected_count}")

        with SessionLocal() as verify_session:
            exact, mismatches = verify_recovered_independent(verify_session, candidates)
            print(f"independent_verify_exact={exact}/{len(candidates)}")
            if mismatches:
                for item in mismatches:
                    print(f"MISMATCH {item}")
                return 3

        with SessionLocal() as verify2:
            exact2, mismatches2 = verify_recovered_independent(verify2, candidates)
            print(f"second_independent_verify_exact={exact2}/{len(candidates)}")
            if mismatches2 or exact2 != len(candidates):
                for item in mismatches2:
                    print(f"MISMATCH2 {item}")
                return 3

        with SessionLocal() as idem_session:
            try:
                idem_session.execute(text("SET TRANSACTION READ ONLY"))
            except Exception:
                pass
            report2 = scan_candidates(idem_session)
            restored_ids = {row.entry_id for row in report2.already_restored}
            recoverable_ids = {row.entry_id for row in report2.recoverable}
            manifest_ids = {item["entry_id"] for item in manifest["allowlist"]}
            print(
                f"post_apply_recoverable={len(report2.recoverable)} "
                f"post_apply_already_restored={len(report2.already_restored)}"
            )
            if recoverable_ids & manifest_ids:
                return 3
            if not manifest_ids.issubset(restored_ids):
                return 3
            if report2.ambiguous or report2.conflicts or report2.invalid:
                return 3
        return 0

    if args.rollback:
        if args.snapshot is None:
            raise SystemExit("--snapshot is required for --rollback")
        with SessionLocal() as session:
            actor = _system_actor(session)
            reverted = rollback_recovery(session, args.snapshot, actor)
            print(f"reverted={reverted}")
            return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
