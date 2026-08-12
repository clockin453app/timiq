"""Recover Site Progress classification from submit audit_events (CASE C).

Source of truth:
  audit_events.action = 'work_progress.submitted'
  details.work_category / elevation / level / elevation_custom

Default mode is DRY-RUN. Never guesses values. Never touches legacy titled rows.

Usage:
  python -m scripts.recover_site_progress_classification --dry-run
  python -m scripts.recover_site_progress_classification --apply --snapshot PATH
  python -m scripts.recover_site_progress_classification --rollback --snapshot PATH

Do not commit production snapshots to git.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, func, select, text
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
    ELEVATION_VALUES,
    LEVEL_MAX,
    LEVEL_MIN,
    WORK_CATEGORY_VALUES,
)
from app.modules.work_progress.models import WorkProgressAttachment, WorkProgressEntry

SUBMIT_ACTION = "work_progress.submitted"
RECOVERY_ACTION = "work_progress.classification_recovered_from_audit"
ROLLBACK_ACTION = "work_progress.classification_recovery_rolled_back"


@dataclass
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
    status: str  # recoverable | already_restored | ambiguous | conflict | invalid | skipped_legacy


@dataclass
class DryRunReport:
    recoverable: list[RecoveryCandidate]
    already_restored: list[RecoveryCandidate]
    ambiguous: list[RecoveryCandidate]
    conflicts: list[RecoveryCandidate]
    invalid: list[RecoveryCandidate]
    legacy_skipped: list[RecoveryCandidate]
    generated_at: str


def _display_name(profile: EmployeeProfile | None, email: str) -> str:
    if profile is None:
        return email
    name = f"{(profile.first_name or '').strip()} {(profile.last_name or '').strip()}".strip()
    return name or email


def _parse_level(raw: Any) -> int | None:
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


def _classify_row(session: Session, entry: WorkProgressEntry) -> RecoveryCandidate:
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
    }

    if entry.progress_status != CLASSIFIED_PROGRESS_STATUS:
        return RecoveryCandidate(**base, status="skipped_legacy")

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

    return RecoveryCandidate(**{**base, **after}, status="recoverable")


def scan_candidates(session: Session) -> DryRunReport:
    entries = list(session.scalars(select(WorkProgressEntry)).all())
    recoverable: list[RecoveryCandidate] = []
    already_restored: list[RecoveryCandidate] = []
    ambiguous: list[RecoveryCandidate] = []
    conflicts: list[RecoveryCandidate] = []
    invalid: list[RecoveryCandidate] = []
    legacy_skipped: list[RecoveryCandidate] = []

    for entry in entries:
        candidate = _classify_row(session, entry)
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

    return DryRunReport(
        recoverable=recoverable,
        already_restored=already_restored,
        ambiguous=ambiguous,
        conflicts=conflicts,
        invalid=invalid,
        legacy_skipped=legacy_skipped,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


def print_dry_run(report: DryRunReport) -> None:
    print("=== SITE PROGRESS CLASSIFICATION RECOVERY DRY-RUN ===")
    print(f"generated_at={report.generated_at}")
    print(f"recoverable={len(report.recoverable)}")
    print(f"already_restored={len(report.already_restored)}")
    print(f"ambiguous={len(report.ambiguous)}")
    print(f"conflicts={len(report.conflicts)}")
    print(f"invalid={len(report.invalid)}")
    print(f"legacy_skipped={len(report.legacy_skipped)}")
    print()
    for row in report.recoverable:
        print(
            json.dumps(
                {
                    "submission_id": row.entry_id,
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


def gate_exact_18(report: DryRunReport) -> bool:
    return (
        len(report.recoverable) == 18
        and len(report.already_restored) == 0
        and len(report.ambiguous) == 0
        and len(report.conflicts) == 0
        and len(report.invalid) == 0
    )


def write_snapshot(report: DryRunReport, path: Path) -> None:
    payload = {
        "generated_at": report.generated_at,
        "allowlist": [asdict(c) for c in report.recoverable],
        "legacy_skipped_ids": [c.entry_id for c in report.legacy_skipped],
        "counts": {
            "recoverable": len(report.recoverable),
            "already_restored": len(report.already_restored),
            "ambiguous": len(report.ambiguous),
            "conflicts": len(report.conflicts),
            "invalid": len(report.invalid),
            "legacy_skipped": len(report.legacy_skipped),
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    print(f"snapshot_written={path}")


def apply_recovery(session: Session, report: DryRunReport, actor: User) -> int:
    if not gate_exact_18(report):
        raise SystemExit("SAFETY GATE FAILED: dry-run is not exactly 18/0/0/0 — refusing APPLY")

    applied = 0
    for candidate in report.recoverable:
        entry_id = uuid.UUID(candidate.entry_id)
        # Atomic conditional update: only when all classification columns are still NULL.
        result = session.execute(
            text(
                """
                UPDATE work_progress_entries
                SET work_category = :work_category,
                    elevation = :elevation,
                    elevation_custom = :elevation_custom,
                    level = :level
                WHERE id = :id
                  AND work_category IS NULL
                  AND elevation IS NULL
                  AND elevation_custom IS NULL
                  AND level IS NULL
                  AND progress_status = :classified
                """
            ),
            {
                "id": entry_id,
                "work_category": candidate.after_work_category,
                "elevation": candidate.after_elevation,
                "elevation_custom": candidate.after_elevation_custom,
                "level": candidate.after_level,
                "classified": CLASSIFIED_PROGRESS_STATUS,
            },
        )
        if result.rowcount != 1:
            session.rollback()
            raise SystemExit(f"Conflict during apply for {candidate.entry_id} — aborting")

        create_internal_audit_event(
            db_session=session,
            actor=actor,
            action=RECOVERY_ACTION,
            entity_type="work_progress_entry",
            entity_id=str(entry_id),
            company_id=uuid.UUID(candidate.company_id),
            details={
                "source_audit_id": candidate.audit_id,
                "work_category": candidate.after_work_category,
                "elevation": candidate.after_elevation,
                "elevation_custom": candidate.after_elevation_custom,
                "level": candidate.after_level,
                "before": {
                    "work_category": None,
                    "elevation": None,
                    "elevation_custom": None,
                    "level": None,
                },
            },
            commit=False,
        )
        applied += 1

    session.commit()
    return applied


def rollback_recovery(session: Session, snapshot_path: Path, actor: User) -> int:
    payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
    allowlist = payload.get("allowlist") or []
    reverted = 0
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
                    level = NULL
                WHERE id = :id
                  AND work_category IS NOT DISTINCT FROM :work_category
                  AND elevation IS NOT DISTINCT FROM :elevation
                  AND elevation_custom IS NOT DISTINCT FROM :elevation_custom
                  AND level IS NOT DISTINCT FROM :level
                """
            ),
            {
                "id": entry_id,
                "work_category": expected_cat,
                "elevation": expected_elev,
                "elevation_custom": expected_custom,
                "level": expected_level,
            },
        )
        if result.rowcount != 1:
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
    admin = session.scalar(
        select(User).where(User.system_role == SystemRole.ADMINISTRATOR).limit(1)
    )
    if admin is None:
        raise SystemExit("No Administrator user available to attribute recovery audit events")
    return admin


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--rollback", action="store_true")
    parser.add_argument("--snapshot", type=Path, help="Snapshot path for apply/rollback")
    parser.add_argument(
        "--allow-nonexact",
        action="store_true",
        help="Dry-run only: allow exit 0 even when counts are not 18/0/0/0",
    )
    args = parser.parse_args(argv)

    engine = create_engine(require_database_url())
    SessionLocal = sessionmaker(
        bind=engine, autocommit=False, autoflush=False, expire_on_commit=False
    )

    with SessionLocal() as session:
        if args.dry_run:
            try:
                session.execute(text("SET TRANSACTION READ ONLY"))
            except Exception:
                pass
            report = scan_candidates(session)
            print_dry_run(report)
            ok = gate_exact_18(report)
            print(f"gate_exact_18={ok}")
            if args.snapshot:
                write_snapshot(report, args.snapshot)
            if not ok and not args.allow_nonexact:
                return 2
            return 0

        if args.apply:
            if args.snapshot is None:
                raise SystemExit("--snapshot is required for --apply")
            report = scan_candidates(session)
            print_dry_run(report)
            if not gate_exact_18(report):
                print("SAFETY GATE FAILED — refusing APPLY")
                return 2
            write_snapshot(report, args.snapshot)
            actor = _system_actor(session)
            applied = apply_recovery(session, report, actor)
            print(f"applied={applied}")
            report2 = scan_candidates(session)
            print(
                f"post_apply_recoverable={len(report2.recoverable)} "
                f"post_apply_already_restored={len(report2.already_restored)}"
            )
            return 0 if applied == 18 else 3

        if args.rollback:
            if args.snapshot is None:
                raise SystemExit("--snapshot is required for --rollback")
            actor = _system_actor(session)
            reverted = rollback_recovery(session, args.snapshot, actor)
            print(f"reverted={reverted}")
            return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
